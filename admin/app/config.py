import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    DATABASE_URL = os.environ.get('DATABASE_URL', '')

    ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@petrxbyflex.com')
    ADMIN_PASSWORD_HASH = os.environ.get('ADMIN_PASSWORD_HASH', '')
    ADMIN_EMAIL_2 = os.environ.get('ADMIN_EMAIL_2', '')
    ADMIN_PASSWORD_HASH_2 = os.environ.get('ADMIN_PASSWORD_HASH_2', '')

    JWT_SECRET = os.environ.get('JWT_SECRET', 'change-me-in-production')
    JWT_ALGORITHM = 'HS256'
    JWT_EXPIRY_HOURS = 12

    SECRET_KEY = os.environ.get('SECRET_KEY', JWT_SECRET)
    DEBUG = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'

    SHOPIFY_APP_URL = os.environ.get('SHOPIFY_APP_URL', 'https://petrx.petrxbyflex.com')
    FULFILLMENT_INTERNAL_SECRET = os.environ.get('FULFILLMENT_INTERNAL_SECRET', '')
    FLEX_PET_RX_API_URL = os.environ.get('FLEX_PET_RX_API_URL', 'https://api.petrxbyflex.com')

    # Grafana Cloud embed (admin dashboards page). Token is a Viewer-role
    # service-account token, set as a Fly secret (never in code/git).
    GRAFANA_URL = os.environ.get('GRAFANA_URL', 'https://livelybison1846.grafana.net')
    GRAFANA_SA_TOKEN = os.environ.get('GRAFANA_SA_TOKEN', '')
