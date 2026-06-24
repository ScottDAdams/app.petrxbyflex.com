"""PetRx admin portal — product content push to all merchant stores."""
import logging

from flask import Blueprint, flash, make_response, redirect, render_template, request, url_for
from sqlalchemy import text

from ..auth import clear_auth_cookie, get_current_admin, require_admin, set_auth_cookie
from ..services.admin_users import authenticate_admin, ensure_admin_users_bootstrapped
from ..config import Config
from ..models.database import get_db
from ..services.shopify_proxy import preflight_shop, shopify_graphql
from ..services.product_images_api import list_product_images, upload_product_image
from ..services.system_health import fetch_pass_cert_status
from ..services.ops_queries import (
    DEFAULT_SHOP_ID,
    DEFAULT_SHOP_URL,
    DIRECT_ATTRIBUTION_LABEL,
    fetch_dashboard_alerts,
    fetch_dashboard_stats,
    fetch_direct_channel_stats,
    fetch_partner_by_domain,
    fetch_partner_contacts,
    fetch_partner_signups,
    fetch_partners_list,
    fetch_signup_detail,
    fetch_hidden_direct_signups_count,
    fetch_signups_funnel,
    fetch_signups_list,
    FUNNEL_FILTER_LABELS,
    normalize_funnel_filter,
)
from ..services.finance_queries import (
    HP_CSA_FEE_CENTS,
    PAYOUT_SCHEDULES,
    fetch_hp_import_detail,
    fetch_hp_import_history,
    fetch_partner_earnings_preview,
    fetch_partner_ledger,
    fetch_reconciliation_summary,
    fetch_shop_referral_terms,
    format_cents,
    import_hp_excel_detail,
    record_partner_ledger_adjustment,
    record_partner_period_payout,
    update_shop_referral_terms,
    upsert_hp_period,
)

logger = logging.getLogger(__name__)
admin_bp = Blueprint('admin', __name__)

PETRX_LOGO_URL = (
    'https://framerusercontent.com/images/hWE32j1qq9RYKbw4llAuqCYawmQ.svg'
    '?width=202&height=39'
)


def _normalize_product_gid(raw: str) -> str:
    raw = (raw or '').strip()
    if not raw:
        return ''
    if raw.startswith('gid://'):
        return raw
    if raw.isdigit():
        return f'gid://shopify/Product/{raw}'
    return raw


def _load_shop_rows():
    with get_db() as db:
        return db.execute(text('''
            SELECT s.id, s.shop_url, s.name AS shop_name, s.petrx_product_id
            FROM shops s
            WHERE s.access_token IS NOT NULL
              AND s.petrx_product_id IS NOT NULL
              AND s.petrx_product_id <> ''
            ORDER BY s.id
        ''')).mappings().all()


def _run_preflight(shop_rows: list) -> list[dict]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    shop_health: list[dict] = []
    if not shop_rows:
        return shop_health

    with ThreadPoolExecutor(max_workers=min(10, max(1, len(shop_rows)))) as ex:
        future_to_shop = {
            ex.submit(preflight_shop, s['shop_url']): s for s in shop_rows
        }
        for fut in as_completed(future_to_shop):
            s = future_to_shop[fut]
            try:
                ok, category, message = fut.result(timeout=10)
            except Exception as e:
                ok, category, message = False, 'unknown', f'preflight raised: {e}'
            has_product = bool((s.get('petrx_product_id') or '').strip())
            shop_health.append({
                'shop_url': s['shop_url'],
                'shop_name': s.get('shop_name') or s['shop_url'],
                'product_count': 1 if has_product else 0,
                'ok': ok,
                'category': category,
                'message': message,
            })

    shop_health.sort(key=lambda r: (not r['ok'], r['category'], r['shop_url']))
    return shop_health


