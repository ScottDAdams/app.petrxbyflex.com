FROM node:20-alpine AS frontend-builder
WORKDIR /app
ARG VITE_ONEINC_MODAL_VERSION=v2
ENV VITE_ONEINC_MODAL_VERSION=$VITE_ONEINC_MODAL_VERSION
# Global environment toggle (single knob). "production" or "development".
# Set in fly.toml [build.args]; the DEV clone sets "development". Defaults to
# development so a missing value can never bake a prod payment host into a dev build.
# The frontend's OneInc host derives from VITE_ONEINC_ENV (which we set = APP_ENV;
# its prod check accepts "production"/"prod"), keeping one source of truth.
ARG APP_ENV=development
ENV VITE_APP_ENV=$APP_ENV
ENV VITE_ONEINC_ENV=$APP_ENV
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# Admin Flask app
COPY admin/requirements.txt /app/admin/requirements.txt
RUN pip install --no-cache-dir -r /app/admin/requirements.txt
COPY admin/ /app/admin/

# Frontend static assets
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY start.sh /start.sh
RUN rm -f /etc/nginx/sites-enabled/default && chmod +x /start.sh

EXPOSE 80

CMD ["/start.sh"]
