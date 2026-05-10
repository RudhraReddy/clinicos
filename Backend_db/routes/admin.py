import datetime as _dt

import os
import shutil
from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, text

from extensions import db, get_ist_now
from models import AuditLog, User, DoctorStaffAssignment, Visit, Bill, Patient
from routes.auth import require_admin, require_auth

admin_bp = Blueprint('admin', __name__)


@admin_bp.route('/admin/users', methods=['GET'])
@require_auth
@require_admin
def list_all_users():
    role_filter = request.args.get('role')
    query = User.query
    if role_filter:
        query = query.filter_by(role=role_filter)
    users = query.order_by(User.created_at.desc()).all()
    return jsonify([
        {
            'user_id': u.id,
            'username': u.username,
            'email': u.email,
            'role': u.role,
            'is_active': u.is_active,
            'location_label': u.location_label,
            'created_at': u.created_at.isoformat() if u.created_at else None,
            'assigned_staff_ids': [a.staff_id for a in DoctorStaffAssignment.query.filter_by(doctor_id=u.id).all()] if u.role == 'doctor' else [],
        }
        for u in users
    ]), 200


@admin_bp.route('/admin/users/<user_id>', methods=['PATCH'])
@require_auth
@require_admin
def update_user(user_id):
    data = request.get_json(silent=True) or {}
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    if 'username' in data:
        username = (data['username'] or '').strip()
        if not username:
            return jsonify({'error': 'Username cannot be empty'}), 400
        existing = User.query.filter(User.username == username, User.id != user_id).first()
        if existing:
            return jsonify({'error': 'Username is already taken'}), 400
        user.username = username

    if 'role' in data:
        if data['role'] not in ('staff', 'doctor', 'admin'):
            return jsonify({'error': "role must be 'staff', 'doctor', or 'admin'"}), 400
        user.role = data['role']

    if 'is_active' in data:
        user.is_active = bool(data['is_active'])

    if 'location_label' in data:
        user.location_label = (data['location_label'] or '').strip() or None

    if 'assigned_staff_ids' in data:
        # Update staff assignments only for doctors
        if user.role == 'doctor':
            new_staff_ids = data['assigned_staff_ids']
            if not isinstance(new_staff_ids, list):
                return jsonify({'error': 'assigned_staff_ids must be a list'}), 400
            
            # Delete existing assignments
            DoctorStaffAssignment.query.filter_by(doctor_id=user_id).delete()
            
            # Create new ones
            for s_id in new_staff_ids:
                s_user = db.session.get(User, s_id)
                if s_user and s_user.role == 'staff':
                    assignment = DoctorStaffAssignment(
                        doctor_id=user_id,
                        staff_id=s_id,
                        created_at=get_ist_now(),
                    )
                    db.session.add(assignment)

    db.session.commit()

    from routes.auth import log_activity
    log_activity(
        action='UPDATE',
        resource_type='user',
        resource_id=user.id,
        resource_label=user.username,
        details=f"role={user.role}, active={user.is_active}",
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'User updated'}), 200


@admin_bp.route('/admin/activity-log', methods=['GET'])
@require_auth
@require_admin
def activity_log():
    page = int(request.args.get('page', 1))
    limit = int(request.args.get('limit', 50))
    user_id_filter = request.args.get('user_id')
    action_filter = request.args.get('action')
    resource_type_filter = request.args.get('resource_type')
    date_from = request.args.get('date_from')  # YYYY-MM-DD
    date_to = request.args.get('date_to')       # YYYY-MM-DD

    query = AuditLog.query
    if user_id_filter:
        query = query.filter(AuditLog.user_id == user_id_filter)
    if action_filter:
        query = query.filter(AuditLog.action == action_filter.upper())
    if resource_type_filter:
        query = query.filter(AuditLog.resource_type == resource_type_filter)
    if date_from:
        try:
            dt_from = _dt.datetime.strptime(date_from, '%Y-%m-%d')
            query = query.filter(AuditLog.timestamp >= dt_from)
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = _dt.datetime.strptime(date_to, '%Y-%m-%d') + _dt.timedelta(days=1)
            query = query.filter(AuditLog.timestamp < dt_to)
        except ValueError:
            pass

    total = query.count()
    entries = query.order_by(AuditLog.timestamp.desc()).offset((page - 1) * limit).limit(limit).all()

    return jsonify({
        'total': total,
        'page': page,
        'limit': limit,
        'pages': (total + limit - 1) // limit,
        'entries': [
            {
                'id': e.id,
                'user_id': e.user_id,
                'username': e.username,
                'action': e.action,
                'resource_type': e.resource_type,
                'resource_id': e.resource_id,
                'resource_label': e.resource_label,
                'details': e.details,
                'timestamp': e.timestamp.isoformat() if e.timestamp else None,
                'ip_address': e.ip_address,
            }
            for e in entries
        ],
    }), 200


