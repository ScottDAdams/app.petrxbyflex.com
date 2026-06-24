import logging
import os

from flask import Flask

from .config import Config
from .routes.admin import admin_bp
from .routes import admin_users_routes  # noqa: F401 — must load before register_blueprint

logger = logging.getLogger(__name__)


def _validate_shopify_proxy_config():
    app_url = (os.environ.get('SHOPIFY_APP_URL') or '').rstrip('/')
    secret = os.environ.get('FULFILLMENT_INTERNAL_SECRET') or ''
    problems: list[str] = []

    if not secret:
        problems.append('FULFILLMENT_INTERNAL_SECRET is not set')
    if not app_url:
        problems.append('SHOPIFY_APP_URL is not set')
    elif 'petrx' not in app_url:
        problems.append(
            f'SHOPIFY_APP_URL looks wrong: {app_url!r} — expected petrx.petrxbyflex.com'
        )

    if problems:
        logger.error(
            'Shopify proxy misconfigured — admin product push will fail. Problems: '
            + '; '.join(problems)
        )
    else:
        logger.info(
            f'Shopify proxy config OK — SHOPIFY_APP_URL={app_url}, '
            f'FULFILLMENT_INTERNAL_SECRET set'
        )


def create_app():
    app = Flask(__name__, template_folder='templates')
    app.config.from_object(Config)
    app.secret_key = Config.SECRET_KEY

    @app.template_filter('dt_short')
    def dt_short(value):
        if value is None:
            return '—'
        try:
            return value.strftime('%b %d, %Y')
        except (AttributeError, TypeError):
            return str(value)[:16]

    _validate_shopify_proxy_config()
    app.register_blueprint(admin_bp)

    with app.app_context():
        from .services.admin_users import ensure_admin_users_bootstrapped
        ensure_admin_users_bootstrapped()

    return app
