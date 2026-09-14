import datetime as _dt

import os
import shutil
from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, text

from extensions import db, get_ist_now
from models import (
    AuditLog, User, DoctorStaffAssignment, Visit, Bill, BillItem, VisitRefund,
    Patient, Location, InventoryBatch, InventoryHistory, PatientImage,
    UploadSession, ExpenseLedger, ProductMaster, PurchaseInvoice,
)
from routes.auth import require_admin, require_auth, _verify_totp

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
            'location_id': u.location_id,
            'location_name': (db.session.get(Location, u.location_id).name if u.location_id else None),
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

    if 'location_id' in data:
        loc_id = data['location_id']
        if loc_id is None:
            user.location_id = None
            user.location_label = None
        else:
            loc = db.session.get(Location, int(loc_id))
            if not loc:
                return jsonify({'error': 'Location not found'}), 404
            user.location_id = loc.id
            user.location_label = loc.name  # keep string in sync for backward compat

    # Keep old handler so existing callers that send location_label still work
    if 'location_label' in data and 'location_id' not in data:
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
        Visit.created_at >= today_ist,
        Visit.status != 'deleted',
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
    # 1. File Storage Telemetry (Images/Invoices)
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

    # 2. Database Size Inquiry (Postgres Safe fallback)
    db_size_bytes = 0
    try:
        db_size_bytes = db.session.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0
    except Exception:
        db_size_bytes = 0  # Graceful fallback for SQLite fallback tests

    return jsonify({
        'db_size_bytes': int(db_size_bytes),
        'media_size_bytes': int(media_used_bytes),
        'system_disk': {
            'total': d_total,
            'used': d_used,
            'free': d_free
        },
        'timestamp': get_ist_now().isoformat()
    }), 200


# ─── Data Management (Danger Zone) ─────────────────────────────────────────

_VALID_SCOPES = ('stock_counts', 'inventory_all', 'images', 'patients', 'all')
_VALID_IMAGE_SCOPES = ('all', 'prescriptions', 'invoices')


def _unlink_files(paths):
    """Best-effort delete of files on disk. Never raises -- a missing or
    unremovable file is logged and skipped, not a reason to fail the
    (already-committed) DB wipe."""
    for p in paths:
        if not p:
            continue
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception as e:
            print(f"Warning: could not delete file {p}: {e}")


def _patient_cascade_counts(patient_ids):
    """Row counts for everything Clear Patients / Clear All would cascade-
    delete for the given patient ids. Read-only -- used by preview."""
    if not patient_ids:
        return {'patients': 0, 'visits': 0, 'bills': 0, 'bill_items': 0,
                'visit_refunds': 0, 'patient_images': 0}

    visit_ids = [v.visit_id for v in
                 Visit.query.with_entities(Visit.visit_id)
                 .filter(Visit.patient_id.in_(patient_ids)).all()]
    bill_ids = [b.invoice_id for b in
                Bill.query.with_entities(Bill.invoice_id)
                .filter(Bill.patient_id.in_(patient_ids)).all()]

    return {
        'patients': len(patient_ids),
        'visits': len(visit_ids),
        'bills': len(bill_ids),
        'bill_items': BillItem.query.filter(BillItem.bill_id.in_(bill_ids)).count() if bill_ids else 0,
        'visit_refunds': VisitRefund.query.filter(VisitRefund.visit_id.in_(visit_ids)).count() if visit_ids else 0,
        'patient_images': PatientImage.query.filter(PatientImage.patient_id.in_(patient_ids)).count(),
    }


