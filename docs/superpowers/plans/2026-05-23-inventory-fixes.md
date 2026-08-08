# Inventory System Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all identified inventory system bugs and gaps: duplicate invoice handling, OCR vendor name loss, expiry threshold config, N+1 query optimization, negative batch prevention, CSV export/import column misalignment, and frontend currency/UX issues.

**Architecture:** Backend fixes are all in `Backend_db/routes/inventory.py`. Frontend adds `expiryReminderMonths` to the localStorage settings context and passes it as a query param to `/api/inventory`. The expiry setting is configurable from the admin Settings tab. No new DB migrations needed — all changes are logic/query level.

**Tech Stack:** Flask + SQLAlchemy 2.0 (backend), Next.js 16 App Router + React + Tailwind + shadcn/ui (frontend), localStorage for settings persistence.

**Note:** This project has no test suites. Verification steps use `curl` against the running dev server (`http://localhost:5000`) and browser inspection.

---

## File Map

| File | Change |
|---|---|
| `Backend_db/routes/inventory.py` | OCR vendor fix, expiry logic + param, N+1 optimization, duplicate invoice detection, negative batch fix, CSV export/import headers |
| `frontend/lib/settings_context.tsx` | Add `expiryReminderMonths` (default 6), persisted to localStorage |
| `frontend/lib/api.ts` | `getInventory(expiryMonths?)` accepts param, `saveInvoice` returns warnings |
| `frontend/app/inventory/page.tsx` | Pass setting to API, fix `$` → `₹`, AllChangesPanel tab visible to all roles |
| `frontend/app/inventory/invoice_edit/page.tsx` | Replace `alert()` with `toast()` |
| `frontend/app/admin/page.tsx` | Add Settings tab with expiry reminder months input |

---

## Task 1: Fix OCR vendor name silently discarded

**Files:**
- Modify: `Backend_db/routes/inventory.py:394-400`

The function `_transform_ocr_result` hardcodes `'vendor_name': ''` even though `_parse_vision_response` extracts the vendor name into `metadata['vendor_name']`.

- [ ] **Step 1: Edit `_transform_ocr_result`**

Find this block (around line 394):
```python
    return {
        'product_details': product_details,
        'invoice_number': metadata.get('invoice_no') or '',
        'gst_number': metadata.get('gst_no') or '',
        'total_amount': str(total_amount) if total_amount != '' else '',
        'vendor_name': '',
    }
```

Replace with:
```python
    return {
        'product_details': product_details,
        'invoice_number': metadata.get('invoice_no') or '',
        'gst_number': metadata.get('gst_no') or '',
        'total_amount': str(total_amount) if total_amount != '' else '',
        'vendor_name': metadata.get('vendor_name') or '',
    }
```

- [ ] **Step 2: Verify**

Upload any invoice image through the OCR flow and confirm the `vendor_name` field in the response is no longer empty when the image has a business name at the top.

---

## Task 2: Fix expiry off-by-one + make threshold configurable

**Files:**
- Modify: `Backend_db/routes/inventory.py` — `get_inventory` function (lines ~404–484)

**Context:** Pharmacy convention: expiry `MM/YY` means valid through the last day of that month. The current check `today.month >= earliest_expiry.month` marks items expired on the 1st of the expiry month. Change to `today.month > earliest_expiry.month`. Also change the "EXPIRES SOON" window from hardcoded 3 months to a query param `expiry_months` (default 6).

- [ ] **Step 1: Add `case` to sqlalchemy imports**

At the top of `inventory.py`, the import is:
```python
from sqlalchemy import func
```

Change to:
```python
from sqlalchemy import func, case
```

- [ ] **Step 2: Update `get_inventory` route signature and expiry logic**

Find this block inside `get_inventory` (around line 444):
```python
        # Expiry Status
        if earliest_expiry:
             today = get_ist_now().date()
             is_expired = (today.year > earliest_expiry.year) or \
                          (today.year == earliest_expiry.year and today.month >= earliest_expiry.month)
             
             if is_expired:
                 status_tags.append('EXPIRED')
             else:
                 months_diff = (earliest_expiry.year - today.year) * 12 + (earliest_expiry.month - today.month)
                 if months_diff <= 3:
                     status_tags.append('EXPIRES SOON')
```

Replace with:
```python
        # Expiry Status
        if earliest_expiry:
             is_expired = (today.year > earliest_expiry.year) or \
                          (today.year == earliest_expiry.year and today.month > earliest_expiry.month)
             
             if is_expired:
                 status_tags.append('EXPIRED')
             else:
                 months_diff = (earliest_expiry.year - today.year) * 12 + (earliest_expiry.month - today.month)
                 if months_diff <= expiry_months:
                     status_tags.append('EXPIRES SOON')
```

Also add `expiry_months` and `today` at the top of the function and remove the `today` line inside the loop. The full updated route signature and top section:

```python
@inventory.route('/inventory', methods=['GET'])
@require_auth
def get_inventory():
    """
    Returns Master ProductMaster Items + Aggregated Stock
    """
    expiry_months = int(request.args.get('expiry_months', 6))
    today = get_ist_now().date()
    items = ProductMaster.query.order_by(ProductMaster.item_name.asc()).all()
    results = []
    for item in items:
```

