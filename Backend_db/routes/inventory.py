
from flask import Blueprint, request, jsonify, send_file, g
from extensions import db, get_ist_now
from models import ProductMaster, InventoryBatch, InventoryHistory, PurchaseInvoice, BillItem
from sqlalchemy import func, case
import io
import csv
import os
import requests as http_requests

from utils import parse_expiry_date
from .auth import require_auth, require_admin, log_activity

def _parse_vision_response(vision_result: dict) -> dict:
    """
    Parse a Google Cloud Vision DOCUMENT_TEXT_DETECTION response into the same
    structured format that the PaddleOCR microservice produced:
        {metadata: {invoice_no, date, gst_no, vendor_name},
         line_items: [...],
         summary: {total_amount, net_payable}}
    """
    import re

    responses = vision_result.get('responses', [])
    if not responses:
        return {'error': 'No text detected in image'}

    full_text_annotation = responses[0].get('fullTextAnnotation')
    if not full_text_annotation:
        return {'error': 'No text detected in image'}

    pages = full_text_annotation.get('pages', [])
    if not pages:
        return {'error': 'No text detected in image'}

    # ------------------------------------------------------------------
    # Step 1: Extract all words with their bounding-box positions.
    # Each word entry: {'text': str, 'center_y': float, 'left_x': float}
    # ------------------------------------------------------------------
    raw_words = []
    for block in pages[0].get('blocks', []):
        for para in block.get('paragraphs', []):
            for word in para.get('words', []):
                symbols = word.get('symbols', [])
                text = ''.join(s.get('text', '') for s in symbols)
                if not text.strip():
                    continue
                vertices = word.get('boundingBox', {}).get('vertices', [])
                if len(vertices) >= 3:
                    center_y = (vertices[0].get('y', 0) + vertices[2].get('y', 0)) / 2
                    left_x = vertices[0].get('x', 0)
                else:
                    center_y = 0
                    left_x = 0
                raw_words.append({'text': text, 'center_y': center_y, 'left_x': left_x})

    if not raw_words:
        return {'error': 'No text detected in image'}

    # ------------------------------------------------------------------
    # Step 2: Group words into logical text lines (cluster by center_y).
    # ------------------------------------------------------------------
    raw_words.sort(key=lambda w: (w['center_y'], w['left_x']))

    text_lines = []   # list of {'words': [...], 'y': float, 'text': str}
    current_group = []
    group_y = raw_words[0]['center_y']

    for word in raw_words:
        if abs(word['center_y'] - group_y) <= 10:
            current_group.append(word)
        else:
            current_group.sort(key=lambda w: w['left_x'])
            line_text = ' '.join(w['text'] for w in current_group)
            text_lines.append({
                'words': current_group,
                'y': group_y,
                'text': line_text
            })
            current_group = [word]
            group_y = word['center_y']

    if current_group:
        current_group.sort(key=lambda w: w['left_x'])
        line_text = ' '.join(w['text'] for w in current_group)
        text_lines.append({
            'words': current_group,
            'y': group_y,
            'text': line_text
        })

    all_text = '\n'.join(ln['text'] for ln in text_lines)

    # ------------------------------------------------------------------
    # Step 3: Extract metadata via regex over the full text.
    # ------------------------------------------------------------------
    metadata = {'invoice_no': '', 'date': '', 'gst_no': '', 'vendor_name': ''}

    # Invoice number
    inv_match = re.search(
        r'(?:Invoice\s*(?:No\.?|#|Number)|Bill\s*No\.?)[:\s]*([A-Za-z0-9/\-]+)',
        all_text, re.IGNORECASE
    )
    if inv_match:
        metadata['invoice_no'] = inv_match.group(1).strip()

    # Date
    date_match = re.search(
        r'(?:Date[:\s]+)(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
        all_text, re.IGNORECASE
    )
    if not date_match:
        date_match = re.search(r'\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b', all_text)
    if date_match:
        metadata['date'] = date_match.group(1).strip()

    # GST number (standard Indian GSTIN format)
    gst_match = re.search(
        r'\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Z][A-Z\d])\b',
        all_text
    )
    if gst_match:
        metadata['gst_no'] = gst_match.group(1)

    # Vendor name: first non-empty line that appears before any "invoice"/"bill" keyword
    # and looks like a business name (not purely numeric, length > 3).
    invoice_keyword_re = re.compile(r'\b(invoice|bill|tax\s+invoice)\b', re.IGNORECASE)
    for ln in text_lines:
        lt = ln['text'].strip()
        if not lt or len(lt) <= 3:
            continue
        if invoice_keyword_re.search(lt):
            break
        if not re.match(r'^[\d\W]+$', lt):
            metadata['vendor_name'] = lt
            break

    # ------------------------------------------------------------------
    # Step 4: Find the table header row.
    # ------------------------------------------------------------------
    header_keywords = {'product', 'item', 'description', 'batch', 'qty', 'mrp', 'rate', 'amount'}
    header_line_idx = -1
    best_match_count = 0

    for i, ln in enumerate(text_lines):
        lt_lower = ln['text'].lower()
        matches = sum(1 for kw in header_keywords if kw in lt_lower)
        if matches > best_match_count:
            best_match_count = matches
            header_line_idx = i

    # ------------------------------------------------------------------
    # Step 5: Parse line items from rows after the header.
    # ------------------------------------------------------------------
    line_items = []
    total_stop_re = re.compile(
        r'\b(total|net\s+payable|amount\s+payable|grand\s+total|sub\s*total)\b',
        re.IGNORECASE
    )

    if header_line_idx >= 0:
        header_line = text_lines[header_line_idx]
        header_words = header_line['words']

        # Build column definitions from header words.
        columns = []
        for hw in header_words:
            ht = hw['text'].lower()
            col_name = 'unknown'
            if re.search(r'product|name|desc|item', ht): col_name = 'product_name'
            elif 'batch' in ht:                          col_name = 'batch'
            elif re.search(r'\bexp', ht):                col_name = 'exp'
            elif 'qty' in ht:                            col_name = 'qty'
            elif re.search(r'mrp|m\.r\.p', ht):         col_name = 'mrp'
            elif 'rate' in ht:                           col_name = 'rate'
            elif 'amount' in ht:                         col_name = 'amount'
            elif 'pack' in ht:                           col_name = 'pack'
            elif 'mfg' in ht:                            col_name = 'mfg'
            elif 'free' in ht:                           col_name = 'free'
            elif re.search(r'dis', ht):                  col_name = 'discount'
            elif 'gst' in ht:                            col_name = 'gst'
            elif 'hsn' in ht:                            col_name = 'hsn'
            columns.append({'name': col_name, 'center_x': hw['left_x']})

        for ln in text_lines[header_line_idx + 1:]:
            lt = ln['text'].strip()
            if not lt:
                continue
            if total_stop_re.search(lt):
                break

            item_data = {}
            for word in ln['words']:
                wx = word['left_x']
                # Assign to closest column by x distance.
                if not columns:
                    break
                best_col = min(columns, key=lambda c: abs(wx - c['center_x']))
                col_name = best_col['name']
                if col_name in item_data:
                    item_data[col_name] += ' ' + word['text']
                else:
                    item_data[col_name] = word['text']

            # Clean numeric columns.
            for num_col in ('mrp', 'rate', 'amount'):
                if num_col in item_data:
                    val = re.sub(r'(?i)(rs\.?|inr)\s*', '', item_data[num_col]).strip()
                    if ' ' in val:
                        val = val.split()[0]
                    item_data[num_col] = val

            # Clean product name: strip leading serial numbers / punctuation.
            if 'product_name' in item_data:
                item_data['product_name'] = re.sub(
                    r'^[\d\s\*\.\-\'\"]+', '', item_data['product_name']
                ).strip()

            # Validate: needs a product name or amount plus at least one numeric field.
            has_product = bool(item_data.get('product_name', '').strip())
            has_numeric = any(k in item_data for k in ('qty', 'rate', 'mrp', 'amount', 'batch'))
            noise_words = ('rupees', ' only', 'total', 'grand', 'signature', 'authorize')
            is_noise = any(x in item_data.get('product_name', '').lower() for x in noise_words)

            if has_product and has_numeric and not is_noise:
                row = {
                    'product_name': item_data.get('product_name', ''),
                    'batch':        item_data.get('batch', ''),
                    'exp':          item_data.get('exp', ''),
                    'qty':          item_data.get('qty', ''),
                    'mrp':          item_data.get('mrp', ''),
                    'rate':         item_data.get('rate', ''),
                    'free':         item_data.get('free', ''),
                    'mfg':          item_data.get('mfg', ''),
                    'pack':         item_data.get('pack', ''),
                    'hsn':          item_data.get('hsn', ''),
                    'gst':          item_data.get('gst', ''),
                    'amount':       item_data.get('amount', ''),
                }
                line_items.append(row)

    # ------------------------------------------------------------------
    # Step 6: Extract summary (total / net payable) from bottom lines.
    # ------------------------------------------------------------------
    summary = {'total_amount': '', 'net_payable': ''}
    if text_lines:
        page_bottom = text_lines[-1]['y']
        threshold_y = page_bottom * 0.70

        amount_candidates = []
        for ln in text_lines:
            if ln['y'] < threshold_y:
                continue
            lt = ln['text']
            clean = re.sub(r'(?i)(rs\.?|inr|,)', '', lt).strip()
            for m in re.findall(r'\d+(?:\.\d{1,2})?', clean):
                try:
                    val = float(m)
                    if val > 0 and val < 1_000_000:
                        amount_candidates.append(val)
                except ValueError:
                    pass

        if amount_candidates:
            max_val = max(amount_candidates)
            summary['total_amount'] = f'{max_val:.2f}'
            summary['net_payable'] = f'{max_val:.2f}'

    return {
        'metadata': metadata,
        'line_items': line_items,
        'summary': summary,
    }


