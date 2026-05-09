from datetime import datetime
from extensions import db, get_ist_now
import secrets

class Patient(db.Model):
    __tablename__ = 'patients'

    patient_id = db.Column(db.String(10), primary_key=True)
    phone_number = db.Column(db.String(20), nullable=False, index=True)
    name = db.Column(db.String(100), nullable=False)
    dob = db.Column(db.Date, nullable=True)
    age = db.Column(db.Integer)
    sex = db.Column(db.String(10))
    address = db.Column(db.Text)
    reference = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=get_ist_now)

    # Def to generate unique patient_id
    @staticmethod
    def generate_patient_id():
        return secrets.token_hex(4).upper()

# --- New Inventory System ---

class PurchaseInvoice(db.Model):
    """
    Tracks the source of inventory.
    Unique constraint on invoice_number.
    """
    __tablename__ = 'purchase_invoices'
    
    invoice_number = db.Column(db.String(50), primary_key=True) # User/OCR provided unique ID
    gst_number = db.Column(db.String(50))
    total_amount = db.Column(db.Numeric(10, 2))
    vendor_name = db.Column(db.String(100))
    invoice_date = db.Column(db.Date) # From Invoice
    upload_date = db.Column(db.DateTime, default=get_ist_now)
    image_path = db.Column(db.String(255)) # Path to saved image
    source = db.Column(db.String(50)) # 'OCR', 'MANUAL', 'CSV_UPDATE', 'CSV_OVERWRITE'

class ProductMaster(db.Model):
    """
    Master Product Table.
    Does NOT store quantity or price directly anymore.
    """
    __tablename__ = 'product_master'

    # Changed from Integer to String to support custom "Product Code"
    id = db.Column(db.String(10), primary_key=True) 
    item_name = db.Column(db.String(100), nullable=False, index=True)
    # dosage removed
    category = db.Column(db.String(50))
    pack_size = db.Column(db.String(50)) # "Packs" - e.g., '1x10', '100ml'
    hsn_code = db.Column(db.String(20))
    # min_stock_level kept for alert logic
    min_stock_level = db.Column(db.Integer, default=10)
    manufacturer = db.Column(db.String(100))
    
    # New Fields for Billing/Product Master
    gst_rate = db.Column(db.Numeric(5, 2), default=0.0)
    generic_tags = db.Column(db.Text) # Comma Separated
    # NOTE: New column — run ALTER TABLE product_master ADD COLUMN formula TEXT; in production
    formula = db.Column(db.Text, nullable=True)

    # Relationships
    batches = db.relationship('InventoryBatch', backref='product', lazy=True)

    @staticmethod
    def generate_item_id():
        """Generates a unique 6-char hex ID for the product (e.g. A1B2C3)"""
        return secrets.token_hex(3).upper()

class InventoryBatch(db.Model):
    """
    Stores actual stock.
    Separated by Expiry Date, MRP, and Batch Number.
    """
    __tablename__ = 'inventory_batches'

    id = db.Column(db.Integer, primary_key=True)
    # FK matches ProductMaster.id type (String 10)
    product_id = db.Column(db.String(10), db.ForeignKey('product_master.id'), nullable=False)
    
    # Origins
    purchase_invoice_number = db.Column(db.String(50), db.ForeignKey('purchase_invoices.invoice_number'), nullable=True)
    batch_number = db.Column(db.String(50)) # Vendor Batch Number
    
    # differentiating factors
    expiry_date = db.Column(db.Date)
    mrp = db.Column(db.Numeric(10, 2)) # Retail Price
    purchase_rate = db.Column(db.Numeric(10, 2)) # Cost Price
    
    # Taxes
    gst_rate = db.Column(db.Numeric(10, 2), default=0.0) # e.g., 12.00, 18.00
    gst_amount = db.Column(db.Numeric(10, 2), default=0.0) # Total tax amount for this batch qty (optional use)

    # Current Stock
    quantity = db.Column(db.Integer, default=0)
    
    # Original Invoice Details (For History)
    initial_quantity = db.Column(db.Integer, default=0) # Qty at time of purchase (Paid + Free)
    free_quantity = db.Column(db.Integer, default=0) # Free Qty included in initial


