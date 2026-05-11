from flask import Blueprint, request, jsonify
from models import ExpenseLedger
from extensions import db, get_ist_now
from datetime import datetime

ledger = Blueprint('ledger', __name__)

@ledger.route('/ledger', methods=['POST'])
def create_expense():
    data = request.get_json()
    if not data or 'title' not in data or 'amount' not in data:
        return jsonify({'error': 'Missing required title or amount'}), 400

    new_expense = ExpenseLedger(
        title=data['title'],
        amount=float(data['amount']),
        category=data.get('category', 'Generic'),
        frequency=data.get('frequency', 'one-time'),
        location=data.get('location', 'Main'),
        receipt_path=data.get('receipt_path'),
        notes=data.get('notes'),
        date=datetime.now().date() # Active instance date
    )
    
    db.session.add(new_expense)
    db.session.commit()
    return jsonify({'message': 'Expense recorded', 'id': new_expense.id}), 201

@ledger.route('/ledger', methods=['GET'])
def get_ledger():
    loc = request.args.get('location')
    page = int(request.args.get('page', 1))
    limit = int(request.args.get('limit', 20))
    
    q = ExpenseLedger.query.order_by(ExpenseLedger.created_at.desc())
    
    if loc and loc != 'all':
        q = q.filter(ExpenseLedger.location == loc)
        
    items = q.offset((page - 1) * limit).limit(limit).all()
    
    results = []
    for i in items:
        results.append({
            'id': i.id,
            'title': i.title,
            'amount': float(i.amount),
            'category': i.category,
            'frequency': i.frequency,
            'date': i.date.isoformat() if i.date else None,
            'location': i.location,
            'created_at': i.created_at.isoformat() if i.created_at else None
        })
    return jsonify(results), 200

@ledger.route('/ledger/<int:item_id>', methods=['DELETE'])
def delete_expense(item_id):
    item = ExpenseLedger.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    return jsonify({'message': 'Entry deleted'}), 200