def _run_ocr(filepath: str) -> dict:
    """
    Call Google Cloud Vision DOCUMENT_TEXT_DETECTION on a local image file,
    then parse the response into the standard OCR result structure.
    """
    import base64

    api_key = os.environ.get('GOOGLE_CLOUD_API_KEY', '').strip()
    if not api_key:
        return {
            'error': (
                'Google Cloud Vision API key not configured — '
                'set GOOGLE_CLOUD_API_KEY in Render dashboard'
            )
        }

    try:
        with open(filepath, 'rb') as f:
            image_b64 = base64.b64encode(f.read()).decode('utf-8')
    except OSError as e:
        return {'error': f'OCR error: OSError: {e}'}

    url = f'https://vision.googleapis.com/v1/images:annotate?key={api_key}'
    payload = {
        'requests': [{
            'image': {'content': image_b64},
            'features': [{'type': 'DOCUMENT_TEXT_DETECTION'}],
        }]
    }

    try:
        resp = http_requests.post(url, json=payload, timeout=30)
    except http_requests.Timeout:
        return {'error': 'Vision API timed out'}
    except Exception as e:
        return {'error': f'OCR error: {type(e).__name__}: {str(e)}'}

    if resp.status_code != 200:
        try:
            err_msg = resp.json().get('error', {}).get('message', resp.text[:200])
        except Exception:
            err_msg = resp.text[:200]
        return {'error': f'Vision API error: {err_msg}'}

    try:
        vision_result = resp.json()
    except Exception as e:
        return {'error': f'OCR error: failed to parse Vision response: {e}'}

    # Surface any per-request errors returned inside the 200 response body.
    responses = vision_result.get('responses', [])
    if responses and 'error' in responses[0]:
        err_msg = responses[0]['error'].get('message', 'unknown Vision error')
        return {'error': f'Vision API error: {err_msg}'}

    return _parse_vision_response(vision_result)

_EMPTY_OCR: dict = {
    'product_details': [],
    'invoice_number': '',
    'gst_number': '',
    'total_amount': '',
    'vendor_name': '',
}

def _transform_ocr_result(ocr_result: dict) -> dict:
    """
    Translate the OCR microservice response schema into the flat schema that
    the frontend (UploadInventoryReportDialog / invoice_edit) expects.

    OCR service returns:
        {
            "metadata": {"invoice_no": ..., "date": ..., "gst_no": ..., "vendor_name": ...},
            "line_items": [{"product_name", "batch", "exp", "qty", "mrp",
                            "rate", "free", "mfg", "pack", "hsn", "gst",
                            "amount"}, ...],
            "summary":   {"total_amount": ..., "net_payable": ...}
        }

    Frontend expects:
        {
            "product_details": [{"product_name", "batch", "expiry", "qty",
                                 "mrp", "rate", "free", "mfg", "pack", "hsn",
                                 "gst", "amount"}, ...],
            "invoice_number": str,
            "gst_number":     str,
            "total_amount":   str,
            "vendor_name":    str   (best-effort: first header line before invoice keyword)
        }

    Error dicts ({"error": "..."}) are passed through unchanged so the
    frontend can surface the message to the user.
    """
    if not ocr_result:
        return dict(_EMPTY_OCR)

    # Pass error responses straight through.
    if 'error' in ocr_result:
        return ocr_result

    metadata = ocr_result.get('metadata') or {}
    line_items = ocr_result.get('line_items') or []
    summary = ocr_result.get('summary') or {}

    # Remap each line item: exp → expiry; all other fields kept as-is.
    product_details = []
    for item in line_items:
        transformed = dict(item)
        if 'exp' in transformed and 'expiry' not in transformed:
            transformed['expiry'] = transformed.pop('exp')
        product_details.append(transformed)

    total_amount = (
        summary.get('total_amount')
        or summary.get('net_payable')
        or ''
    )

    return {
        'product_details': product_details,
        'invoice_number': metadata.get('invoice_no') or '',
        'gst_number': metadata.get('gst_no') or '',
        'total_amount': str(total_amount) if total_amount != '' else '',
        'vendor_name': metadata.get('vendor_name') or '',
    }

inventory = Blueprint('inventory', __name__)