@admin_bp.route('/admin/stats', methods=['GET'])
@require_auth
@require_admin
def admin_stats():
    # User counts by role
    role_counts = db.session.query(User.role, func.count(User.id)).group_by(User.role).all()
    users_by_role = {role: count for role, count in role_counts}

    active_count = User.query.filter_by(is_active=True).count()
    inactive_count = User.query.filter_by(is_active=False).count()

    # Time definitions
    today_ist = get_ist_now().replace(hour=0, minute=0, second=0, microsecond=0)

    logins_today = AuditLog.query.filter(
        AuditLog.action == 'LOGIN',
        AuditLog.timestamp >= today_ist,
    ).count()

    # Daily activities
    activities_today = AuditLog.query.filter(
        AuditLog.timestamp >= today_ist
    ).count()

    visits_today = Visit.query.filter(
        Visit.created_at >= today_ist
    ).count()

    bills_today = Bill.query.filter(
        Bill.created_at >= today_ist
    ).count()

    total_audit = AuditLog.query.count()
    total_patients = Patient.query.count()

    # Recent 10 activity entries
    recent = AuditLog.query.order_by(AuditLog.timestamp.desc()).limit(10).all()

    return jsonify({
        'users_by_role': users_by_role,
        'active_users': active_count,
        'inactive_users': inactive_count,
        'logins_today': logins_today,
        'activities_today': activities_today,
        'visits_today': visits_today,
        'bills_today': bills_today,
        'total_audit_entries': total_audit,
        'total_patients': total_patients,
        'recent_activity': [
            {
                'id': e.id,
                'user_id': e.user_id,
                'username': e.username,
                'action': e.action,
                'resource_type': e.resource_type,
                'resource_id': e.resource_id,
                'resource_label': e.resource_label,
                'details': e.details,
                'timestamp': e.timestamp.isoformat() if e.timestamp else None,
            }
            for e in recent
        ],
    }), 200


@admin_bp.route('/admin/diagnostics', methods=['GET'])
@require_auth
@require_admin
def admin_diagnostics():
    """
    On-demand system health and resource diagnostics gathering.
    Calculates database footprint, dynamic disk usage and system health checks.
    """
    # 1. OCR Status Detection
    ocr_active = bool(os.environ.get('GOOGLE_CLOUD_API_KEY', '').strip())

    # 2. File Storage Telemetry (Images/Invoices)
    storage_base = os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads')
    media_used_bytes = 0
    if os.path.exists(storage_base):
        try:
            for dirpath, dirnames, filenames in os.walk(storage_base):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if os.path.isfile(fp) and not os.path.islink(fp):
                        media_used_bytes += os.path.getsize(fp)
        except Exception:
            pass

    # System Disk Snapshot (Container Context)
    try:
        d_total, d_used, d_free = shutil.disk_usage("/")
    except Exception:
        d_total, d_used, d_free = 0, 0, 0

    # 3. Database Size Inquiry (Postgres Safe fallback)
    db_size_bytes = 0
    try:
        db_size_bytes = db.session.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0
    except Exception:
        db_size_bytes = 0  # Graceful fallback for SQLite fallback tests

    return jsonify({
        'ocr_configured': ocr_active,
        'db_size_bytes': int(db_size_bytes),
        'media_size_bytes': int(media_used_bytes),
        'system_disk': {
            'total': d_total,
            'used': d_used,
            'free': d_free
        },
        'timestamp': get_ist_now().isoformat()
    }), 200
