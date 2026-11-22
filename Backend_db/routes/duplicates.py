"""Duplicate inventory items: detection, merging, and the CSV-import check.

Two products are
  * exact duplicates when their names match ignoring case, spaces,
    punctuation and a strength unit after a number ("DOLO-650 " == "Dolo 650",
    "Azithral 500mg" == "Azithral 500") AND their pack sizes are the same
    count ("10" == "10s" == "10's pack" == "strip of 10"; "100ml" == "100 ML");
  * possible duplicates when the pack matches, the numbers in the name match
    (so "Amlodipine 5" vs "Amlodipine 10" are never flagged) and the letters
    are a near spelling ("Paracetamol" / "Paracetmol", "Crocin" / "Crosin").
    A name that merely contains the other ("Shelcal" / "Shelcal HD",
    "Cetirizine" / "Levocetirizine") is a different product, not flagged.
"""
import csv
import difflib
import io
import json
import re
from collections import defaultdict

from flask import Blueprint, request, jsonify, g
from sqlalchemy import func

from extensions import db
from models import (
    ProductMaster, InventoryBatch, InventoryHistory, BillItem,
    StockTransferItem, Location,
)
from utils import normalize_pack_size
from .auth import require_auth, require_doctor, log_activity

duplicates = Blueprint('duplicates', __name__)

# ── Matching rules ──────────────────────────────────────────────────────────

_PACK_COUNT_RE = re.compile(
    r"^(\d+)\s*(?:'?s\b)?\s*(?:pack|packs|strip|strips|tab|tabs|tablet|tablets|cap|caps|capsule|capsules)?$"
)
_PACK_OF_RE = re.compile(r"^(?:strip|pack|box)\s+of\s+(\d+)(?:\s*(?:tabs?|tablets?|caps?|capsules?))?$")
SIMILARITY = 0.8       # difflib ratio on the letters of two names
MIN_LETTERS = 4        # don't fuzzy-match very short names


_UNIT_AFTER_NUMBER_RE = re.compile(r'(?<=\d)\s*(?:mg|mcg|ml|gm|g|iu|%)(?![a-z])')


def name_key(name):
    """'DOLO-650 ' -> 'dolo650'; 'Azithral 500 mg' -> 'azithral500'."""
    n = _UNIT_AFTER_NUMBER_RE.sub('', (name or '').lower())
    return re.sub(r'[^a-z0-9]', '', n)


def pack_key(pack):
    """'10' / '10s' / "10's pack" / '10 tabs' -> '10'; '100 ML' -> '100ml'."""
    p = (pack or '').strip().lower()
    m = _PACK_COUNT_RE.match(p) or _PACK_OF_RE.match(p)
    if m:
        return str(int(m.group(1)))
    return re.sub(r'[^a-z0-9]', '', p)


def _numbers(key):
    return tuple(re.findall(r'\d+', key))


def _letters(key):
    return re.sub(r'\d+', '', key)


def names_similar(a, b):
    """Near spellings with the same numbers. a/b are name_key()s."""
    if a == b or _numbers(a) != _numbers(b):
        return False
    la, lb = _letters(a), _letters(b)
    if min(len(la), len(lb)) < MIN_LETTERS:
        return False
    if la in lb or lb in la:
        return False          # a variant (extra word/prefix), not a typo
    return difflib.SequenceMatcher(None, la, lb).ratio() >= SIMILARITY


def _block(nkey, pkey):
    """Candidates for fuzzy comparison share pack, numbers and first letter --
    keeps the check fast on thousands of items."""
    letters = _letters(nkey)
    return (pkey, _numbers(nkey), letters[:1])


# ── Product summaries ───────────────────────────────────────────────────────

def _product_summaries(ids):
    """Stock per clinic, batch and bill counts for the given product ids."""
    if not ids:
        return {}
    names = {l.id: l.name for l in Location.query.all()}
    stock = defaultdict(lambda: defaultdict(float))
    batch_count = defaultdict(int)
    for pid, loc, qty in db.session.query(
        InventoryBatch.product_id, InventoryBatch.location_id, InventoryBatch.quantity
    ).filter(InventoryBatch.product_id.in_(ids)).all():
        batch_count[pid] += 1
        if qty and float(qty) > 0:
            stock[pid][names.get(loc, 'Unassigned') if loc else 'Unassigned'] += float(qty)
    bills = dict(db.session.query(BillItem.product_id, func.count(BillItem.id))
                 .filter(BillItem.product_id.in_(ids)).group_by(BillItem.product_id).all())
    out = {}
    for p in ProductMaster.query.filter(ProductMaster.id.in_(ids)).all():
        per_loc = stock.get(p.id, {})
        out[p.id] = {
            'id': p.id,
            'item_name': p.item_name,
            'pack_size': p.pack_size,
            'manufacturer': p.manufacturer,
            'hsn_code': p.hsn_code,
            'category': p.category,
            'total_qty': round(sum(per_loc.values()), 2),
            'stock_by_clinic': [{'location': k, 'quantity': round(v, 2)} for k, v in sorted(per_loc.items())],
            'batch_count': batch_count.get(p.id, 0),
            'bill_count': int(bills.get(p.id, 0)),
        }
    return out


