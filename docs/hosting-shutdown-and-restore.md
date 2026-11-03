# Shutdown & Restore Runbook

**Status:** ClinicOS was **taken offline on 2026-11-02** at the owner's request, to stop paying
for hosting. Every Render resource was deleted.

- **The database was fully backed up first and the backup was checked:** all 16 tables restore
  with exactly the same row counts as production. That includes patients, visits, bills,
  inventory, users and the admin audit log.
- **Uploaded images were not backed up** (owner's choice). The Render disk held no patient photos
  (`patient_images` had 0 rows), but it did hold the photos attached to **87 purchase invoices**.
  Those invoice records are in the backup, but the photo files themselves are gone.
- The **code is untouched** in the GitHub repo `RudhraReddy/clinicos` (branch `main`), including
  `render.yaml`, which recreates the hosting setup.

For how the hosting worked while it was live, see [`hosting.md`](hosting.md).

---

## Part A — What was saved

**Location:** `/home/fia/clinicos-backup-2026-11-02/` on the owner's computer (~1.4MB). It is
deliberately **not** in the git repo, because it contains patient data.
**→ Copy this folder somewhere else as well** (external drive, Google Drive and so on). A single
copy on one laptop is one disk failure away from being lost.

| File | What it is | Use it for |
|---|---|---|
| `clinic_db.dump` | Full PostgreSQL dump (`pg_dump -Fc`, PostgreSQL 18) | **Restoring** the database (Part C) |
| `clinic_db.sql` | The same data as a plain-text SQL script | Reading or searching by hand; restoring with `psql` if `pg_restore` isn't available |
| `csv/<table>.csv` | One CSV per table, with a header row | Opening in Excel or Sheets to look at the data without a database |
| `row_counts_estimate.txt` | Postgres's own row estimates at backup time | Rough reference only (the verified counts are below) |

**Verified row counts** (live production vs. restored from `clinic_db.dump`, all matched exactly):

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| `audit_logs` (admin log history) | 1294 | | `product_master` | 642 |
| `inventory_history` | 1002 | | `purchase_invoices` | 87 |
| `inventory_batches` | 701 | | `visits` | 85 |
| `bill_items` | 294 | | `patients` | 79 |
| `upload_sessions` | 94 | | `bills` | 72 |
| `users` | 7 | | `doctor_staff_assignments` | 3 |
| `locations` | 2 | | `visit_refunds` | 1 |
| `expense_ledger` | 0 | | `patient_images` | 0 |

**Not saved:**
- **The 87 invoice photo files** from the `clinic-uploads` disk. After a restore,
  `purchase_invoices.image_path` still points at `/var/data/clinic_uploads/invoices/...`, but the
  files don't exist, so "view invoice image" will fail for those old invoices. Everything else
  about each invoice is intact.
- **The production `JWT_SECRET_KEY` and `TOTP_SECRET`.** New ones are generated when the site is
  brought back (Part C, step 1), so the old "ClinicOS" entry in everyone's Google Authenticator
  stops working. The **user accounts and passwords do survive** in the `users` table.
- **Render's own service logs** (server output). They can't be exported. The admin activity log
  is `audit_logs`, and that was saved.

## Part B — How it was taken down

All of this was done in the Render dashboard, logged in as the workspace owner. The Blueprint
was named **"Teja Clinic"**, workspace "My Workspace", region **oregon**.

1. **Backup.** The External Database URL was taken from `clinicos-db` → Info → Connections. Then
   `pg_dump` was run from the official `postgres:18` Docker image. (The local `pg_dump` is version
   15, and pg_dump refuses to dump a newer server.)
   ```bash
   docker run --rm -e PGURL="<external-db-url>" -v ~/clinicos-backup-2026-11-02:/out postgres:18 bash -c '
     pg_dump "$PGURL?sslmode=require" -Fc --no-owner --no-privileges -f /out/clinic_db.dump
     pg_dump "$PGURL?sslmode=require"     --no-owner --no-privileges -f /out/clinic_db.sql
     # + \copy each public table to /out/csv/<table>.csv
   '
   ```
2. **Verify.** The dump was restored into a temporary Postgres 18 inside Docker, and
   `count(*)` for every table was compared with production. All 16 matched.
3. **Blueprints** → "Teja Clinic" → Settings → **Disconnect Blueprint**. This stops `render.yaml`
   from syncing or recreating anything. It doesn't delete the resources itself.
4. `clinicos-frontend` → Settings → **Delete Web Service** (confirmation:
   `sudo delete web service clinicos-frontend`).
5. `clinicos-api` → Settings → **Delete Web Service** (`sudo delete web service clinicos-api`).
   This deleted the attached `clinic-uploads` 10GB disk along with it.
6. `clinicos-db` (it was on the paid **Basic-256mb** plan) → **Delete Database**
   (`sudo delete database clinicos-db`). Render keeps **no** backups of deleted databases.
7. **Check:**
   - The dashboard lists no services.
   - `https://clinicos-frontend.onrender.com` and `https://clinicos-api-69mw.onrender.com`
     both return **404**.
   - Billing shows the workspace on the free **Hobby** plan. About $1.24 of usage from
     Nov 1–2 appears on the next invoice; after that, $0/month.

---

## Part C — How to bring it back up

Expect about 45–60 minutes. You'll end up with the same 4-resource setup described in
[`hosting.md`](hosting.md), **with all the old data restored** (except the invoice photos).

### Step 1 — Generate new secrets (on your computer)

```bash
cd Backend_db
source venv/bin/activate

# JWT secret (signs login sessions)
python -c "import secrets; print(secrets.token_urlsafe(48))"

# TOTP secret (Google Authenticator seed for admin login & account creation)
python -c "import pyotp; s = pyotp.random_base32(); print('TOTP_SECRET =', s); print(pyotp.TOTP(s).provisioning_uri('ClinicOS', issuer_name='ClinicOS'))"
```

- In Google Authenticator: delete the old ClinicOS entry, then **+** → **Enter a setup key** →
  account `ClinicOS`, key = the new `TOTP_SECRET`, time-based. (Or turn the printed `otpauth://`
  URI into a QR code with any QR generator and scan it.)
- Keep both values somewhere safe, such as a password manager. **Don't commit them to git.**

### Step 2 — Set the database plan in `render.yaml` first

`render.yaml`'s `databases:` block has **no `plan:` key**. That's how the database originally
ended up on the Free plan, which Render auto-deletes. Set a paid plan explicitly before
deploying. It was on `basic-256mb` when it was shut down:

```yaml
databases:
  - name: clinicos-db
    databaseName: clinic_db
    user: clinicos
    plan: basic-256mb   # check https://render.com/pricing for current plan names
```

Commit and push that change to `main`.

### Step 3 — Create everything from the Blueprint

1. Render dashboard → **New** → **Blueprint** → connect GitHub repo `RudhraReddy/clinicos`,
   branch `main`. Render reads `render.yaml` and proposes `clinicos-db`, `clinicos-api` (with the
   `clinic-uploads` disk) and `clinicos-frontend`.
2. When asked for the `sync: false` values, enter `JWT_SECRET_KEY` and `TOTP_SECRET` from step 1.
3. Click **Apply** and wait for all three to show as live.

On first start the API creates an **empty** schema (`db.create_all()` + `_apply_migrations()`).
The restore in step 4 replaces it.

### Step 4 — Restore the data

1. **Stop the API from writing while you restore:** `clinicos-api` → **Suspend Web Service**.
2. Copy the new database's **External Database URL** from `clinicos-db` → Info → Connections.
   (If the connection is refused, add your IP under that database's Networking → Inbound IP
   Restrictions.)
3. Restore, using the Postgres 18 Docker image so the client version matches:
   ```bash
   docker run --rm -e PGURL="<new-external-db-url>" \
     -v ~/clinicos-backup-2026-11-02:/backup:ro postgres:18 \
     bash -c 'pg_restore --clean --if-exists --no-owner --no-privileges \
              -d "$PGURL?sslmode=require" /backup/clinic_db.dump'
   ```
   `--clean --if-exists` drops the empty tables the API just created and replaces them with the
   backed-up ones. `--no-owner` matters because the new database user may have a different name.
   A few warnings about ownership or extensions are harmless. Real errors mention a specific
   table.
4. Check the counts against the table in Part A:
   ```bash
   docker run --rm -e PGURL="<new-external-db-url>" postgres:18 \
     psql "$PGURL?sslmode=require" -c "select count(*) from patients" -c "select count(*) from audit_logs"
   ```
   You should get 79 patients and 1294 audit logs.
5. `clinicos-api` → **Resume Web Service**. On startup `_apply_migrations()` adds any columns
   that newer code needs, so a backup from an older version of the schema is fine.

*(Want a fresh, empty start instead? Skip step 4 entirely.)*

### Step 5 — Fix the URLs (they will change)

`render.yaml` hard-codes `BACKEND_URL: https://clinicos-api-69mw.onrender.com` (frontend) and
`CORS_ORIGINS: https://clinicos-frontend.onrender.com` (api). Render assigned the `-69mw` suffix
at random, so the new API **will almost certainly get a different one**, and the frontend name
may also change.

1. Copy the new API URL from the `clinicos-api` page.
2. Update `BACKEND_URL` in `render.yaml` (and `CORS_ORIGINS` if the frontend URL changed).
3. Commit and push to `main`; both services redeploy. `BACKEND_URL` is read **when the frontend
   is built**, so it has to be a rebuild, not just a dashboard edit plus restart.
4. Update the live URLs in `CLAUDE.md` and `docs/hosting.md`, and remove the "OFFLINE" notes
   there.

### Step 6 — Log in & check it works

- **Admin login:** username `saivelapati` or `tejavelapati`, password = the current 6-digit code
  from the **new** Google Authenticator entry.
- **Staff and doctor accounts** were restored with their existing usernames and passwords.
- Checklist:
  - [ ] Admin can log in; Admin → Users shows the 7 restored users; Admin → Settings shows both
        locations
  - [ ] Patients list shows 79 patients; Billing history shows old bills
  - [ ] Book a test appointment and create a test bill
  - [ ] Upload a new image, **redeploy the API**, and confirm the image is still there (proves the
        persistent disk is mounted at `/var/data/clinic_uploads`)
  - [ ] Render Billing shows the expected paid plans (no Free database)

---

## Cost reference

| Resource | Plan | Approx. cost |
|---|---|---|
| `clinicos-frontend` | Starter web | $7/mo |
| `clinicos-api` | Starter web | $7/mo |
| `clinic-uploads` disk | 10GB | ~$2.50/mo |
| `clinicos-db` | Basic-256mb Postgres | ~$6–7/mo |
| **Total** | | **~$22–24/mo** |

Cheaper option: set both web services to `plan: free` in `render.yaml`. They sleep when idle
(slow first load), and **free web services can't have persistent disks**, so uploaded images
would vanish on every deploy. Not recommended for real clinic use.