def _push_to_shops(
    title: str,
    description_html: str,
    vendor: str,
    product_type: str,
    media_sources: list[dict],
) -> tuple[int, int, int, list[tuple[str, str, str]]]:
    pushed_products = 0
    failed_products = 0
    skipped_stale = 0
    skipped_auth: list[tuple[str, str, str]] = []

    try:
        rows = _load_shop_rows()
    except Exception as e:
        logger.error(f'petrx_product_content: could not load shops: {e}')
        rows = []

    unique_shops = sorted({r['shop_url'] for r in rows})
    preflight_results: dict[str, tuple[bool, str, str]] = {}
    if unique_shops:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=min(10, len(unique_shops))) as ex:
            future_to_shop = {ex.submit(preflight_shop, su): su for su in unique_shops}
            for fut in as_completed(future_to_shop):
                su = future_to_shop[fut]
                try:
                    preflight_results[su] = fut.result(timeout=10)
                except Exception as e:
                    preflight_results[su] = (False, 'unknown', f'preflight raised: {e}')

    for row in rows:
        shop_domain = row['shop_url']
        product_gid = _normalize_product_gid(row['petrx_product_id'])

        pf_ok, pf_category, pf_message = preflight_results.get(
            shop_domain, (False, 'unknown', 'no preflight result')
        )
        if not pf_ok:
            logger.warning(
                f'petrx_product_content: skipping {shop_domain} ({pf_category}): {pf_message}'
            )
            skipped_auth.append((shop_domain, pf_category, pf_message))
            continue

        if not product_gid:
            skipped_stale += 1
            continue

        try:
            resp = shopify_graphql(
                shop_domain,
                'mutation($input: ProductInput!) { productUpdate(input: $input) { userErrors { field message } } }',
                {
                    'input': {
                        'id': product_gid,
                        'title': title,
                        'descriptionHtml': description_html,
                        'vendor': vendor,
                        'productType': product_type,
                    }
                },
            )
            desc_errs = (
                ((resp.get('data') or {}).get('productUpdate') or {}).get('userErrors') or []
            )
            if desc_errs:
                is_stale = any(
                    'does not exist' in (e.get('message') or '').lower()
                    or 'not found' in (e.get('message') or '').lower()
                    for e in desc_errs
                )
                if is_stale:
                    logger.warning(
                        f'petrx_product_content: stale product_gid {product_gid} on '
                        f'{shop_domain}: {desc_errs}'
                    )
                    skipped_stale += 1
                    continue
                logger.error(
                    f'petrx_product_content: productUpdate userErrors '
                    f'{shop_domain} {product_gid}: {desc_errs}'
                )
                failed_products += 1
                continue

            push_failed = False
            if media_sources:
                r = shopify_graphql(
                    shop_domain,
                    'query($id: ID!) { product(id: $id) { media(first: 20) { edges { node { id } } } } }',
                    {'id': product_gid},
                )
                edges = (
                    (((r.get('data') or {}).get('product') or {}).get('media') or {}).get('edges') or []
                )
                media_ids = [
                    e['node']['id']
                    for e in edges
                    if e.get('node', {}).get('id')
                ]
                if media_ids:
                    del_resp = shopify_graphql(
                        shop_domain,
                        'mutation($pid: ID!, $ids: [ID!]!) { productDeleteMedia(productId: $pid, mediaIds: $ids) { deletedMediaIds userErrors { field message } } }',
                        {'pid': product_gid, 'ids': media_ids},
                    )
                    del_errs = (
                        ((del_resp.get('data') or {}).get('productDeleteMedia') or {}).get('userErrors') or []
                    )
                    if del_errs:
                        logger.error(
                            f'petrx_product_content: productDeleteMedia userErrors '
                            f'{shop_domain} {product_gid}: {del_errs}'
                        )
                        push_failed = True

                add_resp = shopify_graphql(
                    shop_domain,
                    'mutation($input: ProductInput!, $media: [CreateMediaInput!]!) { productUpdate(input: $input, media: $media) { userErrors { field message } } }',
                    {'input': {'id': product_gid}, 'media': media_sources},
                )
                add_errs = (
                    ((add_resp.get('data') or {}).get('productUpdate') or {}).get('userErrors') or []
                )
                if add_errs:
                    logger.error(
                        f'petrx_product_content: productUpdate(media) userErrors '
                        f'{shop_domain} {product_gid}: {add_errs}'
                    )
                    push_failed = True

            if push_failed:
                failed_products += 1
            else:
                pushed_products += 1
        except RuntimeError as e:
            logger.error(f'petrx_product_content: proxy error {shop_domain} {product_gid}: {e}')
            failed_products += 1
        except Exception as e:
            logger.error(f'petrx_product_content: push error {shop_domain} {product_gid}: {e}')
            failed_products += 1

    return pushed_products, failed_products, skipped_stale, skipped_auth