def find_duplicate_groups():
    """Groups of 2+ products that are exact or possible duplicates."""
    products = db.session.query(ProductMaster.id, ProductMaster.item_name, ProductMaster.pack_size).all()
    keys = {pid: (name_key(n), pack_key(pk)) for pid, n, pk in products}

    parent = {pid: pid for pid in keys}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # Exact: identical keys.
    by_key = defaultdict(list)
    for pid, k in keys.items():
        if k[0]:
            by_key[k].append(pid)
    for ids in by_key.values():
        for other in ids[1:]:
            union(ids[0], other)

    # Possible: near spellings between distinct keys within a block.
    blocks = defaultdict(list)
    for k in by_key:
        blocks[_block(*k)].append(k)
    similar_pairs = set()
    for ks in blocks.values():
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                if names_similar(ks[i][0], ks[j][0]):
                    union(by_key[ks[i]][0], by_key[ks[j]][0])
                    similar_pairs.add((ks[i], ks[j]))

    groups = defaultdict(list)
    for pid in keys:
        groups[find(pid)].append(pid)
    groups = [ids for ids in groups.values() if len(ids) > 1]

    summaries = _product_summaries([pid for ids in groups for pid in ids])
    result = []
    for ids in groups:
        exact = len({keys[pid] for pid in ids}) == 1
        items = sorted((summaries[pid] for pid in ids if pid in summaries),
                       key=lambda s: (-s['total_qty'], -s['bill_count'], s['id']))
        result.append({'match': 'exact' if exact else 'similar', 'items': items})
    # Exact groups first, then by name.
    result.sort(key=lambda gr: (gr['match'] != 'exact', (gr['items'][0]['item_name'] or '').lower()))
    return result


@duplicates.route('/inventory/duplicates', methods=['GET'])
@require_auth
@require_doctor
def list_duplicates():
    groups = find_duplicate_groups()
    return jsonify({
        'groups': groups,
        'exact_groups': sum(1 for gr in groups if gr['match'] == 'exact'),
        'similar_groups': sum(1 for gr in groups if gr['match'] == 'similar'),
    }), 200


# ── Merge ───────────────────────────────────────────────────────────────────

_FILL_FIELDS = ('manufacturer', 'hsn_code', 'category', 'formula', 'rack_location', 'generic_tags')


@duplicates.route('/inventory/duplicates/merge', methods=['POST'])
@require_auth
@require_doctor
def merge_duplicates():
    """Merge products into one: {keep_id, merge_ids: [...]}. Every batch,
    stock-history row, transfer line and past bill line of the merged items
    moves to the kept item, blank details on the kept item are filled from the
    merged ones, and the merged items are removed. Past bills keep their
    printed item names (BillItem stores a snapshot)."""
    data = request.get_json() or {}
    keep_id = (data.get('keep_id') or '').strip()
    merge_ids = [m.strip() for m in (data.get('merge_ids') or []) if m and m.strip() and m.strip() != keep_id]
    merge_ids = list(dict.fromkeys(merge_ids))
    if not keep_id or not merge_ids:
        return jsonify({'error': 'Choose the item to keep and at least one item to merge into it'}), 400

    keep = db.session.get(ProductMaster, keep_id)
    if not keep:
        return jsonify({'error': f'Item {keep_id} not found'}), 404
    merged = ProductMaster.query.filter(ProductMaster.id.in_(merge_ids)).all()
    missing = set(merge_ids) - {m.id for m in merged}
    if missing:
        return jsonify({'error': f'Item(s) not found: {", ".join(sorted(missing))}'}), 404

    user_id = g.current_user.get('user_id')
    username = g.current_user.get('username')
    try:
        moved = {'batches': 0, 'history': 0, 'bill_lines': 0, 'transfer_lines': 0}
        for m in merged:
            moved['batches'] += InventoryBatch.query.filter_by(product_id=m.id).update(
                {'product_id': keep_id}, synchronize_session=False)
            moved['history'] += InventoryHistory.query.filter_by(product_id=m.id).update(
                {'product_id': keep_id}, synchronize_session=False)
            moved['bill_lines'] += BillItem.query.filter_by(product_id=m.id).update(
                {'product_id': keep_id}, synchronize_session=False)
            moved['transfer_lines'] += StockTransferItem.query.filter_by(product_id=m.id).update(
                {'product_id': keep_id}, synchronize_session=False)
            for f in _FILL_FIELDS:
                if not getattr(keep, f) and getattr(m, f):
                    setattr(keep, f, getattr(m, f))
            db.session.add(InventoryHistory(
                product_id=keep_id, change_amount=0, type='ADJUSTMENT',
                notes=f"Merged duplicate item '{m.item_name}' ({m.pack_size or 'no pack'}, ID {m.id}) into this item",
                user_id=user_id, username=username,
            ))
        db.session.flush()
        for m in merged:
            db.session.delete(m)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Merge failed: {e}'}), 500

    log_activity(
        action='MERGE',
        resource_type='inventory_product',
        resource_id=keep_id,
        resource_label=keep.item_name,
        details=f"Merged {', '.join(m.id for m in merged)}; moved {moved['batches']} batch(es), "
                f"{moved['bill_lines']} bill line(s)",
        user_id=user_id,
        username=username,
        ip_address=request.remote_addr,
    )
    return jsonify({'message': f"Merged {len(merged)} item(s) into {keep.item_name}", 'moved': moved}), 200


