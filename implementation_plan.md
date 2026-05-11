# ClinicOS — Authentication & User Accounts Implementation Plan

## Goal

Replace the current honour-system role switcher (localStorage `clinic_role`) with a real authentication layer — JWT-based sessions, server-side user accounts, a master-password gate for registration, and a staff ↔ doctor assignment model that controls data visibility. Also make QR-code uploads work on mobile without any login.

---

## Current State (Context)

| Thing | Today |
|---|---|
| Auth | None — role stored in `localStorage["clinic_role"]` |
| Role switch | `profile-switcher.tsx` dropdown visible to everyone |
| Users | No user table exists; `Visit.doctor_id` and `Bill.created_by_user_id` exist as bare strings |
| Login/Create pages | Placeholder empty dirs: `app/login/`, `app/create-account/` |
| QR upload | `app/connect/[sessionId]` — already fully public, no auth |
| Hosted | Render (open domain, no protection at all) |

---

## Decisions (All Resolved)

> [!NOTE]
> **Q1 — Master Auth Gate: ✅ Google Authenticator TOTP**
> Instead of a static master password, we will use a **TOTP (Time-based One-Time Password)** — the same technology as Google Authenticator. A secret key is generated once and stored as a `TOTP_SECRET` env var on Render. Anyone who needs to create an account must open Google Authenticator, add the clinic's entry, and enter the current 6-digit rotating code. This is far more secure than a static string — it changes every 30 seconds and can't be guessed or reused.
>
> **How it works:** `pyotp` library on the backend validates the 6-digit code against the `TOTP_SECRET`. Setup: run `python -c "import pyotp; print(pyotp.random_base32())"` once to generate the secret, store it in Render env vars, and share the QR code with the clinic owner to add to their Google Authenticator app.

> [!NOTE]
> **Q2 — JWT Lifetime: ✅ 8 hours**
> Sessions expire after 8 hours (one workday). Staff/doctor must log in again next day. No refresh tokens for now.

> [!NOTE]
> **Q3 — Data Tagging: ✅ Add explicit `created_by_user_id` column**
> We will **add a proper `created_by_user_id` column** to all key tables (Visits, Bills, PatientImages) as a real FK to the `users` table. Each data point is tagged with the UUID of the user who created it. This gives us a clean, queryable field for filtering — far simpler than the current mixed-use `doctor_id` column. The `Visit.doctor_id` string column will be repurposed to store the proper user UUID going forward.

> [!NOTE]
> **Q4 — Existing Online Data: ✅ Safe — nulls are fine**
> The Render production database has real clinic data. Adding new columns (with `nullable=True` defaults) will **not break or delete** any existing rows — SQLAlchemy's `db.create_all()` only adds missing columns, it never drops data. Old records will have `NULL` for the new auth columns and will show up under the doctor's **"All"** view as unattributed records. Local test data is irrelevant.

> [!NOTE]
> **Q5 — Password Reset: ✅ TOTP-gated reset flow on login page**
> A "Forgot Password" link will appear on the login page. Flow:
> 1. User enters their **email**
> 2. User enters the current **6-digit TOTP code** from Google Authenticator (same gate as account creation)
> 3. If TOTP is valid → user enters and confirms a new password (with the same strength rules)
> 4. Password is overwritten in DB
> No email service needed. TOTP acts as the identity-verification step.

---

## Architecture Overview

```
Browser (Next.js)
  ↓ POST /api/auth/login → JWT access token (httpOnly cookie)
  ↓ All subsequent API calls carry cookie automatically
  ↓ Middleware (middleware.ts) — server-side route protection
Flask Backend
  ↓ /api/auth/* — new auth blueprint
  ↓ JWT validation on all protected routes (decorator)
  ↓ User, DoctorStaffAssignment tables (new)
```

### Token Strategy
- **JWT access token** stored as an **httpOnly, Secure, SameSite=Strict cookie** — never exposed to JS, immune to XSS.
- Token payload: `{ user_id, role, username }`
- Validated by a `@require_auth` decorator on every protected Flask route.
- Next.js `middleware.ts` checks cookie presence server-side and redirects to `/login` if missing (protects all routes except `/connect/[sessionId]` and `/login`).

---