def _flash_push_summary(
    pushed: int,
    failed: int,
    skipped_stale: int,
    skipped_auth: list[tuple[str, str, str]],
):
    auth_summary: dict[str, set[str]] = {}
    for shop_url, category, _ in skipped_auth:
        auth_summary.setdefault(category, set()).add(shop_url)
    auth_msg_parts = []
    label_map = {
        'stale_token': 'with stale token (merchant must reopen the app)',
        'no_session': 'uninstalled (merchant must reinstall)',
        'proxy_unreachable': 'unreachable (proxy/env-var issue)',
        'proxy_auth': 'failing proxy auth',
        'shopify_5xx': 'on Shopify 5xx (transient)',
        'unknown': 'with unknown auth issue',
    }
    for category, shops in sorted(auth_summary.items()):
        label = label_map.get(category, category)
        auth_msg_parts.append(f'{len(shops)} shop(s) {label}')

    msg = f'Saved. Pushed to {pushed} product(s).'
    if skipped_stale:
        msg += f' Skipped {skipped_stale} stale GIDs.'
    if auth_msg_parts:
        msg += f' Skipped {", ".join(auth_msg_parts)}.'
    if failed:
        msg += f' {failed} failed.'

    if failed:
        tone = 'error'
    elif auth_msg_parts or skipped_stale:
        tone = 'warning'
    else:
        tone = 'success'
    flash(msg, tone)


@admin_bp.route('/dashboard')
@require_admin
def dashboard():
    return render_template(
        'admin/dashboard.html',
        stats=fetch_dashboard_stats(),
        alerts=fetch_dashboard_alerts(),
        pass_cert=fetch_pass_cert_status(),
    )


@admin_bp.route('/partners')
@require_admin
def partners():
    return render_template(
        'admin/partners.html',
        partners=fetch_partners_list(),
        direct_channel=fetch_direct_channel_stats(),
    )


@admin_bp.route('/direct')
@require_admin
def direct_channel():
    period = request.args.get('period', '30')
    funnel_filter = normalize_funnel_filter(request.args.get('funnel'))
    if period == 'all':
        days = None
    else:
        try:
            days = int(period)
        except ValueError:
            days = 30
    funnel = fetch_signups_funnel(direct_only=True, days=days)
    signups = fetch_signups_list(
        direct_only=True,
        days=days,
        funnel_filter=funnel_filter,
        limit=100,
    )
    conversion_pct = 0.0
    if funnel['total']:
        conversion_pct = round(100.0 * funnel['hp_completed'] / funnel['total'], 1)
    return render_template(
        'admin/direct.html',
        channel=fetch_direct_channel_stats(),
        funnel=funnel,
        signups=signups,
        conversion_pct=conversion_pct,
        period=period,
        funnel_filter=funnel_filter,
        funnel_filter_label=FUNNEL_FILTER_LABELS.get(funnel_filter, funnel_filter),
        direct_label=DIRECT_ATTRIBUTION_LABEL,
        page='direct',
        hp_csa_fee_cents=HP_CSA_FEE_CENTS,
        format_cents=format_cents,
    )


def _signups_query_params():
    """Parse signups list filters from request args."""
    scope = request.args.get('scope', 'all')
    period = request.args.get('period', '30')
    shop_url = (request.args.get('shop') or '').strip()
    funnel_filter = normalize_funnel_filter(request.args.get('funnel'))

    if period == 'all':
        days = None
    else:
        try:
            days = int(period)
        except ValueError:
            days = 30

    shop_id = None
    include_default_shop = True
    direct_only = False
    if shop_url:
        shop = fetch_partner_by_domain(shop_url)
        shop_id = shop['id'] if shop else -1
    elif scope == 'direct':
        direct_only = True
    elif scope == 'merchants':
        include_default_shop = False
    elif scope == 'all':
        include_default_shop = True

    return {
        'scope': scope,
        'period': period,
        'days': days,
        'shop_url': shop_url,
        'shop_id': shop_id,
        'include_default_shop': include_default_shop,
        'direct_only': direct_only,
        'funnel_filter': funnel_filter,
    }