# ── CSV import pre-check ────────────────────────────────────────────────────

def read_import_rows(file_bytes, field_mapping):
    """Yield (row_index, name, pack_size, product_id_csv) exactly as the
    import loop reads them (same header matching and pack normalisation), so
    row_index values line up with import_inventory's row_decisions."""
    stream = io.StringIO(file_bytes.decode('UTF8'), newline=None)
    reader = csv.DictReader(stream)
    if field_mapping and reader.fieldnames:
        reader.fieldnames = [field_mapping.get(h, h) for h in reader.fieldnames]
    for idx, row in enumerate(reader):
        def get_val(keys):
            for k in keys:
                for exist_k in row.keys():
                    if exist_k and k.lower() in exist_k.lower():
                        return row[exist_k]
            return None
        name = get_val(['Item Name', 'name', 'item', 'Item'])
        if not name:
            continue
        pack = normalize_pack_size(get_val(['Pack Size', 'pack', 'packs', 'Pack']) or '')
        pid = (get_val(['Product ID']) or '').strip()
        yield idx, name.strip(), pack, pid


def default_lookup(name, pack_size):
    """The import's own lookup (exact lower-case name, exact pack)."""
    q = ProductMaster.query.filter(func.lower(ProductMaster.item_name) == name.strip().lower())
    if pack_size:
        q = q.filter(ProductMaster.pack_size == pack_size.strip())
    return q.first()


@duplicates.route('/inventory/import/check-duplicates', methods=['POST'])
@require_auth
@require_doctor
def check_import_duplicates():
    """Before importing: list CSV rows that would create a NEW item although an
    existing item (or an earlier row in the same CSV) looks like the same
    product. Rows with a Product ID, or that already match an item exactly,
    are not listed -- they don't create anything new."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    try:
        field_mapping = json.loads(request.form.get('field_mapping', '{}') or '{}')
    except Exception:
        field_mapping = {}
    try:
        rows = list(read_import_rows(request.files['file'].read(), field_mapping))
    except UnicodeDecodeError:
        return jsonify({'error': 'File is not valid UTF-8 CSV'}), 400

    products = db.session.query(ProductMaster.id, ProductMaster.item_name, ProductMaster.pack_size).all()
    by_key = defaultdict(list)
    blocks = defaultdict(set)
    info = {}
    for pid, n, pk in products:
        k = (name_key(n), pack_key(pk))
        by_key[k].append(pid)
        blocks[_block(*k)].add(k)
        info[pid] = {'id': pid, 'item_name': n, 'pack_size': pk}

    flagged = []
    new_rows = {}                 # key -> first CSV row that creates it
    new_row_keys = defaultdict(set)
    for idx, name, pack, pid in rows:
        if pid or default_lookup(name, pack):
            continue              # updates an existing item; nothing new is created
        k = (name_key(name), pack_key(pack))
        matches = []
        for p in by_key.get(k, []):
            matches.append({**info[p], 'match': 'exact'})
        for other in blocks.get(_block(*k), ()):
            if other != k and names_similar(k[0], other[0]):
                for p in by_key[other]:
                    matches.append({**info[p], 'match': 'similar'})
        same_csv = None
        if k in new_rows:
            same_csv = {'row': new_rows[k]['row'], 'item_name': new_rows[k]['name'],
                        'pack_size': new_rows[k]['pack'], 'match': 'exact'}
        else:
            for other in new_row_keys.get(_block(*k), ()):
                if names_similar(k[0], other[0]):
                    r = new_rows[other]
                    same_csv = {'row': r['row'], 'item_name': r['name'], 'pack_size': r['pack'], 'match': 'similar'}
                    break
        if matches or same_csv:
            exact_existing = next((m for m in matches if m['match'] == 'exact'), None)
            if exact_existing:
                suggestion = f"existing:{exact_existing['id']}"
            elif same_csv and same_csv['match'] == 'exact':
                suggestion = f"row:{same_csv['row']}"
            else:
                suggestion = 'new'
            flagged.append({
                'row': idx, 'line': idx + 2,  # spreadsheet line (header is line 1)
                'item_name': name, 'pack_size': pack,
                'matches': matches, 'same_as_row': same_csv, 'suggestion': suggestion,
            })
        if k not in new_rows:
            new_rows[k] = {'row': idx, 'name': name, 'pack': pack}
            new_row_keys[_block(*k)].add(k)

    return jsonify({'rows': flagged, 'total_rows': len(rows)}), 200
