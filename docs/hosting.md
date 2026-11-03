# Hosting & Infrastructure

How ClinicOS is hosted in production, how the pieces connect, and where the data lives.
Source of truth for the setup is [`render.yaml`](../render.yaml) at the repo root.

> **Last reviewed:** 2026-11-02
>
> **⛔ OFFLINE since 2026-11-02.** Every Render resource below was deleted. The database was
> backed up first (verified) to `~/clinicos-backup-2026-11-02/`; uploaded images were not kept.
> This document describes the setup as it was. To bring it back,
> follow [`hosting-shutdown-and-restore.md`](hosting-shutdown-and-restore.md).

---

## 1. At a glance

ClinicOS runs entirely on **[Render](https://render.com)**. The setup has four parts:

| Render resource | Type | What it is | Plan | Cost |
|---|---|---|---|---|
| `clinicos-frontend` | Web service (Node 20) | Next.js app: the website staff open | Starter (always on, 512MB) | $7/mo |
| `clinicos-api` | Web service (Python) | Flask REST API, run by gunicorn | Starter (always on, 512MB) | $7/mo |
| `clinicos-db` | PostgreSQL 18 | All structured data | **⚠️ Unverified (see §7)** | $0 or $7/mo |
| `clinic-uploads` | Persistent disk, 10GB | All uploaded images | Attached to `clinicos-api` | ~$1/mo |

**Live URLs**
- Website: https://clinicos-frontend.onrender.com
- API: https://clinicos-api-69mw.onrender.com (staff never visit this directly)

**GitHub repo:** `RudhraReddy/clinicos`. Render watches the `main` branch.

---

## 2. How everything connects

```
                Clinic staff (browser / phone)
                            │
                            │  https://clinicos-frontend.onrender.com
                            ▼
        ┌────────────────────────────────────────────┐
        │  clinicos-frontend   (Next.js, Node 20)    │
        │                                            │
        │  middleware.ts  → no auth_token cookie?    │
        │                   redirect to /login       │
        │                                            │
        │  next.config.ts → rewrites /api/*  ────────┼──┐
        └────────────────────────────────────────────┘  │ server-to-server
                                                        │ (BACKEND_URL)
                                                        ▼
        ┌────────────────────────────────────────────┐
        │  clinicos-api   (Flask + gunicorn)         │
        │  create_app() → all blueprints at /api     │
        └───────────────┬───────────────────┬────────┘
                        │                   │
          DATABASE_URL  │                   │  UPLOAD_BASE_DIR
         (auto-injected)│                   │  = /var/data/clinic_uploads
                        ▼                   ▼
        ┌──────────────────────┐   ┌───────────────────────────────┐
        │ clinicos-db          │   │ clinic-uploads disk (10GB)    │
        │ PostgreSQL 18        │   │ patients/<patient_id>/...     │
        │ db name: clinic_db_* │   │ invoices/...                  │
        │                      │   │ temp/<session_id>/...         │
        └──────────────────────┘   └───────────────────────────────┘
```

### 2.1 Browser → Frontend
Staff only ever talk to the frontend's domain. Before a page renders, `frontend/middleware.ts`
checks for the `auth_token` cookie and sends the user to `/login` if it's missing.
These paths skip that check: `/login`, `/create-account`, `/connect/*` (QR mobile upload) and
`/api/*`.

### 2.2 Frontend → API (the proxy)
The browser **never calls the API's hostname**. Every API call in `frontend/lib/api.ts` uses a
relative path such as `/api/patients`, and `API_BASE_URL` is the empty string `''`.
`frontend/next.config.ts` forwards those requests on the server side:

```ts
source: '/api/:path*'
destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:5000'}/api/:path*`
```

Why this matters:
- **The site looks like one origin to the browser.** The login cookie (`auth_token`, set
  `httponly`, `samesite=Strict` and `secure` when not in debug) is treated as first-party, and
  CORS never comes into play for normal use.
- Images and CSV exports also come through `/api/...` on the frontend domain.
- It also lets the app work through Twingate or other remote access without CORS problems.
- `BACKEND_URL` is read **when the frontend is built** (rewrites are compiled into the build).
  If you change it, redeploy the frontend, not just restart it.

### 2.3 API → Database
- Render puts the database connection string into the API as `DATABASE_URL`
  (`fromDatabase: clinicos-db / connectionString` in `render.yaml`).
- Render gives the URL as `postgres://...`, but SQLAlchemy 2.0 needs `postgresql://...`.
  `Backend_db/app.py` rewrites it at startup.
- The actual database name has a Render suffix (`clinic_db_s5ra`). You don't need to know it
  because the URL is supplied for you.
- `create_app()` raises an error and refuses to start if `DATABASE_URL` is missing.

### 2.4 API → Uploaded files
- Every upload route builds its paths from `UPLOAD_BASE_DIR`, which is
  `/var/data/clinic_uploads`, where the `clinic-uploads` persistent disk is mounted.
  - Patient images: `patients/<patient_id>/`
  - Purchase-invoice photos: `invoices/`
  - QR mobile upload staging: `temp/<session_id>/` (files move into `patients/` or `invoices/`
    when the upload is finalized)
- The API serves files with Flask `send_file()`, so the browser fetches them through the
  `/api` proxy like any other request.

---

## 3. Deploys

**Every push to `main` deploys automatically.** Render rebuilds both web services:

| Service | Root dir | Build command | Start command |
|---|---|---|---|
| `clinicos-frontend` | `frontend/` | `npm install && npm run build` | `npm start` (`next start`) |
| `clinicos-api` | `Backend_db/` | `pip install -r requirements.txt` | see below |

```bash
gunicorn --bind 0.0.0.0:$PORT \
  --workers 1 \
  --timeout 120 \
  --max-requests 500 \
  --max-requests-jitter 50 \
  "app:create_app()"
```

- **1 worker.** This fits the 512MB RAM limit.
- **120-second timeout.** Leaves room for large CSV imports and exports.
- **`--max-requests 500` + jitter.** gunicorn restarts the worker roughly every 500 requests to
  limit slow memory leaks.

There's **no CI and no test suite.** If the build passes, the code ships. Run
`npm run build` and `npm run lint` locally before pushing.

---

## 4. Database schema changes (read this before adding a column)

There is **no Alembic or other migration tool.** Every time the API starts (that is, on every
deploy), `create_app()` runs:

1. `db.create_all()` creates **missing tables** only. It **never** adds columns to a table that
   already exists. (`implementation_plan.md` says otherwise; that's wrong.)
2. `_apply_migrations(db)` in `Backend_db/app.py` runs a hand-maintained list of
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` statements.

**Rules for schema changes:**
- **New table:** adding the model to `models.py` is enough.
- **New column on an existing table:** add the model field **and** an
  `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS ...` line to `_apply_migrations`. If you skip the
  second step, production crashes with "column does not exist" as soon as the code queries it.
- Every statement **must be idempotent** (`IF NOT EXISTS` / `IF EXISTS`), because they all
  run on every startup.
- Make new columns `nullable` or give them a default, so existing production rows stay valid.
- Destructive statements (`DROP COLUMN`, data-rewriting `UPDATE`s) run against **live clinic
  data** on the next deploy. Be very careful with them.

---

## 5. Environment variables

### `clinicos-api`
| Variable | Value | Where it's set |
|---|---|---|
| `DATABASE_URL` | Auto-injected from `clinicos-db` | `render.yaml` |
| `UPLOAD_BASE_DIR` | `/var/data/clinic_uploads` | `render.yaml` |
| `FLASK_DEBUG` | `false` | `render.yaml` |
| `CORS_ORIGINS` | `https://clinicos-frontend.onrender.com` | `render.yaml` |
| `JWT_SECRET_KEY` | secret | **Render dashboard only** (`sync: false`) |
| `TOTP_SECRET` | secret (Google Authenticator seed) | **Render dashboard only** (`sync: false`) |

`sync: false` means Render keeps the value you entered in the dashboard and never reads it from
git. **Don't commit these secrets.** If they're lost, they have to be regenerated:
- **New `JWT_SECRET_KEY`:** logs everyone out.
- **New `TOTP_SECRET`:** everyone's authenticator app entry has to be set up again.

`GOOGLE_CLOUD_API_KEY` may still be set in the dashboard from the removed OCR feature. It's
unused and should be deleted by hand.

### `clinicos-frontend`
| Variable | Value |
|---|---|
| `BACKEND_URL` | `https://clinicos-api-69mw.onrender.com` |
| `NODE_VERSION` | `20` |

### Local development (for comparison)
| | Production (Render) | Local |
|---|---|---|
| Frontend | `clinicos-frontend.onrender.com` | `localhost:3000` (`npm run dev`) |
| API | `clinicos-api-69mw.onrender.com` | `127.0.0.1:5000` (`python app.py`) |
| DB | Render Postgres | local Postgres `clinic_db` |
| Uploads | `/var/data/clinic_uploads` | `/media/fia/External/data/images` |
| Config | Render env vars | `Backend_db/.env`, `frontend/.env.local` |

---

## 6. Backups & data safety

| Data | Lives in | Backup |
|---|---|---|
| Patients, visits, bills, inventory, users, settings | `clinicos-db` | Depends on the DB plan. Free plans have **no backups**; paid plans have Render's point-in-time recovery |
| Patient and invoice images | `clinic-uploads` disk | Render takes **daily snapshots, kept for 7 days** |
| Code | GitHub `RudhraReddy/clinicos` | git |

**Things that cause silent data loss. Don't do them:**
- **Don't change the disk's mount path.** `PatientImage.image_path` stores **absolute** file
  paths (`/var/data/clinic_uploads/patients/...`). Moving the mount would break every existing
  image link.
- **Don't let `UPLOAD_BASE_DIR` go unset.** The code then falls back to `/tmp/clinic_uploads`,
  which is **ephemeral**: uploads would work until the next deploy and then disappear.
- **Don't add a second API instance.** A Render persistent disk can only attach to one
  instance, so `clinicos-api` can't scale out while images are stored on the disk.
- For an extra off-Render copy, use the CSV exports (patients and inventory) from the app and
  the Admin data-management export.

---

## 7. ⚠️ Open issue: database plan

`clinicos-db` was created on Render's **Free** PostgreSQL plan, which **auto-deletes after 90
days**. Its deadline was **2026-05-29**. Nobody has confirmed whether it was upgraded to a
paid plan in the dashboard before that date.

`render.yaml`'s `databases:` block has **no `plan:` key**, so the config file doesn't record an
upgrade either way.

**To do:** open the Render dashboard, then `clinicos-db`, and check the plan.
- If it's on a paid plan, add `plan: <that plan>` under `clinicos-db` in `render.yaml` so the
  file matches the live setup, and update this section.
- If it's still on Free, upgrade it immediately.

---

## 8. Known gaps

- **No health check** on either service. Render can't detect a hung worker; it only notices a
  crashed process.
- **Single gunicorn worker.** One slow request (a big import, say) delays everyone else's
  requests for up to 120 seconds.
- **No staging environment.** Every push to `main` goes straight to the live clinic.
- **Region and Postgres version** aren't pinned in `render.yaml`. They were picked when the
  resources were first created in the dashboard.

---

## 9. Common tasks

| I want to… | Do this |
|---|---|
| Deploy a change | Push to `main`. Watch the deploy logs in the Render dashboard |
| Roll back a bad deploy | Render dashboard → service → **Events** → pick an earlier deploy → **Rollback** (or `git revert` and push) |
| Change a secret | Render dashboard → `clinicos-api` → **Environment** → edit → save (restarts the service) |
| Change `BACKEND_URL` | Edit it, then **redeploy** the frontend (it's read at build time) |
| Read API logs / errors | Render dashboard → `clinicos-api` → **Logs** |
| Connect to the prod DB | Render dashboard → `clinicos-db` → **Connect** → copy the external URL → `psql "<url>"` (be careful: this is live data) |
| Look at uploaded files | Render dashboard → `clinicos-api` → **Shell** → `ls /var/data/clinic_uploads` |
| Add a DB column | See §4 |
