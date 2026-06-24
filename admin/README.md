# PetRx Admin (admin.petrxbyflex.com)

Flask admin on the same Fly app as `app.petrxbyflex.com`. Nginx routes by hostname:

- `admin.petrxbyflex.com` → gunicorn (product content editor)
- `app.petrxbyflex.com` → Vite SPA

## Fly secrets (app-petrxbyflex-com)

```bash
fly secrets set -a app-petrxbyflex-com \
  DATABASE_URL='...' \
  JWT_SECRET='...' \
  ADMIN_EMAIL='you@example.com' \
  ADMIN_PASSWORD_HASH='...' \
  SHOPIFY_APP_URL='https://petrx.petrxbyflex.com' \
  FULFILLMENT_INTERNAL_SECRET='...'
```

`FULFILLMENT_INTERNAL_SECRET` must match **flex-pet-rx** and **flex-pet-rx-api**.

### Admin users (preferred)

Run migration `flex-pet-rx-api/migrations/2026-06-01_admin_users.sql` (or Supabase migration `admin_users`).

- First deploy: existing `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` Fly secrets are copied into `admin_users` automatically when the table is empty.
- After that: add colleagues at **Admin users** in the portal (`/admin-users`) — no new Fly secrets needed.
- Legacy env login still works as fallback until everyone is in the database.

Generate a bcrypt hash manually (only if needed outside the UI):

```bash
python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_PASSWORD', bcrypt.gensalt()).decode())"
```

## Database

Run migration on Supabase:

`flex-pet-rx-api/migrations/2026-05-20_petrx_product_config.sql`

## URLs

- Login: https://admin.petrxbyflex.com/
- Dashboard: `/dashboard`
- Partners: `/partners`
- Product content: `/petrx-product-content`

See `PetRx/docs/ADMIN_PORTAL_PLAN.md` for phased roadmap (ops dashboard = Phase 1).