## Proposed Changes

---

### 1. Database — New Models & Column Additions

#### [MODIFY] [models.py](file:///home/fia/Downloads/clinic_related/Backend_db/models.py)

**New table 1 — `User`:**

```python
class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.String(36), primary_key=True)  # UUID4
    email = db.Column(db.String(150), unique=True, nullable=False, index=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # 'staff' | 'doctor'
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=get_ist_now)
    # Human-readable location label (e.g. "Branch A", "Downtown Clinic")
    location_label = db.Column(db.String(100), nullable=True)
```

**New table 2 — `DoctorStaffAssignment`:**

```python
class DoctorStaffAssignment(db.Model):
    __tablename__ = 'doctor_staff_assignments'

    id = db.Column(db.Integer, primary_key=True)
    doctor_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    staff_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    __table_args__ = (db.UniqueConstraint('doctor_id', 'staff_id'),)
```

**Existing table column additions** — tag every data point with who created it:

| Table | New Column | Type | Notes |
|---|---|---|---|
| `visits` | `created_by_user_id` | `String(36), FK→users.id, nullable` | Replaces the semantics of the old bare-string `doctor_id`; `doctor_id` col stays but is deprecated |
| `bills` | *(already has `created_by_user_id`)* | promote to FK | Add FK constraint to `users.id` |
| `patient_images` | `created_by_user_id` | `String(36), FK→users.id, nullable` | New column |

> [!NOTE]
> All new columns added with `nullable=True` — `db.create_all()` adds them to the live Render DB without touching existing rows. Old records get `NULL`, which will appear under the doctor's **"All"** view as unattributed data. **No production data will be lost.**

> [!TIP]
> The old `Visit.doctor_id` string column is kept as-is (not removed) to avoid a destructive migration. Going forward, `created_by_user_id` is the authoritative field. A future cleanup migration can drop `doctor_id` once it's confirmed safe.

---

### 2. Backend — Auth Blueprint

#### [NEW] `Backend_db/routes/auth.py`

Endpoints:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account (requires master password) |
| `POST` | `/api/auth/login` | Login → set httpOnly JWT cookie |
| `POST` | `/api/auth/logout` | Clear cookie |
| `GET` | `/api/auth/me` | Return current user info from JWT |

**`/api/auth/register` body:**
```json
{
  "master_password": "...",
  "email": "staff@clinic.com",
  "username": "Priya",
  "password": "SecurePass1!",
  "role": "staff",
  "location_label": "Branch A"
}
```
- Validates master password against `MASTER_PASSWORD` env var (bcrypt compare or plain env string with constant-time compare).
- Password rules enforced server-side: min 8 chars, 1 uppercase, 1 symbol, 1 digit.
- Returns `201` on success, error messages on failure.

**`/api/auth/login` body:**
```json
{ "email": "...", "password": "..." }
```
- Returns JWT in `Set-Cookie: auth_token=...; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`
- Also returns `{ user_id, username, role }` in body for immediate use.

**Auth decorator** — `require_auth` — reads cookie, validates JWT, injects `g.current_user`:
```python
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get('auth_token')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        payload = verify_jwt(token)  # raises on invalid/expired
        g.current_user = payload
        return f(*args, **kwargs)
    return decorated
```

Apply `@require_auth` to all existing routes **except** `/api/upload/*` (QR sessions — public by design).

#### [MODIFY] `Backend_db/routes/__init__.py`
Register new `auth` blueprint.

#### [MODIFY] `Backend_db/app.py`
- Add `flask-jwt-extended` or manual `PyJWT` (lightweight, prefer `PyJWT`).
- Add `bcrypt` / `werkzeug.security` for password hashing (already available via Werkzeug).
- Add `JWT_SECRET_KEY` env var.

---

### 3. Backend — Staff Assignment Endpoints

#### [NEW] entries in `Backend_db/routes/auth.py` (or a new `routes/users.py`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users` | List all users (doctor only) |
| `GET` | `/api/users/me/assigned-staff` | Doctor → list their assigned staff |
| `POST` | `/api/users/assign-staff` | Doctor assigns a staff member to themselves |
| `DELETE` | `/api/users/assign-staff/<staff_id>` | Doctor removes a staff assignment |

