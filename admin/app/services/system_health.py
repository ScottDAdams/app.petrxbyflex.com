"""Operational health signals pulled from sister services.

Right now this just wraps the Flex API's /api/system/pass-cert-status
endpoint so the admin dashboard can render a Pass Type ID renewal banner.
Keep this module small — anything heavier should live in the relevant
sister service, not here.
"""

from __future__ import annotations

import logging
from typing import Any

import requests

from ..config import Config

logger = logging.getLogger(__name__)

_TIMEOUT_SECS = 4


def fetch_pass_cert_status() -> dict[str, Any]:
    """Return the Apple Pass Type ID cert expiry signal.

    Shape:
        {
          'available': bool,
          'status': 'ok' | 'warning' | 'urgent' | 'critical' | 'expired' | 'unknown',
          'expires_at': ISO-8601 str | None,
          'days_left': int | None,
        }

    `available=False` means we couldn't reach the API or parse the response;
    treat as "unknown" and don't block the dashboard.
    """
    base = (Config.FLEX_PET_RX_API_URL or 'https://api.petrxbyflex.com').rstrip('/')
    url = f'{base}/api/system/pass-cert-status'
    try:
        resp = requests.get(url, timeout=_TIMEOUT_SECS)
        if resp.status_code != 200:
            logger.warning('pass-cert-status HTTP %s from %s', resp.status_code, url)
            return {'available': False, 'status': 'unknown', 'expires_at': None, 'days_left': None}
        data = resp.json()
        return {
            'available': True,
            'status': data.get('status', 'unknown'),
            'expires_at': data.get('expires_at'),
            'days_left': data.get('days_left'),
        }
    except Exception as exc:  # noqa: BLE001 — broad on purpose, just dashboard health
        logger.warning('pass-cert-status fetch failed: %s', exc)
        return {'available': False, 'status': 'unknown', 'expires_at': None, 'days_left': None}