(Remove the `today = get_ist_now().date()` line that was nested inside the for loop at the expiry block.)

- [ ] **Step 3: Also update `get_inventory_analytics` expiry horizon**

In `get_inventory_analytics`, find:
```python
    expiry_horizon = today + timedelta(days=120)
```

Replace with:
```python
    expiry_months = int(request.args.get('expiry_months', 6))
    expiry_horizon = today + timedelta(days=expiry_months * 30)
```

- [ ] **Step 4: Verify**

```bash
curl -s "http://localhost:5000/api/inventory?expiry_months=1" \
  -H "Cookie: session=<your_session>" | python3 -m json.tool | grep -A2 "status"
```

Items expiring next month should show `EXPIRES SOON`. Items expiring this month but not yet finished should NOT show `EXPIRED`.

---

## Task 3: Optimize N+1 queries in `get_inventory`

**Files:**
- Modify: `Backend_db/routes/inventory.py` — entire `get_inventory` function body

**Context:** Currently runs 5–7 SQL queries per product. With 200 products that's 1000+ queries. Replace with 4 queries total using aggregated subqueries.

- [ ] **Step 1: Replace the body of `get_inventory` with the optimized version**

Replace the full function body (everything after the `expiry_months`/`today` lines added in Task 2) with:

```python
@inventory.route('/inventory', methods=['GET'])
@require_auth
def get_inventory():
    expiry_months = int(request.args.get('expiry_months', 6))
    today = get_ist_now().date()

    items = ProductMaster.query.order_by(ProductMaster.item_name.asc()).all()
    if not items:
        return jsonify([]), 200

    product_ids = [item.id for item in items]

    # ── Query 1: batch aggregates ──────────────────────────────────────────
    batch_stats_rows = db.session.query(
        InventoryBatch.product_id,
        func.sum(InventoryBatch.quantity).label('total_qty'),
        func.max(InventoryBatch.mrp).label('max_mrp'),
        func.min(InventoryBatch.mrp).label('min_mrp'),
        func.sum(InventoryBatch.mrp * InventoryBatch.quantity).label('total_value'),
        func.min(
            case(
                (InventoryBatch.quantity > 0, InventoryBatch.expiry_date),
                else_=None
            )
        ).label('earliest_expiry'),
    ).filter(InventoryBatch.product_id.in_(product_ids))\
     .group_by(InventoryBatch.product_id).all()

    stats_map = {
        r.product_id: {
            'total_qty': float(r.total_qty or 0),
            'max_mrp': float(r.max_mrp or 0),
            'min_mrp': float(r.min_mrp or 0),
            'total_value': float(r.total_value or 0),
            'earliest_expiry': r.earliest_expiry,
        }
        for r in batch_stats_rows
    }

    # ── Query 2: current MRP (first active batch FIFO) ─────────────────────
    ranked_sq = db.session.query(
        InventoryBatch.product_id,
        InventoryBatch.mrp,
        func.row_number().over(
            partition_by=InventoryBatch.product_id,
            order_by=InventoryBatch.expiry_date.asc()
        ).label('rn')
    ).filter(
        InventoryBatch.product_id.in_(product_ids),
        InventoryBatch.quantity > 0
    ).subquery()

    current_mrp_rows = db.session.query(
        ranked_sq.c.product_id,
        ranked_sq.c.mrp
    ).filter(ranked_sq.c.rn == 1).all()

    current_mrp_map = {r.product_id: float(r.mrp) for r in current_mrp_rows}

    # ── Query 3: vendor names for active stock ─────────────────────────────
    vendor_rows = db.session.query(
        InventoryBatch.product_id,
        PurchaseInvoice.vendor_name
    ).join(
        PurchaseInvoice,
        InventoryBatch.purchase_invoice_number == PurchaseInvoice.invoice_number
    ).filter(
        InventoryBatch.product_id.in_(product_ids),
        InventoryBatch.quantity > 0,
        PurchaseInvoice.vendor_name.isnot(None)
    ).distinct().all()

    vendors_map: dict = {}
    for pid, vname in vendor_rows:
        if pid not in vendors_map:
            vendors_map[pid] = []
        if vname and vname not in vendors_map[pid]:
            vendors_map[pid].append(vname)

    # ── Build results ──────────────────────────────────────────────────────
    results = []
    empty_stats = {'total_qty': 0, 'max_mrp': 0.0, 'min_mrp': 0.0, 'total_value': 0.0, 'earliest_expiry': None}

    for item in items:
        stats = stats_map.get(item.id, empty_stats)
        total_qty    = stats['total_qty']
        max_mrp      = stats['max_mrp']
        min_mrp      = stats['min_mrp']
        total_value  = stats['total_value']
        earliest_expiry = stats['earliest_expiry']
        current_mrp  = current_mrp_map.get(item.id, max_mrp)
        vendor_list  = vendors_map.get(item.id, [])

        status_tags = []
        if total_qty <= 0:
            status_tags.append('OUT OF STOCK')
        elif total_qty < item.min_stock_level:
            status_tags.append('LOW STOCK')

        if earliest_expiry:
            is_expired = (today.year > earliest_expiry.year) or (
                today.year == earliest_expiry.year and today.month > earliest_expiry.month
            )
            if is_expired:
                status_tags.append('EXPIRED')
            else:
                months_diff = (earliest_expiry.year - today.year) * 12 + (earliest_expiry.month - today.month)
                if months_diff <= expiry_months:
                    status_tags.append('EXPIRES SOON')

        if not status_tags:
            status_tags.append('OK')

        results.append({
            'id': item.id,
            'item_name': item.item_name,
            'quantity': total_qty,
            'min_stock_level': item.min_stock_level,
            'category': item.category,
            'manufacturer': item.manufacturer,
            'vendors': vendor_list,
            'price': current_mrp,
            'min_price': min_mrp,
            'max_price': max_mrp,
            'total_value': total_value,
            'expiry_date': earliest_expiry.strftime('%m/%y') if earliest_expiry else None,
            'status': status_tags,
            'pack_size': item.pack_size,
            'hsn_code': item.hsn_code,
            'gst_rate': float(item.gst_rate) if item.gst_rate else 0.0,
            'formula': item.formula,
        })

    return jsonify(results), 200
```

