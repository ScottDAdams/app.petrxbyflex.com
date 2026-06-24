"""Read-only SQL aggregates for PetRx ops admin (Phase 1)."""

from __future__ import annotations

import logging

from sqlalchemy import text

from ..models.database import get_db

logger = logging.getLogger(__name__)

# Direct-to-consumer traffic: no Shopify merchant attributed (shop_id null or placeholder 0)
DEFAULT_SHOP_URL = 'default_shop'
DEFAULT_SHOP_ID = 0
DIRECT_ATTRIBUTION_LABEL = 'DIRECT'
DIRECT_WHERE_SQL = '(p.shop_id IS NULL OR p.shop_id = :default_shop_id)'

# Funnel drill-down filters (must match fetch_signups_funnel bucket logic)
FUNNEL_FILTER_LABELS = {
    'all': 'All signups',
    'with_session': 'Started insurance',
    'hp_completed': 'HP completed',
    'hp_unknown': 'HP unknown',
    'in_funnel': 'In funnel',
    'no_session': 'Card only',
}

_FUNNEL_FILTER_SQL = {
    'with_session': 'es.session_id IS NOT NULL',
    'hp_completed': "es.hp_enrollment_status = 'completed'",
    'hp_unknown': "es.hp_enrollment_status = 'enroll_submitted_unknown'",
    'in_funnel': (
        'es.session_id IS NOT NULL AND (es.hp_enrollment_status IS NULL '
        "OR es.hp_enrollment_status NOT IN ('completed', 'enroll_submitted_unknown'))"
    ),
    'no_session': 'es.session_id IS NULL',
}


def normalize_funnel_filter(value: str | None) -> str:
    key = (value or 'all').strip().lower()
    if key in FUNNEL_FILTER_LABELS:
        return key
    return 'all'

_SIGNUP_ENROLLMENT_LATERAL = '''
    LEFT JOIN LATERAL (
        SELECT
            es.session_id,
            es.hp_enrollment_status,
            es.current_step,
            es.lead_id,
            es.selected_plan_id,
            es.created_at AS session_created_at
        FROM enrollment_sessions es
        WHERE es.member_id = p.member_id
        ORDER BY es.created_at DESC
        LIMIT 1
    ) es ON TRUE
'''