@inventory.route('/inventory', methods=['GET'])
@require_auth
def get_inventory():
    """
    Returns Master ProductMaster Items + Aggregated Stock
    """
    try:
        expiry_months = max(1, min(int(request.args.get('expiry_months', 6)), 24))
    except (ValueError, TypeError):
        expiry_months = 6
    today = get_ist_now().date()
    items = ProductMaster.query.order_by(ProductMaster.item_name.asc()).all()
    if not items:
        return jsonify([]), 200

    product_ids = [item.id for item in items]

    # ── Query 1: batch aggregates (replaces 5 per-product queries) ─────────
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

    # ── Query 2: current MRP = first active batch FIFO per product ─────────
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
    empty_stats = {
        'total_qty': 0.0, 'max_mrp': 0.0, 'min_mrp': 0.0,
        'total_value': 0.0, 'earliest_expiry': None
    }
    results = []

    for item in items:
        stats = stats_map.get(item.id, empty_stats)
        total_qty       = stats['total_qty']
        max_mrp         = stats['max_mrp']
        min_mrp         = stats['min_mrp']
        total_value     = stats['total_value']
        earliest_expiry = stats['earliest_expiry']
        current_mrp     = current_mrp_map.get(item.id, max_mrp)
        vendor_list     = vendors_map.get(item.id, [])

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
                days_until_expiry = (earliest_expiry - today).days
                if days_until_expiry <= expiry_months * 30:
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

@inventory.route('/inventory_analytics', methods=['GET'])
@require_auth
def get_inventory_analytics():
    from models import PurchaseInvoice, BillItem, ProductMaster, InventoryBatch, Visit, Bill, ExpenseLedger
    from datetime import date, timedelta, datetime
    from sqlalchemy import extract, desc

    loc = request.args.get('location')
    today = get_ist_now().date()
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)

    # Helper to inject location filter uniformly if provided
    def loc_f(q, model):
        if loc and loc != 'all':
            # Ensure model actually has location column attribute to be safe
            if hasattr(model, 'location'):
                return q.filter(model.location == loc)
        return q

    # ── Ledger Aggregations (The NEW Pie & Expense Feed) ──────────────────
    ledger_base = ExpenseLedger.query
    if loc and loc != 'all':
        ledger_base = ledger_base.filter(ExpenseLedger.location == loc)
        
    total_ledger_cost = float(db.session.query(func.sum(ExpenseLedger.amount)).filter(ExpenseLedger.id.in_([x.id for x in ledger_base])).scalar() or 0)
    
    month_ledger_q = ledger_base.filter(func.date(ExpenseLedger.date) >= month_start)
    month_ledger_cost = float(db.session.query(func.sum(ExpenseLedger.amount)).filter(ExpenseLedger.id.in_([x.id for x in month_ledger_q])).scalar() or 0)
    
    year_ledger_q = ledger_base.filter(func.date(ExpenseLedger.date) >= year_start)
    year_ledger_cost = float(db.session.query(func.sum(ExpenseLedger.amount)).filter(ExpenseLedger.id.in_([x.id for x in year_ledger_q])).scalar() or 0)

    # Ledger Category Breakdown (For Pie Chart)
    ledger_cats = db.session.query(
        ExpenseLedger.category,
        func.sum(ExpenseLedger.amount)
    ).filter(ExpenseLedger.id.in_([x.id for x in ledger_base])).group_by(ExpenseLedger.category).all()
    
    ledger_distribution = [{"label": c or "Generic", "value": float(v)} for c, v in ledger_cats if v]

    # ── Raw Purchase Invoice Costs (Physical Stock Inflow) ─────────────────
    pi_q = loc_f(PurchaseInvoice.query, PurchaseInvoice)
    total_pi_cost = float(db.session.query(func.sum(PurchaseInvoice.total_amount)).filter(PurchaseInvoice.invoice_number.in_([p.invoice_number for p in pi_q])).scalar() or 0)
    
    # COMBINED OUTCOMES (Per User Brief: Invoice + Manual Ledger)
    total_outcome = total_pi_cost + total_ledger_cost
    
    month_pi_cost = float(db.session.query(func.sum(PurchaseInvoice.total_amount)).filter(
        PurchaseInvoice.invoice_number.in_([p.invoice_number for p in pi_q]),
        func.date(PurchaseInvoice.invoice_date) >= month_start
    ).scalar() or 0)
    month_outcome = month_pi_cost + month_ledger_cost

    year_pi_cost = float(db.session.query(func.sum(PurchaseInvoice.total_amount)).filter(
        PurchaseInvoice.invoice_number.in_([p.invoice_number for p in pi_q]),
        func.date(PurchaseInvoice.invoice_date) >= year_start
    ).scalar() or 0)
    year_outcome = year_pi_cost + year_ledger_cost

    # ── Medicine Revenue (Pharmacy Income) ────────────────────────────────
    bill_base = loc_f(Bill.query, Bill)
    bill_ids = [b.invoice_id for b in bill_base]
    
    total_med_rev = 0
    month_med_rev = 0
    year_med_rev = 0
    today_med_rev = 0

    if bill_ids:
        total_med_rev = float(db.session.query(func.sum(BillItem.total_value)).filter(BillItem.bill_id.in_(bill_ids)).scalar() or 0)
        month_med_rev = float(db.session.query(func.sum(BillItem.total_value)).join(Bill).filter(
            Bill.invoice_id.in_(bill_ids), func.date(Bill.created_at) >= month_start
        ).scalar() or 0)
        year_med_rev = float(db.session.query(func.sum(BillItem.total_value)).join(Bill).filter(
            Bill.invoice_id.in_(bill_ids), func.date(Bill.created_at) >= year_start
        ).scalar() or 0)
        today_med_rev = float(db.session.query(func.sum(BillItem.total_value)).join(Bill).filter(
            Bill.invoice_id.in_(bill_ids), func.date(Bill.created_at) == today
        ).scalar() or 0)

    # ── Visit Fees (Consultation Income) ───────────────────────────────────
    v_q = loc_f(Visit.query, Visit)
    v_ids = [v.visit_id for v in v_q]
    
    total_visit_fees = 0
    month_visit_fees = 0
    year_visit_fees = 0
    today_visit_fees = 0
    total_visits_count = 0

    if v_ids:
        total_visit_fees = float(db.session.query(func.sum(Visit.amount_paid)).filter(Visit.visit_id.in_(v_ids)).scalar() or 0)
        month_visit_fees = float(db.session.query(func.sum(Visit.amount_paid)).filter(Visit.visit_id.in_(v_ids), func.date(Visit.created_at) >= month_start).scalar() or 0)
        year_visit_fees = float(db.session.query(func.sum(Visit.amount_paid)).filter(Visit.visit_id.in_(v_ids), func.date(Visit.created_at) >= year_start).scalar() or 0)
        today_visit_fees = float(db.session.query(func.sum(Visit.amount_paid)).filter(Visit.visit_id.in_(v_ids), func.date(Visit.created_at) == today).scalar() or 0)
        total_visits_count = Visit.query.filter(Visit.visit_id.in_(v_ids), Visit.status != 'deleted').count()

    # Total Income = Medicine + Consult
    total_income = total_med_rev + total_visit_fees
    month_income = month_med_rev + month_visit_fees
    year_income = year_med_rev + year_visit_fees
    today_income = today_med_rev + today_visit_fees

    # ── Today breakdown by payment type (Dimensionalized) ────────────────
    today_payment_q = []
    if bill_ids:
        today_payment_q = db.session.query(
            Bill.payment_type,
            func.sum(Bill.total_amount)
        ).filter(Bill.invoice_id.in_(bill_ids), func.date(Bill.created_at) == today).group_by(Bill.payment_type).all()
    
    today_by_payment = [{'type': (t or 'Other').upper(), 'value': float(v)} for t, v in today_payment_q if v]

    # ── Stock Current Total Asset Value ──────────────────────────────────
    # Asset value is global usually, but could be filtered if inventory batches held locations (omitted for simplicity now)
    total_current_value = float(db.session.query(func.sum(InventoryBatch.mrp * InventoryBatch.quantity)).filter(InventoryBatch.quantity > 0).scalar() or 0)

    # ── Weekly and Daily distributions for "Busy Matrix" ────────────────
    # Query counts grouped by DOW (Day of Week) for overall traffic
    busy_dow_q = db.session.query(
        extract('dow', Visit.created_at).label('dow'),
        func.count(Visit.visit_id)
    ).filter(Visit.status != 'deleted')
    if v_ids:
        busy_dow_q = busy_dow_q.filter(Visit.visit_id.in_(v_ids))
    busy_dow = busy_dow_q.group_by('dow').all()
    
    # Map PostgreSQL DOW (0=Sun, 1=Mon...)
    dow_map = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 0: "Sun"}
    dow_data = [{"d": dow_map.get(int(d), str(d)), "c": c} for d, c in busy_dow]

    # ── 🟢 NEW INVENTORY SPECIFIC QUERIES ─────────────────────────────────
    # 1. Top Selling Products
    top_items_q = db.session.query(
        ProductMaster.item_name,
        func.sum(BillItem.quantity).label('qty'),
        func.sum(BillItem.total_value).label('rev')
    ).join(BillItem, ProductMaster.id == BillItem.product_id)\
    .group_by(ProductMaster.item_name)\
    .order_by(desc('qty'))\
    .limit(8).all()
    
    top_items = [{'name': t[0], 'qty_sold': float(t[1] or 0), 'revenue': float(t[2] or 0)} for t in top_items_q]

    # 2. Low Stock Warning
    low_stock_q = db.session.query(
        ProductMaster.item_name,
        func.sum(InventoryBatch.quantity).label('qty'),
        ProductMaster.min_stock_level
    ).join(InventoryBatch, ProductMaster.id == InventoryBatch.product_id)\
    .group_by(ProductMaster.id, ProductMaster.item_name, ProductMaster.min_stock_level)\
    .having(func.sum(InventoryBatch.quantity) <= ProductMaster.min_stock_level)\
    .order_by('qty').all()
    
    raw_stock_list = [{'name': l[0], 'qty': float(l[1] or 0), 'threshold': l[2]} for l in low_stock_q]
    out_of_stock = [s for s in raw_stock_list if s['qty'] <= 0]
    low_stock = [s for s in raw_stock_list if s['qty'] > 0]

    # 3. Expiring (Configurable horizon) - Partitioned into Expired vs Expiring Soon
    try:
        expiry_months = max(1, min(int(request.args.get('expiry_months', 6)), 24))
    except (ValueError, TypeError):
        expiry_months = 6
    expiry_horizon = today + timedelta(days=expiry_months * 30)
    expiring_q = db.session.query(
        ProductMaster.item_name,
        InventoryBatch.expiry_date,
        InventoryBatch.quantity
    ).join(InventoryBatch, ProductMaster.id == InventoryBatch.product_id)\
    .filter(InventoryBatch.quantity > 0, InventoryBatch.expiry_date <= expiry_horizon)\
    .order_by(InventoryBatch.expiry_date).all()
    
    raw_expiring = []
    for e in expiring_q:
        raw_expiring.append({
            'name': e[0],
            'dt': e[1],
            'expiry': e[1].strftime('%Y-%m-%d') if e[1] else 'N/A',
            'qty': float(e[2] or 0)
        })
        
    expired = [{ 'name': x['name'], 'expiry': x['expiry'], 'qty': x['qty'] } for x in raw_expiring if x['dt'] and x['dt'] < today]
    expiring_soon = [{ 'name': x['name'], 'expiry': x['expiry'], 'qty': x['qty'] } for x in raw_expiring if x['dt'] and x['dt'] >= today]

    # 4. Recent Purchase Invoices History
    inv_history_q = db.session.query(
        PurchaseInvoice.invoice_number,
        PurchaseInvoice.invoice_date,
        PurchaseInvoice.vendor_name,
        PurchaseInvoice.total_amount
    ).order_by(desc(PurchaseInvoice.invoice_date)).limit(10).all()
    
    invoice_history = [{
        'id': h[0],
        'date': h[1].strftime('%Y-%m-%d') if h[1] else 'N/A',
        'vendor': h[2] or 'Unknown Vendor',
        'amount': float(h[3] or 0)
    } for h in inv_history_q]

    return jsonify({
        # Master Dimension Splits ready for direct frontend feeding
        'all': {
            'income': total_income,
            'outcome': total_outcome,
            'net': total_income - total_outcome,
            'pharmRev': total_med_rev,
            'consultRev': total_visit_fees,
            'visits': total_visits_count
        },
        'year': {
            'income': year_income,
            'outcome': year_outcome,
            'net': year_income - year_outcome,
            'pharmRev': year_med_rev,
            'consultRev': year_visit_fees,
        },
        'month': {
            'income': month_income,
            'outcome': month_outcome,
            'net': month_income - month_outcome,
            'pharmRev': month_med_rev,
            'consultRev': month_visit_fees,
        },
        'today': {
            'income': today_income,
            'outcome': 0, # Ledger logic for single day outcomes usually zero unless explicitly logged today
            'net': today_income,
            'pharmRev': today_med_rev,
            'consultRev': today_visit_fees,
        },
        
        # Specific Detailed Breakdowns
        'ledger_expense_pie': ledger_distribution,
        'sitting_inventory_value': total_current_value,
        'busy_day_matrix': dow_data,
        'today_by_payment': today_by_payment,

        # Extended Inventory Data Modules for Dashboard
        'top_items': top_items,
        'low_stock': low_stock,
        'out_of_stock': out_of_stock,
        'expiring_soon': expiring_soon,
        'expired': expired,
        'invoice_history': invoice_history,
        
        # Backwards compatibility hooks (legacy items just in case other pages read them)
        'total_purchase_cost': total_pi_cost,
        'medicine_revenue': total_med_rev,
        'total_visits': total_visits_count,
        'visit_fees_collected': total_visit_fees,
    }), 200

