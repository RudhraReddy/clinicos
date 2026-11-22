"""Vendors: the suppliers purchase invoices come from.

Each vendor has a profile (name, DL number, GST number, contact, notes) and
links to its purchase invoices through PurchaseInvoice.vendor_id. The vendor
page shows the vendor's invoices, the total of those invoices, how much of
that is still unpaid (invoices with no paid_date), and the items bought from
the vendor.

An invoice's typed vendor name is matched to a vendor by `vendor_key`
(lowercase, letters/digits only). Saving an invoice links it to the matching
vendor, creating the vendor if it's new. CSV-import invoices ("System
Import") are not real vendors and are never linked.
"""
import difflib
import re
from decimal import Decimal

from flask import Blueprint, request, jsonify, g
from sqlalchemy import func

from extensions import db
from models import (
    Vendor, VendorAlias, PurchaseInvoice, InventoryBatch, ProductMaster, Location,
    StockTransferItem,
)
from .auth import require_auth, require_admin, require_doctor, log_activity

vendors = Blueprint('vendors', __name__)

FIELD_LIMITS = {'name': 100, 'dl_number': 100, 'gst_number': 50, 'contact': 200}


def vendor_key(name):
    return re.sub(r'[^a-z0-9]', '', (name or '').lower())[:100]


def clean_name(name):
    return ' '.join((name or '').split())


def _is_csv_invoice(inv):
    return (inv.source or '').upper().startswith('CSV')


def find_vendor(name):
    """The vendor whose name -- or an alias (a merged or old name) --
    matches `name`, else None."""
    key = vendor_key(name)
    if not key:
        return None
    vendor = Vendor.query.filter_by(name_key=key).first()
    if vendor is None:
        alias = VendorAlias.query.filter_by(name_key=key).first()
        if alias:
            vendor = db.session.get(Vendor, alias.vendor_id)
    return vendor


def _add_alias(vendor_id, name, key):
    """Remember `name` as another spelling of the vendor (no-op if known)."""
    if not key or VendorAlias.query.filter_by(name_key=key).first():
        return
    db.session.add(VendorAlias(vendor_id=vendor_id, name=name, name_key=key))


def get_or_create_vendor(name, gst_number=None):
    """The vendor matching `name` (created if new), or None for a blank
    name. Fills a missing GST number from the invoice. Does not commit."""
    key = vendor_key(name)
    if not key:
        return None
    vendor = find_vendor(name)
    if vendor is None:
        vendor = Vendor(name=clean_name(name)[:100], name_key=key,
                        gst_number=(gst_number or '').strip() or None)
        db.session.add(vendor)
        db.session.flush()
    elif not vendor.gst_number and (gst_number or '').strip():
        vendor.gst_number = gst_number.strip()
    return vendor


def backfill_vendors():
    """Link existing purchase invoices that have a vendor name but no
    vendor yet, creating vendors as needed (newest invoice's spelling and
    GST number win). Runs on startup; once everything is linked it only
    does one cheap query."""
    try:
        pending = (PurchaseInvoice.query
                   .filter(PurchaseInvoice.vendor_id.is_(None))
                   .filter(PurchaseInvoice.vendor_name.isnot(None))
                   .filter(func.trim(PurchaseInvoice.vendor_name) != '')
                   .order_by(PurchaseInvoice.upload_date.desc())
                   .all())
        linked = 0
        for inv in pending:
            if _is_csv_invoice(inv):
                continue
            vendor = get_or_create_vendor(inv.vendor_name, inv.gst_number)
            if vendor:
                inv.vendor_id = vendor.id
                linked += 1
        if linked:
            db.session.commit()
            print(f"[vendors] linked {linked} purchase invoice(s) to vendors")
    except Exception as e:  # never block startup (e.g. two workers racing)
        db.session.rollback()
        print(f"[vendors] backfill skipped: {e}")


def _money(v):
    return float(v or 0)


