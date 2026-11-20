"""Stock transfers between clinics (locations).

Moving N units of an item from clinic A to clinic B takes them from A's
batches oldest-expiry-first (same rule as billing) and adds them to B as the
same batch (same batch no / expiry / MRP / cost / purchase invoice) — merged
into an existing identical batch at B, or a new copy of the batch. Because
stock value everywhere is computed as batch MRP × quantity, the value moves
with the units automatically: A loses qty × MRP, B gains exactly the same.

Quantities are in stored units (packs, the same unit as
InventoryBatch.quantity); the frontend converts from the displayed count.
"""
import secrets
from decimal import Decimal, ROUND_HALF_UP

from flask import Blueprint, request, jsonify, g
from sqlalchemy import or_

from extensions import db, get_ist_now
from models import (
    InventoryBatch, InventoryHistory, Location, ProductMaster,
    StockTransfer, StockTransferItem,
)
from .auth import require_auth, log_activity

transfers = Blueprint('transfers', __name__)

# Stored quantities are Numeric(10, 2); anything below this is rounding noise.
QTY_EPS = Decimal('0.005')
UNASSIGNED = 'unassigned'


def _q2(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _location_filter(location_id):
    """location_id None -> legacy stock with no clinic; else that clinic."""
    if location_id is None:
        return InventoryBatch.location_id.is_(None)
    return InventoryBatch.location_id == location_id


def _parse_from_location(raw):
    """'unassigned' -> None (legacy stock), else an active Location id."""
    if raw == UNASSIGNED:
        return None, None
    try:
        loc_id = int(raw)
    except (TypeError, ValueError):
        return None, 'from_location_id is required'
    loc = db.session.get(Location, loc_id)
    if not loc:
        return None, 'Source clinic not found'
    return loc_id, None


def _plan(data, lock=False):
    """Validate a transfer request and work out exactly which batch portions
    move. Returns (plan, error). Shared by preview and create so the preview
    always matches what create will do."""
    from_location_id, err = _parse_from_location(data.get('from_location_id'))
    if err:
        return None, err

    try:
        to_location_id = int(data.get('to_location_id'))
    except (TypeError, ValueError):
        return None, 'to_location_id is required'
    to_loc = db.session.get(Location, to_location_id)
    if not to_loc or not to_loc.is_active:
        return None, 'Destination clinic not found or inactive'
    if from_location_id == to_location_id:
        return None, 'Source and destination clinic must be different'

    raw_items = data.get('items') or []
    if not raw_items:
        return None, 'Add at least one item to transfer'

    # Merge duplicate rows of the same product.
    requested = {}
    for it in raw_items:
        pid = it.get('product_id')
        try:
            qty = _q2(it.get('quantity'))
        except Exception:
            return None, 'Each item needs a valid quantity'
        if not pid:
            return None, 'Each item needs a product_id'
        if qty <= 0:
            return None, 'Quantities must be greater than zero'
        requested[pid] = requested.get(pid, Decimal('0')) + qty

    lines = []
    errors = []
    for pid, qty in requested.items():
        product = db.session.get(ProductMaster, pid)
        if not product:
            errors.append(f'Item {pid} not found')
            continue

        q = InventoryBatch.query.filter(
            InventoryBatch.product_id == pid,
            InventoryBatch.quantity > 0,
            _location_filter(from_location_id),
        ).order_by(InventoryBatch.expiry_date.asc().nullslast(), InventoryBatch.id.asc())
        if lock:
            q = q.with_for_update()
        batches = q.all()

        available = sum((Decimal(str(b.quantity)) for b in batches), Decimal('0'))
        if qty > available + QTY_EPS:
            errors.append({
                'product_id': pid,
                'item_name': product.item_name,
                'pack_size': product.pack_size,
                'requested': float(qty),
                'available': float(available),
            })
            continue

        remaining = min(qty, available)
        portions = []
        for b in batches:
            if remaining <= QTY_EPS:
                break
            take = min(Decimal(str(b.quantity)), remaining)
            remaining -= take
            mrp = Decimal(str(b.mrp or 0))
            portions.append({
                'batch': b,
                'batch_id': b.id,
                'batch_number': b.batch_number,
                'expiry_date': b.expiry_date.isoformat() if b.expiry_date else None,
                'mrp': float(mrp),
                'quantity': float(take),
                'value': float(_q2(take * mrp)),
            })
        lines.append({
            'product_id': pid,
            'item_name': product.item_name,
            'pack_size': product.pack_size,
            'quantity': float(qty),
            'available': float(available),
            'value': float(sum((Decimal(str(p['value'])) for p in portions), Decimal('0'))),
            'portions': portions,
        })

    plan = {
        'from_location_id': from_location_id,
        'to_location_id': to_location_id,
        'lines': lines,
        'errors': errors,
        'total_value': float(sum((Decimal(str(l['value'])) for l in lines), Decimal('0'))),
    }
    return plan, None


def _public_plan(plan):
    """Strip ORM objects before returning a plan as JSON."""
    return {
        **{k: v for k, v in plan.items() if k != 'lines'},
        'lines': [
            {**line, 'portions': [{k: v for k, v in p.items() if k != 'batch'} for p in line['portions']]}
            for line in plan['lines']
        ],
    }


def _generate_transfer_number():
    stamp = get_ist_now().strftime('%d%m%y')
    while True:
        number = f'TR-{stamp}-{secrets.token_hex(2).upper()}'
        if not StockTransfer.query.filter_by(transfer_number=number).first():
            return number


def _location_name(location_id, names):
    return names.get(location_id, 'Unassigned stock') if location_id else 'Unassigned stock'


@transfers.route('/inventory/transfers/preview', methods=['POST'])
@require_auth
def preview_transfer():
    plan, err = _plan(request.get_json() or {})
    if err:
        return jsonify({'error': err}), 400
    return jsonify(_public_plan(plan)), 200


@transfers.route('/inventory/transfers', methods=['POST'])
@require_auth
def create_transfer():
    data = request.get_json() or {}
    plan, err = _plan(data, lock=True)
    if err:
        db.session.rollback()
        return jsonify({'error': err}), 400
    if plan['errors']:
        db.session.rollback()
        return jsonify({'error': 'Not enough stock for some items', 'details': plan['errors']}), 400

    names = {l.id: l.name for l in Location.query.all()}
    from_name = _location_name(plan['from_location_id'], names)
    to_name = names.get(plan['to_location_id'])
    user_id = g.current_user.get('user_id')
    username = g.current_user.get('username')
    notes = (data.get('notes') or '').strip() or None

    try:
        transfer = StockTransfer(
            transfer_number=_generate_transfer_number(),
            from_location_id=plan['from_location_id'],
            to_location_id=plan['to_location_id'],
            total_value=_q2(plan['total_value']),
            notes=notes,
            user_id=user_id,
            username=username,
        )
        db.session.add(transfer)
        db.session.flush()
        history_note = f'Transfer {transfer.transfer_number}: {from_name} → {to_name}'

        for line in plan['lines']:
            for p in line['portions']:
                src = p['batch']
                take = Decimal(str(p['quantity']))

                # Same batch already at the destination? Merge into it.
                dest = InventoryBatch.query.filter(
                    InventoryBatch.product_id == src.product_id,
                    InventoryBatch.location_id == plan['to_location_id'],
                    InventoryBatch.batch_number.is_(None) if src.batch_number is None else InventoryBatch.batch_number == src.batch_number,
                    InventoryBatch.expiry_date.is_(None) if src.expiry_date is None else InventoryBatch.expiry_date == src.expiry_date,
                    InventoryBatch.mrp.is_(None) if src.mrp is None else InventoryBatch.mrp == src.mrp,
                    InventoryBatch.purchase_rate.is_(None) if src.purchase_rate is None else InventoryBatch.purchase_rate == src.purchase_rate,
                    InventoryBatch.purchase_invoice_number.is_(None) if src.purchase_invoice_number is None else InventoryBatch.purchase_invoice_number == src.purchase_invoice_number,
                ).with_for_update().first()
                if dest is None:
                    dest = InventoryBatch(
                        product_id=src.product_id,
                        purchase_invoice_number=src.purchase_invoice_number,
                        batch_number=src.batch_number,
                        expiry_date=src.expiry_date,
                        mrp=src.mrp,
                        purchase_rate=src.purchase_rate,
                        gst_rate=src.gst_rate,
                        gst_amount=0,
                        quantity=0,
                        # Not a purchase: keep initial/free at 0 so purchase
                        # history isn't double-counted.
                        initial_quantity=0,
                        free_quantity=0,
                        created_by_user_id=user_id,
                        location_id=plan['to_location_id'],
                    )
                    db.session.add(dest)
                    db.session.flush()

                src.quantity = _q2(Decimal(str(src.quantity)) - take)
                dest.quantity = _q2(Decimal(str(dest.quantity or 0)) + take)

                db.session.add(StockTransferItem(
                    transfer_id=transfer.id,
                    product_id=src.product_id,
                    item_name=line['item_name'],
                    from_batch_id=src.id,
                    to_batch_id=dest.id,
                    batch_number=src.batch_number,
                    expiry_date=src.expiry_date,
                    mrp=src.mrp,
                    quantity=take,
                    value=_q2(p['value']),
                ))
                db.session.add(InventoryHistory(
                    product_id=src.product_id, batch_id=src.id, change_amount=-take,
                    type='TRANSFER_OUT', notes=history_note, user_id=user_id, username=username,
                ))
                db.session.add(InventoryHistory(
                    product_id=src.product_id, batch_id=dest.id, change_amount=take,
                    type='TRANSFER_IN', notes=history_note, user_id=user_id, username=username,
                ))

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Transfer failed: {e}'}), 500

    log_activity(
        action='TRANSFER',
        resource_type='inventory',
        resource_id=transfer.transfer_number,
        resource_label=f'{from_name} → {to_name}',
        details=f"{len(plan['lines'])} item(s), value ₹{plan['total_value']:.2f}",
        user_id=user_id,
        username=username,
        ip_address=request.remote_addr,
    )

    return jsonify({
        'message': 'Stock transferred',
        'transfer_number': transfer.transfer_number,
        'total_value': plan['total_value'],
    }), 201


@transfers.route('/inventory/transfers', methods=['GET'])
@require_auth
def list_transfers():
    """Transfer slips, newest first. ?location_id=N limits to transfers into
    or out of that clinic."""
    q = StockTransfer.query.order_by(StockTransfer.created_at.desc())
    loc = request.args.get('location_id')
    if loc and loc.isdigit():
        loc_id = int(loc)
        q = q.filter(or_(StockTransfer.from_location_id == loc_id, StockTransfer.to_location_id == loc_id))
    names = {l.id: l.name for l in Location.query.all()}

    result = []
    for t in q.limit(500).all():
        # Collapse batch portions back to one row per product.
        per_product = {}
        for it in t.items:
            row = per_product.setdefault(it.product_id, {
                'product_id': it.product_id, 'item_name': it.item_name,
                'quantity': 0.0, 'value': 0.0, 'batches': [],
            })
            row['quantity'] += float(it.quantity)
            row['value'] += float(it.value or 0)
            row['batches'].append({
                'batch_number': it.batch_number,
                'expiry_date': it.expiry_date.isoformat() if it.expiry_date else None,
                'mrp': float(it.mrp or 0),
                'quantity': float(it.quantity),
            })
        pack_sizes = {p.id: p.pack_size for p in ProductMaster.query.filter(ProductMaster.id.in_(list(per_product))).all()} if per_product else {}
        for pid, row in per_product.items():
            row['pack_size'] = pack_sizes.get(pid)
            row['value'] = round(row['value'], 2)
        result.append({
            'transfer_number': t.transfer_number,
            'from_location_id': t.from_location_id,
            'from_location_name': _location_name(t.from_location_id, names),
            'to_location_id': t.to_location_id,
            'to_location_name': names.get(t.to_location_id),
            'total_value': float(t.total_value or 0),
            'notes': t.notes,
            'created_at': t.created_at.isoformat() if t.created_at else None,
            'username': t.username,
            'items': list(per_product.values()),
        })
    return jsonify(result), 200


@transfers.route('/inventory/transfers/stock', methods=['GET'])
@require_auth
def transfer_stock_search():
    """Item search for the transfer form, scoped to the SOURCE clinic:
    ?location_id=N|unassigned&q=text. Only items with stock there."""
    from_location_id, err = _parse_from_location(request.args.get('location_id'))
    if err:
        return jsonify({'error': err}), 400
    text = (request.args.get('q') or '').strip().lower()

    q = db.session.query(
        ProductMaster.id, ProductMaster.item_name, ProductMaster.pack_size, ProductMaster.manufacturer,
        db.func.sum(InventoryBatch.quantity).label('qty'),
        db.func.sum(InventoryBatch.quantity * InventoryBatch.mrp).label('value'),
    ).join(InventoryBatch, InventoryBatch.product_id == ProductMaster.id).filter(
        InventoryBatch.quantity > 0,
        _location_filter(from_location_id),
    )
    if text:
        q = q.filter(or_(
            db.func.lower(ProductMaster.item_name).contains(text),
            db.func.lower(ProductMaster.manufacturer).contains(text),
            db.func.lower(ProductMaster.id).contains(text),
        ))
    rows = q.group_by(ProductMaster.id, ProductMaster.item_name, ProductMaster.pack_size, ProductMaster.manufacturer) \
        .order_by(ProductMaster.item_name.asc()).limit(30).all()

    return jsonify([{
        'product_id': r.id,
        'item_name': r.item_name,
        'pack_size': r.pack_size,
        'manufacturer': r.manufacturer,
        'quantity': float(r.qty or 0),
        'value': round(float(r.value or 0), 2),
    } for r in rows]), 200


@transfers.route('/inventory/transfers/has-unassigned', methods=['GET'])
@require_auth
def has_unassigned_stock():
    """Whether any in-stock batch has no clinic — the transfer form only
    offers 'Unassigned stock' as a source when this is true."""
    exists = db.session.query(InventoryBatch.id).filter(
        InventoryBatch.location_id.is_(None), InventoryBatch.quantity > 0
    ).first() is not None
    return jsonify({'has_unassigned': exists}), 200