class InventoryHistory(db.Model):
    __tablename__ = 'inventory_history'

    id = db.Column(db.Integer, primary_key=True)
    
    # Links
    product_id = db.Column(db.String(10), db.ForeignKey('product_master.id'), nullable=False)
    batch_id = db.Column(db.Integer, db.ForeignKey('inventory_batches.id'), nullable=True) # Specific batch
    
    # Document Links
    bill_id = db.Column(db.String(50), db.ForeignKey('bills.invoice_id'), nullable=True) # Sales
    purchase_invoice_number = db.Column(db.String(50), db.ForeignKey('purchase_invoices.invoice_number'), nullable=True) # Stock In
    
    # change_amount = db.Column(db.Integer, nullable=False)
    change_amount = db.Column(db.Integer, nullable=False)
    # Type: PURCHASE, SALE, EXPIRED, RETURN, ADJUSTMENT
    type = db.Column(db.String(50), nullable=False) 
    timestamp = db.Column(db.DateTime, default=get_ist_now)
    notes = db.Column(db.Text)

# --- Visits & Billing ---

class Visit(db.Model):
    __tablename__ = 'visits'

    visit_id = db.Column(db.String(50), primary_key=True) # format: patient_id-DDMMYY-XXX-XXX
    patient_id = db.Column(db.String(10), db.ForeignKey('patients.patient_id'), nullable=False)
    invoice_id = db.Column(db.String(50)) 
    reason = db.Column(db.Text)
    visit_date = db.Column(db.Date)
    visit_time = db.Column(db.Time)
    status = db.Column(db.String(20), default='in_progress') # in_progress, Done, cancelled
    doctor_id = db.Column(db.String(50)) # User ID of doctor
    
    # Financials
    visiting_fee = db.Column(db.Integer, default=0)
    amount_paid = db.Column(db.Integer, default=0)
    payment_status = db.Column(db.String(20), default='unpaid') # full, partial, unpaid
    
    created_at = db.Column(db.DateTime, default=get_ist_now)
    updated_at = db.Column(db.DateTime, default=get_ist_now, onupdate=get_ist_now)

class Bill(db.Model):
    __tablename__ = 'bills'

    invoice_id = db.Column(db.String(50), primary_key=True) # format: DDMMYY-XXX-XXX
    patient_id = db.Column(db.String(10), db.ForeignKey('patients.patient_id'), nullable=False)
    visit_id = db.Column(db.String(50), db.ForeignKey('visits.visit_id'), nullable=True)
    total_amount = db.Column(db.Numeric(10, 2), nullable=False)
    payment_type = db.Column(db.String(50)) # CASH, CARD, INSURANCE
    created_at = db.Column(db.DateTime, default=get_ist_now)

    created_by_user_id = db.Column(db.String(50)) # Admin/Staff ID



class BillItem(db.Model):
    __tablename__ = 'bill_items'

    id = db.Column(db.Integer, primary_key=True)
    bill_id = db.Column(db.String(50), db.ForeignKey('bills.invoice_id'), nullable=False)
    product_id = db.Column(db.String(10), db.ForeignKey('product_master.id'), nullable=True) # Link to master for reference
    batch_id = db.Column(db.Integer, nullable=True) # Link to batch if needed
    
    # Snapshot Details
    item_name = db.Column(db.String(100))
    batch_number = db.Column(db.String(50))
    expiry_date = db.Column(db.Date)
    quantity = db.Column(db.Integer)
    mrp = db.Column(db.Numeric(10, 2)) # Unit MRP at sale
    gst_rate = db.Column(db.Numeric(5, 2))
    total_value = db.Column(db.Numeric(10, 2)) # qty * mrp

class PatientImage(db.Model):
    __tablename__ = 'patient_images'

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.String(10), db.ForeignKey('patients.patient_id'), nullable=False)
    visit_id = db.Column(db.String(50), db.ForeignKey('visits.visit_id'), nullable=True) # Optional link to visit
    invoice_id = db.Column(db.String(50), nullable=True) # Link to bill

    image_path = db.Column(db.String(255), nullable=False)
    notes = db.Column(db.Text)
    tag = db.Column(db.String(50)) # e.g., 'Prescription', 'Lab', 'X-Ray'
    timestamp = db.Column(db.DateTime, default=get_ist_now)
    deleted_at = db.Column(db.DateTime, nullable=True, default=None)

class UploadSession(db.Model):
    """
    Temporary session for QR code uploads.
    """
    __tablename__ = 'upload_sessions'

    session_id = db.Column(db.String(36), primary_key=True) # UUID
    context_type = db.Column(db.String(50)) # 'patient', 'inventory'
    context_id = db.Column(db.String(50)) # patient_id or invoice_id (if applicable)
    status = db.Column(db.String(20), default='WAITING') # WAITING, UPLOADED, COMPLETED
    created_at = db.Column(db.DateTime, default=get_ist_now)
    files = db.Column(db.Text) # JSON string of uploaded files info: [{path, tag, notes}]
