
from flask import Blueprint, request, jsonify, g
from extensions import db, get_ist_now
from models import Visit, Patient, ProductMaster, User, Bill, VisitRefund, PatientImage
from sqlalchemy import func
from datetime import datetime
from utils import generate_visit_id
from .auth import require_auth, log_activity

visits = Blueprint('visits', __name__)

@visits.route('/visits', methods=['POST'])
@require_auth
def create_visit():
    data = request.get_json()
    patient = Patient.query.filter_by(patient_id=data['patient_id']).first_or_404()
    
    visit_id = generate_visit_id(patient.patient_id)
    
    new_visit = Visit(
        visit_id=visit_id,
        patient_id=patient.patient_id,
        reason=data.get('reason'),
        visit_date=datetime.strptime(data['visit_date'], '%Y-%m-%d').date() if data.get('visit_date') else None,
        visit_time=datetime.strptime(data['visit_time'], '%H:%M').time() if data.get('visit_time') else None,
        status=data.get('status', 'in_progress'),
        visiting_fee=data.get('visiting_fee', 0),
        amount_paid=data.get('amount_paid', 0),
        payment_status=data.get('payment_status', 'unpaid'),
        payment_mode=data.get('payment_mode'),
        created_by_user_id=g.current_user.get('user_id')
    )
    creator = db.session.get(User, g.current_user.get('user_id'))
    if creator and creator.location_id:
        new_visit.location_id = creator.location_id
    db.session.add(new_visit)
    db.session.commit()

    log_activity(
        action='CREATE',
        resource_type='visit',
        resource_id=visit_id,
        resource_label=f"{patient.name} — {data.get('visit_date', '')}",
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Visit logged', 'visit_id': visit_id}), 201

@visits.route('/visits', methods=['GET'])
@require_auth
def get_all_visits():
    created_by = request.args.get('created_by')
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')

    query = Visit.query.order_by(Visit.created_at.desc())

    if created_by and created_by != 'all':
        # Doctor filtering by a specific staff member
        # Verify the requesting doctor has that staff assigned
        if g.current_user.get('role') == 'doctor':
            from models import DoctorStaffAssignment
            assignment = DoctorStaffAssignment.query.filter_by(
                doctor_id=g.current_user['user_id'],
                staff_id=created_by
            ).first()
            if not assignment:
                return jsonify({'error': 'Staff not assigned to you'}), 403
        query = query.filter(Visit.created_by_user_id == created_by)

    if date_from:
        try:
            datetime.strptime(date_from, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid date_from format, expected YYYY-MM-DD'}), 400
        query = query.filter(func.date(Visit.visit_date) >= date_from)

    if date_to:
        try:
            datetime.strptime(date_to, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid date_to format, expected YYYY-MM-DD'}), 400
        query = query.filter(func.date(Visit.visit_date) <= date_to)

    # The default (unfiltered) list is capped to the 50 most recent visits;
    # once a date filter is applied the caller wants that specific
    # day/range in full, not just a recent slice of it.
    if date_from or date_to:
        visits_list = query.limit(1000).all()
    else:
        visits_list = query.limit(50).all()

    invoice_ids = [v.invoice_id for v in visits_list if v.invoice_id]
    bills_map = {}
    if invoice_ids:
        bills = Bill.query.filter(Bill.invoice_id.in_(invoice_ids)).all()
        bills_map = {b.invoice_id: float(b.total_amount) for b in bills}

    visit_ids_all = [v.visit_id for v in visits_list]
    prescription_visit_ids = set()
    if visit_ids_all:
        prescription_rows = PatientImage.query.filter(
            PatientImage.visit_id.in_(visit_ids_all),
            PatientImage.tag == 'Prescription',
            PatientImage.deleted_at.is_(None),
        ).with_entities(PatientImage.visit_id).distinct().all()
        prescription_visit_ids = {row[0] for row in prescription_rows}

    results = []
    for v in visits_list:
        patient = Patient.query.get(v.patient_id)
        results.append({
            'visit_id': v.visit_id,
            'patient_id': v.patient_id,
            'visit_date': v.visit_date.strftime('%Y-%m-%d') if v.visit_date else None,
            'visit_time': v.visit_time.strftime('%H:%M') if v.visit_time else None,
            'patient_name': patient.name if patient else 'Unknown',
            'phone_number': patient.phone_number if patient else None,
            'dob': patient.dob.strftime('%Y-%m-%d') if patient and patient.dob else None,
            'reason': v.reason,
            'status': v.status,
            'visiting_fee': v.visiting_fee,
            'amount_paid': v.amount_paid,
            'refund_amount': v.refund_amount or 0,
            'refund_mode': v.refund_mode,
            'payment_status': v.payment_status,
            'payment_mode': v.payment_mode,
            'billed_amount': bills_map.get(v.invoice_id),
            'has_prescription': v.visit_id in prescription_visit_ids,
            'created_at': v.created_at.isoformat() if v.created_at else None,
            'updated_at': v.updated_at.isoformat() if hasattr(v, 'updated_at') and v.updated_at else None
        })
    return jsonify(results), 200

@visits.route('/visits/patient/<patient_id>', methods=['GET'])
@require_auth
def get_patient_visits(patient_id):
    patient = Patient.query.filter_by(patient_id=patient_id).first_or_404()
    visits_list = Visit.query.filter_by(patient_id=patient.patient_id).order_by(Visit.visit_date.desc(), Visit.created_at.desc()).all()
    
    results = []
    for v in visits_list:
        results.append({
            'visit_id': v.visit_id,
            'visit_date': v.visit_date.strftime('%Y-%m-%d') if v.visit_date else None,
            'visit_time': v.visit_time.strftime('%H:%M') if v.visit_time else None,
            'reason': v.reason,
            'status': v.status,
            'visiting_fee': v.visiting_fee,
            'amount_paid': v.amount_paid,
            'refund_amount': v.refund_amount or 0,
            'refund_mode': v.refund_mode,
            'payment_status': v.payment_status,
            'payment_mode': v.payment_mode,
            'created_at': v.created_at.isoformat() if v.created_at else None,
            'updated_at': v.updated_at.isoformat() if hasattr(v, 'updated_at') and v.updated_at else None
        })
    return jsonify(results), 200

@visits.route('/visits/<visit_id>', methods=['GET'])
@require_auth
def get_visit(visit_id):
    visit = Visit.query.get_or_404(visit_id)
    patient = Patient.query.get(visit.patient_id)
    return jsonify({
        'visit_id': visit.visit_id,
        'patient_id': visit.patient_id,
        'patient_name': patient.name if patient else 'Unknown',
        'phone_number': patient.phone_number if patient else None,
        'dob': patient.dob.strftime('%Y-%m-%d') if patient and patient.dob else None,
        'visit_date': visit.visit_date.strftime('%Y-%m-%d') if visit.visit_date else None,
        'visit_time': visit.visit_time.strftime('%H:%M') if visit.visit_time else None,
        'reason': visit.reason,
        'status': visit.status,
        'visiting_fee': visit.visiting_fee,
        'amount_paid': visit.amount_paid,
        'refund_amount': visit.refund_amount or 0,
        'refund_mode': visit.refund_mode,
        'payment_status': visit.payment_status,
        'payment_mode': visit.payment_mode,
        'created_at': visit.created_at.isoformat() if visit.created_at else None,
        'updated_at': visit.updated_at.isoformat() if hasattr(visit, 'updated_at') and visit.updated_at else None
    }), 200

@visits.route('/visits/<visit_id>', methods=['PUT'])
@require_auth
def update_visit(visit_id):
    visit = Visit.query.get_or_404(visit_id)
    data = request.get_json()
    
    if 'status' in data:
        visit.status = data['status']
    if 'reason' in data:
        visit.reason = data['reason']
    if 'visiting_fee' in data:
        visit.visiting_fee = data['visiting_fee']
    if 'amount_paid' in data:
        new_amount_paid = data['amount_paid']
        if (visit.refund_amount or 0) > 0 and float(new_amount_paid or 0) < float(visit.amount_paid or 0):
            return jsonify({'error': 'Cannot decrease Amount Paid once a refund has been issued. Use the Refund field instead.'}), 400
        visit.amount_paid = new_amount_paid
    if 'payment_status' in data:
        visit.payment_status = data['payment_status']
    if 'payment_mode' in data:
        visit.payment_mode = data['payment_mode']
    if 'visit_date' in data:
        visit.visit_date = datetime.strptime(data['visit_date'], '%Y-%m-%d').date() if data['visit_date'] else None
    if 'visit_time' in data:
        visit.visit_time = datetime.strptime(data['visit_time'], '%H:%M').time() if data['visit_time'] else None
        
    visit.updated_at = get_ist_now()

    db.session.commit()

    log_activity(
        action='UPDATE',
        resource_type='visit',
        resource_id=visit_id,
        resource_label=visit_id,
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Visit updated successfully'}), 200

@visits.route('/visits/<visit_id>/refund', methods=['POST'])
@require_auth
def refund_visit(visit_id):
    """Sets the visit's refund to an absolute total (not an incremental add) —
    the caller re-sends the full desired refund_amount each time, so editing an
    existing refund up or down is just resubmitting a different number. The
    VisitRefund log records the signed delta between old and new totals so
    Daily Summary still reports accurately by the day each change happened,
    including corrections (a decrease logs a negative entry, netting back
    into that day's Total)."""
    if g.current_user.get('role') == 'doctor':
        return jsonify({'error': 'Not authorized to issue refunds'}), 403

    visit = Visit.query.get_or_404(visit_id)
    data = request.get_json() or {}

    try:
        new_total = float(data.get('amount'))
    except (TypeError, ValueError):
        return jsonify({'error': 'A refund amount is required'}), 400

    if new_total < 0:
        return jsonify({'error': 'Refund amount cannot be negative'}), 400

    amount_paid = float(visit.amount_paid or 0)
    if new_total > amount_paid:
        return jsonify({'error': f'Cannot refund more than the ₹{amount_paid:.2f} collected for this visit'}), 400

    mode = (data.get('mode') or '').strip().lower()
    if new_total > 0 and mode not in ('cash', 'upi'):
        return jsonify({'error': "A refund type of 'cash' or 'upi' is required"}), 400

    previous_total = float(visit.refund_amount or 0)
    previous_mode = visit.refund_mode
    delta = new_total - previous_total

    visit.refund_amount = new_total
    visit.refund_mode = mode if new_total > 0 else None
    visit.payment_status = 'refunded' if new_total > 0 else 'full'
    visit.updated_at = get_ist_now()
    if delta != 0:
        db.session.add(VisitRefund(visit_id=visit_id, amount=delta, mode=mode or previous_mode or 'cash'))
    db.session.commit()

    log_activity(
        action='REFUND',
        resource_type='visit',
        resource_id=visit_id,
        resource_label=f"{visit_id} — refund set to ₹{new_total:.2f} (was ₹{previous_total:.2f})",
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({
        'message': 'Refund recorded',
        'refund_amount': visit.refund_amount,
        'refund_mode': visit.refund_mode,
        'payment_status': visit.payment_status,
    }), 200

@visits.route('/visits/<visit_id>', methods=['DELETE'])
@require_auth
def delete_visit(visit_id):
    visit = Visit.query.get_or_404(visit_id)
    db.session.delete(visit)
    db.session.commit()

    log_activity(
        action='DELETE',
        resource_type='visit',
        resource_id=visit_id,
        resource_label=visit_id,
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Visit deleted successfully'}), 200
