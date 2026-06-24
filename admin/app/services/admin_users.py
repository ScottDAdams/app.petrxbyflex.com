"""Admin portal user accounts — stored in Postgres (not Fly secrets)."""

from __future__ import annotations

import logging
import re

from sqlalchemy import text

from ..auth import check_password, hash_password
from ..config import Config
from ..models.database import get_db

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def _normalize_email(email: str) -> str:
    return (email or '').strip().lower()


def ensure_admin_users_bootstrapped() -> None:
    """Seed admin_users from env secrets when table is empty (first deploy)."""
    try:
        with get_db() as db:
            count = db.execute(text('SELECT COUNT(*) FROM admin_users')).scalar() or 0
            if count > 0:
                return

            seeds: list[tuple[str, str, str | None]] = []
            if Config.ADMIN_EMAIL and Config.ADMIN_PASSWORD_HASH:
                seeds.append((
                    _normalize_email(Config.ADMIN_EMAIL),
                    Config.ADMIN_PASSWORD_HASH.strip(),
                    'Bootstrap (Fly secret)',
                ))
            if Config.ADMIN_EMAIL_2 and Config.ADMIN_PASSWORD_HASH_2:
                seeds.append((
                    _normalize_email(Config.ADMIN_EMAIL_2),
                    Config.ADMIN_PASSWORD_HASH_2.strip(),
                    'Bootstrap (Fly secret 2)',
                ))

            for email, pwd_hash, label in seeds:
                if not email or not pwd_hash.startswith('$2'):
                    continue
                db.execute(text('''
                    INSERT INTO admin_users (email, password_hash, display_name, is_active)
                    VALUES (:email, :hash, :name, TRUE)
                    ON CONFLICT (email) DO NOTHING
                '''), {'email': email, 'hash': pwd_hash, 'name': label})

            if seeds:
                logger.info('admin_users: bootstrapped %s account(s) from env secrets', len(seeds))
    except Exception as e:
        logger.warning('admin_users bootstrap skipped: %s', e)


def authenticate_admin(email: str, password: str) -> bool:
    """Check DB first, then legacy env secret pairs."""
    email = _normalize_email(email)
    if not email or not password:
        return False

    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT password_hash FROM admin_users
                WHERE email = :email AND is_active = TRUE
            '''), {'email': email}).mappings().first()
            if row and check_password(password, row['password_hash']):
                db.execute(text('''
                    UPDATE admin_users
                    SET last_login_at = NOW(), updated_at = NOW()
                    WHERE email = :email
                '''), {'email': email})
                return True
    except Exception as e:
        logger.error('authenticate_admin db error: %s', e)

    # Legacy Fly secrets (until all accounts are in DB)
    pairs = [
        (Config.ADMIN_EMAIL, Config.ADMIN_PASSWORD_HASH),
        (Config.ADMIN_EMAIL_2, Config.ADMIN_PASSWORD_HASH_2),
    ]
    return any(
        acct_email and acct_hash
        and email == _normalize_email(acct_email)
        and check_password(password, acct_hash)
        for acct_email, acct_hash in pairs
    )


def admin_is_active(email: str) -> bool:
    email = _normalize_email(email)
    if not email:
        return False
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT 1 FROM admin_users
                WHERE email = :email AND is_active = TRUE
            '''), {'email': email}).first()
            if row:
                return True
    except Exception as e:
        logger.error('admin_is_active error: %s', e)

    pairs = [
        (Config.ADMIN_EMAIL, Config.ADMIN_PASSWORD_HASH),
        (Config.ADMIN_EMAIL_2, Config.ADMIN_PASSWORD_HASH_2),
    ]
    return any(
        acct_email and acct_hash and email == _normalize_email(acct_email)
        for acct_email, acct_hash in pairs
    )


def list_admin_users() -> list[dict]:
    try:
        with get_db() as db:
            rows = db.execute(text('''
                SELECT id, email, display_name, is_active, created_at, last_login_at
                FROM admin_users
                ORDER BY is_active DESC, email ASC
            ''')).mappings().all()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error('list_admin_users: %s', e)
        return []


def count_active_admins(exclude_email: str | None = None) -> int:
    try:
        with get_db() as db:
            if exclude_email:
                return int(db.execute(text('''
                    SELECT COUNT(*) FROM admin_users
                    WHERE is_active = TRUE AND email <> :email
                '''), {'email': _normalize_email(exclude_email)}).scalar() or 0)
            return int(db.execute(text(
                'SELECT COUNT(*) FROM admin_users WHERE is_active = TRUE'
            )).scalar() or 0)
    except Exception as e:
        logger.error('count_active_admins: %s', e)
        return 0


def create_admin_user(email: str, password: str, display_name: str | None = None) -> tuple[bool, str]:
    email = _normalize_email(email)
    if not EMAIL_RE.match(email):
        return False, 'Enter a valid email address.'
    if len(password) < 8:
        return False, 'Password must be at least 8 characters.'

    try:
        with get_db() as db:
            exists = db.execute(text(
                'SELECT 1 FROM admin_users WHERE email = :email'
            ), {'email': email}).first()
            if exists:
                return False, 'An admin with that email already exists.'

            db.execute(text('''
                INSERT INTO admin_users (email, password_hash, display_name, is_active)
                VALUES (:email, :hash, :name, TRUE)
            '''), {
                'email': email,
                'hash': hash_password(password),
                'name': (display_name or '').strip() or None,
            })
        return True, f'Admin {email} created.'
    except Exception as e:
        logger.error('create_admin_user: %s', e)
        return False, f'Could not create admin: {e}'


def set_admin_active(user_id: int, active: bool, *, current_email: str) -> tuple[bool, str]:
    try:
        with get_db() as db:
            row = db.execute(text('''
                SELECT id, email, is_active FROM admin_users WHERE id = :id
            '''), {'id': user_id}).mappings().first()
            if not row:
                return False, 'Admin user not found.'

            target_email = row['email']
            if not active and _normalize_email(target_email) == _normalize_email(current_email):
                return False, 'You cannot deactivate your own account.'

            if not active:
                others = count_active_admins(exclude_email=target_email)
                if others < 1:
                    return False, 'Cannot deactivate the last active admin.'

            db.execute(text('''
                UPDATE admin_users
                SET is_active = :active, updated_at = NOW()
                WHERE id = :id
            '''), {'active': active, 'id': user_id})

            verb = 'activated' if active else 'deactivated'
            return True, f'{target_email} {verb}.'
    except Exception as e:
        logger.error('set_admin_active: %s', e)
        return False, str(e)


def update_admin_password(
    user_id: int,
    new_password: str,
    *,
    current_email: str,
    allow_any_admin: bool = False,
) -> tuple[bool, str]:
    if len(new_password) < 8:
        return False, 'Password must be at least 8 characters.'

    try:
        with get_db() as db:
            row = db.execute(text(
                'SELECT id, email FROM admin_users WHERE id = :id'
            ), {'id': user_id}).mappings().first()
            if not row:
                return False, 'Admin user not found.'

            if not allow_any_admin and _normalize_email(row['email']) != _normalize_email(current_email):
                return False, 'You can only change your own password here.'

            db.execute(text('''
                UPDATE admin_users
                SET password_hash = :hash, updated_at = NOW()
                WHERE id = :id
            '''), {'hash': hash_password(new_password), 'id': user_id})
            return True, f'Password updated for {row["email"]}.'
    except Exception as e:
        logger.error('update_admin_password: %s', e)
        return False, str(e)
