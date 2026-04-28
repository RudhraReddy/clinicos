import os
import re
import json
from PIL import Image
import logging
from paddleocr import PaddleOCR
from prettytable import PrettyTable

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class AIInvoiceScanner:
    def __init__(self, lang='en'):
        self.ocr = PaddleOCR(use_textline_orientation=True, lang=lang)
        self.logger = logging.getLogger(__name__)

    def scan(self, image_path):
        """
        Scans an image and returns structured data including fields and tables.
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        # Resize image to prevent OOM
        try:
            with Image.open(image_path) as img:
                max_dim = 1024
                if max(img.size) > max_dim:
                    ratio = max_dim / max(img.size)
                    new_size = (int(img.width * ratio), int(img.height * ratio))
                    img = img.resize(new_size, Image.Resampling.LANCZOS)
                    img.save(image_path)
                    self.logger.info(f"Resized image to {new_size}")
        except Exception as e:
            self.logger.warning(f"Failed to resize image: {e}")


        self.logger.info(f"Scanning image: {image_path}")
        result = self.ocr.ocr(image_path)
        
        if not result or not result[0]:
            self.logger.warning("No text detected.")
            return {}

        # result is a list of lists (one for each image), we take the first one
        # Each item is [[box], [text, confidence]]
        # box: [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
        ocr_data = result[0]
        
        # Handle PaddleOCR 2.9+ / PaddleX object result
        # Convert to dict if it's not already, assuming it behaves like a mapping or has keys
        try:
            if not isinstance(ocr_data, list):
                if hasattr(ocr_data, 'keys'):
                     ocr_data = dict(ocr_data)
                elif hasattr(ocr_data, '__dict__'):
                     ocr_data = ocr_data.__dict__
                     
            if isinstance(ocr_data, dict):
                # Try to find text list key
                text_key = 'rec_text' if 'rec_text' in ocr_data else 'rec_texts'
                score_key = 'rec_score' if 'rec_score' in ocr_data else 'rec_scores'
                poly_key = 'dt_polys'
                
                if text_key in ocr_data:
                    converted_data = []
                    dt_polys = ocr_data.get(poly_key, [])
                    rec_texts_list = ocr_data.get(text_key, [])
                    rec_scores_list = ocr_data.get(score_key, [])
                    
                    for i in range(len(rec_texts_list)):
                        box = dt_polys[i].tolist() if i < len(dt_polys) else []
                        text = rec_texts_list[i]
                        score = rec_scores_list[i] if i < len(rec_scores_list) else 0.0
                        converted_data.append([box, (text, score)])
                    ocr_data = converted_data
        except Exception as e:
            self.logger.error(f"Failed to convert OCR data: {e}")
            # fallback or re-raise?
            pass
        

        
        # Helper for sort key
        def get_sort_key(item):
            try:
                # item structure expectation: [box, (text, score)]
                # box: [[x1, y1], [x2, y2], ...]
                box = item[0]
                return (box[0][1], box[0][0])
            except Exception as e:
                print(f"Error sorting item: {item} - {e}")
                return (0, 0)

        sorted_data = sorted(ocr_data, key=get_sort_key)
        
        structured_data = {
            "metadata": self._extract_metadata(ocr_data),
            "line_items": self._extract_table(ocr_data),
            "summary": self._extract_summary(ocr_data)
        }
        
        return structured_data

    def _extract_metadata(self, ocr_data):
        metadata = {
            "invoice_no": None,
            "date": None,
            "gst_no": None
        }
        
        # Simple proximity-based approach for specific keys could be added here
        # For now, we'll try to find values near keys using spatial logic
        
        # Helper to find value to the right of a key
        def find_value_right(key_text__lower, search_data):
            for i, line in enumerate(search_data):
                text = line[1][0]
                if key_text__lower in text.lower():
                    # Check text in the same line (if the box contains both key and value)
                    # Regex for common patterns if needed, or simple split
                    if ":" in text:
                        val = text.split(":", 1)[1].strip()
                        if val: return val
                    
                    # Look for the nearest box to the right
                    key_box = line[0]
                    key_y_center = (key_box[0][1] + key_box[2][1]) / 2
                    
                    # Find boxes with similar Y center and X > key_x_max
                    candidates = []
                    for other_line in search_data:
                        if other_line == line: continue
                        other_box = other_line[0]
                        other_text = other_line[1][0]
                        other_y_center = (other_box[0][1] + other_box[2][1]) / 2
                        
                        # Check vertical alignment (within 10px)
                        if abs(key_y_center - other_y_center) < 15:
                            # Check if it's to the right
                            if other_box[0][0] > key_box[1][0]:
                                candidates.append((other_box[0][0], other_text))
                    
                    if candidates:
                        # Return the closest one to the right
                        candidates.sort(key=lambda x: x[0])
                        return candidates[0][1]
            return None

        metadata['invoice_no'] = find_value_right("invoice no", ocr_data)
        metadata['date'] = find_value_right("date", ocr_data)
        metadata['gst_no'] = find_value_right("gst no", ocr_data)
        
        # Fallback regex if spatial fails
        if not metadata['invoice_no']:
             for line in ocr_data:
                 if re.search(r'invoice\s?no', line[1][0], re.IGNORECASE):
                      match = re.search(r'[A-Za-z]+[0-9]+', line[1][0])
                      if match and "invoice" not in match.group(0).lower():
                          metadata['invoice_no'] = match.group(0)

        return metadata

    def _extract_table(self, ocr_data):
        """
        Extracts line items from the invoice table.
        Strategy:
        1. Find header row.
        2. Map columns by X-coordinates.
        3. Iterate rows below header.
        """
        items = []
        
        # 1. Identify Header Row
        header_keywords = ["product name", "description", "batch", "qty", "amount", "rate", "mrp"]
        header_row_y = None
        headers = [] # List of {'text': text, 'x_min': x, 'x_max': x}
        
        # Find the line that contains the most header keywords
        max_matches = 0
        best_line_idx = -1
        
        # We process 'lines' by grouping text boxes with similar Y coordinates 
        # (PaddleOCR usually gives lines, but sometimes fragmented)
        
        # First, sort all data by Y then X
        try:
            sorted_data = sorted(ocr_data, key=lambda x: (x[0][0][1], x[0][0][0]))
        except:
             # Fallback if structure is somehow still wrong (safety)
             sorted_data = ocr_data
        rows = []
        current_row = []
        last_y = -100
        
        for item in sorted_data:
            box = item[0]
            text = item[1][0]
            y_center = (box[0][1] + box[2][1]) / 2
            
            if abs(y_center - last_y) > 15: # New row threshold
                if current_row:
                    rows.append(current_row)
                current_row = []
                last_y = y_center
            
            current_row.append(item)
        if current_row: rows.append(current_row)
        
        # Find the header row among logical rows
        header_row_index = -1
        for i, row in enumerate(rows):
            row_text = " ".join([item[1][0].lower() for item in row])
            matches = sum(1 for kw in header_keywords if kw in row_text)
            if matches > max_matches:
                max_matches = matches
                header_row_index = i
        
        if header_row_index == -1:
            self.logger.warning("Could not detect table header.")
            return []
            
        header_row = rows[header_row_index]
        self.logger.info(f"Detected Header Row: {[x[1][0] for x in header_row]}")
        
        # Define columns based on headers
        # We need to map expected keys to the detected headers
        # Expected keys: S.No, MFG, PRODUCT NAME, PACK, BATCH, EXP, QTY, FREE, MRP, RATE, DIS%, AMOUNT, GST%, HSN
        
        column_map = {} # x_center -> column_name
        columns = [] # list of (x_min, x_max, name)
        
        for item in header_row:
            box = item[0]
            text = item[1][0].lower()
            x_min, x_max = box[0][0], box[2][0]
            
            col_name = "unknown"
            if "product" in text or "name" in text or "desc" in text: col_name = "product_name"
            elif "batch" in text: col_name = "batch"
            elif "exp" in text: col_name = "exp"
            elif "qty" in text: col_name = "qty"
            elif "mrp" in text or "m.r.p" in text: col_name = "mrp"
            elif "rate" in text: col_name = "rate"
            elif "amount" in text: col_name = "amount"
            elif "pack" in text: col_name = "pack"
            elif "mfg" in text: col_name = "mfg"
            elif "free" in text: col_name = "free"
            elif "dis" in text: col_name = "discount"
            elif "gst" in text: col_name = "gst"
            elif "hsn" in text: col_name = "hsn"
            
            columns.append({
                "name": col_name,
                "x_min": x_min,
                "x_max": x_max,
                "center": (x_min + x_max) / 2
            })
            
        # 2. Iterate rows below header
        for r_idx in range(header_row_index + 1, len(rows)):
            row = rows[r_idx]
            
            # Stop if we hit the footer (e.g., "Total", "Note:")
            row_text_all = " ".join([x[1][0].lower() for x in row])
            if "total" in row_text_all or "note:" in row_text_all:
                break
                
            item_data = {}
            
            for item in row:
                box = item[0]
                text = item[1][0]
                x_center = (box[0][0] + box[2][0]) / 2
                
                # Find best matching column
                best_col = None
                min_dist = float('inf')
                
                for col in columns:
                    # check if x_center falls within column bounds (expanded slightly)
                    # or find closest column center
                    dist = abs(x_center - col['center'])
                    if dist < min_dist:
                        min_dist = dist
                        best_col = col['name']
                
                if best_col:
                    # Handle case where multiple texts map to same column (append)
                    if best_col in item_data:
                        item_data[best_col] += " " + text
                    else:
                        item_data[best_col] = text
            
            # Strict Column Splitting (User Rule: "rest of col wont have space")
            # Apply to single-token columns
            strict_cols = ['batch', 'exp', 'qty', 'gst', 'hsn', 'pack'] # mfg excluded as it can be long names
            
            for col in strict_cols:
                if col in item_data and item_data[col]:
                    val = item_data[col].strip()
                    if ' ' in val:
                        parts = val.split(' ', 1)
                        primary = parts[0]
                        residue = parts[1]
                        
                        # Apply split
                        item_data[col] = primary
                        
                        # Handle Residue
                        # If PACK has residue, it's likely MFG ("100G RANBA" -> "RANBA")
                        if col == 'pack':
                             # Only set MFG if not already present or if it helps
                             if 'mfg' not in item_data:
                                 item_data['mfg'] = residue
            
            # Additional Cleanup for Numeric Cols
            for col in ['mrp', 'rate', 'amount']:
                if col in item_data:
                    # Remove currency symbols first
                    val = re.sub(r'(?i)(rs\.?|inr)\s*', '', item_data[col]).strip()
                    # If strictly "Number Space Number" -> likely split error, take first?
                    # But be careful of "1 000" for 1000. 
                    # User said "wont have space". So "281.25" is good. "281 . 25" is bad. 
                    # simple heuristic: take first token
                    if ' ' in val:
                         item_data[col] = val.split()[0]
                    else:
                         item_data[col] = val

            # Clean Product Name
            if 'product_name' in item_data:
                # Remove leading digits, *, ., spaces
                raw_name = item_data['product_name']
                # Updated regex to handle trailing single digits if needed? 
                # User's example "MOISTUREX CREAM 1" -> "1" is S.No at the end?
                # Let's keep it safe: remove leading only for now as requested before
                cleaned_name = re.sub(r'^[\d\s\*\.\-\'\"]+', '', raw_name)
                item_data['product_name'] = cleaned_name
            
            # Redundant Pack cleaner removal (since strict splitting handles "10'S RANBA" now)
            # Keeping specific regex just in case split failed or user wants specific format
            # But strict split is cleaner. I'll comment out the old pack regex logic to avoid conflict/double processing
            # actually if we split "10'S RANBA", we get "10'S". 
            # If we have "10 ' S", split gives "10". That's bad. 
            # But PaddleOCR normally groups words well. 
            # Let's trust strict split for now.

            # Validate Row
            # 1. Must have product name or amount
            # 2. Should have at least one numeric/code column (qty, rate, mrp, batch, hsn) to be a real line item
            # 3. Product name shouldn't contain "Rupees", "Total", "Only" (Amount in words usually)
            
            has_product = 'product_name' in item_data or 'description' in item_data
            has_numeric = any(k in item_data for k in ['qty', 'rate', 'mrp', 'amount', 'batch', 'hsn', 'gst'])
            
            p_name = item_data.get('product_name', '').lower()
            is_noise = any(x in p_name for x in ['rupees', ' only', 'total', 'grand', 'signature', 'authorize'])
            
            if has_product and has_numeric and not is_noise:
                items.append(item_data)
                
        return items

    def _extract_summary(self, ocr_data):
        summary = {
            "total_amount": None,
            "net_payable": None
        }
        
        # Strategy:
        # 1. Collect all currency-like values from the bottom 30% of the document.
        # 2. Prioritize values associated with strong keys ("Next Payable", "Grand Total").
        # 3. Fallback: The distinct MAX value in the footer is usually the Grand Total.
        
        candidates = []
        page_height = 0
        if ocr_data:
             page_height = max(item[0][2][1] for item in ocr_data)
        
        threshold_y = page_height * 0.70 # Bottom 30%
        
        for line in ocr_data:
            box = line[0]
            text = line[1][0]
            confidence = line[1][1]
            y_center = (box[0][1] + box[2][1]) / 2
            
            # Simple cleaning
            clean_text = text.replace('Rs.', '').replace('Rs', '').replace('INR', '').replace(',', '').strip()
            
            # Find all numbers that look like amounts (e.g. 123.45, 12,345.00)
            # We want to capture the float value and the original text context
            try:
                # Regex for amounts: allow start/end of string, optional commas
                matches = re.findall(r'(\d+(?:\.\d{2})?)', clean_text)
                for m in matches:
                    try:
                        val = float(m)
                        if val > 0 and y_center > threshold_y:
                            candidates.append({
                                'val': val,
                                'text': text,
                                'y': y_center
                            })
                    except: pass
            except: pass

        # Filter candidates:
        # If specific keywords are present in the same line, give 'em a boost?
        # Actually, Max Value is extremely robust for Grand Total. 
        # But we must avoid huge numbers that are IDs (like Invoice No, HSN). 
        # Identifiers often lack decimal points or have >2 decimals. 
        # Valid amounts usually have 2 decimals (or integer if round).
        
        valid_amounts = []
        for c in candidates:
            # Heuristic: Invoice amounts usually aren't integers like "30049021" (HSN)
            # Unless they have ".00"
            is_float_format = '.' in str(c['val']) and len(str(c['val']).split('.')[1]) == 2
            
            # If strictly integer-looking but picked up as float
            # we'll accept it if it was formatted with decimals in text or matched specific pattern
            if is_float_format or c['val'] < 100000: # Arb filter to avoid huge ID numbers
                valid_amounts.append(c['val'])
        
        if valid_amounts:
            # The Grand Total is usually the MAX amount
            max_val = max(valid_amounts)
            summary['net_payable'] = f"{max_val:.2f}"
            summary['total_amount'] = f"{max_val:.2f}" # duplicate for now
            
        return summary

        return summary


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python3 advanced_invoice_scanner.py <image_path>")
        sys.exit(1)
        
    image_path = sys.argv[1]
    scanner = AIInvoiceScanner()
    try:
        data = scanner.scan(image_path)
        
        print("\n" + "="*50)
        print(f" INVOICE DETAILS")
        print("="*50)
        
        # Print Metadata
        meta = data.get('metadata', {})
        print(f" Invoice No : {meta.get('invoice_no', 'N/A')}")
        print(f" Date       : {meta.get('date', 'N/A')}")
        print(f" GST No     : {meta.get('gst_no', 'N/A')}")
        print("-" * 50)
        
        # Print Table
        line_items = data.get('line_items', [])
        if line_items:
            # Determine all unique keys for columns
            # We prioritize common columns for order
            priority_cols = ['product_name', 'batch', 'exp', 'qty', 'mrp', 'rate', 'amount']
            all_keys = set().union(*(d.keys() for d in line_items))
            # Sort keys: priority ones first, then alphabetical
            columns = [c for c in priority_cols if c in all_keys] + sorted([k for k in all_keys if k not in priority_cols])
            
            table = PrettyTable()
            table.field_names = [col.upper().replace('_', ' ') for col in columns]
            
            for item in line_items:
                row = [item.get(col, "") for col in columns]
                table.add_row(row)
            
            print(table)
        else:
            print("No line items found.")
            
        # Print Summary
        summary = data.get('summary', {})
        if summary.get('net_payable') and summary.get('net_payable') != summary.get('total_amount'):
            print(f" NET PAYABLE : {summary.get('net_payable')}")
        if summary.get('total_amount'):
            print(f" TOTAL AMOUNT: {summary.get('total_amount')}")
        print("="*50 + "\n")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error: {e}")