def _preview_counts(scope, image_scope=None):
    """Read-only row counts for the given scope. Raises ValueError on an
    unknown scope/image_scope -- callers must validate against
    _VALID_SCOPES/_VALID_IMAGE_SCOPES first and turn that into a 400."""
    if scope == 'stock_counts':
        return {
            'inventory_batches': InventoryBatch.query.count(),
            'inventory_history': InventoryHistory.query.count(),
        }

    if scope == 'inventory_all':
        return {
            'inventory_batches': InventoryBatch.query.count(),
            'inventory_history': InventoryHistory.query.count(),
            'purchase_invoices': PurchaseInvoice.query.count(),
            'product_master': ProductMaster.query.count(),
        }

    if scope == 'images':
        if image_scope == 'prescriptions':
            return {'patient_images': PatientImage.query.filter_by(tag='Prescription').count()}
        if image_scope == 'invoices':
            return {'purchase_invoice_images': PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).count()}
        return {
            'patient_images': PatientImage.query.count(),
            'purchase_invoice_images': PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).count(),
        }

    if scope == 'patients':
        patient_ids = [p.patient_id for p in Patient.query.with_entities(Patient.patient_id).all()]
        return _patient_cascade_counts(patient_ids)

    if scope == 'all':
        patient_ids = [p.patient_id for p in Patient.query.with_entities(Patient.patient_id).all()]
        counts = _patient_cascade_counts(patient_ids)
        counts.update({
            'inventory_batches': InventoryBatch.query.count(),
            'inventory_history': InventoryHistory.query.count(),
            'purchase_invoices': PurchaseInvoice.query.count(),
            'product_master': ProductMaster.query.count(),
            'expense_ledger': ExpenseLedger.query.count(),
            'upload_sessions': UploadSession.query.count(),
        })
        # Walk-in bills (patient_id IS NULL) are outside _patient_cascade_counts()'s
        # scope -- add them on top so the preview matches what _wipe_all() actually
        # deletes (see _wipe_all()'s matching walk-in bill block).
        walkin_bill_ids = [b.invoice_id for b in
                           Bill.query.with_entities(Bill.invoice_id)
                           .filter(Bill.patient_id.is_(None)).all()]
        counts['bills'] += len(walkin_bill_ids)
        counts['bill_items'] += BillItem.query.filter(
            BillItem.bill_id.in_(walkin_bill_ids)).count() if walkin_bill_ids else 0
        return counts

    raise ValueError(f'Unknown scope: {scope}')


def _wipe_stock_counts():
    """= today's existing Wipe Inventory behavior: batches + history only."""
    history_count = InventoryHistory.query.count()
    batch_count = InventoryBatch.query.count()
    InventoryHistory.query.delete(synchronize_session=False)
    InventoryBatch.query.delete(synchronize_session=False)
    db.session.commit()
    return {'inventory_batches': batch_count, 'inventory_history': history_count}, []


def _wipe_inventory_all():
    """Everything _wipe_stock_counts() does, plus the ProductMaster catalog
    and PurchaseInvoice rows (+ their image files). BillItem.product_id is
    nulled (not cascaded) first -- same reasoning as delete_inventory_item
    in routes/inventory.py: BillItem stores a sale-time snapshot, so losing
    the live FK link on a bulk catalog wipe must not touch historical
    billing rows."""
    history_count = InventoryHistory.query.count()
    batch_count = InventoryBatch.query.count()
    product_ids = [p.id for p in ProductMaster.query.with_entities(ProductMaster.id).all()]
    invoice_rows = PurchaseInvoice.query.with_entities(
        PurchaseInvoice.invoice_number, PurchaseInvoice.image_path
    ).all()

    files = [r.image_path for r in invoice_rows if r.image_path]

    if product_ids:
        BillItem.query.filter(BillItem.product_id.in_(product_ids)).update(
            {'product_id': None}, synchronize_session=False)
    InventoryHistory.query.delete(synchronize_session=False)
    InventoryBatch.query.delete(synchronize_session=False)
    PurchaseInvoice.query.delete(synchronize_session=False)
    ProductMaster.query.delete(synchronize_session=False)
    db.session.commit()

    return {
        'inventory_batches': batch_count,
        'inventory_history': history_count,
        'purchase_invoices': len(invoice_rows),
        'product_master': len(product_ids),
    }, files


def _wipe_images(image_scope):
    if image_scope == 'prescriptions':
        imgs = PatientImage.query.filter_by(tag='Prescription').all()
        files = [i.image_path for i in imgs if i.image_path]
        count = len(imgs)
        PatientImage.query.filter_by(tag='Prescription').delete(synchronize_session=False)
        db.session.commit()
        return {'patient_images': count}, files

    if image_scope == 'invoices':
        invs = PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).all()
        files = [i.image_path for i in invs]
        count = len(invs)
        PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).update(
            {'image_path': None}, synchronize_session=False)
        db.session.commit()
        return {'purchase_invoice_images': count}, files

    # 'all' -- every PatientImage row (any tag, including trashed) + every
    # PurchaseInvoice image file. PurchaseInvoice rows themselves are kept
    # (deleting the row is inventory_all's job, not this one).
    imgs = PatientImage.query.all()
    patient_image_files = [i.image_path for i in imgs if i.image_path]
    patient_image_count = len(imgs)

    invs = PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).all()
    invoice_image_files = [i.image_path for i in invs]
    invoice_image_count = len(invs)

    PatientImage.query.delete(synchronize_session=False)
    PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).update(
        {'image_path': None}, synchronize_session=False)
    db.session.commit()

    return {
        'patient_images': patient_image_count,
        'purchase_invoice_images': invoice_image_count,
    }, patient_image_files + invoice_image_files


