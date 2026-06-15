from flask import Blueprint, request, jsonify
from sqlalchemy import func
from extensions import db
from models import Location, User, Visit, Bill, PurchaseInvoice, ExpenseLedger, InventoryBatch
from routes.auth import require_auth, require_admin

locations_bp = Blueprint('locations', __name__)


@locations_bp.route('/admin/locations', methods=['GET'])
@require_auth
def list_locations():
    locs = Location.query.order_by(Location.name).all()
    return jsonify([{
        'id': l.id,
        'name': l.name,
        'is_active': l.is_active,
    } for l in locs])


@locations_bp.route('/admin/locations', methods=['POST'])
@require_auth
@require_admin
def create_location():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    if Location.query.filter(func.lower(Location.name) == name.lower()).first():
        return jsonify({'error': 'A location with this name already exists'}), 409
    loc = Location(name=name)
    db.session.add(loc)
    db.session.commit()
    return jsonify({'id': loc.id, 'name': loc.name, 'is_active': loc.is_active}), 201


@locations_bp.route('/admin/locations/<int:loc_id>', methods=['PATCH'])
@require_auth
@require_admin
def update_location(loc_id):
    loc = db.session.get(Location, loc_id)
    if not loc:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(silent=True) or {}
    if 'name' in data:
        name = (data['name'] or '').strip()
        if not name:
            return jsonify({'error': 'name cannot be empty'}), 400
        duplicate = Location.query.filter(
            func.lower(Location.name) == name.lower(),
            Location.id != loc_id
        ).first()
        if duplicate:
            return jsonify({'error': 'A location with this name already exists'}), 409
        loc.name = name
    if 'is_active' in data:
        loc.is_active = bool(data['is_active'])
    db.session.commit()
    return jsonify({'id': loc.id, 'name': loc.name, 'is_active': loc.is_active})


@locations_bp.route('/admin/locations/<int:loc_id>', methods=['DELETE'])
@require_auth
@require_admin
def delete_location(loc_id):
    loc = db.session.get(Location, loc_id)
    if not loc:
        return jsonify({'error': 'Not found'}), 404
    refs = (
        User.query.filter_by(location_id=loc_id).count() +
        Visit.query.filter_by(location_id=loc_id).count() +
        Bill.query.filter_by(location_id=loc_id).count() +
        PurchaseInvoice.query.filter_by(location_id=loc_id).count() +
        ExpenseLedger.query.filter_by(location_id=loc_id).count() +
        InventoryBatch.query.filter_by(location_id=loc_id).count()
    )
    if refs > 0:
        return jsonify({
            'error': f'Cannot delete: {refs} record(s) reference this location. Deactivate it instead.'
        }), 409
    db.session.delete(loc)
    db.session.commit()
    return jsonify({'ok': True})
