from flask import Blueprint, request, jsonify
from datetime import datetime
from sqlalchemy import func
from models import Visit, Patient, Bill
from .auth import require_auth

daily_summary = Blueprint('daily_summary', __name__)


def _norm_mode(raw):
    """Lowercase a payment mode/type down to 'cash'/'upi'/'other'. Bills use
    'CASH'/'UPI'/'CARD', visits use 'cash'/'upi' — this normalizes both."""
    if not raw:
        return None
    m = raw.strip().lower()
    return m if m in ('cash', 'upi') else 'other'


def _empty_bucket():
    return {'cash': 0, 'upi': 0, 'total': 0}


@daily_summary.route('/daily_summary', methods=['GET'])
@require_auth
def get_daily_summary():
    date_str = request.args.get('date')
    if not date_str:
        return jsonify({'error': 'date is required, expected YYYY-MM-DD'}), 400
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format, expected YYYY-MM-DD'}), 400

    location_id_param = request.args.get('location_id')
    filter_location_id = None
    if location_id_param and location_id_param.isdigit():
        filter_location_id = int(location_id_param)

    summary = {
        'visit_fee': _empty_bucket(),
        'billing_fee': _empty_bucket(),
        'total': _empty_bucket(),
    }

    def add(bucket, mode, amount):
        if not amount:
            return
        summary[bucket]['total'] += amount
        summary['total']['total'] += amount
        if mode in ('cash', 'upi'):
            summary[bucket][mode] += amount
            summary['total'][mode] += amount

    # ── Visits for the day ──────────────────────────────────────────────
    visit_q = Visit.query.filter(Visit.visit_date == date_obj, Visit.status != 'deleted')
    if filter_location_id is not None:
        visit_q = visit_q.filter(Visit.location_id == filter_location_id)
    visits_list = visit_q.all()

    visit_ids = [v.visit_id for v in visits_list]
    patient_ids = [v.patient_id for v in visits_list]

    bills_by_visit = {}
    if visit_ids:
        linked_bills = Bill.query.filter(Bill.visit_id.in_(visit_ids)).all()
        bills_by_visit = {b.visit_id: b for b in linked_bills}

    patients_map = {}
    if patient_ids:
        patients_list = Patient.query.filter(Patient.patient_id.in_(patient_ids)).all()
        patients_map = {p.patient_id: p for p in patients_list}

    rows = []
    for v in visits_list:
        patient = patients_map.get(v.patient_id)
        bill = bills_by_visit.get(v.visit_id)

        visit_fee = float(v.amount_paid or 0) - float(v.refund_amount or 0)
        visit_fee_mode = _norm_mode(v.payment_mode) if visit_fee else None
        billing_fee = float(bill.total_amount) if bill else None
        billing_fee_mode = _norm_mode(bill.payment_type) if bill else None

        rows.append({
            'type': 'visit',
            'visit_id': v.visit_id,
            'patient_id': v.patient_id,
            'patient_name': patient.name if patient else 'Unknown',
            'phone_number': patient.phone_number if patient else None,
            'reason': v.reason,
            'time': v.visit_time.strftime('%H:%M') if v.visit_time else '00:00',
            'visit_fee': visit_fee if visit_fee else None,
            'visit_fee_mode': visit_fee_mode,
            'billing_fee': billing_fee,
            'billing_fee_mode': billing_fee_mode,
        })

        add('visit_fee', visit_fee_mode, visit_fee)
        if bill:
            add('billing_fee', billing_fee_mode, billing_fee)

    # ── Walk-in bills for the day (no patient_id → not already covered above) ──
    walkin_q = Bill.query.filter(
        func.date(Bill.created_at) == date_str,
        Bill.patient_id.is_(None),
    )
    if filter_location_id is not None:
        walkin_q = walkin_q.filter(Bill.location_id == filter_location_id)
    walkin_bills = walkin_q.all()

    for b in walkin_bills:
        mode = _norm_mode(b.payment_type)
        amount = float(b.total_amount)
        rows.append({
            'type': 'walkin',
            'invoice_id': b.invoice_id,
            'patient_id': None,
            'patient_name': b.walk_in_name or 'Walk-in',
            'phone_number': None,
            'reason': None,
            'time': b.created_at.strftime('%H:%M') if b.created_at else '00:00',
            'visit_fee': None,
            'visit_fee_mode': None,
            'billing_fee': amount,
            'billing_fee_mode': mode,
        })
        add('billing_fee', mode, amount)

    rows.sort(key=lambda r: r['time'])

    # Guard against float accumulation artifacts (e.g. 462.57 + 400.0 == 862.5699999999999)
    for bucket in summary.values():
        for key in bucket:
            bucket[key] = round(bucket[key], 2)

    return jsonify({'date': date_str, 'rows': rows, 'summary': summary}), 200
