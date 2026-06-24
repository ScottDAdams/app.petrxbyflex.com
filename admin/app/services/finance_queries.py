"""HP commission reconciliation and partner referral payout queries."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from io import BytesIO
from typing import Any

from sqlalchemy import text

from ..models.database import get_db
from .ops_queries import DEFAULT_SHOP_ID, DIRECT_WHERE_SQL

logger = logging.getLogger(__name__)

# Healthy Paws marketing agreement: $250 per Completed Submitted Application
HP_CSA_FEE_CENTS = 25_000

PAYOUT_MODES = ('none', 'flat', 'percent')
PAYOUT_SCHEDULES = (
    ('net_30_after_hp_paid', 'Net 30 after HP pays Flex'),
    ('net_15_after_hp_paid', 'Net 15 after HP pays Flex'),
    ('same_month_as_hp', 'Same month as HP payment'),
    ('manual', 'Manual / ad hoc'),
)

LEDGER_EVENT_TYPES = (
    'referral_paid',
    'manual_adjustment',
)

HP_EXCEL_COLUMN_ALIASES = {
    'leadid': 'lead_id',
    'leadsource': 'lead_source',
    'accountid': 'account_id',
    'leadstatus': 'lead_status',
    'enrollmentdate': 'enrollment_date',
    'petid': 'pet_id',
    'petname': 'pet_name',
    'petpremium': 'pet_premium',
    'petplan': 'pet_plan',
    'compensation': 'compensation',
    'commission': 'compensation',
    'csafee': 'compensation',
    'amount': 'compensation',
}


def compute_partner_share_cents(shop: dict, hp_fee_cents: int = HP_CSA_FEE_CENTS) -> int:
    mode = (shop.get('referral_payout_mode') or 'none').lower()
    if mode == 'none':
        return 0
    if mode == 'flat':
        return max(0, int(shop.get('referral_payout_flat_cents') or 0))
    if mode == 'percent':
        pct = float(shop.get('referral_payout_percent') or 0)
        return max(0, int(round(hp_fee_cents * pct / 100.0)))
    return 0


def format_cents(cents: int | None) -> str:
    if cents is None:
        return '—'
    return f'${cents / 100:,.2f}'


def fetch_shop_referral_terms(shop_id: int) -> dict | None:
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT id, shop_url, name,
                       referral_payout_mode,
                       referral_payout_flat_cents,
                       referral_payout_percent,
                       referral_payout_schedule,
                       referral_payout_notes
                FROM shops WHERE id = :sid
            '''), {'sid': shop_id}).mappings().first()
            return dict(row) if row else None
    except Exception as e:
        logger.error('fetch_shop_referral_terms %s: %s', shop_id, e)
        return None


def update_shop_referral_terms(
    shop_id: int,
    *,
    mode: str,
    flat_cents: int | None,
    percent: float | None,
    schedule: str,
    notes: str | None,
) -> bool:
    if mode not in PAYOUT_MODES:
        mode = 'none'
    valid_schedules = {s[0] for s in PAYOUT_SCHEDULES}
    if schedule not in valid_schedules:
        schedule = 'net_30_after_hp_paid'
    try:
        with get_db() as db:
            db.execute(text('''
                UPDATE shops SET
                  referral_payout_mode = :mode,
                  referral_payout_flat_cents = :flat,
                  referral_payout_percent = :pct,
                  referral_payout_schedule = :sched,
                  referral_payout_notes = :notes,
                  updated_at = now()
                WHERE id = :sid
            '''), {
                'sid': shop_id,
                'mode': mode,
                'flat': flat_cents if mode == 'flat' else None,
                'pct': percent if mode == 'percent' else None,
                'sched': schedule,
                'notes': (notes or '').strip() or None,
            })
        return True
    except Exception as e:
        logger.error('update_shop_referral_terms %s: %s', shop_id, e)
        return False


def _period_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def fetch_completed_enrollments_by_shop(*, year: int, month: int) -> list[dict]:
    """HP completed enrollments in calendar month, grouped by shop (incl. DIRECT)."""
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT
                    COALESCE(p.shop_id, :default_shop_id) AS shop_id,
                    s.shop_url,
                    s.name AS shop_name,
                    s.referral_payout_mode,
                    s.referral_payout_flat_cents,
                    s.referral_payout_percent,
                    s.referral_payout_schedule,
                    COUNT(DISTINCT es.session_id) AS hp_completed_count
                FROM enrollment_sessions es
                INNER JOIN pet_prescription_signups p ON p.member_id = es.member_id
                LEFT JOIN shops s ON s.id = p.shop_id
                WHERE es.hp_enrollment_status = 'completed'
                  AND es.hp_enroll_status_updated_at >= make_date(:y, :m, 1)
                  AND es.hp_enroll_status_updated_at < (
                      CASE WHEN :m = 12
                           THEN make_date(:y + 1, 1, 1)
                           ELSE make_date(:y, :m + 1, 1)
                      END
                  )
                GROUP BY COALESCE(p.shop_id, :default_shop_id),
                         s.shop_url, s.name,
                         s.referral_payout_mode,
                         s.referral_payout_flat_cents,
                         s.referral_payout_percent,
                         s.referral_payout_schedule
                ORDER BY hp_completed_count DESC
            '''), {'y': year, 'm': month, 'default_shop_id': DEFAULT_SHOP_ID}).mappings().all()
            result = []
            for row in rows:
                d = dict(row)
                count = int(d['hp_completed_count'] or 0)
                is_direct = int(d['shop_id'] or 0) == DEFAULT_SHOP_ID
                hp_gross = count * HP_CSA_FEE_CENTS
                if is_direct:
                    partner_total = 0
                else:
                    partner_total = compute_partner_share_cents(d) * count
                d['is_direct'] = is_direct
                d['hp_gross_cents'] = hp_gross
                d['partner_owed_cents'] = partner_total
                d['flex_net_cents'] = hp_gross - partner_total
                result.append(d)
            return result
    except Exception as e:
        logger.error('fetch_completed_enrollments_by_shop: %s', e)
        return []


def fetch_hp_period(year: int, month: int) -> dict | None:
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT * FROM hp_commission_periods
                WHERE period_year = :y AND period_month = :m
            '''), {'y': year, 'm': month}).mappings().first()
            return dict(row) if row else None
    except Exception as e:
        logger.error('fetch_hp_period: %s', e)
        return None


def upsert_hp_period(
    year: int,
    month: int,
    *,
    statement_ref: str | None,
    csa_count: int | None,
    gross_cents: int | None,
    status: str,
    notes: str | None,
) -> bool:
    try:
        with get_db() as db:
            db.execute(text('''
                INSERT INTO hp_commission_periods (
                    period_year, period_month, hp_statement_ref,
                    hp_csa_count, hp_gross_cents, status, notes, updated_at
                ) VALUES (:y, :m, :ref, :cnt, :gross, :st, :notes, now())
                ON CONFLICT (period_year, period_month) DO UPDATE SET
                    hp_statement_ref = EXCLUDED.hp_statement_ref,
                    hp_csa_count = EXCLUDED.hp_csa_count,
                    hp_gross_cents = EXCLUDED.hp_gross_cents,
                    status = EXCLUDED.status,
                    notes = EXCLUDED.notes,
                    hp_received_at = CASE
                        WHEN EXCLUDED.status IN ('hp_received', 'reconciled', 'closed')
                             AND hp_commission_periods.hp_received_at IS NULL
                        THEN now()
                        ELSE hp_commission_periods.hp_received_at
                    END,
                    updated_at = now()
            '''), {
                'y': year, 'm': month,
                'ref': (statement_ref or '').strip() or None,
                'cnt': csa_count,
                'gross': gross_cents,
                'st': status or 'open',
                'notes': (notes or '').strip() or None,
            })
        return True
    except Exception as e:
        logger.error('upsert_hp_period: %s', e)
        return False


def fetch_reconciliation_summary(*, year: int, month: int) -> dict[str, Any]:
    by_shop = fetch_completed_enrollments_by_shop(year=year, month=month)
    hp_period = fetch_hp_period(year, month)
    hp_period_id = hp_period['id'] if hp_period else None
    paid_by_shop = fetch_partner_paid_by_shop(hp_period_id) if hp_period_id else {}

    flex_expected = sum(r['hp_gross_cents'] for r in by_shop)
    partner_total = sum(r['partner_owed_cents'] for r in by_shop)
    partner_paid_total = 0
    partner_outstanding_total = 0

    for row in by_shop:
        shop_id = int(row['shop_id'] or DEFAULT_SHOP_ID)
        paid = paid_by_shop.get(shop_id, 0)
        owed = int(row['partner_owed_cents'] or 0)
        outstanding = max(0, owed - paid)
        row['partner_paid_cents'] = paid
        row['partner_outstanding_cents'] = outstanding
        row['payout_recorded'] = paid > 0 and outstanding == 0 and owed > 0
        row['payout_partial'] = 0 < paid < owed
        if not row['is_direct']:
            partner_paid_total += paid
            partner_outstanding_total += outstanding

    flex_net = flex_expected - partner_total
    our_count = sum(r['hp_completed_count'] for r in by_shop)

    hp_received = int(hp_period['hp_gross_cents']) if hp_period and hp_period.get('hp_gross_cents') else None
    hp_count = int(hp_period['hp_csa_count']) if hp_period and hp_period.get('hp_csa_count') else None

    latest_import = fetch_latest_hp_import(year, month)
    import_summary = None
    if latest_import:
        import_summary = {
            'id': latest_import['id'],
            'filename': latest_import['filename'],
            'uploaded_at': latest_import['uploaded_at'],
            'matched_count': latest_import['matched_count'],
            'unmatched_count': latest_import['unmatched_count'],
            'not_completed_count': latest_import['not_completed_count'],
            'mismatch_count': latest_import['mismatch_count'],
            'row_count': latest_import['row_count'],
            'in_period_count': latest_import['in_period_count'],
        }

    return {
        'year': year,
        'month': month,
        'by_shop': by_shop,
        'hp_period': hp_period,
        'hp_period_id': hp_period_id,
        'our_hp_completed_count': our_count,
        'flex_expected_cents': flex_expected,
        'partner_owed_cents': partner_total,
        'partner_paid_cents': partner_paid_total,
        'partner_outstanding_cents': partner_outstanding_total,
        'flex_net_cents': flex_net,
        'hp_received_cents': hp_received,
        'hp_received_count': hp_count,
        'variance_cents': (hp_received - flex_expected) if hp_received is not None else None,
        'variance_count': (hp_count - our_count) if hp_count is not None else None,
        'latest_hp_import': import_summary,
    }


def fetch_partner_earnings_preview(shop_id: int, *, limit: int = 10) -> dict:
    """Recent completed enrollments with computed partner share."""
    terms = fetch_shop_referral_terms(shop_id) or {}
    share_one = compute_partner_share_cents(terms)
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT
                    p.id AS signup_id,
                    p.pet_name,
                    p.email,
                    es.session_id,
                    es.lead_id,
                    es.hp_enroll_status_updated_at AS completed_at
                FROM enrollment_sessions es
                INNER JOIN pet_prescription_signups p ON p.member_id = es.member_id
                WHERE p.shop_id = :sid
                  AND es.hp_enrollment_status = 'completed'
                ORDER BY es.hp_enroll_status_updated_at DESC NULLS LAST
                LIMIT :lim
            '''), {'sid': shop_id, 'lim': limit}).mappings().all()
            enrollments = [dict(r) for r in rows]
    except Exception as e:
        logger.error('fetch_partner_earnings_preview %s: %s', shop_id, e)
        enrollments = []

    completed_total = len(enrollments)  # preview only; full count separate
    try:
        with get_db() as db:
            total_row = db.execute(text('''
                SELECT COUNT(DISTINCT es.session_id) AS n
                FROM enrollment_sessions es
                INNER JOIN pet_prescription_signups p ON p.member_id = es.member_id
                WHERE p.shop_id = :sid AND es.hp_enrollment_status = 'completed'
            '''), {'sid': shop_id}).mappings().first()
            completed_total = int(total_row['n'] or 0) if total_row else 0
    except Exception:
        pass

    return {
        'terms': terms,
        'share_per_enrollment_cents': share_one,
        'hp_fee_cents': HP_CSA_FEE_CENTS,
        'completed_total': completed_total,
        'partner_owed_total_cents': share_one * completed_total,
        'flex_retained_total_cents': (HP_CSA_FEE_CENTS - share_one) * completed_total,
        'partner_paid_total_cents': fetch_partner_paid_total(shop_id),
        'recent': enrollments,
    }


def fetch_partner_paid_by_shop(hp_period_id: int) -> dict[int, int]:
    """Map shop_id -> total paid cents for an HP commission period."""
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT shop_id, COALESCE(SUM(ABS(amount_cents)), 0) AS paid
                FROM shop_referral_ledger
                WHERE hp_period_id = :pid AND event_type = 'referral_paid'
                GROUP BY shop_id
            '''), {'pid': hp_period_id}).mappings().all()
            return {int(r['shop_id']): int(r['paid'] or 0) for r in rows}
    except Exception as e:
        logger.error('fetch_partner_paid_by_shop: %s', e)
        return {}


def fetch_partner_paid_total(shop_id: int) -> int:
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS paid
                FROM shop_referral_ledger
                WHERE shop_id = :sid AND event_type = 'referral_paid'
            '''), {'sid': shop_id}).mappings().first()
            return int(row['paid'] or 0) if row else 0
    except Exception as e:
        logger.error('fetch_partner_paid_total %s: %s', shop_id, e)
        return 0


def record_partner_period_payout(
    shop_id: int,
    *,
    year: int,
    month: int,
    created_by: str,
    notes: str | None = None,
) -> tuple[bool, str]:
    """Mark calculated partner share for period as paid (ledger entry)."""
    if shop_id == DEFAULT_SHOP_ID:
        return False, 'DIRECT channel has no partner payout.'

    hp_period = fetch_hp_period(year, month)
    if not hp_period:
        return False, 'Save HP period first before recording payouts.'

    by_shop = fetch_completed_enrollments_by_shop(year=year, month=month)
    row = next((r for r in by_shop if int(r.get('shop_id') or 0) == shop_id), None)
    if not row:
        return False, 'No completed enrollments for this partner in the selected period.'

    owed = int(row['partner_owed_cents'] or 0)
    if owed <= 0:
        return False, 'Nothing owed for this partner in this period.'

    paid_map = fetch_partner_paid_by_shop(hp_period['id'])
    already_paid = paid_map.get(shop_id, 0)
    outstanding = owed - already_paid
    if outstanding <= 0:
        return False, 'Partner payout already recorded for this period.'

    payout_note = (notes or '').strip() or (
        f'Referral payout {year}-{month:02d}: {row["hp_completed_count"]} enrollment(s)'
    )
    try:
        with get_db() as db:
            db.execute(text('''
                INSERT INTO shop_referral_ledger (
                    shop_id, event_type, amount_cents, hp_period_id, notes, created_by
                ) VALUES (:sid, 'referral_paid', :amt, :pid, :notes, :by)
            '''), {
                'sid': shop_id,
                'amt': -outstanding,
                'pid': hp_period['id'],
                'notes': payout_note,
                'by': created_by,
            })
        return True, f'Recorded payout of {format_cents(outstanding)}.'
    except Exception as e:
        logger.error('record_partner_period_payout %s: %s', shop_id, e)
        if 'idx_shop_referral_ledger_period_payout' in str(e):
            return False, 'Partner payout already recorded for this period.'
        return False, 'Could not record payout (run latest migration if tables missing).'


def fetch_partner_ledger(shop_id: int, *, page: int = 1, per_page: int = 50) -> dict[str, Any]:
    offset = (page - 1) * per_page
    try:
        with get_db() as db:
            total_rows = db.execute(text(
                'SELECT COUNT(*) FROM shop_referral_ledger WHERE shop_id = :sid'
            ), {'sid': shop_id}).scalar() or 0

            events = db.execute(text('''
                SELECT
                    l.id, l.event_type, l.amount_cents, l.notes, l.created_by, l.created_at,
                    l.session_id, l.hp_period_id,
                    p.period_year, p.period_month
                FROM shop_referral_ledger l
                LEFT JOIN hp_commission_periods p ON p.id = l.hp_period_id
                WHERE l.shop_id = :sid
                ORDER BY l.created_at DESC, l.id DESC
                LIMIT :lim OFFSET :off
            '''), {'sid': shop_id, 'lim': per_page, 'off': offset}).mappings().all()

            paid_total = db.execute(text('''
                SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS paid
                FROM shop_referral_ledger
                WHERE shop_id = :sid AND event_type = 'referral_paid'
            '''), {'sid': shop_id}).mappings().first()

            adj_total = db.execute(text('''
                SELECT COALESCE(SUM(amount_cents), 0) AS adj
                FROM shop_referral_ledger
                WHERE shop_id = :sid AND event_type = 'manual_adjustment'
            '''), {'sid': shop_id}).mappings().first()

        total_pages = max(1, (total_rows + per_page - 1) // per_page)
        return {
            'events': [dict(e) for e in events],
            'total_rows': int(total_rows),
            'page': page,
            'total_pages': total_pages,
            'paid_total_cents': int(paid_total['paid'] or 0) if paid_total else 0,
            'adjustment_total_cents': int(adj_total['adj'] or 0) if adj_total else 0,
        }
    except Exception as e:
        logger.error('fetch_partner_ledger %s: %s', shop_id, e)
        return {
            'events': [],
            'total_rows': 0,
            'page': 1,
            'total_pages': 1,
            'paid_total_cents': 0,
            'adjustment_total_cents': 0,
        }


def record_partner_ledger_adjustment(
    shop_id: int,
    *,
    amount_cents: int,
    notes: str,
    created_by: str,
) -> bool:
    if amount_cents == 0:
        return False
    try:
        with get_db() as db:
            db.execute(text('''
                INSERT INTO shop_referral_ledger (
                    shop_id, event_type, amount_cents, notes, created_by
                ) VALUES (:sid, 'manual_adjustment', :amt, :notes, :by)
            '''), {
                'sid': shop_id,
                'amt': amount_cents,
                'notes': (notes or '').strip() or None,
                'by': created_by,
            })
        return True
    except Exception as e:
        logger.error('record_partner_ledger_adjustment %s: %s', shop_id, e)
        return False


def _normalize_header_cell(value: Any) -> str:
    return re.sub(r'[^a-z0-9]', '', str(value or '').strip().lower())


def _parse_excel_header(header_row: tuple) -> dict[str, int]:
    col_map: dict[str, int] = {}
    for idx, cell in enumerate(header_row):
        key = HP_EXCEL_COLUMN_ALIASES.get(_normalize_header_cell(cell))
        if key and key not in col_map:
            col_map[key] = idx
    return col_map


def _excel_cell(row: tuple, col_map: dict[str, int], name: str, default=None):
    idx = col_map.get(name)
    if idx is None or idx >= len(row):
        return default
    val = row[idx]
    return default if val is None else val


def _parse_money_cents(value: Any) -> int | None:
    if value is None or value == '':
        return None
    try:
        if isinstance(value, (int, float)):
            return int(round(float(value) * 100))
        cleaned = str(value).replace('$', '').replace(',', '').strip()
        if not cleaned:
            return None
        return int(round(float(cleaned) * 100))
    except (TypeError, ValueError):
        return None


def _parse_enrollment_in_period(enrollment_date: Any, year: int, month: int) -> bool:
    if enrollment_date is None:
        return False
    if isinstance(enrollment_date, datetime):
        d = enrollment_date.date()
    elif isinstance(enrollment_date, date):
        d = enrollment_date
    else:
        text_val = str(enrollment_date).strip()
        for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%Y/%m/%d'):
            try:
                d = datetime.strptime(text_val[:10], fmt).date()
                break
            except ValueError:
                continue
        else:
            return False
    return d.year == year and d.month == month


def _find_enrollment_for_hp_row(
    db,
    *,
    lead_id: str | None,
    account_id: str | None,
) -> dict | None:
    params: dict[str, Any] = {}
    clauses = []
    if lead_id:
        params['lead'] = lead_id
        clauses.append('es.lead_id = :lead')
    if account_id:
        params['acct'] = account_id
        clauses.append('es.oneinc_account_id = :acct')
    if not clauses:
        return None
    where = ' OR '.join(clauses)
    row = db.execute(text(f'''
        SELECT
            es.session_id,
            es.lead_id,
            es.oneinc_account_id,
            es.hp_enrollment_status,
            p.id AS signup_id,
            COALESCE(p.shop_id, :default_shop_id) AS shop_id,
            p.pet_name
        FROM enrollment_sessions es
        INNER JOIN pet_prescription_signups p ON p.member_id = es.member_id
        WHERE ({where})
        ORDER BY es.hp_enroll_status_updated_at DESC NULLS LAST
        LIMIT 1
    '''), {**params, 'default_shop_id': DEFAULT_SHOP_ID}).mappings().first()
    return dict(row) if row else None


def import_hp_excel_detail(
    file_bytes: bytes,
    filename: str,
    *,
    year: int,
    month: int,
    uploaded_by: str,
) -> dict[str, Any]:
    """Parse HP commission Excel and match rows to enrollment sessions."""
    try:
        import openpyxl
    except ImportError:
        return {'ok': False, 'error': 'openpyxl is not installed on the server.'}

    try:
        wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
    except Exception as e:
        return {'ok': False, 'error': f'Could not read Excel file: {e}'}

    if not all_rows:
        return {'ok': False, 'error': 'Excel file appears empty.'}

    col_map = _parse_excel_header(all_rows[0])
    if 'lead_id' not in col_map and 'account_id' not in col_map:
        return {'ok': False, 'error': 'Missing LeadId or Account_Id column in header row.'}

    data_rows = [r for r in all_rows[1:] if any(v is not None and str(v).strip() != '' for v in r)]
    seen_keys: set[str] = set()

    buckets: dict[str, list] = {
        'matched_ok': [],
        'not_in_db': [],
        'not_completed': [],
        'amount_mismatch': [],
        'duplicate_row': [],
    }
    counts = {
        'row_count': len(data_rows),
        'matched_count': 0,
        'unmatched_count': 0,
        'not_completed_count': 0,
        'mismatch_count': 0,
        'in_period_count': 0,
    }

    try:
        with get_db() as db:
            upload_row = db.execute(text('''
                INSERT INTO hp_report_uploads (
                    period_year, period_month, filename, uploaded_by
                ) VALUES (:y, :m, :fn, :by)
                RETURNING id
            '''), {'y': year, 'm': month, 'fn': filename, 'by': uploaded_by}).mappings().first()
            upload_id = int(upload_row['id'])

            for row in data_rows:
                lead_id = str(_excel_cell(row, col_map, 'lead_id', '') or '').strip() or None
                account_id = str(_excel_cell(row, col_map, 'account_id', '') or '').strip() or None
                pet_id = str(_excel_cell(row, col_map, 'pet_id', '') or '').strip() or None
                pet_name = str(_excel_cell(row, col_map, 'pet_name', '') or '').strip() or None
                lead_status = str(_excel_cell(row, col_map, 'lead_status', '') or '').strip() or None
                enrollment_date = _excel_cell(row, col_map, 'enrollment_date')
                hp_comp = _parse_money_cents(_excel_cell(row, col_map, 'compensation'))
                in_period = _parse_enrollment_in_period(enrollment_date, year, month)
                if in_period:
                    counts['in_period_count'] += 1

                dedupe_key = f'{lead_id or ""}|{account_id or ""}|{pet_id or ""}'
                if dedupe_key in seen_keys and dedupe_key != '||':
                    status = 'duplicate_row'
                    buckets[status].append({
                        'lead_id': lead_id,
                        'account_id': account_id,
                        'pet_name': pet_name,
                        'lead_status': lead_status,
                    })
                    _store_hp_match(db, upload_id, status, lead_id, account_id, pet_id, pet_name,
                                    lead_status, enrollment_date, hp_comp, None)
                    continue
                seen_keys.add(dedupe_key)

                match = _find_enrollment_for_hp_row(db, lead_id=lead_id, account_id=account_id)
                if not match:
                    status = 'not_in_db'
                    counts['unmatched_count'] += 1
                    buckets[status].append({
                        'lead_id': lead_id,
                        'account_id': account_id,
                        'pet_name': pet_name,
                        'lead_status': lead_status,
                        'in_period': in_period,
                    })
                    _store_hp_match(db, upload_id, status, lead_id, account_id, pet_id, pet_name,
                                    lead_status, enrollment_date, hp_comp, None)
                    continue

                if (match.get('hp_enrollment_status') or '').lower() != 'completed':
                    status = 'not_completed'
                    counts['not_completed_count'] += 1
                    buckets[status].append({
                        'lead_id': lead_id,
                        'account_id': account_id,
                        'pet_name': match.get('pet_name') or pet_name,
                        'hp_status': match.get('hp_enrollment_status'),
                        'signup_id': match.get('signup_id'),
                        'in_period': in_period,
                    })
                    _store_hp_match(db, upload_id, status, lead_id, account_id, pet_id, pet_name,
                                    lead_status, enrollment_date, hp_comp, match)
                    continue

                if hp_comp is not None and abs(hp_comp - HP_CSA_FEE_CENTS) > 2:
                    status = 'amount_mismatch'
                    counts['mismatch_count'] += 1
                    buckets[status].append({
                        'lead_id': lead_id,
                        'account_id': account_id,
                        'pet_name': match.get('pet_name') or pet_name,
                        'hp_compensation_cents': hp_comp,
                        'expected_cents': HP_CSA_FEE_CENTS,
                        'signup_id': match.get('signup_id'),
                        'in_period': in_period,
                    })
                    _store_hp_match(db, upload_id, status, lead_id, account_id, pet_id, pet_name,
                                    lead_status, enrollment_date, hp_comp, match)
                    continue

                status = 'matched_ok'
                counts['matched_count'] += 1
                buckets[status].append({
                    'lead_id': lead_id,
                    'account_id': account_id,
                    'pet_name': match.get('pet_name') or pet_name,
                    'signup_id': match.get('signup_id'),
                    'shop_id': match.get('shop_id'),
                    'session_id': str(match.get('session_id') or ''),
                    'in_period': in_period,
                })
                _store_hp_match(db, upload_id, status, lead_id, account_id, pet_id, pet_name,
                                lead_status, enrollment_date, hp_comp, match)

            db.execute(text('''
                UPDATE hp_report_uploads SET
                    row_count = :rows,
                    matched_count = :matched,
                    unmatched_count = :unmatched,
                    not_completed_count = :not_completed,
                    mismatch_count = :mismatch,
                    in_period_count = :in_period
                WHERE id = :id
            '''), {
                'id': upload_id,
                'rows': counts['row_count'],
                'matched': counts['matched_count'],
                'unmatched': counts['unmatched_count'],
                'not_completed': counts['not_completed_count'],
                'mismatch': counts['mismatch_count'],
                'in_period': counts['in_period_count'],
            })

        return {
            'ok': True,
            'upload_id': upload_id,
            'filename': filename,
            **counts,
            'buckets': buckets,
        }
    except Exception as e:
        logger.error('import_hp_excel_detail: %s', e)
        return {'ok': False, 'error': str(e)}


def _store_hp_match(
    db,
    upload_id: int,
    status: str,
    lead_id,
    account_id,
    pet_id,
    pet_name,
    lead_status,
    enrollment_date,
    hp_comp_cents,
    match: dict | None,
):
    db.execute(text('''
        INSERT INTO hp_report_matches (
            upload_id, match_status, lead_id, account_id, pet_id, pet_name,
            lead_status, enrollment_date, hp_compensation_cents,
            session_id, signup_id, shop_id
        ) VALUES (
            :uid, :st, :lead, :acct, :pet_id, :pet_name,
            :lead_status, :enroll_date, :comp,
            :session_id, :signup_id, :shop_id
        )
    '''), {
        'uid': upload_id,
        'st': status,
        'lead': lead_id,
        'acct': account_id,
        'pet_id': pet_id,
        'pet_name': pet_name,
        'lead_status': lead_status,
        'enroll_date': str(enrollment_date) if enrollment_date is not None else None,
        'comp': hp_comp_cents,
        'session_id': match.get('session_id') if match else None,
        'signup_id': match.get('signup_id') if match else None,
        'shop_id': match.get('shop_id') if match else None,
    })


def fetch_latest_hp_import(year: int, month: int) -> dict | None:
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT * FROM hp_report_uploads
                WHERE period_year = :y AND period_month = :m
                ORDER BY uploaded_at DESC
                LIMIT 1
            '''), {'y': year, 'm': month}).mappings().first()
            return dict(row) if row else None
    except Exception as e:
        logger.error('fetch_latest_hp_import: %s', e)
        return None


def fetch_hp_import_detail(upload_id: int, *, limit_per_bucket: int = 50) -> dict | None:
    try:
        with get_db() as db:
            upload = db.execute(text(
                'SELECT * FROM hp_report_uploads WHERE id = :id'
            ), {'id': upload_id}).mappings().first()
            if not upload:
                return None
            rows = db.execute(text('''
                SELECT * FROM hp_report_matches
                WHERE upload_id = :id
                ORDER BY id
            '''), {'id': upload_id}).mappings().all()

        buckets: dict[str, list] = {
            'matched_ok': [],
            'not_in_db': [],
            'not_completed': [],
            'amount_mismatch': [],
            'duplicate_row': [],
        }
        for row in rows:
            st = row['match_status']
            if st in buckets and len(buckets[st]) < limit_per_bucket:
                buckets[st].append(dict(row))
        return {'upload': dict(upload), 'buckets': buckets}
    except Exception as e:
        logger.error('fetch_hp_import_detail %s: %s', upload_id, e)
        return None


def fetch_hp_import_history(*, limit: int = 20) -> list[dict]:
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT id, period_year, period_month, filename, uploaded_at, uploaded_by,
                       row_count, matched_count, unmatched_count, not_completed_count,
                       mismatch_count, in_period_count
                FROM hp_report_uploads
                ORDER BY uploaded_at DESC
                LIMIT :lim
            '''), {'lim': limit}).mappings().all()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error('fetch_hp_import_history: %s', e)
        return []
