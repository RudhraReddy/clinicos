import os
import tempfile
from flask import Flask, request, jsonify
from ocr_service import AIInvoiceScanner

app = Flask(__name__)
_scanner = None

def get_scanner():
    global _scanner
    if _scanner is None:
        _scanner = AIInvoiceScanner()
    return _scanner

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

@app.route('/ocr', methods=['POST'])
def ocr():
    if 'image' not in request.files:
        return jsonify({'error': 'no image field in request'}), 400
    img_file = request.files['image']
    suffix = os.path.splitext(img_file.filename or '.jpg')[1] or '.jpg'
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        img_file.save(tmp.name)
        path = tmp.name
    try:
        result = get_scanner().scan(path)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