@admin_bp.route('/signups')
@require_admin
def signups_index():
    params = _signups_query_params()
    funnel = fetch_signups_funnel(
        shop_id=params['shop_id'],
        include_default_shop=params['include_default_shop'],
        direct_only=params['direct_only'],
        days=params['days'],
    )
    signups = fetch_signups_list(
        shop_id=params['shop_id'],
        include_default_shop=params['include_default_shop'],
        direct_only=params['direct_only'],
        funnel_filter=params['funnel_filter'],
        days=params['days'],
        limit=150,
    )
    conversion_pct = 0.0
    if funnel['total']:
        conversion_pct = round(100.0 * funnel['hp_completed'] / funnel['total'], 1)

    hidden_direct_count = 0
    if params['scope'] == 'merchants' and not params['shop_url']:
        hidden_direct_count = fetch_hidden_direct_signups_count(days=params['days'])

    return render_template(
        'admin/signups.html',
        funnel=funnel,
        signups=signups,
        conversion_pct=conversion_pct,
        scope=params['scope'],
        period=params['period'],
        shop_url=params['shop_url'],
        default_shop_url=DEFAULT_SHOP_URL,
        direct_label=DIRECT_ATTRIBUTION_LABEL,
        hidden_direct_count=hidden_direct_count,
        funnel_filter=params['funnel_filter'],
        funnel_filter_label=FUNNEL_FILTER_LABELS.get(params['funnel_filter'], params['funnel_filter']),
        page='signups',
    )


@admin_bp.route('/signups/<int:signup_id>')
@require_admin
def signup_detail(signup_id):
    detail = fetch_signup_detail(signup_id)
    if not detail:
        flash(f'Signup #{signup_id} not found.', 'error')
        return redirect(url_for('admin.signups_index'))
    return render_template(
        'admin/signup_detail.html',
        signup=detail['signup'],
        sessions=detail['sessions'],
        default_shop_id=DEFAULT_SHOP_ID,
        direct_label=DIRECT_ATTRIBUTION_LABEL,
    )


@admin_bp.route('/partners/<path:shop_domain>', methods=['GET', 'POST'])
@require_admin
def partner_detail(shop_domain):
    shop = fetch_partner_by_domain(shop_domain)
    if not shop:
        flash(f'Shop not found: {shop_domain}', 'error')
        return redirect(url_for('admin.partners'))
    shop_id = shop['id']

    if request.method == 'POST' and request.form.get('form') == 'referral_terms':
        mode = (request.form.get('referral_payout_mode') or 'none').strip()
        flat_raw = (request.form.get('referral_payout_flat_dollars') or '').strip()
        pct_raw = (request.form.get('referral_payout_percent') or '').strip()
        schedule = (request.form.get('referral_payout_schedule') or 'net_30_after_hp_paid').strip()
        notes = request.form.get('referral_payout_notes') or ''
        flat_cents = None
        pct = None
        try:
            if flat_raw:
                flat_cents = int(round(float(flat_raw) * 100))
        except ValueError:
            flash('Invalid flat payout amount.', 'error')
            return redirect(url_for('admin.partner_detail', shop_domain=shop_domain))
        try:
            if pct_raw:
                pct = float(pct_raw)
        except ValueError:
            flash('Invalid percent payout.', 'error')
            return redirect(url_for('admin.partner_detail', shop_domain=shop_domain))
        if update_shop_referral_terms(
            shop_id,
            mode=mode,
            flat_cents=flat_cents,
            percent=pct,
            schedule=schedule,
            notes=notes,
        ):
            flash('Referral payout terms saved.', 'success')
        else:
            flash('Could not save referral terms.', 'error')
        return redirect(url_for('admin.partner_detail', shop_domain=shop_domain))

    terms = fetch_shop_referral_terms(shop_id) or {}
    earnings = fetch_partner_earnings_preview(shop_id)
    return render_template(
        'admin/partner_detail.html',
        shop=shop,
        contacts=fetch_partner_contacts(shop_id),
        signups=fetch_partner_signups(shop_id, limit=50),
        referral_terms=terms,
        earnings=earnings,
        payout_schedules=PAYOUT_SCHEDULES,
        hp_csa_fee_cents=HP_CSA_FEE_CENTS,
        format_cents=format_cents,
    )


