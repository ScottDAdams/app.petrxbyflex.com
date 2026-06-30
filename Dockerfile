FROM node:20-alpine AS frontend-builder
WORKDIR /app
ARG VITE_ONEINC_MODAL_VERSION=v2
ENV VITE_ONEINC_MODAL_VERSION=$VITE_ONEINC_MODAL_VERSION
# OneInc environment: "staging" (default) or "prod". Controls which PortalOne
# SDK host the frontend loads. Production is set in fly.toml [build.args].
ARG VITE_ONEINC_ENV=staging
ENV VITE_ONEINC_ENV=$VITE_ONEINC_ENV
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
