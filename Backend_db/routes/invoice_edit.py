"""Editing a saved purchase invoice (doctor/admin only).

PUT /inventory/invoices/<invoice_number>/edit changes the invoice header
(vendor, GST number, invoice number, invoice date, total) and its lines in
one go:

- Changed line: batch no / expiry / MRP / rate / GST are updated (and copied
  to any stock-transfer copies of the batch at other clinics -- it's the same
  physical batch). A quantity change moves current stock by the difference,
  but can't go below what has already been sold/moved out of the batch.
- Removed line: only if none of it has been used (nothing sold, moved or
  adjusted). Its stock is taken back out.
- New line: added like on invoice entry (existing item, or a new one).

Every stock change is written to the item's inventory history.
"""
from decimal import Decimal, InvalidOperation

from flask import Blueprint, request, jsonify, g
from sqlalchemy import func

from extensions import db
from models import (
    PurchaseInvoice, InventoryBatch, InventoryHistory, ProductMaster, BillItem,
    StockTransferItem,
)
from utils import parse_expiry_date, normalize_pack_size
from .auth import require_auth, require_doctor, log_activity
from .vendors import get_or_create_vendor

invoice_edit = Blueprint('invoice_edit', __name__)

EPS = Decimal('0.005')


class EditError(Exception):
    pass


def _dec(value, label, allow_blank=True):
    if value is None or str(value).strip() == '':
        if allow_blank:
            return Decimal(0)
        raise EditError(f'{label} is required')
    try:
        d = Decimal(str(value).strip())
    except InvalidOperation:
        raise EditError(f'{label}: "{value}" is not a number')
    if d < 0:
        raise EditError(f'{label} can\'t be negative')
    return d


def _fmt(d):
    d = Decimal(d or 0)
    return f'{d:.2f}'.rstrip('0').rstrip('.') if d != d.to_integral() else str(int(d))


def _copies_of(batch_id):
    """Stock-transfer copies of a batch at other clinics."""
    ids = [tid for (tid,) in db.session.query(StockTransferItem.to_batch_id)
           .filter(StockTransferItem.from_batch_id == batch_id,
                   StockTransferItem.to_batch_id.isnot(None)).distinct()]
    if not ids:
        return []
    return [b for b in InventoryBatch.query.filter(InventoryBatch.id.in_(ids)).all()
            if not b.initial_quantity]


def _transfer_copy_ids(batches):
    ids = [b.id for b in batches if not b.initial_quantity]
    if not ids:
        return set()
    return {bid for (bid,) in db.session.query(StockTransferItem.to_batch_id)
            .filter(StockTransferItem.to_batch_id.in_(ids)).distinct()}


def _history(product_id, batch_id, invoice_no, change, kind, note):
    db.session.add(InventoryHistory(
        product_id=product_id, batch_id=batch_id, purchase_invoice_number=invoice_no,
        change_amount=change, type=kind, notes=note,
        user_id=g.current_user.get('user_id'), username=g.current_user.get('username'),
    ))


def _line_fields(line, label):
    qty = _dec(line.get('qty'), f'{label}: Qty')
    free = _dec(line.get('free'), f'{label}: Free')
    if qty + free <= 0:
        raise EditError(f'{label}: quantity must be more than 0')
    gst = _dec(line.get('gst'), f'{label}: GST')
    if gst >= 100:
        raise EditError(f'{label}: GST must be under 100%')
    expiry_raw = (line.get('expiry') or '').strip()
    try:
        expiry = parse_expiry_date(expiry_raw) if expiry_raw else None
    except ValueError:
        raise EditError(f'{label}: expiry "{expiry_raw}" not understood (use MM/YY)')
    if expiry_raw and expiry is None:
        raise EditError(f'{label}: expiry "{expiry_raw}" not understood (use MM/YY)')
    return {
        'qty': qty, 'free': free, 'total': qty + free,
        'mrp': _dec(line.get('mrp'), f'{label}: MRP'),
        'rate': _dec(line.get('rate'), f'{label}: Rate'),
        'gst': gst,
        'expiry': expiry,
        'batch_number': (line.get('batch_number') or '').strip() or None,
    }