@admin_bp.route('/partners/<path:shop_domain>/ledger', methods=['GET', 'POST'])
@require_admin
def partner_ledger(shop_domain):
    shop = fetch_partner_by_domain(shop_domain)
    if not shop:
        flash(f'Shop not found: {shop_domain}', 'error')
        return redirect(url_for('admin.partners'))
    shop_id = shop['id']

    if request.method == 'POST' and request.form.get('form') == 'ledger_adjustment':
        raw = (request.form.get('adjustment_dollars') or '').strip()
        notes = request.form.get('adjustment_notes') or ''
        try:
            dollars = float(raw)
            if dollars == 0:
                raise ValueError('zero')
            amount_cents = int(round(dollars * 100))
        except ValueError:
            flash('Enter a non-zero adjustment amount.', 'error')
            return redirect(url_for('admin.partner_ledger', shop_domain=shop_domain))
        if record_partner_ledger_adjustment(
            shop_id,
            amount_cents=amount_cents,
            notes=notes,
            created_by=get_current_admin() or 'admin',
        ):
            flash('Ledger adjustment recorded.', 'success')
        else:
            flash('Could not record adjustment.', 'error')
        return redirect(url_for('admin.partner_ledger', shop_domain=shop_domain))

    try:
        page = max(1, int(request.args.get('page', 1)))
    except ValueError:
        page = 1
    ledger = fetch_partner_ledger(shop_id, page=page)
    earnings = fetch_partner_earnings_preview(shop_id)
    return render_template(
        'admin/partner_ledger.html',
        shop=shop,
        ledger=ledger,
        earnings=earnings,
        format_cents=format_cents,
        hp_csa_fee_cents=HP_CSA_FEE_CENTS,
    )


