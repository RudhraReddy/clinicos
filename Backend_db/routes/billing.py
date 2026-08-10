
import math

from flask import Blueprint, request, jsonify, g
from extensions import db, get_ist_now
from models import Bill, BillItem, Patient, Visit, ProductMaster, InventoryBatch, InventoryHistory, User, Location
from sqlalchemy import func
from utils import generate_invoice_id
from .auth import require_auth, log_activity

billing = Blueprint('billing', __name__)

@billing.route('/billing', methods=['POST'])
@require_auth
def create_bill():
    data = request.get_json()

    walk_in_name = (data.get('walk_in_name') or '').strip()
    patient = None

    if data.get('patient_id'):
        patient = Patient.query.filter_by(patient_id=data['patient_id']).first()
        if not patient:
            return jsonify({'error': 'Patient not found'}), 404
    elif not walk_in_name:
        return jsonify({'error': 'Patient ID or a walk-in name is required'}), 400

    items_used = data.get('items_used', [])
    if not items_used:
        return jsonify({'error': 'No items in bill'}), 400

    payment_type = (data.get('payment_type') or 'CASH').strip().upper()
    if payment_type not in ('CASH', 'UPI'):
        return jsonify({'error': "payment_type must be 'CASH' or 'UPI'"}), 400

    discount_type = data.get('discount_type')
    discount_value = data.get('discount_value')
    if discount_type is not None or discount_value is not None:
        if discount_type not in ('percent', 'flat'):
            return jsonify({'error': "discount_type must be 'percent' or 'flat'"}), 400
        try:
            discount_value = float(discount_value)
        except (TypeError, ValueError):
            return jsonify({'error': 'discount_value must be a number'}), 400
        if discount_value < 0:
            return jsonify({'error': 'discount_value cannot be negative'}), 400
        if discount_type == 'percent' and discount_value > 100:
            return jsonify({'error': 'Percent discount cannot exceed 100'}), 400
    else:
        discount_type = None
        discount_value = None

    visit_id = data.get('visit_id') if patient else None
    visit = None
    if visit_id:
        visit = Visit.query.get(visit_id)
        existing_bill = Bill.query.filter_by(visit_id=visit_id).first()
        if existing_bill:
            return jsonify({'error': 'A bill already exists for this visit'}), 400

    # ── Clinic resolution ────────────────────────────────────────────────
    # A visit-linked bill can never disagree with its own visit's clinic —
    # that takes priority over anything the caller sends. Otherwise an
    # explicit location_id (the admin/doctor picker) is honored, falling
    # back to the creator's own assigned clinic (the frontdesk-lock case).
    creator = db.session.get(User, g.current_user.get('user_id'))
    resolved_location_id = None
    if visit and visit.location_id:
        resolved_location_id = visit.location_id
    elif data.get('location_id') not in (None, ''):
        try:
            requested_location_id = int(data['location_id'])
        except (TypeError, ValueError):
            return jsonify({'error': 'location_id must be a number'}), 400
        location = Location.query.get(requested_location_id)
        if not location or not location.is_active:
            return jsonify({'error': 'Invalid or inactive clinic'}), 400
        resolved_location_id = requested_location_id
    elif creator and creator.location_id:
        resolved_location_id = creator.location_id

    if not resolved_location_id:
        return jsonify({'error': 'A clinic must be assigned to this bill'}), 400

    invoice_id = generate_invoice_id()

    walk_in_age = None
    walk_in_sex = None
    if not patient:
        try:
            raw_age = data.get('walk_in_age')
            walk_in_age = int(raw_age) if raw_age not in (None, '') else None
        except (ValueError, TypeError):
            walk_in_age = None
        walk_in_sex = (data.get('walk_in_sex') or '').strip() or None

    new_bill = Bill(
        invoice_id=invoice_id,
        patient_id=patient.patient_id if patient else None,
        walk_in_name=walk_in_name if not patient else None,
        walk_in_age=walk_in_age,
        walk_in_sex=walk_in_sex,
        visit_id=visit_id,
        payment_type=payment_type,
        total_amount=0,
        location_id=resolved_location_id,
        created_by_user_id=g.current_user.get('user_id')
    )
    db.session.add(new_bill)
    db.session.flush()

    if visit:
        visit.invoice_id = invoice_id
        visit.status = 'done'

    total_calc_amount = 0
    
    for item in items_used:
        master_id = item.get('item_id')
        qty_needed = float(item.get('quantity', 0))
        
        product_master = ProductMaster.query.get(master_id)
        if not product_master: continue 
        
        # Get exact frontend fields
        billed_qty = float(item.get('qty', qty_needed))
        billed_unit = item.get('unit', 'ea')
        billed_mrp = float(item.get('mrp', 0))
        billed_total = float(item.get('total_value', billed_mrp * billed_qty))
        
        total_calc_amount += billed_total
        
        # Deduct from inventory batches (FIFO)
        remaining_to_deduct = qty_needed
        batches = InventoryBatch.query.filter(
            InventoryBatch.product_id == master_id,
            InventoryBatch.quantity > 0
        ).order_by(InventoryBatch.expiry_date.asc()).all()
        
        associated_batch_id = None
        associated_batch_number = "Auto-FIFO"
        associated_expiry_date = None
        
        if batches:
            associated_batch_id = batches[0].id
            associated_batch_number = batches[0].batch_number
            associated_expiry_date = batches[0].expiry_date
            
            for batch in batches:
                if remaining_to_deduct <= 0: break
                take = min(float(batch.quantity), float(remaining_to_deduct))
                batch.quantity = float(batch.quantity) - take
                remaining_to_deduct = float(remaining_to_deduct) - take
                
                # Add to inventory history
                history = InventoryHistory(
                    product_id=master_id,
                    batch_id=batch.id,
                    bill_id=invoice_id,
                    change_amount=-take,
                    type='SALE',
                    notes=f"Billed Invoice {invoice_id}",
                    user_id=g.current_user.get('user_id'),
                    username=g.current_user.get('username'),
                )
                db.session.add(history)
        
        # ALWAYS create exactly one BillItem with the exact quantity billed!
        bill_item = BillItem(
            bill_id=invoice_id,
            product_id=master_id,
            batch_id=associated_batch_id,
            item_name=product_master.item_name,
            batch_number=associated_batch_number + f"|{billed_unit}",
            expiry_date=associated_expiry_date,
            quantity=billed_qty,
            mrp=billed_mrp,
            gst_rate=product_master.gst_rate,
            total_value=billed_total
        )
        db.session.add(bill_item)

    subtotal_amount = total_calc_amount
    discount_amount = 0
    if discount_type == 'percent':
        discount_amount = subtotal_amount * discount_value / 100
    elif discount_type == 'flat':
        if discount_value > subtotal_amount:
            return jsonify({'error': 'Flat discount cannot exceed the bill subtotal'}), 400
        discount_amount = discount_value

    final_total = subtotal_amount - discount_amount

    new_bill.subtotal_amount = subtotal_amount
    new_bill.discount_type = discount_type
    new_bill.discount_value = discount_value
    new_bill.total_amount = final_total

    db.session.commit()

    log_activity(
        action='CREATE',
        resource_type='bill',
        resource_id=invoice_id,
        resource_label=f"{patient.name if patient else (walk_in_name or 'Walk-in')} — ₹{final_total:.2f}",
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Bill created', 'invoice_id': invoice_id, 'total': final_total}), 201

@billing.route('/billing/history', methods=['GET'])
@require_auth
def get_billing_history():
    date_from    = request.args.get('date_from')
    date_to      = request.args.get('date_to')
    payment_type = request.args.get('payment_type')
    patient_id   = request.args.get('patient_id')
    is_walk_in   = request.args.get('is_walk_in')

    try:
        page  = max(1, int(request.args.get('page', 1)))
        limit = max(1, min(int(request.args.get('limit', 25)), 200))
    except (ValueError, TypeError):
        return jsonify({'error': 'page and limit must be integers'}), 400

    query = (
        db.session.query(Bill, Patient)
        .join(Patient, Bill.patient_id == Patient.patient_id, isouter=True)
        .order_by(Bill.created_at.desc())
    )

    if date_from:
        try:
            query = query.filter(func.date(Bill.created_at) >= date_from)
        except Exception:
            return jsonify({'error': 'Invalid date_from format, expected YYYY-MM-DD'}), 400

    if date_to:
        try:
            query = query.filter(func.date(Bill.created_at) <= date_to)
        except Exception:
            return jsonify({'error': 'Invalid date_to format, expected YYYY-MM-DD'}), 400

    if payment_type:
        query = query.filter(Bill.payment_type == payment_type.upper())

    if patient_id:
        query = query.filter(Bill.patient_id == patient_id)

    if is_walk_in == 'true':
        query = query.filter(Bill.patient_id.is_(None))
    elif is_walk_in == 'false':
        query = query.filter(Bill.patient_id.isnot(None))

    created_by = request.args.get('created_by')
    if created_by and created_by != 'all':
        if g.current_user.get('role') == 'doctor':
            from models import DoctorStaffAssignment
            assignment = DoctorStaffAssignment.query.filter_by(
                doctor_id=g.current_user['user_id'],
                staff_id=created_by
            ).first()
            if not assignment:
                return jsonify({'error': 'Staff not assigned to you'}), 403
        query = query.filter(Bill.created_by_user_id == created_by)

    total = query.count()
    rows  = query.offset((page - 1) * limit).limit(limit).all()

    bills = []
    for b, p in rows:
        bills.append({
            'invoice_id':   b.invoice_id,
            'date':         b.created_at.strftime('%Y-%m-%d %H:%M'),
            'patient_name': p.name if p else (b.walk_in_name or 'Walk-in'),
            'patient_id':   b.patient_id,
            'is_walk_in':   b.patient_id is None,
            'total_amount': float(b.total_amount),
            'payment_type': b.payment_type,
            'visit_id':     b.visit_id,
        })

    return jsonify({
        'bills':  bills,
        'total':  total,
        'page':   page,
        'limit':  limit,
        'pages':  math.ceil(total / limit) if total else 0,
    }), 200

@billing.route('/billing/patient/<patient_id>', methods=['GET'])
@require_auth
def get_patient_billing_history(patient_id):
    bills = Bill.query.filter_by(patient_id=patient_id).order_by(Bill.created_at.desc()).all()
    results = []
    for b in bills:
        results.append({
            'invoice_id': b.invoice_id,
            'visit_id': b.visit_id,
            'date': b.created_at.strftime('%Y-%m-%d %H:%M'),
            'total_amount': float(b.total_amount),
            'payment_type': b.payment_type
        })
    return jsonify(results), 200

@billing.route('/billing/<invoice_id>', methods=['GET'])
@require_auth
def get_bill_details(invoice_id):
    bill = Bill.query.get_or_404(invoice_id)
    patient = Patient.query.get(bill.patient_id) if bill.patient_id else None
    items = BillItem.query.filter_by(bill_id=invoice_id).all()

    reference_name = None
    if patient and patient.reference_patient_id:
        ref_patient = Patient.query.get(patient.reference_patient_id)
        reference_name = ref_patient.name if ref_patient else None

    # Bulk-load ProductMaster rows for O(1) lookup in the loop
    product_ids = [i.product_id for i in items if i.product_id]
    products_map = {}
    if product_ids:
        masters = ProductMaster.query.filter(ProductMaster.id.in_(product_ids)).all()
        products_map = {m.id: m for m in masters}

    item_list = []
    for i in items:
        master = products_map.get(i.product_id)
        item_list.append({
            'item_name': i.item_name,
            'batch_number': i.batch_number,
            'expiry_date': i.expiry_date.strftime('%Y-%m-%d') if i.expiry_date else None,
            'quantity': i.quantity,
            'mrp': float(i.mrp) if i.mrp else 0,
            'gst_rate': float(i.gst_rate) if i.gst_rate else 0,
            'total_value': float(i.total_value) if i.total_value else 0,
            'hsn_code': master.hsn_code if master else None,
            'manufacturer': master.manufacturer if master else None,
            'pack_size': master.pack_size if master else None,
        })

    return jsonify({
        'invoice_id': bill.invoice_id,
        'created_at': bill.created_at.strftime('%Y-%m-%d %H:%M'),
        'patient': {
            'name': patient.name if patient else (bill.walk_in_name or 'Walk-in Customer'),
            'phone': patient.phone_number if patient else '',
            'id': bill.patient_id,
            'age': patient.age if patient else bill.walk_in_age,
            'sex': patient.sex if patient else bill.walk_in_sex,
            'reference': reference_name,
        },
        'is_walk_in': bill.patient_id is None,
        'payment_type': bill.payment_type,
        'subtotal_amount': float(bill.subtotal_amount) if bill.subtotal_amount is not None else float(bill.total_amount),
        'discount_type': bill.discount_type,
        'discount_value': float(bill.discount_value) if bill.discount_value is not None else None,
        'total_amount': float(bill.total_amount),
        'items': item_list
    }), 200

@billing.route('/billing/<invoice_id>', methods=['DELETE'])
@require_auth
def delete_bill(invoice_id):
    if g.current_user.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized. Only admins can delete bills.'}), 403

    bill = Bill.query.get(invoice_id)
    if not bill:
        return jsonify({'error': 'Bill not found'}), 404

    # 1. Unlink associated Visit if present
    if bill.visit_id:
        visit = Visit.query.get(bill.visit_id)
        if visit:
            visit.invoice_id = None
            visit.status = 'in_progress'

    # Also check other visits that might reference this invoice_id
    visits = Visit.query.filter_by(invoice_id=invoice_id).all()
    for v in visits:
        v.invoice_id = None
        v.status = 'in_progress'

    # 2. Revert inventory stock deductions
    bill_items = BillItem.query.filter_by(bill_id=invoice_id).all()
    for item in bill_items:
        # Get multiplier for pack size
        multiplier = 1
        product_master = ProductMaster.query.get(item.product_id)
        if product_master and product_master.pack_size:
            pack = product_master.pack_size.lower()
            if 's' in pack or 'x' in pack:
                import re
                match = re.search(r'(\d+)', pack)
                if match:
                    try:
                        multiplier = int(match.group(1))
                    except:
                        multiplier = 1

        is_ea = False
        if item.batch_number and '|ea' in item.batch_number:
            is_ea = True

        qty_to_restore = float(item.quantity)
        if is_ea and multiplier > 1:
            qty_to_restore = qty_to_restore / multiplier

        # Find the specific batch to restore stock to
        if item.batch_id:
            batch = InventoryBatch.query.get(item.batch_id)
            if batch:
                batch.quantity = float(batch.quantity) + qty_to_restore
        else:
            # Fallback: find any batch for this product
            batch = InventoryBatch.query.filter_by(product_id=item.product_id).first()
            if batch:
                batch.quantity = float(batch.quantity) + qty_to_restore

    # 3. Delete inventory history records
    InventoryHistory.query.filter_by(bill_id=invoice_id).delete()

    # 4. Delete bill items
    BillItem.query.filter_by(bill_id=invoice_id).delete()

    # 5. Delete the Bill itself
    db.session.delete(bill)
    db.session.commit()

    log_activity(
        action='DELETE',
        resource_type='bill',
        resource_id=invoice_id,
        resource_label=invoice_id,
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': f'Bill {invoice_id} successfully deleted and stock restored.'}), 200

