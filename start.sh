#!/bin/sh
set -e

cd /app/admin
gunicorn wsgi:app \
  --bind 127.0.0.1:8080 \
  --workers 1 \
  --threads 4 \
  --timeout 120 \
  --access-logfile - \
  --error-logfile - &

exec nginx -g 'daemon off;'