def _product_for_new_line(line, label):
    """Existing item by id, else by name + pack, else a new item --
    same rule as invoice entry."""
    pid = (line.get('product_id') or '').strip()
    if pid:
        item = db.session.get(ProductMaster, pid)
        if not item:
            raise EditError(f'{label}: item {pid} not found')
        return item, False
    name = ' '.join((line.get('product_name') or '').split())
    if not name:
        raise EditError(f'{label}: item name is required')
    pack = normalize_pack_size(line.get('pack_size') or '')
    q = ProductMaster.query.filter(func.lower(ProductMaster.item_name) == name.lower())
    if pack:
        q = q.filter(ProductMaster.pack_size == pack)
    item = q.first()
    if item:
        return item, False
    item = ProductMaster(
        id=ProductMaster.generate_item_id(), item_name=name[:100], category='',
        manufacturer=(line.get('manufacturer') or '').strip()[:100],
        pack_size=pack, hsn_code=(line.get('hsn_code') or '').strip()[:20],
        min_stock_override=False,
    )
    db.session.add(item)
    db.session.flush()
    return item, True


def _rename_invoice(inv, new_no):
    """Invoice number is the primary key: copy the row under the new number,
    repoint batches and history, drop the old row."""
    old_no = inv.invoice_number
    cols = {c.key: getattr(inv, c.key) for c in PurchaseInvoice.__mapper__.column_attrs}
    cols['invoice_number'] = new_no
    new_inv = PurchaseInvoice(**cols)
    db.session.add(new_inv)
    db.session.flush()
    InventoryBatch.query.filter_by(purchase_invoice_number=old_no).update(
        {InventoryBatch.purchase_invoice_number: new_no}, synchronize_session=False)
    InventoryHistory.query.filter_by(purchase_invoice_number=old_no).update(
        {InventoryHistory.purchase_invoice_number: new_no}, synchronize_session=False)
    db.session.flush()
    db.session.delete(inv)
    db.session.flush()
    return new_inv