def _vendor_dict(v, aliases=None):
    return {
        'id': v.id,
        'name': v.name,
        'dl_number': v.dl_number or '',
        'gst_number': v.gst_number or '',
        'contact': v.contact or '',
        'notes': v.notes or '',
        'created_at': v.created_at.isoformat() if v.created_at else None,
        'aliases': aliases.get(v.id, []) if aliases is not None else
                   [a.name for a in VendorAlias.query.filter_by(vendor_id=v.id).order_by(VendorAlias.name).all()],
    }


def _read_fields(data, partial):
    """Validated vendor fields from a request body, or (None, error)."""
    out = {}
    for field in ('name', 'dl_number', 'gst_number', 'contact', 'notes'):
        if field not in data:
            continue
        val = data.get(field)
        val = clean_name(val) if field == 'name' else (str(val).strip() if val is not None else '')
        limit = FIELD_LIMITS.get(field)
        if limit and len(val) > limit:
            return None, f'{field.replace("_", " ").title()} must be at most {limit} characters'
        out[field] = val or None
    if not partial or 'name' in out:
        if not out.get('name') or not vendor_key(out['name']):
            return None, 'Vendor name is required'
    return out, None


def _name_taken(name, exclude_id=None):
    """Another vendor already using this name (or as an alias)."""
    vendor = find_vendor(name)
    if vendor is not None and vendor.id != exclude_id:
        return vendor
    return None


@vendors.route('/vendors', methods=['GET'])
@require_auth
def list_vendors():
    unpaid = PurchaseInvoice.paid_date.is_(None)
    stats = {
        vid: (count, total, unpaid_count, unpaid_total, last_date)
        for vid, count, total, unpaid_count, unpaid_total, last_date in db.session.query(
            PurchaseInvoice.vendor_id,
            func.count(PurchaseInvoice.invoice_number),
            func.coalesce(func.sum(PurchaseInvoice.total_amount), 0),
            func.count(PurchaseInvoice.invoice_number).filter(unpaid),
            func.coalesce(func.sum(PurchaseInvoice.total_amount).filter(unpaid), 0),
            func.max(PurchaseInvoice.invoice_date),
        ).filter(PurchaseInvoice.vendor_id.isnot(None))
         .group_by(PurchaseInvoice.vendor_id).all()
    }
    aliases = {}
    for a in VendorAlias.query.order_by(VendorAlias.name).all():
        aliases.setdefault(a.vendor_id, []).append(a.name)
    result = []
    for v in Vendor.query.order_by(func.lower(Vendor.name)).all():
        count, total, unpaid_count, unpaid_total, last_date = stats.get(v.id, (0, 0, 0, 0, None))
        d = _vendor_dict(v, aliases)
        d.update({
            'invoice_count': count,
            'total_amount': _money(total),
            'unpaid_count': unpaid_count,
            'unpaid_amount': _money(unpaid_total),
            'last_invoice_date': last_date.isoformat() if last_date else None,
        })
        result.append(d)
    return jsonify(result), 200


@vendors.route('/vendors', methods=['POST'])
@require_auth
def create_vendor():
    fields, err = _read_fields(request.get_json() or {}, partial=False)
    if err:
        return jsonify({'error': err}), 400
    existing = _name_taken(fields['name'])
    if existing:
        return jsonify({'error': f'A vendor named "{existing.name}" already exists'}), 409
    vendor = Vendor(name_key=vendor_key(fields['name']), **fields)
    db.session.add(vendor)
    db.session.commit()
    # Invoices typed with this name before the vendor existed (e.g. the
    # vendor was deleted and re-added) get linked now.
    backfill_vendors()
    log_activity(action='CREATE', resource_type='vendor', resource_id=str(vendor.id),
                 resource_label=vendor.name, user_id=g.current_user.get('user_id'),
                 username=g.current_user.get('username'), ip_address=request.remote_addr)
    return jsonify(_vendor_dict(vendor)), 201


def _transfer_copy_ids(batch_ids):
    """Batches made at a receiving clinic by a stock transfer -- they keep
    the invoice number but were not bought on it."""
    if not batch_ids:
        return set()
    return {bid for (bid,) in db.session.query(StockTransferItem.to_batch_id)
            .filter(StockTransferItem.to_batch_id.in_(batch_ids)).distinct()}