def fetch_dashboard_stats() -> dict:
    stats = {
        'installed_shops': 0,
        'setup_complete': 0,
        'setup_in_progress': 0,
        'petrx_enabled': 0,
        'signups_30d': 0,
        'hp_completed_30d': 0,
        'hp_unknown_30d': 0,
        'direct_signups_30d': 0,
        'direct_hp_completed_30d': 0,
        'needs_revalidation': 0,
    }
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT
                    COUNT(*) FILTER (WHERE access_token IS NOT NULL) AS installed_shops,
                    COUNT(*) FILTER (WHERE setup_status = 'complete') AS setup_complete,
                    COUNT(*) FILTER (
                        WHERE access_token IS NOT NULL
                          AND setup_status IN ('not_started', 'in_progress')
                    ) AS setup_in_progress,
                    COUNT(*) FILTER (WHERE petrx_enabled IS TRUE) AS petrx_enabled,
                    COUNT(*) FILTER (
                        WHERE needs_revalidation IS TRUE
                           OR setup_status = 'needs_revalidation'
                    ) AS needs_revalidation
                FROM shops
            ''')).mappings().first()
            if row:
                for key in ('installed_shops', 'setup_complete', 'setup_in_progress',
                            'petrx_enabled', 'needs_revalidation'):
                    stats[key] = int(row[key] or 0)

            funnel = db.execute(text('''
                SELECT
                    (SELECT COUNT(*) FROM pet_prescription_signups
                     WHERE created_at >= NOW() - INTERVAL '30 days') AS signups_30d,
                    (SELECT COUNT(*) FROM enrollment_sessions es
                     WHERE es.created_at >= NOW() - INTERVAL '30 days'
                       AND es.hp_enrollment_status = 'completed') AS hp_completed_30d,
                    (SELECT COUNT(*) FROM enrollment_sessions es
                     WHERE es.created_at >= NOW() - INTERVAL '30 days'
                       AND es.hp_enrollment_status = 'enroll_submitted_unknown') AS hp_unknown_30d,
                    (SELECT COUNT(*) FROM pet_prescription_signups p
                     WHERE (p.shop_id IS NULL OR p.shop_id = 0)
                       AND p.created_at >= NOW() - INTERVAL '30 days') AS direct_signups_30d,
                    (SELECT COUNT(DISTINCT es.session_id)
                     FROM enrollment_sessions es
                     INNER JOIN pet_prescription_signups p ON p.member_id = es.member_id
                     WHERE (p.shop_id IS NULL OR p.shop_id = 0)
                       AND es.hp_enrollment_status = 'completed'
                       AND es.created_at >= NOW() - INTERVAL '30 days') AS direct_hp_completed_30d
            ''')).mappings().first()
            if funnel:
                stats['signups_30d'] = int(funnel['signups_30d'] or 0)
                stats['hp_completed_30d'] = int(funnel['hp_completed_30d'] or 0)
                stats['hp_unknown_30d'] = int(funnel['hp_unknown_30d'] or 0)
                stats['direct_signups_30d'] = int(funnel['direct_signups_30d'] or 0)
                stats['direct_hp_completed_30d'] = int(funnel['direct_hp_completed_30d'] or 0)
    except Exception as e:
        logger.error('fetch_dashboard_stats: %s', e)
    return stats


def fetch_dashboard_alerts(limit: int = 12) -> list[dict]:
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT shop_url, name, setup_status, petrx_enabled,
                       last_compat_verdict, needs_revalidation, last_heartbeat_status
                FROM shops
                WHERE access_token IS NOT NULL
                  AND (
                    COALESCE(needs_revalidation, FALSE) IS TRUE
                    OR setup_status = 'needs_revalidation'
                    OR last_compat_verdict = 'red'
                    OR (setup_status <> 'complete' AND petrx_product_id IS NULL)
                  )
                ORDER BY updated_at DESC NULLS LAST
                LIMIT :lim
            '''), {'lim': limit}).mappings().all()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error('fetch_dashboard_alerts: %s', e)
        return []