@invoice_edit.route('/inventory/invoices/<invoice_number>/edit', methods=['PUT'])
@require_auth
@require_doctor
def edit_invoice(invoice_number):
    inv = db.session.get(PurchaseInvoice, invoice_number)
    if not inv:
        return jsonify({'error': 'Invoice not found'}), 404
    data = request.get_json() or {}
    header = data.get('header') or {}
    lines = data.get('lines') or []
    deleted_ids = {int(i) for i in (data.get('deleted_batch_ids') or []) if str(i).isdigit()}

    changes = []
    try:
        batches = InventoryBatch.query.filter_by(purchase_invoice_number=invoice_number).all()
        copies = _transfer_copy_ids(batches)
        own = {b.id: b for b in batches if b.id not in copies}
        products = {p.id: p for p in ProductMaster.query.filter(
            ProductMaster.id.in_({b.product_id for b in own.values()})).all()} if own else {}

        def name_of(b):
            p = products.get(b.product_id)
            return p.item_name if p else b.product_id

        # ── Removed lines ────────────────────────────────────────────────
        for bid in deleted_ids:
            b = own.get(bid)
            if not b:
                raise EditError('A removed line is not on this invoice -- reload and try again')
            initial = Decimal(b.initial_quantity or 0)
            remaining = Decimal(b.quantity or 0)
            moved = db.session.query(StockTransferItem.id).filter(
                StockTransferItem.from_batch_id == b.id).first()
            billed = db.session.query(BillItem.id).filter(BillItem.batch_id == b.id).first()
            if abs(initial - remaining) > EPS or moved or billed:
                raise EditError(f'{name_of(b)}: can\'t remove this line -- some of it has already been '
                                f'sold, moved or adjusted. Change its quantity instead.')
            _history(b.product_id, None, invoice_number, -remaining, 'ADJUSTMENT',
                     f'Invoice {invoice_number} edited: line removed (batch {b.batch_number or "-"}, '
                     f'qty {_fmt(initial)})')
            InventoryHistory.query.filter_by(batch_id=b.id).update(
                {InventoryHistory.batch_id: None}, synchronize_session=False)
            changes.append(f'removed {name_of(b)}')
            db.session.delete(b)

        # ── Changed and new lines ────────────────────────────────────────
        kept = 0
        for n, line in enumerate(lines, start=1):
            bid = line.get('batch_id')
            if bid:
                b = own.get(int(bid))
                if not b or b.id in deleted_ids:
                    raise EditError(f'Line {n} is not on this invoice -- reload and try again')
                label = name_of(b)
                f = _line_fields(line, label)
                old_total = Decimal(b.initial_quantity or b.quantity or 0)
                remaining = Decimal(b.quantity or 0)
                used = old_total - remaining
                delta = f['total'] - old_total
                if abs(delta) > EPS:
                    if f['total'] + EPS < used:
                        raise EditError(f'{label}: {_fmt(used)} already sold/moved from this batch, '
                                        f'so the quantity can\'t go below {_fmt(used)}')
                    b.quantity = max(Decimal(0), remaining + delta)
                    _history(b.product_id, b.id, invoice_number, delta, 'ADJUSTMENT',
                             f'Invoice {invoice_number} edited: qty {_fmt(old_total)} → {_fmt(f["total"])}')
                    changes.append(f'{label} qty {_fmt(old_total)}→{_fmt(f["total"])}')
                b.initial_quantity = f['total']
                b.free_quantity = f['free']
                detail = []
                for attr, key in (('batch_number', 'batch_number'), ('expiry_date', 'expiry'),
                                  ('mrp', 'mrp'), ('purchase_rate', 'rate'), ('gst_rate', 'gst')):
                    old = getattr(b, attr)
                    new = f[key]
                    same = (Decimal(old or 0) == new) if isinstance(new, Decimal) else (old == new)
                    if not same:
                        detail.append(attr)
                        setattr(b, attr, new)
                        for c in _copies_of(b.id):
                            setattr(c, attr, new)
                if detail:
                    changes.append(f'{label} {", ".join(detail)}')
                kept += 1
            else:
                label = (line.get('product_name') or f'New line {n}').strip()
                f = _line_fields(line, label)
                item, created = _product_for_new_line(line, label)
                nb = InventoryBatch(
                    product_id=item.id, purchase_invoice_number=invoice_number,
                    batch_number=f['batch_number'], quantity=f['total'], initial_quantity=f['total'],
                    free_quantity=f['free'], mrp=f['mrp'], purchase_rate=f['rate'],
                    gst_rate=f['gst'], expiry_date=f['expiry'], location_id=inv.location_id,
                    created_by_user_id=g.current_user.get('user_id'),
                )
                db.session.add(nb)
                db.session.flush()
                _history(item.id, nb.id, invoice_number, f['total'], 'PURCHASE',
                         f'Invoice {invoice_number} edited: line added (batch {f["batch_number"] or "-"})')
                changes.append(f'added {item.item_name}' + (' (new item)' if created else ''))
                kept += 1

        if kept == 0:
            raise EditError('An invoice needs at least one line')

        # ── Header ───────────────────────────────────────────────────────
        if 'vendor_name' in header:
            vname = ' '.join((header.get('vendor_name') or '').split())[:100]
            if vname != (inv.vendor_name or ''):
                changes.append(f'vendor "{inv.vendor_name or ""}"→"{vname}"')
                inv.vendor_name = vname
            vendor = get_or_create_vendor(vname, header.get('gst_number')) if vname else None
            inv.vendor_id = vendor.id if vendor else None
        if 'gst_number' in header:
            gst = (header.get('gst_number') or '').strip()[:50]
            if gst != (inv.gst_number or ''):
                changes.append('GST number')
                inv.gst_number = gst
        if 'invoice_date' in header:
            from datetime import datetime as _dt
            raw = (header.get('invoice_date') or '').strip()
            try:
                new_date = _dt.strptime(raw, '%Y-%m-%d').date() if raw else None
            except ValueError:
                raise EditError('Invoice date must be YYYY-MM-DD')
            if new_date != inv.invoice_date:
                changes.append('invoice date')
                inv.invoice_date = new_date
        if 'total_amount' in header:
            total = _dec(header.get('total_amount'), 'Total amount', allow_blank=False)
            if Decimal(inv.total_amount or 0) != total:
                changes.append(f'total ₹{_fmt(inv.total_amount)}→₹{_fmt(total)}')
                inv.total_amount = total

        new_no = ' '.join((header.get('invoice_number') or invoice_number).split())[:50]
        if not new_no:
            raise EditError('Invoice number is required')
        if new_no != invoice_number:
            if db.session.get(PurchaseInvoice, new_no):
                raise EditError(f'Invoice number {new_no} is already used by another invoice')
            inv = _rename_invoice(inv, new_no)
            changes.append(f'invoice no {invoice_number}→{new_no}')

        db.session.commit()
    except EditError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Could not save invoice: {e}'}), 500

    log_activity(
        action='UPDATE', resource_type='purchase_invoice', resource_id=inv.invoice_number,
        resource_label=f"{inv.vendor_name or 'Unknown Vendor'} — {inv.invoice_number}",
        user_id=g.current_user.get('user_id'), username=g.current_user.get('username'),
        ip_address=request.remote_addr,
        details=('Edited: ' + '; '.join(changes))[:1000] if changes else 'Edited: no changes',
    )
    return jsonify({
        'message': 'Invoice updated' if changes else 'No changes',
        'invoice_number': inv.invoice_number,
        'changes': changes,
    }), 200