@vendors.route('/vendors/<int:vendor_id>', methods=['GET'])
@require_auth
def get_vendor(vendor_id):
    vendor = db.session.get(Vendor, vendor_id)
    if not vendor:
        return jsonify({'error': 'Vendor not found'}), 404

    invoices = (PurchaseInvoice.query.filter_by(vendor_id=vendor.id)
                .order_by(PurchaseInvoice.invoice_date.desc().nullslast(),
                          PurchaseInvoice.upload_date.desc())
                .all())
    locations = {loc.id: loc.name for loc in Location.query.all()}

    total = sum((inv.total_amount or Decimal(0)) for inv in invoices)
    unpaid_invs = [inv for inv in invoices if inv.paid_date is None]
    unpaid = sum((inv.total_amount or Decimal(0)) for inv in unpaid_invs)

    invoice_rows = [{
        'invoice_number': inv.invoice_number,
        'invoice_date': inv.invoice_date.isoformat() if inv.invoice_date else None,
        'upload_date': inv.upload_date.isoformat() if inv.upload_date else None,
        'total_amount': _money(inv.total_amount),
        'paid_date': inv.paid_date.isoformat() if inv.paid_date else None,
        'payment_mode': inv.payment_mode,
        'location_name': locations.get(inv.location_id),
        'vendor_name_on_invoice': inv.vendor_name,
    } for inv in invoices]

    # Items bought from this vendor, summed over its invoices.
    items = []
    inv_numbers = [inv.invoice_number for inv in invoices]
    if inv_numbers:
        inv_dates = {inv.invoice_number: inv.invoice_date or (inv.upload_date.date() if inv.upload_date else None)
                     for inv in invoices}
        batches = (InventoryBatch.query
                   .filter(InventoryBatch.purchase_invoice_number.in_(inv_numbers))
                   .order_by(InventoryBatch.id).all())
        copies = _transfer_copy_ids([b.id for b in batches if not b.initial_quantity])
        products = {p.id: p for p in ProductMaster.query.filter(
            ProductMaster.id.in_({b.product_id for b in batches})).all()} if batches else {}
        by_product = {}
        for b in batches:
            if b.id in copies:
                continue
            qty = b.initial_quantity if b.initial_quantity else (b.quantity or 0)
            p = products.get(b.product_id)
            row = by_product.setdefault(b.product_id, {
                'product_id': b.product_id,
                'item_name': p.item_name if p else 'Unknown',
                'pack_size': (p.pack_size if p else '') or '',
                'manufacturer': (p.manufacturer if p else '') or '',
                'quantity': Decimal(0),
                'free_quantity': Decimal(0),
                'invoices': set(),
                'last_date': None,
                'last_rate': None,
                'last_mrp': None,
            })
            row['quantity'] += Decimal(qty)
            row['free_quantity'] += Decimal(b.free_quantity or 0)
            row['invoices'].add(b.purchase_invoice_number)
            d = inv_dates.get(b.purchase_invoice_number)
            if row['last_date'] is None or (d and d >= row['last_date']):
                row['last_date'] = d
                row['last_rate'] = b.purchase_rate
                row['last_mrp'] = b.mrp
        for row in by_product.values():
            invs = row.pop('invoices')
            items.append({
                **row,
                'quantity': float(row['quantity']),
                'free_quantity': float(row['free_quantity']),
                'invoice_count': len(invs),
                'last_date': row['last_date'].isoformat() if row['last_date'] else None,
                'last_rate': _money(row['last_rate']) if row['last_rate'] is not None else None,
                'last_mrp': _money(row['last_mrp']) if row['last_mrp'] is not None else None,
            })
        items.sort(key=lambda r: r['item_name'].lower())

    return jsonify({
        'vendor': _vendor_dict(vendor),
        'summary': {
            'invoice_count': len(invoices),
            'total_amount': _money(total),
            'unpaid_count': len(unpaid_invs),
            'unpaid_amount': _money(unpaid),
            'paid_amount': _money(total - unpaid),
        },
        'invoices': invoice_rows,
        'items': items,
    }), 200


