
from flask import Blueprint, request, jsonify
from extensions import db, get_ist_now
from models import Bill, BillItem, Patient, Visit, ProductMaster, InventoryBatch, InventoryHistory
from sqlalchemy import func
from utils import generate_invoice_id

billing = Blueprint('billing', __name__)

@billing.route('/billing', methods=['POST'])
def create_bill():
    data = request.get_json()
    
    if not data.get('patient_id'):
         return jsonify({'error': 'Patient ID is required'}), 400
         
    items_used = data.get('items_used', [])
    if not items_used:
        return jsonify({'error': 'No items in bill'}), 400

    patient = Patient.query.filter_by(patient_id=data['patient_id']).first()
    if not patient:
        return jsonify({'error': 'Patient not found'}), 404
    
    invoice_id = generate_invoice_id()
    
    new_bill = Bill(
        invoice_id=invoice_id,
        patient_id=patient.patient_id,
        visit_id=data.get('visit_id'),
        payment_type=data.get('payment_type', 'CASH'),
        total_amount=0 
    )
    db.session.add(new_bill)
    db.session.flush() 
    
    if data.get('visit_id'):
        visit = Visit.query.get(data['visit_id'])
        if visit:
            visit.invoice_id = invoice_id
            visit.status = 'done' 
    
    total_calc_amount = 0
    
    for item in items_used:
        master_id = item.get('item_id')
        qty_needed = int(item.get('quantity', 0))
        
        if qty_needed <= 0: continue
        
        product_master = ProductMaster.query.get(master_id)
        if not product_master: continue 
        
        batches = InventoryBatch.query.filter(
            InventoryBatch.product_id == master_id,
            InventoryBatch.quantity > 0
        ).order_by(InventoryBatch.expiry_date.asc()).all()
        
        remaining_to_deduct = qty_needed
        
        target_batches = []
        if batches:
             target_batches = batches

        for batch in target_batches:
            if remaining_to_deduct <= 0: break
            
            take = min(batch.quantity, remaining_to_deduct)
            
            batch.quantity -= take
            remaining_to_deduct -= take
            
            unit_price = float(batch.mrp) if batch.mrp else 0
            line_total = unit_price * take
            total_calc_amount += line_total
            
            bill_item = BillItem(
                bill_id=invoice_id,
                product_id=master_id,
                batch_id=batch.id,
                item_name=product_master.item_name,
                batch_number=batch.batch_number,
                expiry_date=batch.expiry_date,
                quantity=take,
                mrp=batch.mrp,
                gst_rate=product_master.gst_rate,
                total_value=line_total
            )
            db.session.add(bill_item)
            
            history = InventoryHistory(
                product_id=master_id,
                batch_id=batch.id,
                bill_id=invoice_id,
                change_amount=-take,
                type='SALE',
                notes=f"Billed Invoice {invoice_id}"
            )
            db.session.add(history)

    if 'total_amount' in data:
         new_bill.total_amount = total_calc_amount
    else:
         new_bill.total_amount = total_calc_amount

    db.session.commit()
    return jsonify({'message': 'Bill created', 'invoice_id': invoice_id, 'total': total_calc_amount}), 201

@billing.route('/billing/history', methods=['GET'])
def get_billing_history():
    bills = Bill.query.order_by(Bill.created_at.desc()).limit(50).all()
    results = []
    for b in bills:
        p = Patient.query.get(b.patient_id)
        results.append({
            'invoice_id': b.invoice_id,
            'date': b.created_at.strftime('%Y-%m-%d %H:%M'),
            'patient_name': p.name if p else 'Unknown',
            'patient_id': b.patient_id,
            'total_amount': float(b.total_amount),
            'payment_type': b.payment_type
        })
    return jsonify(results), 200

@billing.route('/billing/patient/<patient_id>', methods=['GET'])
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
def get_bill_details(invoice_id):
    bill = Bill.query.get_or_404(invoice_id)
    patient = Patient.query.get(bill.patient_id)
    items = BillItem.query.filter_by(bill_id=invoice_id).all()
    
    item_list = []
    for i in items:
        item_list.append({
            'item_name': i.item_name,
            'batch_number': i.batch_number,
            'expiry_date': i.expiry_date.strftime('%Y-%m-%d') if i.expiry_date else None,
            'quantity': i.quantity,
            'mrp': float(i.mrp) if i.mrp else 0,
            'gst_rate': float(i.gst_rate) if i.gst_rate else 0,
            'total_value': float(i.total_value) if i.total_value else 0
        })
        
    return jsonify({
        'invoice_id': bill.invoice_id,
        'created_at': bill.created_at.strftime('%Y-%m-%d %H:%M'),
        'patient': {
            'name': patient.name if patient else 'Unknown',
            'phone': patient.phone_number if patient else '',
            'id': bill.patient_id
        },
        'payment_type': bill.payment_type,
        'total_amount': float(bill.total_amount),
        'items': item_list
    }), 200
