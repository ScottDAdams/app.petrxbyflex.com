"""Admin authentication — JWT httpOnly cookie (same pattern as FlexProtect)."""
import logging
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
import jwt
from flask import redirect, request, url_for

from .config import Config

logger = logging.getLogger(__name__)

COOKIE_NAME = 'prx_admin'


def check_password(plain: str, hashed: str) -> bool:
    try:
        hashed = hashed.strip()
        if not hashed.startswith('$2'):
            logger.warning("ADMIN_PASSWORD_HASH does not look like a bcrypt hash")
            return False
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception as e:
        logger.warning(f"check_password error: {e}")
        return False


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def _make_token(email: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=Config.JWT_EXPIRY_HOURS)
    return jwt.encode({'sub': email, 'exp': exp}, Config.JWT_SECRET, algorithm=Config.JWT_ALGORITHM)


def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, Config.JWT_SECRET, algorithms=[Config.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def set_auth_cookie(response, email: str):
    token = _make_token(email)
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        secure=True,
        samesite='Lax',
        max_age=int(Config.JWT_EXPIRY_HOURS * 3600),
    )
    return response


def clear_auth_cookie(response):
    response.delete_cookie(COOKIE_NAME)
    return response


def get_current_admin() -> str | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    payload = _decode_token(token)
    if not payload:
        return None
    return payload.get('sub')


def require_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        email = get_current_admin()
        if not email:
            return redirect(url_for('admin.login', next=request.path))
        from .services.admin_users import admin_is_active
        if not admin_is_active(email):
            resp = redirect(url_for('admin.login', next=request.path))
            clear_auth_cookie(resp)
            return resp
        return f(*args, **kwargs)
    return wrapper
