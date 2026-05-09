import datetime as _dt
import os
import uuid
from functools import wraps

import jwt
import pyotp
from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from extensions import db, get_ist_now
from models import User

auth_bp = Blueprint('auth', __name__)

_SESSION_HOURS = 8


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _verify_totp(code: str) -> bool:
    """Validates a TOTP code against TOTP_SECRET env var."""
    secret = os.environ.get('TOTP_SECRET', '')
    if not secret:
        return False
    return pyotp.TOTP(secret).verify(code)


# ---------------------------------------------------------------------------
# Auth decorator
# ---------------------------------------------------------------------------

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

    totp_code = data.get('totp_code', '')
    email = (data.get('email') or '').strip().lower()
    username = (data.get('username') or '').strip()
    password = data.get('password', '')
    role = (data.get('role') or '').strip()
    location_label = (data.get('location_label') or '').strip() or None

    # Validate TOTP
    if not _verify_totp(totp_code):
        return jsonify({'error': 'Invalid or expired TOTP code'}), 400

    # Validate required fields
    if not email or not username or not password or not role:
        return jsonify({'error': 'email, username, password, and role are required'}), 400

    # Validate role
    if role not in ('staff', 'doctor'):
        return jsonify({'error': "role must be 'staff' or 'doctor'"}), 400

    # Validate password strength
    pw_error = _validate_password_strength(password)
    if pw_error:
        return jsonify({'error': pw_error}), 400

    # Check uniqueness
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 400

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
    email = (data.get('email') or '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'email and password are required'}), 400

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid email or password'}), 401

    if not user.is_active:
        return jsonify({'error': 'Invalid email or password'}), 401

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
def logout():
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
    }), 200


@auth_bp.route('/auth/verify-totp', methods=['POST'])
def verify_totp():
    data = request.get_json(silent=True) or {}
    totp_code = data.get('totp_code', '')

    if _verify_totp(totp_code):
        return jsonify({'valid': True}), 200
    return jsonify({'error': 'Invalid or expired code'}), 401


@auth_bp.route('/auth/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    totp_code = data.get('totp_code', '')
    new_password = data.get('new_password', '')

    # Validate TOTP first
    if not _verify_totp(totp_code):
        return jsonify({'error': 'Invalid or expired TOTP code'}), 400

    if not email:
        return jsonify({'error': 'email is required'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'Invalid request'}), 400

    # Validate new password strength
    pw_error = _validate_password_strength(new_password)
    if pw_error:
        return jsonify({'error': pw_error}), 400

    user.password_hash = generate_password_hash(new_password)
    db.session.commit()

    return jsonify({'message': 'Password updated'}), 200