def _wipe_patients():
    """Deletes every Patient and cascades PatientImage (+ files),
    VisitRefund, BillItem, Bill (only bills with patient_id set -- walk-in
    bills stay), Visit, and any 'patient'-context UploadSession rows for
    the deleted ids. InventoryHistory.bill_id is nulled (not cascaded) on
    the bills about to be deleted -- same FK-null-not-cascade reasoning as
    _wipe_inventory_all()'s BillItem.product_id handling: the stock-
    movement audit trail should survive even though the bill it once
    pointed at is gone."""
    patient_ids = [p.patient_id for p in Patient.query.with_entities(Patient.patient_id).all()]
    if not patient_ids:
        return {'patients': 0, 'visits': 0, 'bills': 0, 'bill_items': 0,
                'visit_refunds': 0, 'patient_images': 0}, []

    visit_ids = [v.visit_id for v in
                 Visit.query.with_entities(Visit.visit_id)
                 .filter(Visit.patient_id.in_(patient_ids)).all()]
    bill_ids = [b.invoice_id for b in
                Bill.query.with_entities(Bill.invoice_id)
                .filter(Bill.patient_id.in_(patient_ids)).all()]

    images = PatientImage.query.filter(PatientImage.patient_id.in_(patient_ids)).all()
    files = [i.image_path for i in images if i.image_path]
    image_count = len(images)

    bill_item_count = BillItem.query.filter(BillItem.bill_id.in_(bill_ids)).count() if bill_ids else 0
    refund_count = VisitRefund.query.filter(VisitRefund.visit_id.in_(visit_ids)).count() if visit_ids else 0

    PatientImage.query.filter(PatientImage.patient_id.in_(patient_ids)).delete(synchronize_session=False)
    if visit_ids:
        VisitRefund.query.filter(VisitRefund.visit_id.in_(visit_ids)).delete(synchronize_session=False)
    if bill_ids:
        BillItem.query.filter(BillItem.bill_id.in_(bill_ids)).delete(synchronize_session=False)
        InventoryHistory.query.filter(InventoryHistory.bill_id.in_(bill_ids)).update(
            {'bill_id': None}, synchronize_session=False)
        Bill.query.filter(Bill.invoice_id.in_(bill_ids)).delete(synchronize_session=False)
    Visit.query.filter(Visit.patient_id.in_(patient_ids)).delete(synchronize_session=False)
    UploadSession.query.filter(
        UploadSession.context_type == 'patient',
        UploadSession.context_id.in_(patient_ids),
    ).delete(synchronize_session=False)
    Patient.query.filter(Patient.patient_id.in_(patient_ids)).delete(synchronize_session=False)
    db.session.commit()

    # Best-effort: remove each patient's now-empty upload folder.
    base_folder = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'patients')
    for pid in patient_ids:
        shutil.rmtree(os.path.join(base_folder, pid), ignore_errors=True)

    return {
        'patients': len(patient_ids),
        'visits': len(visit_ids),
        'bills': len(bill_ids),
        'bill_items': bill_item_count,
        'visit_refunds': refund_count,
        'patient_images': image_count,
    }, files