@admin_bp.route('/reconciliation', methods=['GET', 'POST'])
@require_admin
def reconciliation():
    today = __import__('datetime').date.today()
    try:
        year = int(request.args.get('year') or request.form.get('year') or today.year)
        month = int(request.args.get('month') or request.form.get('month') or today.month)
    except ValueError:
        year, month = today.year, today.month

    import_results = None
    import_detail = None

    if request.method == 'POST':
        form = request.form.get('form')

        if form == 'hp_period':
            ref = request.form.get('hp_statement_ref')
            try:
                csa_count = int(request.form.get('hp_csa_count') or 0) or None
            except ValueError:
                csa_count = None
            gross_raw = (request.form.get('hp_gross_dollars') or '').strip()
            gross_cents = None
            if gross_raw:
                try:
                    gross_cents = int(round(float(gross_raw) * 100))
                except ValueError:
                    flash('Invalid HP gross amount.', 'error')
                    return redirect(url_for('admin.reconciliation', year=year, month=month))
            status = (request.form.get('hp_status') or 'open').strip()
            notes = request.form.get('hp_notes') or ''
            if upsert_hp_period(
                year, month,
                statement_ref=ref,
                csa_count=csa_count,
                gross_cents=gross_cents,
                status=status,
                notes=notes,
            ):
                flash('HP statement recorded for this period.', 'success')
            else:
                flash('Could not save HP period (run migration if tables missing).', 'error')
            return redirect(url_for('admin.reconciliation', year=year, month=month))

        if form == 'hp_excel':
            uploaded = request.files.get('hp_excel_file')
            if not uploaded or not uploaded.filename:
                flash('Choose an HP Excel detail file to upload.', 'error')
                return redirect(url_for('admin.reconciliation', year=year, month=month))
            if not uploaded.filename.lower().endswith(('.xlsx', '.xls')):
                flash('Upload an Excel file (.xlsx or .xls).', 'error')
                return redirect(url_for('admin.reconciliation', year=year, month=month))
            import_results = import_hp_excel_detail(
                uploaded.read(),
                uploaded.filename,
                year=year,
                month=month,
                uploaded_by=get_current_admin() or 'admin',
            )
            if import_results.get('ok'):
                flash(
                    f"Imported {import_results['row_count']} rows: "
                    f"{import_results['matched_count']} matched, "
                    f"{import_results['unmatched_count']} not in DB.",
                    'success',
                )
            else:
                flash(import_results.get('error') or 'Import failed.', 'error')
                import_results = None

        elif form == 'mark_partner_paid':
            try:
                shop_id = int(request.form.get('shop_id') or 0)
            except ValueError:
                shop_id = 0
            notes = request.form.get('payout_notes') or ''
            ok, msg = record_partner_period_payout(
                shop_id,
                year=year,
                month=month,
                created_by=get_current_admin() or 'admin',
                notes=notes,
            )
            flash(msg, 'success' if ok else 'error')
            return redirect(url_for('admin.reconciliation', year=year, month=month))

    upload_id = request.args.get('upload_id')
    if upload_id:
        try:
            import_detail = fetch_hp_import_detail(int(upload_id))
        except ValueError:
            import_detail = None

    summary = fetch_reconciliation_summary(year=year, month=month)
    if import_results and import_results.get('ok') and not import_detail:
        import_detail = fetch_hp_import_detail(import_results['upload_id'])

    return render_template(
        'admin/reconciliation.html',
        summary=summary,
        import_results=import_results,
        import_detail=import_detail,
        import_history=fetch_hp_import_history(limit=10),
        format_cents=format_cents,
        hp_csa_fee_cents=HP_CSA_FEE_CENTS,
        direct_label=DIRECT_ATTRIBUTION_LABEL,
        default_shop_id=DEFAULT_SHOP_ID,
    )


@admin_bp.route('/', methods=['GET', 'POST'])
def login():
    if get_current_admin():
        return redirect(url_for('admin.dashboard'))

    error = None
    if request.method == 'POST':
        email = (request.form.get('email') or '').strip().lower()
        password = request.form.get('password') or ''
        ensure_admin_users_bootstrapped()
        if authenticate_admin(email, password):
            resp = make_response(redirect(url_for('admin.dashboard')))
            set_auth_cookie(resp, email)
            return resp
        error = 'Invalid credentials.'

    return render_template('admin/login.html', error=error, logo_url=PETRX_LOGO_URL)


@admin_bp.route('/logout')
def logout():
    resp = make_response(redirect(url_for('admin.login')))
    clear_auth_cookie(resp)
    return resp


@admin_bp.route('/admin/login')
@admin_bp.route('/admin/')
def legacy_admin_login():
    return redirect(url_for('admin.login'))


@admin_bp.route('/admin/petrx-product-content')
def legacy_admin_product_content():
    return redirect(url_for('admin.petrx_product_content'))


@admin_bp.route('/petrx-product-content/upload-image', methods=['POST'])
@require_admin
def upload_product_image_route():
    upload = request.files.get('image')
    if not upload or not upload.filename:
        flash('Choose an image file to upload.', 'error')
        return redirect(url_for('admin.petrx_product_content'))

    try:
        image = upload_product_image(
            upload.filename,
            upload.read(),
            upload.content_type or 'application/octet-stream',
        )
        flash(f"Uploaded {image.get('filename', 'image')} to the product library.", 'success')
    except Exception as e:
        logger.error('admin upload_product_image: %s', e)
        flash(f'Upload failed: {e}', 'error')

    return redirect(url_for('admin.petrx_product_content'))