def fetch_partners_list() -> list[dict]:
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT
                    s.id,
                    s.shop_url,
                    s.name AS shop_name,
                    s.created_at,
                    s.setup_status,
                    s.petrx_enabled,
                    s.install_method,
                    s.last_heartbeat_at,
                    s.last_heartbeat_status,
                    s.last_compat_verdict,
                    COALESCE(s.needs_revalidation, FALSE) AS needs_revalidation,
                    (s.access_token IS NOT NULL) AS installed,
                    (s.petrx_product_id IS NOT NULL AND s.petrx_product_id <> '') AS has_product,
                    COALESCE(sig.signup_count, 0) AS signup_count,
                    COALESCE(sig.signups_30d, 0) AS signups_30d,
                    COALESCE(hp.hp_completed_count, 0) AS hp_completed_count,
                    COALESCE(ct.contact_count, 0) AS contact_count,
                    COALESCE(fc.has_financial, FALSE) AS has_financial_contact
                FROM shops s
                LEFT JOIN (
                    SELECT shop_id,
                           COUNT(*) AS signup_count,
                           COUNT(*) FILTER (
                               WHERE created_at >= NOW() - INTERVAL '30 days'
                           ) AS signups_30d
                    FROM pet_prescription_signups
                    WHERE shop_id IS NOT NULL
                    GROUP BY shop_id
                ) sig ON sig.shop_id = s.id
                LEFT JOIN (
                    SELECT p.shop_id, COUNT(DISTINCT es.session_id) AS hp_completed_count
                    FROM enrollment_sessions es
                    INNER JOIN pet_prescription_signups p
                        ON p.member_id = es.member_id AND p.shop_id IS NOT NULL
                    WHERE es.hp_enrollment_status = 'completed'
                    GROUP BY p.shop_id
                ) hp ON hp.shop_id = s.id
                LEFT JOIN (
                    SELECT shop_id, COUNT(*) AS contact_count
                    FROM shop_contacts
                    GROUP BY shop_id
                ) ct ON ct.shop_id = s.id
                LEFT JOIN (
                    SELECT shop_id, TRUE AS has_financial
                    FROM shop_contacts
                    WHERE role = 'financial'
                    GROUP BY shop_id
                ) fc ON fc.shop_id = s.id
                WHERE s.shop_url <> :default_shop
                ORDER BY s.created_at DESC NULLS LAST
            '''), {'default_shop': DEFAULT_SHOP_URL}).mappings().all()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error('fetch_partners_list: %s', e)
        return []


def fetch_direct_channel_stats() -> dict:
    """Aggregate stats for DIRECT channel (no merchant shop attributed)."""
    channel = {
        'label': DIRECT_ATTRIBUTION_LABEL,
        'signup_count': 0,
        'signups_30d': 0,
        'hp_completed_count': 0,
        'hp_unknown_count': 0,
        'signups_shop_id_null': 0,
        'signups_shop_id_zero': 0,
    }
    try:
        with get_db() as db:
            row = db.execute(text(f'''
                SELECT
                    COUNT(*) AS signup_count,
                    COUNT(*) FILTER (
                        WHERE p.created_at >= NOW() - INTERVAL '30 days'
                    ) AS signups_30d,
                    COUNT(*) FILTER (WHERE p.shop_id IS NULL) AS signups_shop_id_null,
                    COUNT(*) FILTER (WHERE p.shop_id = :default_shop_id) AS signups_shop_id_zero
                FROM pet_prescription_signups p
                WHERE {DIRECT_WHERE_SQL}
            '''), {'default_shop_id': DEFAULT_SHOP_ID}).mappings().first()
            hp = db.execute(text(f'''
                SELECT
                    COUNT(DISTINCT es.session_id) FILTER (
                        WHERE es.hp_enrollment_status = 'completed'
                    ) AS hp_completed_count,
                    COUNT(DISTINCT es.session_id) FILTER (
                        WHERE es.hp_enrollment_status = 'enroll_submitted_unknown'
                    ) AS hp_unknown_count
                FROM enrollment_sessions es
                INNER JOIN pet_prescription_signups p ON p.member_id = es.member_id
                WHERE {DIRECT_WHERE_SQL}
            '''), {'default_shop_id': DEFAULT_SHOP_ID}).mappings().first()
            if row:
                for key in ('signup_count', 'signups_30d', 'signups_shop_id_null', 'signups_shop_id_zero'):
                    channel[key] = int(row[key] or 0)
            if hp:
                channel['hp_completed_count'] = int(hp['hp_completed_count'] or 0)
                channel['hp_unknown_count'] = int(hp['hp_unknown_count'] or 0)
    except Exception as e:
        logger.error('fetch_direct_channel_stats: %s', e)
    return channel


def fetch_direct_enrollment_sessions(*, limit: int = 25) -> list[dict]:
    try:
        with get_db() as db:
            rows = db.execute(text(f'''
                SELECT
                    es.session_id,
                    es.member_id,
                    es.hp_enrollment_status,
                    es.current_step,
                    es.funnel_type,
                    es.lead_id,
                    es.created_at,
                    es.updated_at,
                    p.pet_name,
                    p.email
                FROM enrollment_sessions es
                INNER JOIN pet_prescription_signups p ON p.member_id = es.member_id
                WHERE {DIRECT_WHERE_SQL}
                ORDER BY es.created_at DESC
                LIMIT :lim
            '''), {'default_shop_id': DEFAULT_SHOP_ID, 'lim': limit}).mappings().all()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error('fetch_direct_enrollment_sessions: %s', e)
        return []


def fetch_hidden_direct_signups_count(*, days: int | None = 30) -> int:
    """DIRECT signups that merchants-only filter would hide."""
    clauses = [DIRECT_WHERE_SQL]
    params: dict = {'default_shop_id': DEFAULT_SHOP_ID}
    if days is not None:
        clauses.append('p.created_at >= NOW() - make_interval(days => :days)')
        params['days'] = days
    where_sql = ' AND '.join(clauses)
    try:
        with get_db() as db:
            row = db.execute(
                text(f'SELECT COUNT(*) AS n FROM pet_prescription_signups p WHERE {where_sql}'),
                params,
            ).mappings().first()
            return int(row['n'] or 0) if row else 0
    except Exception as e:
        logger.error('fetch_hidden_direct_signups_count: %s', e)
        return 0


def fetch_signups_funnel(
    *,
    shop_id: int | None = None,
    include_default_shop: bool = True,
    direct_only: bool = False,
    days: int | None = 30,
) -> dict:
    """Aggregate card signups vs insurance funnel (latest enrollment session per member)."""
    stats = {
        'total': 0,
        'with_session': 0,
        'hp_completed': 0,
        'hp_unknown': 0,
        'in_funnel': 0,
        'no_session': 0,
    }
    clauses = ['1=1']
    params: dict = {'default_shop_id': DEFAULT_SHOP_ID}
    if direct_only:
        clauses.append(DIRECT_WHERE_SQL)
    elif shop_id is not None:
        clauses.append('p.shop_id = :shop_id')
        params['shop_id'] = shop_id
    elif not include_default_shop:
        clauses.append('(p.shop_id IS NULL OR p.shop_id <> :default_shop_id)')
    if days is not None:
        clauses.append('p.created_at >= NOW() - make_interval(days => :days)')
        params['days'] = days

    where_sql = ' AND '.join(clauses)
    try:
        with get_db() as db:
            row = db.execute(text(f'''
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE es.session_id IS NOT NULL) AS with_session,
                    COUNT(*) FILTER (WHERE es.hp_enrollment_status = 'completed') AS hp_completed,
                    COUNT(*) FILTER (
                        WHERE es.hp_enrollment_status = 'enroll_submitted_unknown'
                    ) AS hp_unknown,
                    COUNT(*) FILTER (
                        WHERE es.session_id IS NOT NULL
                          AND (es.hp_enrollment_status IS NULL
                               OR es.hp_enrollment_status NOT IN (
                                   'completed', 'enroll_submitted_unknown'
                               ))
                    ) AS in_funnel,
                    COUNT(*) FILTER (WHERE es.session_id IS NULL) AS no_session
                FROM pet_prescription_signups p
                {_SIGNUP_ENROLLMENT_LATERAL}
                WHERE {where_sql}
            '''), params).mappings().first()
            if row:
                for key in stats:
                    stats[key] = int(row[key] or 0)
    except Exception as e:
        logger.error('fetch_signups_funnel: %s', e)
    return stats


def fetch_signups_list(
    *,
    shop_id: int | None = None,
    include_default_shop: bool = True,
    direct_only: bool = False,
    funnel_filter: str = 'all',
    days: int | None = 30,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    clauses = ['1=1']
    params: dict = {'lim': limit, 'off': offset, 'default_shop_id': DEFAULT_SHOP_ID}
    if direct_only:
        clauses.append(DIRECT_WHERE_SQL)
    elif shop_id is not None:
        clauses.append('p.shop_id = :shop_id')
        params['shop_id'] = shop_id
    elif not include_default_shop:
        clauses.append('(p.shop_id IS NULL OR p.shop_id <> :default_shop_id)')
    if days is not None:
        clauses.append('p.created_at >= NOW() - make_interval(days => :days)')
        params['days'] = days
    funnel_filter = normalize_funnel_filter(funnel_filter)
    if funnel_filter != 'all':
        clauses.append(_FUNNEL_FILTER_SQL[funnel_filter])

    where_sql = ' AND '.join(clauses)
    try:
        with get_db() as db:
            rows = db.execute(text(f'''
                SELECT
                    p.id,
                    p.created_at,
                    p.member_id,
                    p.owner_first_name,
                    p.owner_last_name,
                    p.email,
                    p.pet_name,
                    p.pet_type,
                    p.pet_breed_name,
                    p.zip_code,
                    p.campaign,
                    p.aff_id,
                    p.shop_id,
                    s.shop_url,
                    es.session_id,
                    es.hp_enrollment_status,
                    es.current_step,
                    es.lead_id,
                    es.selected_plan_id,
                    es.session_created_at
                FROM pet_prescription_signups p
                LEFT JOIN shops s ON s.id = p.shop_id
                {_SIGNUP_ENROLLMENT_LATERAL}
                WHERE {where_sql}
                ORDER BY p.created_at DESC
                LIMIT :lim OFFSET :off
            '''), params).mappings().all()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error('fetch_signups_list: %s', e)
        return []


def fetch_signup_detail(signup_id: int) -> dict | None:
    try:
        with get_db() as db:
            signup = db.execute(text('''
                SELECT p.*, s.shop_url, s.name AS shop_name
                FROM pet_prescription_signups p
                LEFT JOIN shops s ON s.id = p.shop_id
                WHERE p.id = :sid
            '''), {'sid': signup_id}).mappings().first()
            if not signup:
                return None
            sessions = db.execute(text('''
                SELECT
                    session_id, member_id, funnel_type, current_step,
                    hp_enrollment_status, hp_registration_redirect_url,
                    lead_id, quote_detail_id, selected_plan_id,
                    selected_deductible, selected_reimbursement,
                    created_at, updated_at, hp_enroll_status_updated_at
                FROM enrollment_sessions
                WHERE member_id = :mid
                ORDER BY created_at DESC
                LIMIT 10
            '''), {'mid': signup['member_id']}).mappings().all()
            return {
                'signup': dict(signup),
                'sessions': [dict(r) for r in sessions],
            }
    except Exception as e:
        logger.error('fetch_signup_detail %s: %s', signup_id, e)
        return None


def fetch_partner_by_domain(shop_domain: str) -> dict | None:
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT
                    s.*,
                    COALESCE(sig.signup_count, 0) AS signup_count,
                    COALESCE(sig.signups_30d, 0) AS signups_30d,
                    COALESCE(hp.hp_completed_count, 0) AS hp_completed_count,
                    COALESCE(hp.hp_unknown_count, 0) AS hp_unknown_count
                FROM shops s
                LEFT JOIN (
                    SELECT shop_id,
                           COUNT(*) AS signup_count,
                           COUNT(*) FILTER (
                               WHERE created_at >= NOW() - INTERVAL '30 days'
                           ) AS signups_30d
                    FROM pet_prescription_signups
                    WHERE shop_id IS NOT NULL
                    GROUP BY shop_id
                ) sig ON sig.shop_id = s.id
                LEFT JOIN (
                    SELECT p.shop_id,
                           COUNT(DISTINCT es.session_id) FILTER (
                               WHERE es.hp_enrollment_status = 'completed'
                           ) AS hp_completed_count,
                           COUNT(DISTINCT es.session_id) FILTER (
                               WHERE es.hp_enrollment_status = 'enroll_submitted_unknown'
                           ) AS hp_unknown_count
                    FROM enrollment_sessions es
                    INNER JOIN pet_prescription_signups p
                        ON p.member_id = es.member_id AND p.shop_id IS NOT NULL
                    GROUP BY p.shop_id
                ) hp ON hp.shop_id = s.id
                WHERE s.shop_url = :shop
            '''), {'shop': shop_domain}).mappings().first()
            return dict(row) if row else None
    except Exception as e:
        logger.error('fetch_partner_by_domain %s: %s', shop_domain, e)
        return None


def fetch_partner_contacts(shop_id: int) -> list[dict]:
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT role, name, email, phone, city, state, postal_code, is_primary, updated_at
                FROM shop_contacts
                WHERE shop_id = :sid
                ORDER BY role, name
            '''), {'sid': shop_id}).mappings().all()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error('fetch_partner_contacts: %s', e)
        return []


def fetch_partner_signups(shop_id: int, limit: int = 25) -> list[dict]:
    return fetch_signups_list(shop_id=shop_id, include_default_shop=True, days=None, limit=limit)


def fetch_partner_enrollment_sessions(shop_id: int, limit: int = 25) -> list[dict]:
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT
                    es.session_id,
                    es.member_id,
                    es.hp_enrollment_status,
                    es.current_step,
                    es.funnel_type,
                    es.created_at,
                    es.updated_at
                FROM enrollment_sessions es
                INNER JOIN pet_prescription_signups p ON p.member_id = es.member_id
                WHERE p.shop_id = :sid
                ORDER BY es.created_at DESC
                LIMIT :lim
            '''), {'sid': shop_id, 'lim': limit}).mappings().all()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error('fetch_partner_enrollment_sessions: %s', e)
        return []