def _wipe_all():
    """Composition of _wipe_patients() + _wipe_inventory_all(), plus
    walk-in bills (Bill.patient_id IS NULL, missed by both of those --
    see the walk-in bill block below), ExpenseLedger, and any remaining
    UploadSession rows. Deliberately does NOT also call _wipe_images('all')
    -- see the comment in the spec doc's Backend API section for why that
    would double-count/double-delete PatientImage rows. Keeps: User,
    DoctorStaffAssignment, Location, AuditLog."""
    counts = {}
    files = []

    patient_counts, patient_files = _wipe_patients()
    counts.update(patient_counts)
    files.extend(patient_files)

    inv_counts, inv_files = _wipe_inventory_all()
    counts.update(inv_counts)
    files.extend(inv_files)

    # Walk-in bills (patient_id IS NULL) are outside _wipe_patients()'s scope
    # (correctly, for the standalone patients scope) and _wipe_inventory_all()
    # never touches Bill at all -- 'all' must finish the job here to match its
    # own "wipes everything except accounts" promise. Added to the EXISTING
    # counts['bills']/counts['bill_items'] (already holding the patient-linked
    # totals from _wipe_patients()) so the final numbers are the true total.
    walkin_bill_ids = [b.invoice_id for b in
                       Bill.query.with_entities(Bill.invoice_id)
                       .filter(Bill.patient_id.is_(None)).all()]
    if walkin_bill_ids:
        counts['bills'] = counts.get('bills', 0) + len(walkin_bill_ids)
        counts['bill_items'] = counts.get('bill_items', 0) + BillItem.query.filter(
            BillItem.bill_id.in_(walkin_bill_ids)).count()
        BillItem.query.filter(BillItem.bill_id.in_(walkin_bill_ids)).delete(synchronize_session=False)
        InventoryHistory.query.filter(InventoryHistory.bill_id.in_(walkin_bill_ids)).update(
            {'bill_id': None}, synchronize_session=False)
        Bill.query.filter(Bill.invoice_id.in_(walkin_bill_ids)).delete(synchronize_session=False)

    expenses = ExpenseLedger.query.all()
    expense_files = [e.receipt_path for e in expenses if e.receipt_path]
    counts['expense_ledger'] = len(expenses)
    files.extend(expense_files)
    ExpenseLedger.query.delete(synchronize_session=False)

    counts['upload_sessions'] = UploadSession.query.count()
    UploadSession.query.delete(synchronize_session=False)

    db.session.commit()

    # Best-effort: sweep any leftover scratch files under temp/ (e.g. from
    # an abandoned/never-finalized QR session) not tracked by any DB row.
    temp_dir = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'temp')
    if os.path.isdir(temp_dir):
        for entry in os.listdir(temp_dir):
            shutil.rmtree(os.path.join(temp_dir, entry), ignore_errors=True)

    return counts, files


@admin_bp.route('/admin/data_management/preview', methods=['GET'])
@require_auth
@require_admin
def data_management_preview():
    scope = request.args.get('scope')
    image_scope = request.args.get('image_scope')

    if scope not in _VALID_SCOPES:
        return jsonify({'error': 'Invalid scope'}), 400
    if scope == 'images' and image_scope not in _VALID_IMAGE_SCOPES:
        return jsonify({'error': 'Invalid image_scope'}), 400

    return jsonify({'counts': _preview_counts(scope, image_scope)}), 200


@admin_bp.route('/admin/data_management/execute', methods=['DELETE'])
@require_auth
@require_admin
def data_management_execute():
    data = request.get_json(silent=True) or {}
    scope = data.get('scope')
    image_scope = data.get('image_scope')
    totp_code = (data.get('totp_code') or '').strip()

    if scope not in _VALID_SCOPES:
        return jsonify({'error': 'Invalid scope'}), 400
    if scope == 'images' and image_scope not in _VALID_IMAGE_SCOPES:
        return jsonify({'error': 'Invalid image_scope'}), 400
    if not totp_code:
        return jsonify({'error': 'Auth code is required'}), 400
    if not _verify_totp(totp_code):
        return jsonify({'error': 'Invalid or expired auth code'}), 401

    try:
        if scope == 'stock_counts':
            counts, files = _wipe_stock_counts()
        elif scope == 'inventory_all':
            counts, files = _wipe_inventory_all()
        elif scope == 'images':
            counts, files = _wipe_images(image_scope)
        elif scope == 'patients':
            counts, files = _wipe_patients()
        else:  # 'all'
            counts, files = _wipe_all()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

    _unlink_files(files)

    from routes.auth import log_activity
    log_activity(
        action='DELETE',
        resource_type='data_management',
        resource_id=scope if scope != 'images' else f'images:{image_scope}',
        resource_label=f'Data management wipe: {scope}',
        details=', '.join(f'{k}={v}' for k, v in counts.items()),
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Wipe completed successfully.', 'counts': counts}), 200