@admin_bp.route('/petrx-product-content', methods=['GET', 'POST'])
@require_admin
def petrx_product_content():
    if request.method == 'POST':
        title = (request.form.get('title') or '').strip()
        description_html = (request.form.get('description_html') or '').strip()
        vendor = (request.form.get('vendor') or '').strip()
        product_type = (request.form.get('product_type') or '').strip()

        if not title or not description_html or not vendor or not product_type:
            flash('Title, description, vendor, and product type are required.', 'error')
            return redirect(url_for('admin.petrx_product_content'))

        images = []
        for i in range(1, 5):
            src = (request.form.get(f'image_{i}_src') or '').strip()
            alt = (request.form.get(f'image_{i}_alt') or '').strip()
            if src:
                images.append({'src': src, 'alt': alt})

        try:
            with get_db() as db:
                db.execute(text('''
                    INSERT INTO petrx_product_config (
                        id, title, description_html, vendor, product_type, updated_at,
                        image_1_src, image_1_alt, image_2_src, image_2_alt,
                        image_3_src, image_3_alt, image_4_src, image_4_alt
                    )
                    VALUES (
                        1, :title, :html, :vendor, :ptype, NOW(),
                        :i1s, :i1a, :i2s, :i2a, :i3s, :i3a, :i4s, :i4a
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        description_html = EXCLUDED.description_html,
                        vendor = EXCLUDED.vendor,
                        product_type = EXCLUDED.product_type,
                        image_1_src = EXCLUDED.image_1_src, image_1_alt = EXCLUDED.image_1_alt,
                        image_2_src = EXCLUDED.image_2_src, image_2_alt = EXCLUDED.image_2_alt,
                        image_3_src = EXCLUDED.image_3_src, image_3_alt = EXCLUDED.image_3_alt,
                        image_4_src = EXCLUDED.image_4_src, image_4_alt = EXCLUDED.image_4_alt,
                        updated_at = NOW()
                '''), {
                    'title': title,
                    'html': description_html,
                    'vendor': vendor,
                    'ptype': product_type,
                    'i1s': request.form.get('image_1_src', '').strip() or None,
                    'i1a': request.form.get('image_1_alt', '').strip() or None,
                    'i2s': request.form.get('image_2_src', '').strip() or None,
                    'i2a': request.form.get('image_2_alt', '').strip() or None,
                    'i3s': request.form.get('image_3_src', '').strip() or None,
                    'i3a': request.form.get('image_3_alt', '').strip() or None,
                    'i4s': request.form.get('image_4_src', '').strip() or None,
                    'i4a': request.form.get('image_4_alt', '').strip() or None,
                })
        except Exception as e:
            logger.error(f'petrx_product_content save error: {e}')
            flash(f'Save failed: {e}', 'error')
            return redirect(url_for('admin.petrx_product_content'))

        media_sources = [
            {'originalSource': img['src'], 'alt': img['alt'], 'mediaContentType': 'IMAGE'}
            for img in images
        ]
        pushed, failed, skipped_stale, skipped_auth = _push_to_shops(
            title, description_html, vendor, product_type, media_sources
        )
        _flash_push_summary(pushed, failed, skipped_stale, skipped_auth)
        return redirect(url_for('admin.petrx_product_content'))

    config = {}
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT title, description_html, vendor, product_type, updated_at,
                       image_1_src, image_1_alt, image_2_src, image_2_alt,
                       image_3_src, image_3_alt, image_4_src, image_4_alt
                FROM petrx_product_config WHERE id = 1
            ''')).mappings().first()
            if row:
                config = dict(row)
    except Exception as e:
        logger.error(f'petrx_product_content load error: {e}')

    shop_rows = []
    try:
        shop_rows = [dict(r) for r in _load_shop_rows()]
    except Exception as e:
        logger.error(f'petrx_product_content: shop list error: {e}')

    shop_health = _run_preflight(shop_rows)
    healthy = [s for s in shop_health if s['ok']]
    broken = [s for s in shop_health if not s['ok']]
    push_shop_count = len(shop_rows)

    return render_template(
        'admin/petrx_product_content.html',
        config=config,
        shop_health=shop_health,
        healthy_count=len(healthy),
        broken_count=len(broken),
        push_shop_count=push_shop_count,
        image_library=list_product_images(),
        product_images_base=f'{Config.FLEX_PET_RX_API_URL.rstrip("/")}/static/images/product/',
    )
