from flask import Blueprint, request, jsonify
from datetime import datetime
from sqlalchemy import func
from models import Visit, Patient, Bill, VisitRefund
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
        'refund': _empty_bucket(),
        'discount': _empty_bucket(),
        'billing_refund': _empty_bucket(),
        'total': _empty_bucket(),
    }

    def add(bucket, mode, amount):
        """Adds to `bucket` and to Total — for money actually coming in."""
        if not amount:
            return
        summary[bucket]['total'] += amount
        summary['total']['total'] += amount
        if mode in ('cash', 'upi'):
            summary[bucket][mode] += amount
            summary['total'][mode] += amount

    def net_out(bucket, mode, amount):
        """Removes `amount` from `bucket` itself, and from Total — for a payout
        refund that actually left a specific till. Unlike `add`'s mirror image,
        this decreases the bucket's own total too, so e.g. 'Visit Cash' reads as
        the true net figure (collected minus paid back out of that same till)."""
        if not amount:
            return
        summary[bucket]['total'] -= amount
        summary['total']['total'] -= amount
        if mode in ('cash', 'upi'):
            summary[bucket][mode] -= amount
            summary['total'][mode] -= amount

    def add_info(bucket, mode, amount):
        """Adds to `bucket` only — informational, doesn't touch Total. Discount
        doesn't move money on its own; the bill's total_amount already reflects
        it, and that's what billing_fee/Total already count."""
        if not amount:
            return
        summary[bucket]['total'] += amount
        if mode in ('cash', 'upi'):
            summary[bucket][mode] += amount

    # ── Visits for the day ──────────────────────────────────────────────
    visit_q = Visit.query.filter(Visit.visit_date == date_obj, Visit.status != 'deleted')
    if filter_location_id is not None:
        visit_q = visit_q.filter(Visit.location_id == filter_location_id)
    visits_list = visit_q.all()

    visit_ids = [v.visit_id for v in visits_list]
    patient_ids = [v.patient_id for v in visits_list]

    # A visit can now have any number of bills, so this maps to a *list* — never
    # assume [0] is "the" bill for a visit.
    bills_by_visit = {}
    if visit_ids:
        linked_bills = Bill.query.filter(Bill.visit_id.in_(visit_ids)).all()
        for b in linked_bills:
            bills_by_visit.setdefault(b.visit_id, []).append(b)

    patients_map = {}
    if patient_ids:
        patients_list = Patient.query.filter(Patient.patient_id.in_(patient_ids)).all()
        patients_map = {p.patient_id: p for p in patients_list}

    rows = []
    for v in visits_list:
        patient = patients_map.get(v.patient_id)
        visit_bills = bills_by_visit.get(v.visit_id, [])

        visit_fee = float(v.amount_paid or 0)
        visit_fee_mode = _norm_mode(v.payment_mode) if visit_fee else None

        # One entry per bill on this visit, so the row can show "200/300/400"
        # instead of only ever the single bill the old code assumed existed.
        billing_fees = []
        for bill in visit_bills:
            amount = float(bill.total_amount)
            mode = _norm_mode(bill.payment_type)
            billing_fees.append({'amount': amount, 'mode': mode})
            add('billing_fee', mode, amount)
            if bill.subtotal_amount is not None:
                # visit_refund_applied is already netted out of total_amount too —
                # back it out here so 'discount' only ever reflects an actual
                # discount, not a refund that happened to shrink this same bill.
                discount_amount = float(bill.subtotal_amount) - float(bill.total_amount) - float(bill.visit_refund_applied or 0)
                add_info('discount', mode, discount_amount)
            if bill.visit_refund_applied:
                add_info('billing_refund', mode, float(bill.visit_refund_applied))

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
            'refund_amount': float(v.refund_amount) if v.refund_amount else None,
            'refund_mode': v.refund_mode,
            'billing_fees': billing_fees,
        })

        # Added exactly once per visit, regardless of how many bills it has —
        # the visit's own fee doesn't multiply just because it was billed
        # against multiple times.
        add('visit_fee', visit_fee_mode, visit_fee)

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
            'billing_fees': [{'amount': amount, 'mode': mode}],
        })
        add('billing_fee', mode, amount)
        if b.subtotal_amount is not None:
            discount_amount = float(b.subtotal_amount) - float(b.total_amount)
            add_info('discount', mode, discount_amount)

    # ── Refunds issued today (may belong to visits from any earlier day) ──────
    # Payout refunds are tagged with exactly which till they came out of —
    # subtract from that bucket directly (so "Visit Cash"/"Billing UPI" etc.
    # are true net-of-refunds tally figures), while still logging into the
    # info-only 'refund' bucket (split by cash/upi regardless of source) for
    # at-a-glance reconciliation. 'apply_to_bill' refunds never reach this log
    # at all — see routes/visits.py — they're accounted for via billing_refund
    # above instead, since they never left any till.
    REFUND_BUCKET_MAP = {
        'visit_cash': ('visit_fee', 'cash'),
        'visit_upi': ('visit_fee', 'upi'),
        'billing_cash': ('billing_fee', 'cash'),
        'billing_upi': ('billing_fee', 'upi'),
    }
    refund_q = VisitRefund.query.filter(func.date(VisitRefund.created_at) == date_str)
    if filter_location_id is not None:
        refund_q = refund_q.join(Visit, Visit.visit_id == VisitRefund.visit_id) \
                            .filter(Visit.location_id == filter_location_id)
    for r in refund_q.all():
        bucket, norm_mode = REFUND_BUCKET_MAP.get(r.mode, (None, None))
        if not bucket:
            continue
        net_out(bucket, norm_mode, float(r.amount))
        add_info('refund', norm_mode, float(r.amount))

    rows.sort(key=lambda r: r['time'])

    # Guard against float accumulation artifacts (e.g. 462.57 + 400.0 == 862.5699999999999)
    for bucket in summary.values():
        for key in bucket:
            bucket[key] = round(bucket[key], 2)

    return jsonify({'date': date_str, 'rows': rows, 'summary': summary}), 200
