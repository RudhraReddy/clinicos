# Clinic ML Models

This directory is for storing machine learning models and related code for the clinic management system.

## Current Models

### 1. Invoice OCR (Implemented)
**Location**: `invoice_ocr.py`

Offline invoice text extraction using PaddleOCR + Layout Analysis.

**Features**:
- Extract all text from invoice images
- Auto-parse: Invoice ID, Date, Total Amount, Line Items
- 100% offline (no API keys needed)
- Supports 80+ languages
- Table Extraction (Tabular output)

**Usage**:
```python
from invoice_ocr import AIInvoiceScanner
scanner = AIInvoiceScanner()
data = scanner.scan('path/to/invoice.jpg')
```

## Future Models

Ideas for expansion:
- Prescription OCR
- Medical report analysis
- Appointment scheduling AI
- Inventory forecasting