@vendors.route('/vendors/<int:vendor_id>', methods=['PATCH'])
@require_auth
def update_vendor(vendor_id):
    vendor = db.session.get(Vendor, vendor_id)
    if not vendor:
        return jsonify({'error': 'Vendor not found'}), 404
    fields, err = _read_fields(request.get_json() or {}, partial=True)
    if err:
        return jsonify({'error': err}), 400
    if 'name' in fields:
        clash = _name_taken(fields['name'], exclude_id=vendor.id)
        if clash:
            return jsonify({'error': f'A vendor named "{clash.name}" already exists'}), 409
        new_key = vendor_key(fields['name'])
        if new_key != vendor.name_key:
            # Invoices typed with the old name keep linking here.
            _add_alias(vendor.id, vendor.name, vendor.name_key)
            VendorAlias.query.filter_by(name_key=new_key, vendor_id=vendor.id).delete()
            vendor.name_key = new_key
    for k, v in fields.items():
        setattr(vendor, k, v)
    db.session.commit()
    log_activity(action='UPDATE', resource_type='vendor', resource_id=str(vendor.id),
                 resource_label=vendor.name, user_id=g.current_user.get('user_id'),
                 username=g.current_user.get('username'), ip_address=request.remote_addr)
    return jsonify(_vendor_dict(vendor)), 200


@vendors.route('/vendors/<int:vendor_id>', methods=['DELETE'])
@require_auth
@require_admin
def delete_vendor(vendor_id):
    vendor = db.session.get(Vendor, vendor_id)
    if not vendor:
        return jsonify({'error': 'Vendor not found'}), 404
    count = PurchaseInvoice.query.filter_by(vendor_id=vendor.id).count()
    if count:
        return jsonify({'error': f'{vendor.name} has {count} invoice(s) and can\'t be deleted'}), 409
    name = vendor.name
    VendorAlias.query.filter_by(vendor_id=vendor.id).delete()
    db.session.delete(vendor)
    db.session.commit()
    log_activity(action='DELETE', resource_type='vendor', resource_id=str(vendor_id),
                 resource_label=name, user_id=g.current_user.get('user_id'),
                 username=g.current_user.get('username'), ip_address=request.remote_addr)
    return jsonify({'message': f'Deleted {name}'}), 200


# ── Duplicate vendors ────────────────────────────────────────────────────────

# Words that say what kind of business it is, not which one -- ignored when
# comparing names, so "Sri Sai Pharma" and "Sri Sai Pharmaceuticals" match.
_GENERIC = {
    'pharmaceutical', 'pharmaceuticals', 'pharmacy', 'pharma', 'medical', 'medicals',
    'medicine', 'medicines', 'distributor', 'distributors', 'distribution', 'agency',
    'agencies', 'enterprise', 'enterprises', 'trader', 'traders', 'trading', 'surgical',
    'surgicals', 'healthcare', 'health', 'pvt', 'private', 'ltd', 'limited', 'llp',
    'company', 'corporation', 'and', 'co', 'the', 'm', 's', 'ms',
}

SIMILARITY = 0.8


def _core(name):
    """Name as letters/digits with generic business words dropped."""
    words = re.findall(r'[a-z0-9]+', (name or '').lower())
    core = ''.join(w for w in words if w not in _GENERIC)
    core = core if len(core) >= 3 else vendor_key(name)
    # Common spelling variants of the same name: Sree/Sri, Shree/Sri, Pooja/Puja.
    for a, b in _SPELLING:
        core = core.replace(a, b)
    return core


_SPELLING = [('sh', 's'), ('ph', 'f'), ('th', 't'), ('ee', 'i'), ('oo', 'u'),
             ('aa', 'a'), ('w', 'v'), ('z', 's'), ('y', 'i')]


def vendors_similar(a, b):
    """a/b are Vendor rows: same GST number, or near-identical names once
    generic business words are dropped."""
    ga, gb = (a.gst_number or '').strip().upper(), (b.gst_number or '').strip().upper()
    if ga and ga == gb:
        return True
    ca, cb = _core(a.name), _core(b.name)
    if ca == cb:
        return True
    if min(len(ca), len(cb)) >= 5 and (ca in cb or cb in ca):
        return True
    return difflib.SequenceMatcher(None, ca, cb).ratio() >= SIMILARITY


