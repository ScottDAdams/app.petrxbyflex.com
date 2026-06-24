"""Proxy to flex-pet-rx-api product image library."""

from __future__ import annotations

import logging

import requests

from ..config import Config

logger = logging.getLogger(__name__)


def _headers() -> dict:
    return {
        'x-fulfillment-secret': Config.FULFILLMENT_INTERNAL_SECRET or '',
    }


def _api_base() -> str:
    return (Config.FLEX_PET_RX_API_URL or 'https://api.petrxbyflex.com').rstrip('/')


def list_product_images() -> list[dict]:
    if not Config.FULFILLMENT_INTERNAL_SECRET:
        logger.warning('FULFILLMENT_INTERNAL_SECRET unset — cannot load image library')
        return []
    try:
        resp = requests.get(
            f'{_api_base()}/api/internal/product-images',
            headers=_headers(),
            timeout=15,
        )
        if resp.status_code != 200:
            logger.warning('product-images list HTTP %s: %s', resp.status_code, resp.text[:200])
            return []
        return resp.json().get('images') or []
    except Exception as e:
        logger.error('product-images list error: %s', e)
        return []


def upload_product_image(filename: str, data: bytes, content_type: str) -> dict:
    resp = requests.post(
        f'{_api_base()}/api/internal/product-images',
        headers=_headers(),
        files={'image': (filename, data, content_type or 'application/octet-stream')},
        timeout=60,
    )
    if resp.status_code not in (200, 201):
        payload = resp.json() if resp.headers.get('content-type', '').startswith('application/json') else {}
        raise RuntimeError(payload.get('error') or f'Upload failed ({resp.status_code})')
    body = resp.json()
    return body.get('image') or body
