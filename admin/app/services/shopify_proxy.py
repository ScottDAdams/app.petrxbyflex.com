"""Shopify Admin API calls via petrx.petrxbyflex.com internal GraphQL proxy."""

import logging
import os

import requests

logger = logging.getLogger(__name__)


def _proxy_env() -> tuple[str, str]:
    secret = os.environ.get('FULFILLMENT_INTERNAL_SECRET', '')
    app_url = (os.environ.get('SHOPIFY_APP_URL', 'https://petrx.petrxbyflex.com') or '').rstrip('/')
    if not secret or not app_url:
        logger.error(
            'shopify_proxy: SHOPIFY_APP_URL or FULFILLMENT_INTERNAL_SECRET not set'
        )
    return app_url, secret


def shopify_graphql(shop_url: str, query: str, variables: dict | None = None) -> dict:
    app_url, secret = _proxy_env()
    url = f'{app_url}/api/internal/graphql'
    headers = {
        'x-fulfillment-secret': secret,
        'Content-Type': 'application/json',
    }
    body = {'shop_url': shop_url, 'query': query, 'variables': variables or {}}
    resp = requests.post(url, headers=headers, json=body, timeout=30)
    if resp.status_code != 200:
        logger.warning(
            f'shopify_graphql proxy for {shop_url} returned '
            f'{resp.status_code}: {resp.text[:200]}'
        )
        raise RuntimeError(
            f'Shopify GraphQL proxy {resp.status_code}: {resp.text[:300]}'
        )
    return resp.json()


def preflight_shop(shop_url: str) -> tuple[bool, str, str]:
    try:
        result = shopify_graphql(shop_url, '{ shop { name } }')
    except RuntimeError as e:
        msg = str(e)
        if '401' in msg and 'Unauthorized' in msg and 'fulfillment' not in msg.lower():
            return False, 'stale_token', (
                f'{shop_url}: stored Shopify session is invalid. '
                f'Merchant must open the PetRx app in Shopify admin to refresh the token.'
            )
        if '401' in msg or 'Unauthorized' in msg:
            return False, 'proxy_auth', (
                f'{shop_url}: proxy rejected our auth header. '
                f'Check FULFILLMENT_INTERNAL_SECRET matches flex-pet-rx.'
            )
        if any(code in msg for code in ('500', '502', '503', '504')):
            return False, 'shopify_5xx', (
                f'{shop_url}: Shopify returned a 5xx via the proxy. '
                f'Usually transient — retry in 30 seconds.'
            )
        if '404' in msg or 'no offline session' in msg.lower() or 'no session' in msg.lower():
            return False, 'no_session', (
                f'{shop_url}: no Shopify session on file. '
                f'Merchant likely uninstalled — they need to reinstall the app.'
            )
        return False, 'unknown', f'{shop_url}: {msg[:200]}'
    except Exception as e:
        return False, 'proxy_unreachable', (
            f'Cannot reach the Shopify proxy ({type(e).__name__}). '
            f'Check SHOPIFY_APP_URL ({os.environ.get("SHOPIFY_APP_URL", "<unset>")}) '
            f'and that petrx.petrxbyflex.com is up.'
        )

    shop_data = (result.get('data') or {}).get('shop')
    if shop_data and shop_data.get('name'):
        return True, 'ok', shop_data['name']

    errors = result.get('errors') or []
    if errors:
        first = (errors[0] or {}).get('message', '')
        return False, 'unknown', f'{shop_url}: Shopify error: {first[:200]}'
    return False, 'unknown', f'{shop_url}: empty shop response'