@vendors.route('/vendors/duplicates', methods=['GET'])
@require_auth
def vendor_duplicates():
    """Groups of vendors that look like the same supplier."""
    rows = Vendor.query.order_by(Vendor.id).all()
    parent = {v.id: v.id for v in rows}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if vendors_similar(a, b):
                parent[find(a.id)] = find(b.id)

    groups = {}
    for v in rows:
        groups.setdefault(find(v.id), []).append(v)
    groups = [g for g in groups.values() if len(g) > 1]
    if not groups:
        return jsonify({'groups': []}), 200

    counts = dict(db.session.query(PurchaseInvoice.vendor_id, func.count(PurchaseInvoice.invoice_number))
                  .filter(PurchaseInvoice.vendor_id.isnot(None))
                  .group_by(PurchaseInvoice.vendor_id).all())
    out = []
    for g in groups:
        gsts = {(v.gst_number or '').strip().upper() for v in g}
        items = [{**_vendor_dict(v), 'invoice_count': counts.get(v.id, 0)} for v in g]
        items.sort(key=lambda d: (-d['invoice_count'], d['name'].lower()))
        out.append({
            'same_gst': len(gsts) == 1 and '' not in gsts,
            'vendors': items,
        })
    out.sort(key=lambda grp: grp['vendors'][0]['name'].lower())
    return jsonify({'groups': out}), 200


@vendors.route('/vendors/merge', methods=['POST'])
@require_auth
@require_doctor
def merge_vendors():
    """Merge vendors into one: their invoices move to the kept vendor,
    blank details on it are filled from the merged ones (notes are
    combined), their names become aliases of it, and they're removed."""
    data = request.get_json() or {}
    try:
        keep_id = int(data.get('keep_id'))
        merge_ids = [int(i) for i in (data.get('merge_ids') or [])]
    except (TypeError, ValueError):
        return jsonify({'error': 'keep_id and merge_ids must be vendor ids'}), 400
    merge_ids = [i for i in dict.fromkeys(merge_ids) if i != keep_id]
    if not merge_ids:
        return jsonify({'error': 'Pick at least one vendor to merge'}), 400

    keep = db.session.get(Vendor, keep_id)
    if not keep:
        return jsonify({'error': 'Vendor to keep not found'}), 404
    others = Vendor.query.filter(Vendor.id.in_(merge_ids)).all()
    if len(others) != len(merge_ids):
        return jsonify({'error': 'Some vendors to merge no longer exist -- refresh and try again'}), 404

    moved = 0
    notes = [keep.notes] if keep.notes else []
    for o in others:
        moved += PurchaseInvoice.query.filter_by(vendor_id=o.id).update(
            {PurchaseInvoice.vendor_id: keep.id}, synchronize_session=False)
        for field in ('dl_number', 'gst_number', 'contact'):
            if not getattr(keep, field) and getattr(o, field):
                setattr(keep, field, getattr(o, field))
        if o.notes and o.notes not in notes:
            notes.append(o.notes)
        VendorAlias.query.filter_by(vendor_id=o.id).update(
            {VendorAlias.vendor_id: keep.id}, synchronize_session=False)
    keep.notes = '\n'.join(notes) or None

    names = [o.name for o in others]
    for o in others:
        key, name = o.name_key, o.name
        db.session.delete(o)
        db.session.flush()           # frees the name_key before it becomes an alias
        _add_alias(keep.id, name, key)
    db.session.commit()

    log_activity(action='MERGE', resource_type='vendor', resource_id=str(keep.id),
                 resource_label=f"{', '.join(names)} -> {keep.name}",
                 user_id=g.current_user.get('user_id'),
                 username=g.current_user.get('username'), ip_address=request.remote_addr)
    return jsonify({
        'message': f"Merged {len(others)} vendor(s) into {keep.name} ({moved} invoice(s) moved)",
        'vendor': _vendor_dict(keep),
    }), 200