These are **doctor-only** routes — decorator checks `g.current_user['role'] == 'doctor'`.

---

### 4. Backend — Data Scoping

When any user (staff or doctor) creates a visit, bill, or image, the `@require_auth` decorator already has `g.current_user` available. The route handler writes `g.current_user['user_id']` to the new `created_by_user_id` column automatically.

```python
# Example in visits route
new_visit = Visit(
    ...,
    created_by_user_id=g.current_user['user_id']
)
```

When the **doctor** fetches data:
- `GET /api/visits?created_by=<staff_user_id>` → filters `Visit.created_by_user_id == staff_user_id`
- `GET /api/visits?created_by=all` → returns visits from all staff assigned to this doctor + the doctor themselves
- Same pattern applies to `/api/billing`, `/api/images`

The backend verifies that the requested `staff_user_id` is actually assigned to the requesting doctor (prevents cross-doctor snooping).

---

### 5. Frontend — Auth Context

#### [MODIFY] `frontend/lib/auth_context.tsx`

Replace `localStorage["clinic_role"]` with:
```ts
interface AuthUser {
  user_id: string
  username: string
  role: 'staff' | 'doctor'
  location_label?: string
}

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  login: (email, password) => Promise<void>
  logout: () => Promise<void>
  // For doctor only — active view mode
  activeStaffFilter: string  // 'all' | staff_user_id
  setActiveStaffFilter: (id: string) => void
  assignedStaff: AuthUser[]  // Populated for doctors
}
```

- On mount: call `GET /api/auth/me` to hydrate user from cookie.
- If `401` → user is `null` → middleware redirects to `/login`.
- `activeStaffFilter` stored in `useState` only (resets on page refresh — intentional, always start on "All").

---

### 6. Frontend — Middleware (Route Protection)

#### [NEW] `frontend/middleware.ts`

```ts
// Protect all routes except /login, /connect/*, and /api/*
export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')
  const isPublic = request.nextUrl.pathname.startsWith('/login')
    || request.nextUrl.pathname.startsWith('/connect')
    || request.nextUrl.pathname.startsWith('/api')

  if (!isPublic && !token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  // Prevent logged-in users from seeing /login again
  if (request.nextUrl.pathname === '/login' && token) {
    return NextResponse.redirect(new URL('/', request.url))
  }
}
```

---

### 7. Frontend — Login Page

#### [MODIFY] `frontend/app/login/page.tsx`

**Design:** Full-screen centered card. Dark-mode glass card aesthetic. Clinic logo/name at top.

**Step 1 — Role Selection (Landing):**
Two large clickable cards:
- 🖥️ **Staff** — "Front Desk Access"
- 🩺 **Doctor** — "Clinical Dashboard"

No button — clicking the card transitions to the login form (smooth slide/fade animation).

**Step 2 — Login Form:**
- Email field
- Password field (with show/hide toggle)
- **Login** button
- Clickable text: `"Don't have an account? Create one"` → `/create-account?role=<selected_role>`
- Clickable text: `"Forgot password?"` → transitions to password reset flow (Step 3)
- Back arrow to return to role selection

**Step 3 — Forgot Password Flow (inline, no new page):**
1. Email field — "Enter your account email"
2. TOTP field — "Enter the 6-digit code from Google Authenticator"
3. New password + confirm (with strength indicator)
4. **Reset Password** button → `POST /api/auth/reset-password`
5. On success → back to login with toast "Password updated successfully"

On login success → redirect:
- staff → `/` (front desk dashboard)
- doctor → `/doctor`

---

### 8. Frontend — Create Account Page

#### [MODIFY] `frontend/app/create-account/page.tsx`

**Two-step wizard:**

**Step 1 — Google Authenticator Gate:**
- Single numeric field: "Enter the 6-digit code from Google Authenticator"
- Helper text: "Open Google Authenticator → ClinicOS entry"
- Continue button
- On failure → shake animation + "Invalid or expired code. Codes refresh every 30 seconds."
- Validation: `POST /api/auth/verify-totp` — returns 200/401 only (does NOT create anything yet)