- [ ] **Step 2: Verify**

Start the backend and load inventory. Check Flask logs — you should see roughly 4 SQL statements, not hundreds.

```bash
cd Backend_db && source venv/bin/activate && FLASK_DEBUG=True python app.py
# In another terminal:
curl -s http://localhost:5000/api/inventory | python3 -m json.tool | head -40
```

---

## Task 4: Fix duplicate invoice — detect, compare, adjust

**Files:**
- Modify: `Backend_db/routes/inventory.py` — `save_invoice` function (lines ~1372–1520)

**Context:** When the same `invoice_number` is submitted again, the current code `pass`es the duplicate check and blindly adds all batches again (doubling stock). Fix: if the invoice exists, compare each row against existing batches. Identical rows → log a history entry and skip. Different qty → add an adjustment batch with the difference. New rows → add normally. Always return a `warnings` list.

- [ ] **Step 1: Replace the `existing = PurchaseInvoice.query.get(invoice_no)` block**

Find this section (around line 1384):
```python
    existing = PurchaseInvoice.query.get(invoice_no)
    if existing:
        pass
    else:
        source_type = 'MANUAL'
        ...
        db.session.add(new_inv)
```

Replace with:
```python
    warnings: list = []
    existing = PurchaseInvoice.query.get(invoice_no)
    is_duplicate_invoice = existing is not None

    if not existing:
        source_type = 'MANUAL'
        if image_path:
            source_type = 'OCR'

        new_inv = PurchaseInvoice(
            invoice_number=invoice_no,
            gst_number=gst_no,
            total_amount=data.get('total_amount', 0),
            vendor_name=data.get('vendor_name', ''),
            invoice_date=get_ist_now().date(),
            image_path=image_path,
            source=source_type,
            upload_date=get_ist_now(),
            created_by_user_id=g.current_user.get('user_id'),
        )
        db.session.add(new_inv)
```

- [ ] **Step 2: Replace the products loop inside the `try` block**

The current `try` block starting at ~line 1406 has a simple `for p in products:` loop that always creates a new batch. Replace the entire `try:` block with this version that branches on `is_duplicate_invoice`:

```python
    try:
        for p in products:
            p_name = p.get('product_name')
            if not p_name: continue

            p_mfg    = p.get('mfg', '').strip()
            p_pack   = p.get('packs') or p.get('pack') or ''
            p_batch  = p.get('batch') or p.get('batch_number') or ''
            p_hsn    = p.get('hsn') or p.get('hsn_code') or ''
            p_formula = (p.get('formula') or '').strip()

            try:
                p_gst = float(str(p.get('gst', 0) or 0))
                if p_gst >= 100:
                    p_gst = 0.0
            except:
                p_gst = 0.0

            # Resolve product master
            matched_id = p.get('matched_id')
            item = None
            if matched_id:
                item = ProductMaster.query.get(matched_id)

            if not item:
                query = ProductMaster.query.filter(func.lower(ProductMaster.item_name) == p_name.lower())
                if p_pack:
                    query = query.filter(ProductMaster.pack_size == str(p_pack))
                item = query.first()

            if not item:
                item = ProductMaster(
                    id=ProductMaster.generate_item_id(),
                    item_name=p_name,
                    category='',
                    manufacturer=p_mfg,
                    pack_size=str(p_pack),
                    hsn_code=str(p_hsn),
                    formula=p_formula if p_formula else None,
                )
                db.session.add(item)
                db.session.flush()
            else:
                if p_mfg and not item.manufacturer:
                    item.manufacturer = p_mfg
                if p_hsn and not item.hsn_code:
                    item.hsn_code = p_hsn
                if p_formula:
                    item.formula = p_formula

            qty = 0
            try: qty = int(float(str(p.get('qty', 0))))
            except: qty = 0

            free_qty = 0
            try: free_qty = int(float(str(p.get('free', 0))))
            except: free_qty = 0

            total_stock_qty = qty + free_qty

            mrp = 0.0
            try: mrp = float(str(p.get('mrp', 0)))
            except: mrp = 0.0

            rate = 0.0
            try: rate = float(str(p.get('rate', 0)))
            except: rate = 0.0

            expiry = parse_expiry_date(p.get('expiry'))

            if is_duplicate_invoice:
                # ── Duplicate invoice path: compare against existing batch ──
                existing_batch = InventoryBatch.query.filter_by(
                    purchase_invoice_number=invoice_no,
                    product_id=item.id,
                    batch_number=p_batch,
                ).first()

                if existing_batch:
                    existing_qty = float(existing_batch.initial_quantity or existing_batch.quantity)
                    qty_diff = total_stock_qty - existing_qty
                    mrp_diff = abs(float(existing_batch.mrp or 0) - mrp)

                    if abs(qty_diff) < 0.01 and mrp_diff < 0.01:
                        # Completely identical — log and skip
                        history = InventoryHistory(
                            product_id=item.id,
                            batch_id=existing_batch.id,
                            purchase_invoice_number=invoice_no,
                            change_amount=0,
                            type='ADJUSTMENT',
                            notes='Duplicate invoice entry — no change made',
                            user_id=g.current_user.get('user_id'),
                            username=g.current_user.get('username'),
                        )
                        db.session.add(history)
                        warnings.append(f'{p_name}: duplicate entry — skipped (identical)')
                    else:
                        # Differences found — add adjustment batch
                        adj_batch = InventoryBatch(
                            product_id=item.id,
                            purchase_invoice_number=invoice_no,
                            batch_number=p_batch,
                            quantity=qty_diff,
                            initial_quantity=qty_diff,
                            free_quantity=0,
                            mrp=mrp,
                            purchase_rate=rate,
                            gst_rate=p_gst,
                            expiry_date=expiry,
                            created_by_user_id=g.current_user.get('user_id'),
                        )
                        db.session.add(adj_batch)
                        db.session.flush()
                        history = InventoryHistory(
                            product_id=item.id,
                            batch_id=adj_batch.id,
                            purchase_invoice_number=invoice_no,
                            change_amount=qty_diff,
                            type='ADJUSTMENT',
                            notes=f'Duplicate invoice — qty reconciled: {existing_qty:.0f} → {total_stock_qty:.0f}',
                            user_id=g.current_user.get('user_id'),
                            username=g.current_user.get('username'),
                        )
                        db.session.add(history)
                        warnings.append(f'{p_name}: qty adjusted by {qty_diff:+.0f}')
                else:
                    # New product row not in original invoice — add normally
                    new_batch = InventoryBatch(
                        product_id=item.id,
                        purchase_invoice_number=invoice_no,
                        batch_number=p_batch,
                        quantity=total_stock_qty,
                        initial_quantity=total_stock_qty,
                        free_quantity=free_qty,
                        mrp=mrp,
                        purchase_rate=rate,
                        gst_rate=p_gst,
                        expiry_date=expiry,
                        created_by_user_id=g.current_user.get('user_id'),
                    )
                    db.session.add(new_batch)
                    db.session.flush()
                    history = InventoryHistory(
                        product_id=item.id,
                        batch_id=new_batch.id,
                        purchase_invoice_number=invoice_no,
                        change_amount=total_stock_qty,
                        type='PURCHASE',
                        notes=f'Duplicate invoice — new line item added: {invoice_no}, Batch: {p_batch}',
                        user_id=g.current_user.get('user_id'),
                        username=g.current_user.get('username'),
                    )
                    db.session.add(history)

            else:
                # ── Normal (first-time) invoice path ──────────────────────
                new_batch = InventoryBatch(
                    product_id=item.id,
                    purchase_invoice_number=invoice_no,
                    batch_number=p_batch,
                    quantity=total_stock_qty,
                    initial_quantity=total_stock_qty,
                    free_quantity=free_qty,
                    mrp=mrp,
                    purchase_rate=rate,
                    gst_rate=p_gst,
                    expiry_date=expiry,
                    created_by_user_id=g.current_user.get('user_id'),
                )
                db.session.add(new_batch)
                db.session.flush()

                history = InventoryHistory(
                    product_id=item.id,
                    batch_id=new_batch.id,
                    purchase_invoice_number=invoice_no,
                    change_amount=total_stock_qty,
                    type='PURCHASE',
                    notes=f'Invoice: {invoice_no}, Batch: {p_batch}',
                    user_id=g.current_user.get('user_id'),
                    username=g.current_user.get('username'),
                )
                db.session.add(history)

        db.session.commit()

        log_activity(
            action='CREATE' if not is_duplicate_invoice else 'UPDATE',
            resource_type='purchase_invoice',
            resource_id=invoice_no,
            resource_label=f"{data.get('vendor_name', 'Unknown Vendor')} — {invoice_no}",
            details='Duplicate invoice reconciliation' if is_duplicate_invoice else None,
            user_id=g.current_user.get('user_id'),
            username=g.current_user.get('username'),
            ip_address=request.remote_addr,
        )

        msg = 'Duplicate invoice reconciled' if is_duplicate_invoice else 'Invoice Saved'
        return jsonify({
            'message': msg,
            'invoice_number': invoice_no,
            'warnings': warnings,
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 3: Verify**

Save an invoice, then save the exact same invoice again. The second response should include a `warnings` array listing each skipped duplicate line. Stock counts should not change on the second save.

---

## Task 5: Prevent negative inventory batches (CSV overwrite mode)

**Files:**
- Modify: `Backend_db/routes/inventory.py` — `import_inventory` function, overwrite mode block (~lines 1214–1239)

**Context:** When CSV overwrite calculates `diff = qty - current_qty` and diff is negative, it creates an `InventoryBatch` with `quantity=diff` (e.g., -5). That's invalid. Instead, reduce existing batches FIFO.

- [ ] **Step 1: Replace the `if mode == 'overwrite':` block**

Find:
```python
            if mode == 'overwrite':
                current_qty = db.session.query(func.sum(InventoryBatch.quantity)).filter(InventoryBatch.product_id == item.id).scalar() or 0
                diff = qty - current_qty
                
                if diff != 0:
                     batch = InventoryBatch(
                        product_id=item.id,
                        quantity=diff, 
                        ...
                     )
                     db.session.add(batch)
                     
                     hist = InventoryHistory(
                        product_id=item.id,
                        batch_id=batch.id, # will be None until flush? no, we need flush
                        change_amount=diff,
                        ...
                     )
                     db.session.add(hist)
