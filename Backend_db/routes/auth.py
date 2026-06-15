import datetime as _dt
import os
import uuid
from functools import wraps

import jwt
import pyotp
from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from extensions import db, get_ist_now
from sqlalchemy.exc import IntegrityError

from models import AuditLog, DoctorStaffAssignment, User

auth_bp = Blueprint('auth', __name__)

_SESSION_HOURS = 8


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log_activity(action, resource_type=None, resource_id=None, resource_label=None,
                 details=None, user_id=None, username=None, ip_address=None):
    """Insert a row into audit_logs. Safe to call from any route."""
    try:
        entry = AuditLog(
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            resource_label=resource_label,
            details=details,
            user_id=user_id,
            username=username,
            ip_address=ip_address,
        )
        db.session.add(entry)
        db.session.commit()
    except Exception:
        db.session.rollback()

def _validate_password_strength(password: str):
    """
    Returns an error string if the password fails strength requirements,
    or None if it passes.
    Rules: min 8 chars, >=1 uppercase, >=1 digit, >=1 symbol.
    """
    if len(password) < 8:
        return 'Password must be at least 8 characters long'
    if not any(c.isupper() for c in password):
        return 'Password must contain at least one uppercase letter'
    if not any(c.isdigit() for c in password):
        return 'Password must contain at least one digit'
    symbols = set('!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~\\')
    if not any(c in symbols for c in password):
        return 'Password must contain at least one symbol'
    return None


_GRANT_MINUTES = 10  # how long a verified TOTP grant stays valid


def _verify_totp(code: str, valid_window: int = 1) -> bool:
    """Validates a TOTP code against TOTP_SECRET env var."""
    secret = os.environ.get('TOTP_SECRET', '').strip()
    if not secret:
        return False
    return pyotp.TOTP(secret).verify(str(code).strip(), valid_window=valid_window)


def _make_grant_token(app) -> str:
    """Issue a short-lived JWT that proves the caller passed TOTP verification."""
    payload = {
        'purpose': 'totp_grant',
        'exp': _dt.datetime.utcnow() + _dt.timedelta(minutes=_GRANT_MINUTES),
    }
    return jwt.encode(payload, app.config['JWT_SECRET_KEY'], algorithm='HS256')