**Step 2 — Account Details (unlocked after TOTP):**
- Role toggle: **Staff** | **Doctor** (pre-filled from URL query param `?role=`)
- Username / Display Name
- Email
- Password with live strength indicator:
  - ✅ Min 8 characters
  - ✅ At least 1 uppercase letter
  - ✅ At least 1 number  
  - ✅ At least 1 special symbol
- Confirm Password
- Location Label *(only shown for Staff role)* — e.g., "Branch A", "Downtown Clinic"
- **Create Account** button

On success → redirect to `/login` with success toast: "Account created! Please log in."

---

### 9. Frontend — Sidebar & Role-Based Nav

#### [MODIFY] `frontend/layout/Sidebar.tsx` (or equivalent)

Current behaviour: Two hardcoded nav lists keyed on `localStorage role`.

New behaviour:
- Read `user.role` from `AuthContext` (real server-authenticated role).
- **Staff logged in:** Never show the role/profile switcher. Nav = frontdesk nav only.
- **Doctor logged in:** Show the profile switcher (now renamed to "Location/Staff Switcher") at the top of the sidebar.
- Show **Logout** button in sidebar footer.

---

### 10. Frontend — Doctor Location/Staff Switcher

#### [MODIFY] `frontend/components/profile-switcher.tsx` → repurpose into **`StaffLocationSwitcher`**

For doctors only — a dropdown/tabs in the sidebar (or directly above the doctor dashboard content area) that lets the doctor switch their active view:

- **All** — aggregate data from all assigned staff
- **[Staff A Name] — Branch A**
- **[Staff B Name] — Downtown**
- **[Staff C Name] — Branch A**

Selection stored in `AuthContext.activeStaffFilter`. All data-fetching hooks read this filter and append `?created_by=<id>` (or `?created_by=all`) to API calls.

> [!NOTE]
> The old `profile-switcher.tsx` that toggled between "Front Desk" and "Doctor" roles will be **removed** — roles are now fixed at login time, not switchable. Doctors can still _view_ the front desk layout by switching to "All" + front desk views, but they cannot impersonate staff.

---

### 11. Frontend — Doctor Settings Tab

#### [NEW or MODIFY] Doctor settings section (within doctor dashboard or a `/settings` route)

A section accessible to doctors only:

**"Staff Assignments" panel:**
- List of all `staff` users in the system (fetched from `GET /api/users?role=staff`)
- Toggle/checkbox next to each staff member: "Assign to me"
- Changes saved via `POST /api/users/assign-staff` or `DELETE /api/users/assign-staff/<id>`
- Live feedback (toast on save)

This is where the doctor configures which staff they can see data for.

---

### 12. Frontend — QR Upload (No Auth Required)

#### [NO CHANGE NEEDED] `frontend/app/connect/[sessionId]/page.tsx`

The `/connect/[sessionId]` route is already public and bypassed by the middleware. The mobile user:
1. Scans QR code → opens `/connect/<session_id>` in phone browser
2. No login prompt, no auth cookie needed
3. Uploads image directly

The `UploadSession` model already tracks the session. **This works as-is** — the middleware plan already whitelists `/connect/*`.

> [!WARNING]
> The QR session upload endpoint `POST /api/upload/...` must remain **excluded** from the `@require_auth` decorator. Currently `routes/upload.py` routes need to stay public. This is intentional.

---

### 13. Dependencies to Add