```

Replace with:
```python
            if mode == 'overwrite':
                current_qty = float(db.session.query(func.sum(InventoryBatch.quantity)).filter(InventoryBatch.product_id == item.id).scalar() or 0)
                diff = qty - current_qty

                if abs(diff) < 0.01:
                    pass  # no change needed
                elif diff > 0:
                    # Add stock
                    batch = InventoryBatch(
                        product_id=item.id,
                        quantity=diff,
                        mrp=mrp,
                        purchase_rate=rate,
                        gst_rate=gst_rate,
                        expiry_date=expiry_date,
                        purchase_invoice_number=import_id,
                        batch_number=batch_num or 'ADJUST'
                    )
                    db.session.add(batch)
                    db.session.flush()

                    hist = InventoryHistory(
                        product_id=item.id,
                        batch_id=batch.id,
                        change_amount=diff,
                        type='ADJUSTMENT',
                        notes='CSV Import Overwrite — stock increase',
                        purchase_invoice_number=import_id
                    )
                    db.session.add(hist)
                else:
                    # Reduce stock FIFO — never create negative batches
                    to_reduce = abs(diff)
                    fifo_batches = InventoryBatch.query.filter(
                        InventoryBatch.product_id == item.id,
                        InventoryBatch.quantity > 0
                    ).order_by(InventoryBatch.expiry_date.asc()).all()

                    for fb in fifo_batches:
                        if to_reduce <= 0:
                            break
                        take = min(float(fb.quantity), to_reduce)
                        fb.quantity = float(fb.quantity) - take
                        to_reduce -= take

                    hist = InventoryHistory(
                        product_id=item.id,
                        batch_id=None,
                        change_amount=diff,
                        type='ADJUSTMENT',
                        notes='CSV Import Overwrite — stock reduction (FIFO)',
                        purchase_invoice_number=import_id
                    )
                    db.session.add(hist)
```

- [ ] **Step 2: Verify**

Import a CSV where the target quantity is less than current stock. Confirm no batch shows a negative `quantity` in the database, and the total qty matches the CSV target.

---

## Task 6: Fix CSV export headers and data alignment

**Files:**
- Modify: `Backend_db/routes/inventory.py` — `export_inventory` function (~lines 1049–1085)

**Context:**
- Old headers had 10 columns but rows had 9 values (offset by one from "Dosage" header with no data).
- "Avg Purchase Rate" column was confusing and contained averaged cost, not what users expect.
- "Max MRP" header was at position 9 but the data at position 9 was Earliest Expiry.
- New design: ID, Item Name, Pack Size, Category, Min Stock, Quantity, MRP, Expiry Date
- MRP = highest batch MRP per unit (what we sell at). Expiry = earliest active batch expiry.
- On import, "Total MRP" and "Total Qty" are computed — do not export/import them as authoritative.

- [ ] **Step 1: Replace the `export_inventory` function**

```python
@inventory.route('/inventory/export', methods=['GET'])
@require_auth
def export_inventory():
    items = ProductMaster.query.all()

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(['ID', 'Item Name', 'Pack Size', 'Category', 'Min Stock', 'Quantity', 'MRP', 'Expiry Date'])

    for item in items:
        total_qty = db.session.query(func.sum(InventoryBatch.quantity)).filter(
            InventoryBatch.product_id == item.id, InventoryBatch.quantity > 0
        ).scalar() or 0

        # Highest MRP across all batches (use for pricing)
        max_mrp = db.session.query(func.max(InventoryBatch.mrp)).filter(
            InventoryBatch.product_id == item.id
        ).scalar() or 0.0

        # Earliest active-stock expiry
        earliest_expiry = db.session.query(func.min(InventoryBatch.expiry_date)).filter(
            InventoryBatch.product_id == item.id, InventoryBatch.quantity > 0
        ).scalar()

        writer.writerow([
            item.id,
            item.item_name,
            item.pack_size or '',
            item.category or '',
            item.min_stock_level,
            int(total_qty),
            f"{float(max_mrp):.2f}",
            earliest_expiry.strftime('%m/%y') if earliest_expiry else '',
        ])

    output.seek(0)

    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'inventory_export_{get_ist_now().strftime("%Y%m%d")}.csv'
    )