@inventory.route('/inventory/<string:product_id>/history', methods=['GET'])
@require_auth
def get_inventory_history(product_id):
    """Returns paginated movement history for a specific inventory item"""
    product = ProductMaster.query.get(product_id)
    if not product:
        return jsonify({'error': 'Product not found'}), 404

    try:
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 50))
    except ValueError:
        return jsonify({'error': 'Invalid page or limit parameter'}), 400

    records = (
        InventoryHistory.query
        .filter_by(product_id=product_id)
        .order_by(InventoryHistory.timestamp.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    history = []
    for r in records:
        history.append({
            'id': r.id,
            'type': r.type,
            'change_amount': r.change_amount,
            'batch_id': r.batch_id,
            'bill_id': r.bill_id,
            'timestamp': r.timestamp.isoformat() if r.timestamp else None,
        })

    return jsonify({
        'product_id': product_id,
        'history': history,
        'page': page,
        'limit': limit,
    }), 200

@inventory.route('/inventory/<string:id>/batches', methods=['GET'])
@require_auth
def get_inventory_batches(id):
    """Returns all active batches for a specific inventory item"""
    batches = InventoryBatch.query.filter_by(product_id=id).filter(InventoryBatch.quantity > 0).all()
    
    results = []
    for b in batches:
        vendor_name = None
        if b.purchase_invoice_number:
            inv = PurchaseInvoice.query.get(b.purchase_invoice_number)
            if inv: vendor_name = inv.vendor_name
            
        results.append({
            'id': b.id,
            'quantity': b.quantity,
            'expiry_date': b.expiry_date.strftime('%m/%y') if b.expiry_date else None,
            'mrp': float(b.mrp) if b.mrp else 0.0,
            'purchase_rate': float(b.purchase_rate) if b.purchase_rate else 0.0,
            'vendor': vendor_name,
            'invoice_number': b.purchase_invoice_number,
            'batch_number': b.batch_number
        })
        
    return jsonify(results), 200

@inventory.route('/inventory', methods=['POST'])
@require_auth
def add_inventory_item():
    """Creates a new Master Item (No stock initially)"""
    data = request.get_json()
    new_item = ProductMaster(
        id=ProductMaster.generate_item_id(),
        item_name=data['item_name'],
        min_stock_level=data.get('min_stock_level', 10),
        manufacturer=data.get('supplier', ''),
        category=data.get('category', ''),
        pack_size=data.get('pack_size', ''),
        hsn_code=data.get('hsn_code', ''),
        created_by_user_id=g.current_user.get('user_id'),
    )
    db.session.add(new_item)
    db.session.commit()

    log_activity(
        action='CREATE',
        resource_type='inventory_product',
        resource_id=new_item.id,
        resource_label=data['item_name'],
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Master Item added', 'id': new_item.id}), 201

@inventory.route('/inventory/<string:id>', methods=['PUT'])
@require_auth
def update_inventory_item(id):
    item = ProductMaster.query.get_or_404(id)
    data = request.get_json()

    changed_fields = []

    if 'item_name' in data:
        if item.item_name != data['item_name']:
            changed_fields.append('item_name')
        item.item_name = data['item_name']
    if 'category' in data:
        if item.category != data['category']:
            changed_fields.append('category')
        item.category = data['category']
    if 'min_stock_level' in data:
        try:
            new_val = int(float(data['min_stock_level']))
        except (ValueError, TypeError):
            new_val = item.min_stock_level
        if item.min_stock_level != new_val:
            changed_fields.append('min_stock_level')
        item.min_stock_level = new_val
    if 'pack_size' in data:
        if item.pack_size != data['pack_size']:
            changed_fields.append('pack_size')
        item.pack_size = data['pack_size']
    if 'hsn_code' in data:
        if item.hsn_code != data['hsn_code']:
            changed_fields.append('hsn_code')
        item.hsn_code = data['hsn_code']
    if 'formula' in data:
        new_formula = data['formula']
        if item.formula != new_formula:
            changed_fields.append('formula')
        item.formula = new_formula
    if 'manufacturer' in data:
        if item.manufacturer != data['manufacturer']:
            changed_fields.append('manufacturer')
        item.manufacturer = data['manufacturer']
    if 'gst_rate' in data:
        new_gst = float(data['gst_rate']) if data['gst_rate'] is not None else 0.0
        if item.gst_rate != new_gst:
            changed_fields.append('gst_rate')
        item.gst_rate = new_gst

    if changed_fields:
        hist = InventoryHistory(
            product_id=id,
            change_amount=0,
            type='ADJUSTMENT',
            notes=f"Item fields updated: {', '.join(changed_fields)}",
            user_id=g.current_user.get('user_id'),
            username=g.current_user.get('username'),
        )
        db.session.add(hist)

    db.session.commit()

    log_activity(
        action='UPDATE',
        resource_type='inventory_product',
        resource_id=id,
        resource_label=item.item_name,
        details=f"Fields: {', '.join(changed_fields)}" if changed_fields else None,
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Item updated successfully'}), 200

@inventory.route('/inventory/<string:id>', methods=['DELETE'])
@require_auth
@require_admin
def delete_inventory_item(id):
    """
    Restricted physical deletion of a Product from Master Inventory.
    Safeguards historical billing snapshots while purging active stock data.
    """
    item = ProductMaster.query.get_or_404(id)
    item_name = item.item_name
    
    try:
        # Step 1: Maintain transactional context by nullifying the FK link in Bills rather than cascading deletion
        BillItem.query.filter_by(product_id=id).update({"product_id": None}, synchronize_session=False)
        
        # Step 2: Hard purge active operational records tying storage to the product ID
        InventoryHistory.query.filter_by(product_id=id).delete(synchronize_session=False)
        InventoryBatch.query.filter_by(product_id=id).delete(synchronize_session=False)
        
        # Step 3: Finalize master table deletion
        db.session.delete(item)
        db.session.commit()
        
        log_activity(
            action='DELETE',
            resource_type='inventory_product',
            resource_id=id,
            resource_label=item_name,
            details='Full inventory node purge executed',
            user_id=g.current_user.get('user_id'),
            username=g.current_user.get('username'),
            ip_address=request.remote_addr,
        )
        return jsonify({'message': f'Product {item_name} has been permanently expunged.'}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Database rollback executed due to constraint fault: {str(e)}'}), 500

@inventory.route('/inventory/batch/<int:id>', methods=['PUT'])
@require_auth
def update_inventory_batch(id):
    batch = InventoryBatch.query.get_or_404(id)
    data = request.get_json()
    
    changes = []
    
    if 'expiry_date' in data:
        try:
            new_exp = parse_expiry_date(data['expiry_date'])
            if new_exp and batch.expiry_date != new_exp:
                changes.append(f"Expiry: {batch.expiry_date} -> {new_exp}")
                batch.expiry_date = new_exp
        except ValueError:
            pass 
            
    if 'quantity' in data:
        try:
            new_qty = int(data['quantity'])
            if batch.quantity != new_qty:
                diff = new_qty - batch.quantity
                changes.append(f"Qty: {batch.quantity} -> {new_qty}")
                batch.quantity = new_qty
                
                hist = InventoryHistory(
                    product_id=batch.product_id,
                    batch_id=batch.id,
                    change_amount=diff,
                    type='ADJUSTMENT',
                    notes='Manual Batch Update',
                    user_id=g.current_user.get('user_id'),
                    username=g.current_user.get('username'),
                )
                db.session.add(hist)
        except: pass
        
    if 'mrp' in data:
        try:
            batch.mrp = float(data['mrp'])
        except: pass

    if 'purchase_rate' in data:
        try:
            batch.purchase_rate = float(data['purchase_rate'])
        except: pass

    if 'gst_rate' in data:
        try:
            batch.gst_rate = float(data['gst_rate'])
        except: pass

    if changes:
        db.session.commit()
        log_activity(
            action='UPDATE',
            resource_type='inventory_batch',
            resource_id=str(id),
            resource_label=f"Batch {id} ({batch.product_id})",
            details='; '.join(changes),
            user_id=g.current_user.get('user_id'),
            username=g.current_user.get('username'),
            ip_address=request.remote_addr,
        )
        return jsonify({'message': 'Batch updated', 'changes': changes}), 200
    else:
        db.session.commit()
        return jsonify({'message': 'No significant changes or just price updated'}), 200

@inventory.route('/inventory/search', methods=['GET'])
@require_auth
def search_inventory():
    query = request.args.get('q', '').lower().strip()
    if not query: return jsonify([])

    base_q = ProductMaster.query
    
    found_items = base_q.filter(
        (func.lower(ProductMaster.item_name).contains(query)) |
        (func.lower(ProductMaster.manufacturer).contains(query)) |
        (func.lower(ProductMaster.generic_tags).contains(query)) |
        (func.lower(ProductMaster.id).contains(query))
    ).limit(20).all()
    
    results = []
    for item in found_items:
        total_qty = db.session.query(func.sum(InventoryBatch.quantity)).filter(
            InventoryBatch.product_id == item.id,
            InventoryBatch.quantity > 0
        ).scalar() or 0
        
        max_mrp = db.session.query(func.max(InventoryBatch.mrp)).filter(
            InventoryBatch.product_id == item.id
        ).scalar() or 0.0
        
        results.append({
            'id': item.id,
            'item_name': item.item_name,
            'manufacturer': item.manufacturer,
            'gst_rate': float(item.gst_rate) if item.gst_rate else 0,
            'total_qty': total_qty,
            'price': float(max_mrp),
            'pack_size': item.pack_size,
            'substitutes': []
        })
        
    return jsonify(results), 200

@inventory.route('/inventory/export', methods=['GET'])
@require_auth
def export_inventory():
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        'Product ID', 'Item Name', 'Pack Size', 'Category', 'HSN Code',
        'Min Stock', 'Manufacturer', 'Product GST Rate', 'Generic Tags', 'Formula',
        'Batch Number', 'Expiry Date', 'MRP', 'Purchase Rate',
        'Batch GST Rate', 'GST Amount', 'Quantity', 'Initial Quantity', 'Free Quantity',
    ])

    products = ProductMaster.query.order_by(ProductMaster.item_name).all()

    for product in products:
        batches = InventoryBatch.query.filter_by(product_id=product.id).order_by(InventoryBatch.expiry_date.asc()).all()
        product_row = [
            product.id,
            product.item_name,
            product.pack_size or '',
            product.category or '',
            product.hsn_code or '',
            product.min_stock_level,
            product.manufacturer or '',
            f"{float(product.gst_rate or 0):.2f}",
            product.generic_tags or '',
            product.formula or '',
        ]
        if batches:
            for batch in batches:
                writer.writerow(product_row + [
                    batch.batch_number or '',
                    batch.expiry_date.strftime('%m/%y') if batch.expiry_date else '',
                    f"{float(batch.mrp or 0):.2f}",
                    f"{float(batch.purchase_rate or 0):.2f}",
                    f"{float(batch.gst_rate or 0):.2f}",
                    f"{float(batch.gst_amount or 0):.2f}",
                    int(batch.quantity or 0),
                    int(batch.initial_quantity or 0),
                    int(batch.free_quantity or 0),
                ])
        else:
            writer.writerow(product_row + ['', '', '', '', '', '', '', '', ''])

    output.seek(0)

    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'inventory_export_{get_ist_now().strftime("%Y%m%d")}.csv'
    )

@inventory.route('/inventory/invoices/<invoice_number>/export', methods=['GET'])
@require_auth
def export_invoice(invoice_number):
    batches = InventoryBatch.query.filter_by(purchase_invoice_number=invoice_number).all()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Product Name', 'Batch', 'Pack', 'GST', 'Quantity', 'MRP', 'Rate', 'Expiry', 'Total Amount'])
    
    for b in batches:
        product = ProductMaster.query.get(b.product_id)
        p_name = product.item_name if product else 'Unknown'
        p_pack = product.pack_size if product else ''
        
        writer.writerow([
            p_name,
            b.batch_number or '',
            p_pack,
            f"{float(b.gst_rate)}%" if b.gst_rate else '',
            b.quantity,
            b.mrp,
            b.purchase_rate,
            b.expiry_date,
            (float(b.quantity) * float(b.purchase_rate or 0))
        ])
        
    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'invoice_{invoice_number}.csv'
    )

@inventory.route('/inventory/import', methods=['POST'])
@require_auth
def import_inventory():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    mode = request.form.get('mode', 'update')
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    try:
        import_id = f"IMPORT-{get_ist_now().strftime('%Y%m%d-%H%M%S')}"
        source_type = f"CSV_{mode.upper()}"
        
        # PRE-FLUSH PARENT INVOICE: To satisfy Foreign Key constraints on Batch Inserts inside the loop
        sys_invoice = PurchaseInvoice(
            invoice_number=import_id,
            vendor_name="System Import",
            total_amount=0,
            source=source_type,
            image_path=""
        )
        db.session.add(sys_invoice)
        db.session.flush()

        total_import_value = 0
        warnings_list = []

        stream = io.StringIO(file.stream.read().decode("UTF8"), newline=None)
        csv_input = csv.DictReader(stream)
        
        if not csv_input.fieldnames:
             return jsonify({'error': 'Empty CSV'}), 400
             
        processed_count = 0
        
        for row in csv_input:
            def get_val(keys):
                for k in keys:
                    for exist_k in row.keys():
                        if k.lower() in exist_k.lower(): return row[exist_k]
                return None

            # ── Field extraction (supports both old and new header names) ──
            name = get_val(['Item Name', 'name', 'item', 'Item'])
            if not name:
                continue

            pack_size = get_val(['Pack Size', 'pack', 'packs', 'Pack']) or ''
            product_id_csv = (get_val(['Product ID']) or '').strip()

            # Product lookup: by ID first (if provided), then by name+pack
            if product_id_csv:
                item = ProductMaster.query.get(product_id_csv)
            else:
                name_q = ProductMaster.query.filter(func.lower(ProductMaster.item_name) == name.strip().lower())
                if pack_size:
                    name_q = name_q.filter(ProductMaster.pack_size == pack_size.strip())
                item = name_q.first()

            try:
                min_stock_val = int(float(get_val(['Min Stock', 'min', 'Min Stock Level']) or 10))
            except (ValueError, TypeError):
                min_stock_val = 10

            if not item:
                new_id = product_id_csv if product_id_csv else ProductMaster.generate_item_id()
                item = ProductMaster(
                    id=new_id,
                    item_name=name.strip(),
                    pack_size=pack_size.strip(),
                    category=get_val(['Category', 'cat']) or '',
                    min_stock_level=min_stock_val,
                    manufacturer=get_val(['Manufacturer', 'mfg', 'manufacturer']) or '',
                    hsn_code=get_val(['HSN Code', 'hsn']) or '',
                    generic_tags=get_val(['Generic Tags', 'tags']) or '',
                    formula=get_val(['Formula', 'formula']) or '',
                )
                try:
                    item.gst_rate = float(str(get_val(['Product GST Rate', 'Product GST', 'gst_rate']) or '0').replace('%', ''))
                except (ValueError, TypeError):
                    pass
                db.session.add(item)
                db.session.flush()
            else:
                # Update product master fields if provided in CSV
                cat = get_val(['Category', 'cat'])
                if cat: item.category = cat
                if min_stock_val: item.min_stock_level = min_stock_val
                mfg = get_val(['Manufacturer', 'mfg', 'manufacturer'])
                if mfg: item.manufacturer = mfg
                hsn = get_val(['HSN Code', 'hsn'])
                if hsn: item.hsn_code = hsn
                tags = get_val(['Generic Tags', 'tags'])
                if tags: item.generic_tags = tags
                formula = get_val(['Formula', 'formula'])
                if formula: item.formula = formula
                pgst = get_val(['Product GST Rate', 'Product GST', 'gst_rate'])
                if pgst:
                    try:
                        item.gst_rate = float(str(pgst).replace('%', ''))
                    except (ValueError, TypeError):
                        pass

            qty_str = get_val(['Quantity', 'qty', 'Total Quantity']) or '0'
            try:
                qty = int(float(qty_str))
            except (ValueError, TypeError):
                qty = 0

            if qty <= 0 and mode == 'update':
                continue

            mrp_str = get_val(['MRP', 'price', 'Max MRP']) or '0'
            try:
                mrp = float(mrp_str)
            except (ValueError, TypeError):
                mrp = 0.0

            rate_str = get_val(['Purchase Rate', 'rate', 'Avg Purchase Rate']) or '0'
            try:
                rate = float(rate_str)
            except (ValueError, TypeError):
                rate = 0.0

            gst_str = get_val(['Batch GST Rate', 'GST', 'tax', 'GST Rate']) or '0'
            try:
                gst_rate = float(str(gst_str).replace('%', ''))
            except (ValueError, TypeError):
                gst_rate = 0.0

            batch_num = get_val(['Batch Number', 'Batch', 'batch no', 'Batch No']) or ''

            exp_str = get_val(['Expiry Date', 'Expiry', 'exp', 'Earliest Expiry'])
            expiry_date = parse_expiry_date(exp_str)

            try:
                initial_qty = int(float(get_val(['Initial Quantity', 'initial_qty']) or qty))
            except (ValueError, TypeError):
                initial_qty = qty

            try:
                free_qty = int(float(get_val(['Free Quantity', 'free_qty']) or 0))
            except (ValueError, TypeError):
                free_qty = 0
            
            # Try to find an existing batch to update in place (match by batch_number + expiry_date)
            existing_batch = None
            if batch_num and expiry_date:
                existing_batch = InventoryBatch.query.filter_by(
                    product_id=item.id,
                    batch_number=batch_num,
                    expiry_date=expiry_date,
                ).first()
            elif batch_num:
                existing_batch = InventoryBatch.query.filter_by(
                    product_id=item.id,
                    batch_number=batch_num,
                ).first()

            if existing_batch:
                # Update batch-level fields in place
                existing_batch.mrp = mrp
                existing_batch.purchase_rate = rate
                existing_batch.gst_rate = gst_rate
                if expiry_date:
                    existing_batch.expiry_date = expiry_date

                diff = qty - float(existing_batch.quantity)
                if abs(diff) >= 0.01:
                    existing_batch.quantity = qty
                    hist = InventoryHistory(
                        product_id=item.id,
                        batch_id=existing_batch.id,
                        change_amount=diff,
                        type='ADJUSTMENT',
                        notes=f'CSV Import {mode.capitalize()} — batch update',
                        purchase_invoice_number=import_id,
                        user_id=g.current_user.get('user_id'),
                        username=g.current_user.get('username'),
                    )
                    db.session.add(hist)
                    total_import_value += abs(diff) * mrp

            elif mode == 'overwrite':
                # No matching batch found — diff against total product qty
                db.session.flush()
                current_qty = float(db.session.query(func.sum(InventoryBatch.quantity)).filter(InventoryBatch.product_id == item.id).scalar() or 0)
                diff = qty - current_qty

                if abs(diff) < 0.01:
                    pass  # no change needed
                elif diff > 0:
                    batch = InventoryBatch(
                        product_id=item.id,
                        quantity=diff,
                        initial_quantity=diff,
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
                        purchase_invoice_number=import_id,
                        user_id=g.current_user.get('user_id'),
                        username=g.current_user.get('username'),
                    )
                    db.session.add(hist)
                    total_import_value += diff * mrp
                else:
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

                    if to_reduce > 0.01:
                        warnings_list.append(
                            f"{name}: insufficient stock — could only reduce by "
                            f"{abs(diff) - to_reduce:.0f} of {abs(diff):.0f} requested"
                        )

                    hist = InventoryHistory(
                        product_id=item.id,
                        batch_id=None,
                        change_amount=diff,
                        type='ADJUSTMENT',
                        notes='CSV Import Overwrite — stock reduction (FIFO)',
                        purchase_invoice_number=import_id,
                        user_id=g.current_user.get('user_id'),
                        username=g.current_user.get('username'),
                    )
                    db.session.add(hist)

            elif mode == 'update':
                # No matching batch — create a new one
                batch = InventoryBatch(
                    product_id=item.id,
                    quantity=qty,
                    initial_quantity=initial_qty,
                    free_quantity=free_qty,
                    mrp=mrp,
                    purchase_rate=rate,
                    gst_rate=gst_rate,
                    expiry_date=expiry_date,
                    purchase_invoice_number=import_id,
                    batch_number=batch_num
                )
                db.session.add(batch)
                total_import_value += (qty * mrp)
                db.session.flush()
                hist = InventoryHistory(
                    product_id=item.id,
                    batch_id=batch.id,
                    change_amount=qty,
                    type='PURCHASE',
                    notes='CSV Import Update',
                    purchase_invoice_number=import_id
                )
                db.session.add(hist)
                
            processed_count += 1
            
        # Finalize parent summation
        sys_invoice.total_amount = total_import_value
            
        db.session.commit()
        return jsonify({
            'message': f'Processed {processed_count} items',
            'warnings': warnings_list,
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@inventory.route('/inventory/invoices', methods=['GET'])
@require_auth
def get_invoices():
    invoices = PurchaseInvoice.query.order_by(PurchaseInvoice.upload_date.desc()).all()
    results = []
    for inv in invoices:
        results.append({
            'invoice_number': inv.invoice_number,
            'gst_number': inv.gst_number,
            'total_amount': float(inv.total_amount) if inv.total_amount else 0,
            'vendor_name': inv.vendor_name,
            'source': inv.source,
            'upload_date': inv.upload_date.isoformat(),
            'has_image': bool(inv.image_path)
        })
    return jsonify(results), 200

@inventory.route('/inventory/invoices/<invoice_number>', methods=['GET'])
@require_auth
def get_invoice_detail(invoice_number):
    inv = PurchaseInvoice.query.get_or_404(invoice_number)
    batches = InventoryBatch.query.filter_by(purchase_invoice_number=invoice_number).all()
    
    items = []
    for b in batches:
        product = ProductMaster.query.get(b.product_id)
        items.append({
            'product_name': product.item_name if product else 'Unknown',
            'batch_id': b.id,
            'batch_number': b.batch_number,
            'quantity': b.initial_quantity if b.initial_quantity else b.quantity,
            'free_quantity': b.free_quantity or 0,
            'mrp': float(b.mrp) if b.mrp else 0,
            'purchase_rate': float(b.purchase_rate) if b.purchase_rate else 0,
            'expiry_date': b.expiry_date.strftime('%m/%y') if b.expiry_date else None,
            'pack_size': product.pack_size if product else '',
            'gst_rate': float(b.gst_rate) if b.gst_rate else 0,
            'hsn_code': product.hsn_code if product else '',
            'manufacturer': product.manufacturer if product else ''
        })
        
    return jsonify({
        'invoice': {
            'invoice_number': inv.invoice_number,
            'gst_number': inv.gst_number,
            'total_amount': float(inv.total_amount) if inv.total_amount else 0,
            'vendor_name': inv.vendor_name,
            'upload_date': inv.upload_date.isoformat(),
            'has_image': bool(inv.image_path)
        },
        'items': items
    }), 200

@inventory.route('/inventory/invoices/<invoice_number>/image', methods=['GET'])
@require_auth
def get_invoice_image(invoice_number):
    inv = PurchaseInvoice.query.get_or_404(invoice_number)
    if inv.image_path and os.path.exists(inv.image_path):
        return send_file(inv.image_path)
    return jsonify({'error': 'Image not found'}), 404

@inventory.route('/inventory/upload', methods=['POST'])
@require_auth
def upload_inventory_report():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    upload_folder = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'invoices')
    try:
        if not os.path.exists(upload_folder):
            os.makedirs(upload_folder)
        
        timestamp = int(get_ist_now().timestamp())
        filename = f"{timestamp}_{file.filename}"
        filepath = os.path.join(upload_folder, filename)
        file.save(filepath)
        
        ocr_result = _run_ocr(filepath)

        return jsonify({
            'message': 'File uploaded and processed successfully',
            'path': filepath,
            'ocr_data': _transform_ocr_result(ocr_result)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@inventory.route('/inventory/save_invoice', methods=['POST'])
@require_auth
def save_invoice():
    data = request.get_json()
    
    invoice_no = data.get('invoice_number')
    if not invoice_no:
        return jsonify({'error': 'Invoice Number is required'}), 400
        
    gst_no = data.get('gst_number', '')
    image_path = data.get('image_path', '')
    
    warnings: list = []
    existing = PurchaseInvoice.query.get(invoice_no)
    is_duplicate_invoice = existing is not None

    if not existing:
        products_early = data.get('product_details', [])
        if not products_early:
            return jsonify({'error': 'No product details provided'}), 400

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
    
    products = data.get('product_details', [])
    
    try:
        for p in products:
            p_name = p.get('product_name')
            if not p_name: continue

            p_mfg    = p.get('mfg', '').strip()
            p_pack   = p.get('packs') or p.get('pack') or ''
            p_batch  = (p.get('batch') or p.get('batch_number') or '').strip() or None
            p_hsn    = p.get('hsn') or p.get('hsn_code') or ''
            p_formula = (p.get('formula') or '').strip()

            try:
                p_gst = float(str(p.get('gst', 0) or 0))
                if p_gst >= 100:
                    p_gst = 0.0
            except (ValueError, TypeError):
                p_gst = 0.0

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
            except (ValueError, TypeError): qty = 0

            free_qty = 0
            try: free_qty = int(float(str(p.get('free', 0))))
            except (ValueError, TypeError): free_qty = 0

            total_stock_qty = qty + free_qty

            mrp = 0.0
            try: mrp = float(str(p.get('mrp', 0)))
            except (ValueError, TypeError): mrp = 0.0

            rate = 0.0
            try: rate = float(str(p.get('rate', 0)))
            except (ValueError, TypeError): rate = 0.0

            expiry = parse_expiry_date(p.get('expiry'))

            if is_duplicate_invoice:
                # Find existing batch for this product+batch_number under the same invoice
                _batch_filter = (
                    InventoryBatch.batch_number == p_batch
                    if p_batch is not None
                    else InventoryBatch.batch_number.is_(None)
                )
                existing_batch = InventoryBatch.query.filter(
                    InventoryBatch.purchase_invoice_number == invoice_no,
                    InventoryBatch.product_id == item.id,
                    _batch_filter,
                ).first()

                if existing_batch:
                    existing_qty = float(existing_batch.initial_quantity or existing_batch.quantity)
                    qty_diff = total_stock_qty - existing_qty
                    mrp_diff = abs(float(existing_batch.mrp or 0) - mrp)

                    if abs(qty_diff) < 0.01 and mrp_diff < 0.01:
                        # Identical — log history, skip
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
                    elif qty_diff < 0:
                        # Stock reduction: deduct from existing batch, floor at zero
                        reduce_by = abs(qty_diff)
                        existing_batch.quantity = max(0, float(existing_batch.quantity) - reduce_by)
                        db.session.flush()
                        history = InventoryHistory(
                            product_id=item.id,
                            batch_id=existing_batch.id,
                            purchase_invoice_number=invoice_no,
                            change_amount=qty_diff,
                            type='ADJUSTMENT',
                            notes=f'Duplicate invoice — qty reduced: {existing_qty:.0f} → {total_stock_qty:.0f}',
                            user_id=g.current_user.get('user_id'),
                            username=g.current_user.get('username'),
                        )
                        db.session.add(history)
                        warnings.append(f'{p_name}: qty reduced by {qty_diff:+.0f}')
                    else:
                        # qty_diff > 0: add adjustment batch (positive quantity only)
                        adj_batch_number = (
                            f'{p_batch}-ADJ' if p_batch is not None else 'ADJ'
                        )
                        adj_batch = InventoryBatch(
                            product_id=item.id,
                            purchase_invoice_number=invoice_no,
                            batch_number=adj_batch_number,
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
                    # New row not in original invoice — add normally
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
                        notes=f'Duplicate invoice — new line item: {invoice_no}, Batch: {p_batch}',
                        user_id=g.current_user.get('user_id'),
                        username=g.current_user.get('username'),
                    )
                    db.session.add(history)

            else:
                # First-time save — normal path
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


@inventory.route('/inventory/all-changes', methods=['GET'])
@require_auth
def get_all_inventory_changes():
    """Returns all inventory history grouped by date, split into MANUAL and SALES"""
    from collections import defaultdict

    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')

    query = InventoryHistory.query.order_by(InventoryHistory.timestamp.desc())

    if date_from:
        try:
            query = query.filter(func.date(InventoryHistory.timestamp) >= date_from)
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(func.date(InventoryHistory.timestamp) <= date_to)
        except Exception:
            pass

    records = query.all()

    product_ids = list({r.product_id for r in records})
    products = {}
    if product_ids:
        products = {p.id: p.item_name for p in ProductMaster.query.filter(ProductMaster.id.in_(product_ids)).all()}

    days: dict = defaultdict(lambda: {'manual': [], 'sales': []})

    for r in records:
        date_key = r.timestamp.strftime('%Y-%m-%d') if r.timestamp else 'unknown'
        entry = {
            'id': r.id,
            'product_id': r.product_id,
            'product_name': products.get(r.product_id, 'Unknown'),
            'type': r.type,
            'change_amount': r.change_amount,
            'timestamp': r.timestamp.isoformat() if r.timestamp else None,
            'notes': r.notes,
            'bill_id': r.bill_id,
        }
        if r.type == 'SALE':
            days[date_key]['sales'].append(entry)
        else:
            days[date_key]['manual'].append(entry)

    result = []
    for date_key in sorted(days.keys(), reverse=True):
        result.append({
            'date': date_key,
            'manual': days[date_key]['manual'],
            'sales': days[date_key]['sales'],
        })

    return jsonify({'days': result}), 200