def _check_grant_token(token: str, app) -> bool:
    """Return True if the grant token is valid and unexpired."""
    try:
        payload = jwt.decode(token, app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
        return payload.get('purpose') == 'totp_grant'
    except jwt.PyJWTError:
        return False


# ---------------------------------------------------------------------------
# Auth decorator
# ---------------------------------------------------------------------------

def require_doctor(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if g.current_user.get('role') not in ('doctor', 'admin'):
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return decorated


def require_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if g.current_user.get('role') != 'admin':
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return decorated


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get('auth_token')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        try:
            payload = jwt.decode(
                token,
                current_app.config['JWT_SECRET_KEY'],
                algorithms=['HS256'],
            )
            g.current_user = payload  # keys: user_id, role, username
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Session expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@auth_bp.route('/auth/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}

    grant_token = (data.get('grant_token') or '').strip()
    totp_code   = (data.get('totp_code')   or '').strip()  # fallback for direct callers
    username       = (data.get('username') or '').strip()
    password       = data.get('password', '')
    role           = (data.get('role')     or '').strip()
    location_label = (data.get('location_label') or '').strip() or None

    # Accept either a pre-issued grant token (preferred) or a fresh TOTP code
    if grant_token:
        if not _check_grant_token(grant_token, current_app):
            return jsonify({'error': 'Verification token expired. Please go back and verify again.'}), 400
    elif totp_code:
        if not _verify_totp(totp_code):
            return jsonify({'error': 'Invalid or expired TOTP code'}), 400
    else:
        return jsonify({'error': 'TOTP verification is required'}), 400

    # Validate required fields
    if not username or not password or not role:
        return jsonify({'error': 'username, password, and role are required'}), 400

    # Validate role
    if role not in ('staff', 'doctor', 'admin'):
        return jsonify({'error': "role must be 'staff', 'doctor', or 'admin'"}), 400

    # Disable direct admin registration
    if role == 'admin':
        return jsonify({'error': 'Admin registration is disabled. Use hardcoded accounts.'}), 400

    # Validate password strength
    pw_error = _validate_password_strength(password)
    if pw_error:
        return jsonify({'error': pw_error}), 400

    # Check uniqueness
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 400

    email = f"{username.lower()}@example.com"

    user = User(
        id=str(uuid.uuid4()),
        email=email,
        username=username,
        password_hash=generate_password_hash(password),
        role=role,
        is_active=True,
        created_at=get_ist_now(),
        location_label=location_label,
    )
    db.session.add(user)
    db.session.commit()

    return jsonify({'message': 'Account created'}), 201


@auth_bp.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': 'username and password are required'}), 400

    # Hardcoded admin accounts with TOTP password
    if username.lower() in ("saivelapati", "tejavelapati"):
        if _verify_totp(password):
            user = User.query.filter_by(username=username).first()
            if not user:
                # Create on-the-fly to support foreign keys / audit logs / standard flow
                user = User(
                    id=str(uuid.uuid4()),
                    email=f"{username.lower()}@example.com",
                    username=username,
                    password_hash=generate_password_hash("placeholder"),
                    role="admin",
                    is_active=True,
                    created_at=get_ist_now(),
                )
                db.session.add(user)
                db.session.commit()
        else:
            return jsonify({'error': 'Invalid TOTP code for admin login'}), 401
    else:
        user = User.query.filter_by(username=username).first()
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({'error': 'Invalid username or password'}), 401

    if not user.is_active:
        return jsonify({'error': 'Invalid username or password'}), 401

    now_utc = _dt.datetime.utcnow()
    exp = now_utc + _dt.timedelta(hours=_SESSION_HOURS)

    payload = {
        'user_id': user.id,
        'role': user.role,
        'username': user.username,
        'exp': exp,
    }

    token = jwt.encode(
        payload,
        current_app.config['JWT_SECRET_KEY'],
        algorithm='HS256',
    )

    log_activity(
        action='LOGIN',
        resource_type='auth',
        resource_id=user.id,
        resource_label=user.username,
        details=f'role={user.role}',
        user_id=user.id,
        username=user.username,
        ip_address=request.remote_addr,
    )

    resp = jsonify({'user_id': user.id, 'username': user.username, 'role': user.role})
    resp.set_cookie(
        'auth_token',
        token,
        httponly=True,
        secure=not current_app.debug,
        samesite='Strict',
        max_age=_SESSION_HOURS * 3600,
    )
    return resp, 200


@auth_bp.route('/auth/logout', methods=['POST'])
@require_auth
def logout():
    u = g.current_user
    log_activity(
        action='LOGOUT',
        resource_type='auth',
        resource_id=u.get('user_id'),
        resource_label=u.get('username'),
        user_id=u.get('user_id'),
        username=u.get('username'),
        ip_address=request.remote_addr,
    )
    resp = jsonify({'message': 'Logged out'})
    resp.set_cookie('auth_token', '', max_age=0, httponly=True, samesite='Strict', secure=not current_app.debug)
    return resp, 200


@auth_bp.route('/auth/me', methods=['GET'])
@require_auth
def me():
    user = db.session.get(User, g.current_user['user_id'])
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({
        'user_id': user.id,
        'username': user.username,
        'role': user.role,
        'location_label': user.location_label,
        'location_id': user.location_id,
    }), 200


@auth_bp.route('/auth/verify-totp', methods=['POST'])
def verify_totp():
    """Verify a TOTP code and return a short-lived grant token on success.

    The grant token can be passed as `grant_token` to /auth/register and
    /auth/reset-password instead of re-submitting the raw 30-second code,
    giving the user up to 10 minutes to complete the form.
    """
    data = request.get_json(silent=True) or {}
    totp_code = data.get('totp_code', '')

    if _verify_totp(totp_code):
        grant = _make_grant_token(current_app)
        return jsonify({'valid': True, 'grant_token': grant}), 200
    return jsonify({'error': 'Invalid or expired code'}), 401


@auth_bp.route('/auth/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True) or {}
    username     = (data.get('username')     or '').strip()
    grant_token  = (data.get('grant_token')  or '').strip()
    totp_code    = (data.get('totp_code')    or '').strip()  # fallback
    new_password = data.get('new_password', '')

    # Accept grant token (issued by verify-totp) or a fresh TOTP code
    if grant_token:
        if not _check_grant_token(grant_token, current_app):
            return jsonify({'error': 'Verification token expired. Please go back and verify again.'}), 400
    elif totp_code:
        if not _verify_totp(totp_code):
            return jsonify({'error': 'Invalid or expired TOTP code'}), 400
    else:
        return jsonify({'error': 'TOTP verification is required'}), 400

    if not username:
        return jsonify({'error': 'username is required'}), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'Invalid request'}), 400

    # Validate new password strength
    pw_error = _validate_password_strength(new_password)
    if pw_error:
        return jsonify({'error': pw_error}), 400

    user.password_hash = generate_password_hash(new_password)
    db.session.commit()

    return jsonify({'message': 'Password updated'}), 200


@auth_bp.route('/auth/users', methods=['GET'])
@require_auth
def list_users():
    role_filter = request.args.get('role')
    query = User.query.filter_by(is_active=True)
    if role_filter:
        query = query.filter_by(role=role_filter)
    users = query.all()
    return jsonify([
        {
            'user_id': u.id,
            'username': u.username,
            'role': u.role,
            'location_label': u.location_label,
            'location_id': u.location_id,
        }
        for u in users
    ]), 200


@auth_bp.route('/auth/users/me/assigned-staff', methods=['GET'])
@require_auth
@require_doctor
def list_assigned_staff():
    doctor_id = g.current_user['user_id']
    assignments = DoctorStaffAssignment.query.filter_by(doctor_id=doctor_id).all()
    result = []
    for assignment in assignments:
        user = db.session.get(User, assignment.staff_id)
        if user and user.is_active:
            result.append({
                'user_id': user.id,
                'username': user.username,
                'role': user.role,
                'location_label': user.location_label,
            })
    return jsonify(result), 200


@auth_bp.route('/auth/users/assign-staff', methods=['POST'])
@require_auth
@require_doctor
def assign_staff():
    data = request.get_json(silent=True) or {}
    staff_id = (data.get('staff_id') or '').strip()

    if not staff_id:
        return jsonify({'error': 'staff_id is required'}), 400

    staff_user = db.session.get(User, staff_id)
    if not staff_user or staff_user.role != 'staff' or not staff_user.is_active:
        return jsonify({'error': 'Staff user not found or not eligible'}), 404

    doctor_id = g.current_user['user_id']
    assignment = DoctorStaffAssignment(
        doctor_id=doctor_id,
        staff_id=staff_id,
        created_at=get_ist_now(),
    )
    db.session.add(assignment)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Staff already assigned to this doctor'}), 400

    return jsonify({'message': 'Staff assigned'}), 201


@auth_bp.route('/auth/users/assign-staff/<staff_id>', methods=['DELETE'])
@require_auth
@require_doctor
def unassign_staff(staff_id):
    doctor_id = g.current_user['user_id']
    assignment = DoctorStaffAssignment.query.filter_by(
        doctor_id=doctor_id,
        staff_id=staff_id,
    ).first()

    if not assignment:
        return jsonify({'error': 'Assignment not found'}), 404

    db.session.delete(assignment)
    db.session.commit()
    return jsonify({'message': 'Assignment removed'}), 200