```

- [ ] **Step 2: Update `import_inventory` field mapping to match new headers**

In the `import_inventory` function, update the `get_val` calls to recognise the new header names. Find the block that reads field values and update:

```python
            # ── Field extraction (supports both old and new header names) ──
            name = get_val(['Item Name', 'name', 'item'])
            if not name: continue

            pack_size = get_val(['Pack Size', 'pack', 'packs']) or ''

            qty_str = get_val(['Quantity', 'qty', 'Total Quantity']) or '0'
            try: qty = int(float(qty_str))
            except: qty = 0

            if qty <= 0 and mode == 'update': continue

            mrp_str = get_val(['MRP', 'price']) or '0'
            try: mrp = float(mrp_str)
            except: mrp = 0.0

            # Purchase rate: not in new export but keep reading if present in old CSVs
            rate_str = get_val(['Purchase Rate', 'rate', 'Avg Purchase Rate']) or '0'
            try: rate = float(rate_str)
            except: rate = 0.0

            gst_str = get_val(['GST', 'tax']) or '0'
            try: gst_rate = float(gst_str.replace('%', ''))
            except: gst_rate = 0.0

            batch_num = get_val(['Batch', 'batch no', 'Batch Number']) or ''

            exp_str = get_val(['Expiry Date', 'Expiry', 'exp', 'Earliest Expiry'])
            expiry_date = parse_expiry_date(exp_str)
```

(This replaces the existing set of `qty_str`, `mrp_str`, `rate_str`, `gst_str`, `batch_num`, `exp_str` lines.)

- [ ] **Step 3: Verify**

Export inventory as CSV. Open the file — confirm 8 columns, all correctly labelled and aligned. Import the exported CSV back — confirm quantities and MRPs are preserved.

---

## Task 7: Settings context — add `expiryReminderMonths`

**Files:**
- Modify: `frontend/lib/settings_context.tsx`

- [ ] **Step 1: Add the new field to the interface and provider**

Replace the entire file content with:

```tsx
"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'

interface SettingsContextType {
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    referenceDoctor: string
    appFontSize: number
    expiryReminderMonths: number
    setSettings: (settings: Partial<Omit<SettingsContextType, 'setSettings' | 'setPreviewFontSize'>>) => void
    setPreviewFontSize: (size: number | null) => void
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [clinicName, setClinicName] = useState("Teja Reddy Clinic")
    const [clinicAddress, setClinicAddress] = useState("#3145 Here and there, TS 500081")
    const [clinicPhone, setClinicPhone] = useState("+91 98765 43210")
    const [referenceDoctor, setReferenceDoctor] = useState("")
    const [appFontSize, setAppFontSize] = useState(16)
    const [expiryReminderMonths, setExpiryReminderMonths] = useState(6)
    const [previewFontSize, setPreviewFontSize] = useState<number | null>(null)

    const currentFontSize = previewFontSize !== null ? previewFontSize : appFontSize

    useEffect(() => {
        const storedName       = localStorage.getItem("clinic_name")
        const storedAddress    = localStorage.getItem("clinic_address")
        const storedPhone      = localStorage.getItem("clinic_phone")
        const storedRefDoc     = localStorage.getItem("clinic_ref_doc")
        const storedFontSize   = localStorage.getItem("clinic_font_size")
        const storedExpiry     = localStorage.getItem("expiry_reminder_months")

        if (storedName)    setClinicName(storedName)
        if (storedAddress !== null) setClinicAddress(storedAddress)
        if (storedPhone !== null)   setClinicPhone(storedPhone)
        if (storedRefDoc !== null)  setReferenceDoctor(storedRefDoc)
        if (storedFontSize) {
            const parsed = parseInt(storedFontSize, 10)
            if (!isNaN(parsed) && parsed >= 12 && parsed <= 24) setAppFontSize(parsed)
        }
        if (storedExpiry) {
            const parsed = parseInt(storedExpiry, 10)
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 24) setExpiryReminderMonths(parsed)
        }
    }, [])

    useEffect(() => {
        document.documentElement.style.fontSize = `${currentFontSize}px`
    }, [currentFontSize])

    const setSettings = (settings: Partial<Omit<SettingsContextType, 'setSettings'>>) => {
        if (settings.clinicName !== undefined) {
            setClinicName(settings.clinicName)
            localStorage.setItem("clinic_name", settings.clinicName)
        }
        if (settings.clinicAddress !== undefined) {
            setClinicAddress(settings.clinicAddress)
            localStorage.setItem("clinic_address", settings.clinicAddress)
        }
        if (settings.clinicPhone !== undefined) {
            setClinicPhone(settings.clinicPhone)
            localStorage.setItem("clinic_phone", settings.clinicPhone)
        }
        if (settings.referenceDoctor !== undefined) {
            setReferenceDoctor(settings.referenceDoctor)
            localStorage.setItem("clinic_ref_doc", settings.referenceDoctor)
        }
        if (settings.appFontSize !== undefined) {
            setAppFontSize(settings.appFontSize)
            localStorage.setItem("clinic_font_size", settings.appFontSize.toString())
        }
        if (settings.expiryReminderMonths !== undefined) {
            setExpiryReminderMonths(settings.expiryReminderMonths)
            localStorage.setItem("expiry_reminder_months", settings.expiryReminderMonths.toString())
        }
    }

    return (
        <SettingsContext.Provider value={{
            clinicName,
            clinicAddress,
            clinicPhone,
            referenceDoctor,
            appFontSize: currentFontSize,
            expiryReminderMonths,
            setSettings,
            setPreviewFontSize
        }}>
            {children}
        </SettingsContext.Provider>
    )
}

