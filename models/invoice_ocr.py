import os
import re
import json
import logging
import cv2
from paddleocr import PaddleOCR
from prettytable import PrettyTable

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class AIInvoiceScanner:
    def __init__(self, lang='en'):
        self.ocr = PaddleOCR(use_textline_orientation=True, lang=lang)
        self.logger = logging.getLogger(__name__)

    def check_blur(self, image_path, threshold=100.0):
        """
        Checks if an image is blurry using the Variance of Laplacian method.
        Returns True if blurry, False otherwise.
        """
        try:
            image = cv2.imread(image_path)
            if image is None:
                self.logger.error(f"Could not read image for blur check: {image_path}")
                return False # Assume not blurry to try processing, or raise error
            
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            score = cv2.Laplacian(gray, cv2.CV_64F).var()
            self.logger.info(f"Blur Score: {score}")
            return score < threshold
        except Exception as e:
            self.logger.error(f"Blur detection failed: {e}")
            return False

    def scan(self, image_path):
        """
        Scans an image and returns structured data including fields and tables.
        Output format:
        {
            "invoice_number": "...",
            "gst_number": "...",
            "total_amount": "...",
            "product_details": [...]
        }
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        # 1. Blur Check
        if self.check_blur(image_path):
            self.logger.warning(f"Image is blurry: {image_path}")
            return {"error": "BLURRED", "message": "The uploaded image is too blurry. Please upload a clear image."}

        self.logger.info(f"Scanning image: {image_path}")
        result = self.ocr.ocr(image_path)
        
        if not result or not result[0]:
            self.logger.warning("No text detected.")
            return {}

        ocr_data = result[0]
        
        # Handle PaddleOCR 2.9+ / PaddleX object result (compatibility)
        try:
            if not isinstance(ocr_data, list):
                if hasattr(ocr_data, 'keys'): ocr_data = dict(ocr_data)
                elif hasattr(ocr_data, '__dict__'): ocr_data = ocr_data.__dict__
                     
            if isinstance(ocr_data, dict):
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
            pass
        
        # Helper for sort key
        def get_sort_key(item):
            try:
                box = item[0]
                return (box[0][1], box[0][0])
            except: return (0, 0)

        # Sort top-down
        # sorted_data = sorted(ocr_data, key=get_sort_key) # We use spatial logic in extractors mainly

        # Extract Components
        metadata = self._extract_metadata(ocr_data)
        product_details = self._extract_table(ocr_data)
        summary = self._extract_summary(ocr_data)
        
        # Construct Final JSON
        invoice_data = {
            "invoice_number": metadata.get("invoice_no", ""),
            "gst_number": metadata.get("gst_no", ""),
            "vendor_name": metadata.get("vendor_name", ""),
            "total_amount": summary.get("net_payable", "") if summary.get("net_payable") else summary.get("total_amount", ""),
            "product_details": product_details
        }
        
        return invoice_data

    def _extract_metadata(self, ocr_data):
        metadata = {
            "invoice_no": None,
            "gst_no": None,
            "vendor_name": None
        }
        
        # Helper to find value to the right of a key
        def find_value_right(key_text__lower, search_data):
            for i, line in enumerate(search_data):
                text = line[1][0]
                if key_text__lower in text.lower():
                    if ":" in text:
                        val = text.split(":", 1)[1].strip()
                        if val: return val
                    
                    key_box = line[0]
                    key_y_center = (key_box[0][1] + key_box[2][1]) / 2
                    
                    candidates = []
                    for other_line in search_data:
                        if other_line == line: continue
                        other_box = other_line[0]
                        other_text = other_line[1][0]
                        other_y_center = (other_box[0][1] + other_box[2][1]) / 2
                        
                        if abs(key_y_center - other_y_center) < 15:
                            if other_box[0][0] > key_box[1][0]:
                                candidates.append((other_box[0][0], other_text))
                    
                    if candidates:
                        candidates.sort(key=lambda x: x[0])
                        return candidates[0][1]
            return None

        metadata['invoice_no'] = find_value_right("invoice no", ocr_data)
        metadata['gst_no'] = find_value_right("gst no", ocr_data)
        
        # --- Vendor Name Extraction ---
        # Strategy: Largest text in top 20% of page, excluding common labels
        try:
            page_height = max(item[0][2][1] for item in ocr_data) if ocr_data else 1000
            header_threshold = page_height * 0.20
            
            candidates = []
            block_list = ["tax invoice", "invoice", "bill to", "ship to", "gst", "phone", "date", "no:", "page", "original", "duplicate"]
            
            for line in ocr_data:
                box = line[0]
                text = line[1][0].strip()
                confidence = line[1][1]
                
                # Check position
                y_center = (box[0][1] + box[2][1]) / 2
                if y_center > header_threshold: continue
                
                # Check block list
                if any(b in text.lower() for b in block_list): continue
                if len(text) < 4: continue # Too short
                if re.search(r'\d', text): continue # Contains numbers (likely address/phone/id), skip for name
                
                # Metrics
                height = abs(box[2][1] - box[0][1])
                width = abs(box[1][0] - box[0][0])
                
                candidates.append({
                    'text': text,
                    'height': height,
                    'y': y_center,
                    'score': height * 2 - (y_center * 0.5) # Prefer large text, penalize lower down
                })
            
            if candidates:
                # Sort by score desc
                candidates.sort(key=lambda x: x['score'], reverse=True)
                metadata['vendor_name'] = candidates[0]['text']
            else:
                metadata['vendor_name'] = ""
                
        except Exception as e:
            self.logger.error(f"Vendor extraction failed: {e}")
            metadata['vendor_name'] = ""

        # Fallback regex
        if not metadata['invoice_no']:
             for line in ocr_data:
                 if re.search(r'invoice\s?no', line[1][0], re.IGNORECASE):
                      match = re.search(r'[A-Za-z0-9]+', line[1][0].split('No')[-1]) # rudimentary
                      pass 

        return metadata

    def _extract_table(self, ocr_data):
        """
        Extracts product details from the invoice table.
        Returns list of dicts with: product_name, expiry, mrp, rate, amount, mfg, pack
        """
        items = []
        
        # 1. Identify Header Row
        header_keywords = ["product", "description", "batch", "qty", "amount", "rate", "mrp", "exp", "mfg", "pack"]
        max_matches = 0
        header_row_index = -1
        
        # Sort data by Y then X
        try:
            sorted_data = sorted(ocr_data, key=lambda x: (x[0][0][1], x[0][0][0]))
        except: sorted_data = ocr_data
        
        rows = []
        current_row = []
        last_y = -100
        
        for item in sorted_data:
            box = item[0]
            y_center = (box[0][1] + box[2][1]) / 2
            if abs(y_center - last_y) > 15:
                if current_row: rows.append(current_row)
                current_row = []
                last_y = y_center
            current_row.append(item)
        if current_row: rows.append(current_row)
        
        for i, row in enumerate(rows):
            row_text = " ".join([item[1][0].lower() for item in row])
            matches = sum(1 for kw in header_keywords if kw in row_text)
            if matches > max_matches:
                max_matches = matches
                header_row_index = i
        
        if header_row_index == -1: return []
            
        header_row = rows[header_row_index]
        
        # Map columns
        columns = []
        for item in header_row:
            box = item[0]
            text = item[1][0].lower()
            clean_text = text.replace('.', '')
            x_min, x_max = box[0][0], box[2][0]
            
            col_name = "unknown"
            if "product" in clean_text or "desc" in clean_text: col_name = "product_name"
            elif "exp" in clean_text: col_name = "expiry"
            elif "mrp" in clean_text: col_name = "mrp"
            elif "rate" in clean_text: col_name = "rate"
            # elif "amount" in clean_text: col_name = "amount" # User requested removal
            elif "mfg" in clean_text: col_name = "mfg"
            elif "pack" in clean_text: col_name = "pack"
            elif "batch" in clean_text: col_name = "batch"
            elif "qty" in clean_text: col_name = "qty"
            elif "free" in clean_text: col_name = "free"
            elif "hsn" in clean_text: col_name = "hsn"
            elif "gst" in clean_text: col_name = "gst"
            elif "disc" in clean_text: col_name = "disc"
            
            if col_name != "unknown":
                columns.append({
                    "name": col_name,
                    "center": (x_min + x_max) / 2
                })

        # Sort columns by center X to enable logical flow (left-to-right)
        columns.sort(key=lambda x: x['center'])
        
        # 2. Iterate rows
        for r_idx in range(header_row_index + 1, len(rows)):
            row = rows[r_idx]
            row_text_all = " ".join([x[1][0].lower() for x in row])
            if "total" in row_text_all or "note:" in row_text_all: break
                
            item_data = {
                "product_name": "", "expiry": "", "mrp": "", 
                "rate": "", "mfg": "", "pack": "", "batch": "", 
                "qty": "", "free": "", "hsn": "", "gst": "", "disc": ""
            }
            
            # Sort row items left-to-right
            row.sort(key=lambda x: x[0][0][0])
            
            for item in row:
                box = item[0]
                text = item[1][0]
                x_center = (box[0][0] + box[2][0]) / 2
                
                # Find best matching start column
                best_col_idx = -1
                min_dist = float('inf')
                for idx, col in enumerate(columns):
                    dist = abs(x_center - col['center'])
                    if dist < min_dist:
                        min_dist = dist
                        best_col_idx = idx
                
                if best_col_idx != -1:
                    col_name = columns[best_col_idx]['name']
                    
                    if col_name == "product_name":
                        # Allow spaces, just append
                        if item_data[col_name]: item_data[col_name] += " " + text
                        else: item_data[col_name] = text
                    else:
                        # Non-product columns: Strict NO SPACE rule
                        # If space exists, split and distribute to subsequent columns
                        parts = text.split()
                        
                        # Assign parts starting from best_col_idx
                        current_idx = best_col_idx
                        for part in parts:
                            if current_idx < len(columns):
                                target_col = columns[current_idx]['name']
                                if not item_data.get(target_col):
                                    item_data[target_col] = part
                                current_idx += 1

            # Basic Cleanup
            if item_data['product_name']:
                # User Rule: Clean product name
                item_data['product_name'] = re.sub(r'^[\d\s\*\.\-\'\"]+', '', item_data['product_name'])
                item_data['product_name'] = item_data['product_name'].strip()

            # Filter valid rows
            has_pname = len(item_data['product_name']) > 2
            # Check if we have at least one numeric/value field
            has_values = any(item_data.get(k) for k in ["mrp", "rate", "batch", "pack"])
            
            if has_pname and has_values and "total" not in item_data['product_name'].lower():
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
        print(f" OCR OUTPUT (JSON)")
        print("="*50)
        print(json.dumps(data, indent=4))
        print("="*50 + "\n")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error: {e}")
