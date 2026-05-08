
from flask import Blueprint, request, jsonify, send_file
from extensions import db, get_ist_now
from models import ProductMaster, InventoryBatch, InventoryHistory, PurchaseInvoice
from sqlalchemy import func
import io
import csv
import os
import requests as http_requests

from utils import parse_expiry_date

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
            "metadata": {"invoice_no": ..., "date": ..., "gst_no": ...},
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
            "vendor_name":    str   (OCR cannot extract this)
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
        'vendor_name': '',
    }

inventory = Blueprint('inventory', __name__)

@inventory.route('/inventory', methods=['GET'])
def get_inventory():
    """
    Returns Master ProductMaster Items + Aggregated Stock
    """
    items = ProductMaster.query.order_by(ProductMaster.item_name.asc()).all()
    results = []
    for item in items:
        # Aggregate Quantity from Batches
        total_qty = db.session.query(func.sum(InventoryBatch.quantity)).filter(InventoryBatch.product_id == item.id).scalar() or 0
        
        # Calculate Price Range (Min/Max MRP) from Batches
        max_mrp = db.session.query(func.max(InventoryBatch.mrp)).filter(InventoryBatch.product_id == item.id).scalar() or 0.0
        min_mrp = db.session.query(func.min(InventoryBatch.mrp)).filter(InventoryBatch.product_id == item.id).scalar() or 0.0
        
        earliest_expiry = db.session.query(func.min(InventoryBatch.expiry_date)).filter(
            InventoryBatch.product_id == item.id, 
            InventoryBatch.quantity > 0
        ).scalar()

        # Status Tags
        status_tags = []
        if total_qty <= 0:
            status_tags.append('OUT OF STOCK')
        elif total_qty < item.min_stock_level:
            status_tags.append('LOW STOCK')
            
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
        
        if not status_tags:
            status_tags.append('OK')

        # Get list of vendors for active stock
        vendors = db.session.query(PurchaseInvoice.vendor_name)\
            .join(InventoryBatch, InventoryBatch.purchase_invoice_number == PurchaseInvoice.invoice_number)\
            .filter(InventoryBatch.product_id == item.id, InventoryBatch.quantity > 0)\
            .distinct().all()
        vendor_list = [v[0] for v in vendors if v[0]]

        results.append({
            'id': item.id,
            'item_name': item.item_name,
            'quantity': total_qty,
            'min_stock_level': item.min_stock_level,
            'category': item.category,
            'manufacturer': item.manufacturer,
            'vendors': vendor_list,
            'price': float(max_mrp),
            'min_price': float(min_mrp),
            'max_price': float(max_mrp),
            'total_value': float(max_mrp) * total_qty,
            'expiry_date': earliest_expiry.strftime('%m/%y') if earliest_expiry else None,
            'status': status_tags,
            'pack_size': item.pack_size,
            'hsn_code': item.hsn_code,
            'gst_rate': float(item.gst_rate) if item.gst_rate else 0.0
        })
    return jsonify(results), 200

@inventory.route('/inventory/<string:product_id>/history', methods=['GET'])
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
        hsn_code=data.get('hsn_code', '')
    )
    db.session.add(new_item)
    db.session.commit()
    return jsonify({'message': 'Master Item added', 'id': new_item.id}), 201

@inventory.route('/inventory/<string:id>', methods=['PUT'])
def update_inventory_item(id):
    item = ProductMaster.query.get_or_404(id)
    data = request.get_json()
    
    if 'item_name' in data:
        item.item_name = data['item_name']
    if 'category' in data:
        item.category = data['category']
    if 'min_stock_level' in data:
        item.min_stock_level = int(data['min_stock_level'])
    if 'pack_size' in data:
        item.pack_size = data['pack_size']
    if 'hsn_code' in data:
        item.hsn_code = data['hsn_code']
        
    db.session.commit()
    return jsonify({'message': 'Item updated successfully'}), 200

@inventory.route('/inventory/batch/<int:id>', methods=['PUT'])
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
                    notes='Manual Batch Update'
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
        return jsonify({'message': 'Batch updated', 'changes': changes}), 200
    else:
        db.session.commit() 
        return jsonify({'message': 'No significant changes or just price updated'}), 200

@inventory.route('/inventory/search', methods=['GET'])
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
            'substitutes': []
        })
        
    return jsonify(results), 200

@inventory.route('/inventory/export', methods=['GET'])
def export_inventory():
    items = ProductMaster.query.all()
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    writer.writerow(['ID', 'Item Name', 'Dosage', 'Pack Size', 'Category', 'Min Stock', 'Total Quantity', 'Avg Purchase Rate', 'Max MRP', 'Earliest Expiry'])
    
    for item in items:
        total_qty = db.session.query(func.sum(InventoryBatch.quantity)).filter(InventoryBatch.product_id == item.id).scalar() or 0
        max_mrp = db.session.query(func.max(InventoryBatch.mrp)).filter(InventoryBatch.product_id == item.id).scalar() or 0.0
        earliest_expiry = db.session.query(func.min(InventoryBatch.expiry_date)).filter(InventoryBatch.product_id == item.id, InventoryBatch.quantity > 0).scalar()
        
        avg_rate = db.session.query(func.avg(InventoryBatch.purchase_rate)).filter(InventoryBatch.product_id == item.id).scalar() or 0.0
        
        writer.writerow([
            item.id,
            item.item_name,
            item.pack_size or '',
            item.category or '',
            item.min_stock_level,
            total_qty,
            f"{float(avg_rate):.2f}",
            f"{float(max_mrp):.2f}",
            earliest_expiry.isoformat() if earliest_expiry else ''
        ])
        
    output.seek(0)
    
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'inventory_export_{get_ist_now().strftime("%Y%m%d")}.csv'
    )