#### Backend (`requirements.txt`)
```
PyJWT>=2.8.0
pyotp>=2.9.0
qrcode>=7.4.2   # for generating the TOTP setup QR code image (one-time admin utility)
```
(Werkzeug's `generate_password_hash` / `check_password_hash` already available — no extra dep for bcrypt)

#### Frontend (`package.json`)
- No new packages needed. Auth state is managed entirely via the `/api/auth/me` API call using httpOnly cookies (invisible to JS).

### 13b. TOTP Initial Setup (One-Time Admin Step)

Before deploying auth, the clinic owner runs this once:
```bash
python -c "import pyotp; s = pyotp.random_base32(); print('Secret:', s); import qrcode; qrcode.make(pyotp.totp.TOTP(s).provisioning_uri('ClinicOS', issuer_name='ClinicOS')).save('totp_setup.png')"
```
- Scan `totp_setup.png` with Google Authenticator → adds "ClinicOS" entry
- Copy the printed `Secret` → set as `TOTP_SECRET` env var in Render dashboard
- Delete the `totp_setup.png` file
- Share the QR code with any staff/doctor who will ever need to create accounts or reset passwords

---

### 14. Environment Variables

#### Backend (new vars to add to Render dashboard + `.env`)
```
TOTP_SECRET=<base32-secret-from-setup-step>
JWT_SECRET_KEY=<long-random-secret>
```
**Remove:** `MASTER_PASSWORD` — no longer needed.

#### Frontend — No new vars needed

---

## UI Flow Summary

```
https://clinicos-frontend.onrender.com
    ↓ (no cookie → middleware redirects)

/login
  ┌─[Staff Card]──────────────────────────────┐
  │ email + password → POST /api/auth/login   │
  │ cookie set → redirect /                   │
  └───────────────────────────────────────────┘
  ┌─[Doctor Card]─────────────────────────────┐
  │ email + password → POST /api/auth/login   │
  │ cookie set → redirect /doctor             │
  └───────────────────────────────────────────┘
  "Don't have an account? Create one" → /create-account?role=<role>
  "Forgot password?" → inline reset flow:
      email + TOTP code + new password → POST /api/auth/reset-password

/create-account
  Step 1: 6-digit TOTP → POST /api/auth/verify-totp
  Step 2: Details (role, username, email, password, location) → POST /api/auth/register
  → redirect /login with success toast

/ (staff dashboard)
  - Sidebar: NO role/profile switcher
  - Front desk nav only (Dashboard, Patients, Inventory, Billing)
  - Logout button in sidebar footer

/doctor (doctor dashboard)
  - Sidebar: StaffLocationSwitcher (All / [Staff A - Branch A] / [Staff B - Downtown])
  - Doctor Settings tab: Staff Assignment panel (assign/unassign staff)
  - All data views filtered by activeStaffFilter
  - Logout button in sidebar footer

/connect/[sessionId]
  - Fully public, no auth needed, scan QR and upload — NO CHANGE
```

---

## Verification Plan

### Automated / Code Checks
- Backend: `python app.py` + test auth endpoints with curl
- Frontend: `npm run build` to catch TypeScript errors
- Middleware: navigate to `/patients` in incognito → confirm redirect to `/login`

### Manual Verification
- [ ] Generate TOTP secret and scan into Google Authenticator
- [ ] Create account with wrong TOTP code → should fail
- [ ] Create account with correct TOTP → should succeed
- [ ] Forgot password with wrong TOTP → should fail
- [ ] Forgot password with correct TOTP + valid email → password updates
- [ ] Login as staff → front desk nav only, no role switcher visible
- [ ] Login as doctor → doctor nav + StaffLocationSwitcher visible
- [ ] Doctor assigns Staff A in settings → "Staff A" tab appears in switcher
- [ ] Doctor "Staff A" tab only shows Staff A's data, not Staff B's
- [ ] Doctor cannot access data from staff not assigned to them
- [ ] Scan QR code on mobile (no login) → upload works fine
- [ ] Navigate to `/patients` with no cookie → redirects to `/login`
- [ ] Old data (null `created_by_user_id`) → visible under doctor's "All" tab

---

## Implementation Order (Suggested Phases)

| Phase | Scope | Why first |
|---|---|---|
| **1** | TOTP setup script + DB models (User, DoctorStaffAssignment) + column additions | Everything depends on this |
| **2** | Auth blueprint (`/register`, `/login`, `/logout`, `/me`, `/verify-totp`, `/reset-password`) | Core auth layer |
| **3** | Next.js middleware + updated `auth_context.tsx` | Protects all routes |
| **4** | Login page (role cards + login form + TOTP forgot-password flow) | First thing users see |
| **5** | Create account page (TOTP gate → details wizard) | Enables onboarding |
| **6** | Sidebar changes (remove old role switcher, add logout, show StaffLocationSwitcher for doctors) | Clean up old system |
| **7** | Data scoping: tag writes with `created_by_user_id`, filter reads by it | Doctor visibility |
| **8** | Doctor settings — staff assignment panel | Self-service assignment |
| **9** | QR upload smoke-test (confirm still public, no auth required) | Safety check |