export function useSettings() {
    const context = useContext(SettingsContext)
    if (context === undefined) {
        throw new Error("useSettings must be used within a SettingsProvider")
    }
    return context
}
```

---

## Task 8: Update `api.ts` — `getInventory` accepts expiry months, `saveInvoice` returns warnings

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Update `getInventory`**

Find:
```typescript
    async getInventory(): Promise<InventoryItem[]> {
        return fetchApi('/api/inventory');
    },
```

Replace with:
```typescript
    async getInventory(expiryMonths?: number): Promise<InventoryItem[]> {
        const qs = expiryMonths ? `?expiry_months=${expiryMonths}` : '';
        return fetchApi(`/api/inventory${qs}`);
    },
```

- [ ] **Step 2: Update `saveInvoice` return type**

Find:
```typescript
    async saveInvoice(data: any): Promise<{ message: string; invoice_number: string }> {
```

Replace with:
```typescript
    async saveInvoice(data: any): Promise<{ message: string; invoice_number: string; warnings?: string[] }> {
```

---

## Task 9: Update inventory page — pass setting, fix currency, fix tab visibility

**Files:**
- Modify: `frontend/app/inventory/page.tsx`

- [ ] **Step 1: Destructure `expiryReminderMonths` from useSettings**

Find (around line 270):
```typescript
    const { appFontSize } = useSettings()
```

Replace with:
```typescript
    const { appFontSize, expiryReminderMonths } = useSettings()
```

- [ ] **Step 2: Pass the setting to `api.getInventory`**

Find (inside `loadData`):
```typescript
            const data = await api.getInventory()
```

Replace with:
```typescript
            const data = await api.getInventory(expiryReminderMonths)
```

- [ ] **Step 3: Fix dollar signs to rupee symbol**

Find (around line 830):
```typescript
                                                {visibleColumns.has('price') && <TableCell>
                                                    {`$${item.price}`}
                                                </TableCell>}
```

Replace with:
```typescript
                                                {visibleColumns.has('price') && <TableCell>
                                                    {`₹${item.price}`}
                                                </TableCell>}
```

Find (around line 836):
```typescript
                                                {visibleColumns.has('total_value') && <TableCell>
                                                    {item.total_value ? `$${item.total_value.toLocaleString()}` : '-'}
                                                </TableCell>}
```

Replace with:
```typescript
                                                {visibleColumns.has('total_value') && <TableCell>
                                                    {item.total_value ? `₹${item.total_value.toLocaleString()}` : '-'}
                                                </TableCell>}
```

- [ ] **Step 4: Make AllChangesPanel tab visible to all roles (not just doctor)**

Find (around line 519):
```typescript
                {role === 'doctor' && (
                    <TabsList>
                        <TabsTrigger value="inventory">Inventory</TabsTrigger>
                        <TabsTrigger value="all-changes">All Changes</TabsTrigger>
                    </TabsList>
                )}
```

Replace with:
```typescript
                <TabsList>
                    <TabsTrigger value="inventory">Inventory</TabsTrigger>
                    <TabsTrigger value="all-changes">All Changes</TabsTrigger>
                </TabsList>
```

---

## Task 10: Fix `invoice_edit` — replace `alert()` with `toast()`

**Files:**
- Modify: `frontend/app/inventory/invoice_edit/page.tsx`

- [ ] **Step 1: Replace the `handleSave` function body**

Find (around line 172):
```typescript
    const handleSave = async () => {
        setSaving(true)
        try {
            const payload = {
                invoice_number: invoiceNo,
                gst_number: gstNo,
                total_amount: totalAmount,
                vendor_name: vendorName,
                image_path: imagePath,
                product_details: rows
            }
            await api.saveInvoice(payload)

            // Clean up
            sessionStorage.removeItem("currentInvoice")
            alert("Saved successfully!")
            window.location.href = "/inventory"
        } catch (e) {
            alert("Failed to save: " + e)
        } finally {
            setSaving(false)
        }
    }
```

Replace with:
```typescript
    const handleSave = async () => {
        setSaving(true)
        try {
            const payload = {
                invoice_number: invoiceNo,
                gst_number: gstNo,
                total_amount: totalAmount,
                vendor_name: vendorName,
                image_path: imagePath,
                product_details: rows
            }
            const result = await api.saveInvoice(payload)

            if (result.warnings && result.warnings.length > 0) {
                result.warnings.forEach(w => toast.warning(w))
            }

            sessionStorage.removeItem("currentInvoice")
            toast.success(result.message || "Saved successfully!")
            setTimeout(() => { window.location.href = "/inventory" }, 800)
        } catch (e) {
            toast.error("Failed to save: " + (e instanceof Error ? e.message : String(e)))
        } finally {
            setSaving(false)
        }
    }
```

---

## Task 11: Admin page — add Settings tab with expiry reminder control

**Files:**
- Modify: `frontend/app/admin/page.tsx`

- [ ] **Step 1: Add `useSettings` import**

Find the imports block (near the top of the file). Add after the existing imports:
```typescript
import { useSettings } from "@/lib/settings_context"
```

- [ ] **Step 2: Add a `SettingsTab` component** before the default export function

Add this component anywhere before the main `export default` function in the file:

```typescript
function SettingsTab() {
    const { expiryReminderMonths, setSettings } = useSettings()
    const [localMonths, setLocalMonths] = useState(expiryReminderMonths)

    const handleSave = () => {
        const val = Math.max(1, Math.min(24, localMonths))
        setSettings({ expiryReminderMonths: val })
        toast.success(`Expiry reminder set to ${val} months`)
    }

    return (
        <div className="space-y-6 max-w-lg">
            <div>
                <h2 className="text-lg font-semibold mb-1">Inventory Settings</h2>
                <p className="text-sm text-muted-foreground">
                    These settings apply across all inventory tables and dashboards.
                </p>
            </div>
            <div className="rounded-lg border p-4 space-y-4">
                <div className="space-y-1">
                    <label className="text-sm font-medium">Expiry Reminder (months)</label>
                    <p className="text-xs text-muted-foreground">
                        Items expiring within this many months will be flagged as "Expires Soon".
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                        <input
                            type="number"
                            min={1}
                            max={24}
                            value={localMonths}
                            onChange={e => setLocalMonths(parseInt(e.target.value, 10) || 1)}
                            className="w-24 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-sm text-muted-foreground">months (1–24)</span>
                    </div>
                </div>
                <Button size="sm" onClick={handleSave}>Save Settings</Button>
            </div>
        </div>
    )
}
```

Note: `SettingsTab` uses `useState` — add `useState` to the import if not already there. Check the existing import line:
```typescript
import { useState, useEffect, ... } from "react"
```
`useState` should already be imported. If not, add it.

Also `toast` from `"sonner"` — check if it's imported. If not add:
```typescript
import { toast } from "sonner"
```

- [ ] **Step 3: Add the Settings tab trigger and content**

Find the TabsList section (around line 772):
```typescript
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
```

Add a new trigger:
```typescript
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
```

Find the last `</TabsContent>` closing the activity tab (around line 787):
```typescript
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
```

Add after it:
```typescript
        <TabsContent value="settings" className="mt-4">
          <SettingsTab />
        </TabsContent>
```

- [ ] **Step 4: Verify**

Open the admin page → Settings tab. Change the expiry reminder to 2 months and save. Navigate to Inventory. Items expiring within 2 months should show "EXPIRES SOON". Reload the admin page — the setting should still show 2 months (from localStorage).

---

## Self-Review Checklist

**Spec coverage:**
- [x] Duplicate invoice warning + compare-and-adjust (Task 4)
- [x] OCR vendor name fix (Task 1)
- [x] Invoice date = upload date (Task 4 — `invoice_date=get_ist_now().date()`)
- [x] Expiry off-by-one fix (Task 2)
- [x] Expiry soon threshold changed to 6 months (Task 2)
- [x] Expiry threshold configurable in settings (Tasks 7, 8, 9, 11)
- [x] "Common for all tables" — param passed to analytics endpoint too (Task 2)
- [x] N+1 query optimization (Task 3)
- [x] Negative batches prevented (Task 5)
- [x] CSV export headers fixed — no Dosage, correct alignment (Task 6)
- [x] Avg Purchase Rate removed → MRP per unit (Task 6)
- [x] Max MRP vs Expiry Date column confusion fixed (Task 6)
- [x] Import ignores calculated fields, uses Qty + MRP (Task 6)
- [x] ₹ symbol everywhere in inventory table (Task 9)
- [x] `alert()` → `toast()` in invoice_edit (Task 10)
- [x] AllChangesPanel tab visible to all roles (Task 9)

**Gaps found:** None.

**Type consistency:** `saveInvoice` returns `{ message, invoice_number, warnings? }` — used correctly in Task 10. `getInventory(expiryMonths?)` — used correctly in Task 9. `expiryReminderMonths` in context — consistent across Tasks 7, 8, 9, 11.