@inventory.route('/inventory/invoices/<invoice_number>/export', methods=['GET'])
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
        total_import_value = 0
        
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

            name = get_val(['Item Name', 'name', 'item'])
            if not name: continue
            
            pack_size = get_val(['Pack Size', 'pack', 'packs']) or ''
            
            query = ProductMaster.query.filter(func.lower(ProductMaster.item_name) == name.strip().lower())
            if pack_size:
                query = query.filter(ProductMaster.pack_size == pack_size.strip())
                
            item = query.first()
            
            if not item:
                item = ProductMaster(
                    id=ProductMaster.generate_item_id(),
                    item_name=name.strip(),
                    pack_size=pack_size.strip(),
                    category=get_val(['Category', 'cat']) or '',
                    min_stock_level=int(get_val(['Min Stock', 'min']) or 10)
                )
                db.session.add(item)
                db.session.flush()
            else:
                cat = get_val(['Category', 'cat'])
                if cat: item.category = cat
                min_s = get_val(['Min Stock', 'min'])
                if min_s: item.min_stock_level = int(min_s)

            qty_str = get_val(['Quantity', 'qty', 'Total Quantity']) or '0'
            try: qty = int(float(qty_str))
            except: qty = 0
            
            if qty <= 0 and mode == 'update': continue 
            
            mrp_str = get_val(['MRP', 'Max MRP', 'price']) or '0'
            try: mrp = float(mrp_str)
            except: mrp = 0.0
            
            rate_str = get_val(['Purchase Rate', 'rate', 'Avg Purchase Rate']) or '0'
            try: rate = float(rate_str)
            except: rate = 0.0
            
            gst_str = get_val(['GST', 'tax']) or '0'
            try: gst_rate = float(gst_str.replace('%', ''))
            except: gst_rate = 0.0
            
            batch_num = get_val(['Batch', 'batch no', 'Batch Number']) or ''

            exp_str = get_val(['Expiry', 'exp', 'Earliest Expiry'])
            expiry_date = parse_expiry_date(exp_str)
            
            if mode == 'overwrite':
                current_qty = db.session.query(func.sum(InventoryBatch.quantity)).filter(InventoryBatch.product_id == item.id).scalar() or 0
                diff = qty - current_qty
                
                if diff != 0:
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
                     
                     hist = InventoryHistory(
                        product_id=item.id,
                        batch_id=batch.id, # will be None until flush? no, we need flush
                        change_amount=diff,
                        type='ADJUSTMENT',
                        notes='CSV Import Overwrite',
                        purchase_invoice_number=import_id
                     )
                     db.session.add(hist)
            
            elif mode == 'update':
                batch = InventoryBatch(
                    product_id=item.id,
                    quantity=qty,
                    initial_quantity=qty,
                    free_quantity=0,
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
            
        sys_invoice = PurchaseInvoice(
            invoice_number=import_id,
            vendor_name="System Import",
            total_amount=total_import_value,
            source=source_type,
            image_path=""
        )
        db.session.add(sys_invoice)
            
        db.session.commit()
        return jsonify({'message': f'Processed {processed_count} items'}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@inventory.route('/inventory/invoices', methods=['GET'])
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
def get_invoice_image(invoice_number):
    inv = PurchaseInvoice.query.get_or_404(invoice_number)
    if inv.image_path and os.path.exists(inv.image_path):
        return send_file(inv.image_path)
    return jsonify({'error': 'Image not found'}), 404

@inventory.route('/inventory/upload', methods=['POST'])
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
def save_invoice():
    data = request.get_json()
    
    invoice_no = data.get('invoice_number')
    if not invoice_no:
        return jsonify({'error': 'Invoice Number is required'}), 400
        
    gst_no = data.get('gst_number', '')
    image_path = data.get('image_path', '')
    
    existing = PurchaseInvoice.query.get(invoice_no)
    if existing:
        pass
    else:
        source_type = 'MANUAL'
        if image_path:
            source_type = 'OCR'
            
        new_inv = PurchaseInvoice(
            invoice_number=invoice_no,
            gst_number=gst_no,
            total_amount=data.get('total_amount', 0),
            vendor_name=data.get('vendor_name', ''),
            image_path=image_path,
            source=source_type,
            upload_date=get_ist_now()
        )
        db.session.add(new_inv)
    
    products = data.get('product_details', [])
    
    try:
        for p in products:
            p_name = p.get('product_name')
            if not p_name: continue
            
            p_mfg = p.get('mfg', '').strip()
            p_pack = p.get('packs') or p.get('pack') or ''
            p_batch = p.get('batch') or p.get('batch_number') or ''
            p_hsn = p.get('hsn') or p.get('hsn_code') or ''
            
            try: 
                p_gst = float(str(p.get('gst', 0) or 0))
                if p_gst >= 100:
                    p_gst = 0.0
            except: 
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
                    hsn_code=str(p_hsn)
                )
                db.session.add(item)
                db.session.flush()
            else:
                 if p_mfg and not item.manufacturer:
                     item.manufacturer = p_mfg
                 if p_hsn and not item.hsn_code:
                     item.hsn_code = p_hsn
            
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
                expiry_date=expiry
            )
            db.session.add(new_batch)
            db.session.flush()
            
            history = InventoryHistory(
                product_id=item.id,
                batch_id=new_batch.id,
                purchase_invoice_number=invoice_no,
                change_amount=total_stock_qty,
                type='PURCHASE',
                notes=f"Invoice: {invoice_no}, Batch: {p_batch}"
            )
            db.session.add(history)
            
        db.session.commit()
        return jsonify({'message': 'Invoice Saved', 'invoice_number': invoice_no}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
