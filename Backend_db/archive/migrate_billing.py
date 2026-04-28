import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import os
os.environ['DISABLE_MODEL_SOURCE_CHECK'] = 'True'
from extensions import db
from app import create_app
app = create_app()
from sqlalchemy import text

def run_migration():
    with app.app_context():
        print("Starting migration...")
        try:
            # 1. Inventory Updates
            print("Updating Inventory Table...")
            db.session.execute(text("ALTER TABLE inventory ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5, 2) DEFAULT 0.0;"))
            db.session.execute(text("ALTER TABLE inventory ADD COLUMN IF NOT EXISTS generic_tags TEXT;"))
            db.session.execute(text("ALTER TABLE inventory ADD COLUMN IF NOT EXISTS pack_size VARCHAR(50);"))
            
            # 2. Bill Items Table
            print("Creating Bill Items Table...")
            db.session.execute(text("""
                CREATE TABLE IF NOT EXISTS bill_items (
                    id SERIAL PRIMARY KEY, 
                    bill_id VARCHAR(50) NOT NULL, 
                    inventory_id VARCHAR(10), 
                    batch_id INTEGER, 
                    item_name VARCHAR(100), 
                    batch_number VARCHAR(50), 
                    expiry_date DATE, 
                    quantity INTEGER, 
                    mrp NUMERIC(10, 2), 
                    gst_rate NUMERIC(5, 2), 
                    total_value NUMERIC(10, 2), 
                    CONSTRAINT fk_bill FOREIGN KEY(bill_id) REFERENCES bills(invoice_id), 
                    CONSTRAINT fk_inventory FOREIGN KEY(inventory_id) REFERENCES inventory(id)
                );
            """))
            
            db.session.commit()
            print("Inventory and BillItems Migration Successful!")
        except Exception as e:
            print(f"Error during migration: {e}")
            db.session.rollback()

if __name__ == "__main__":
    run_migration()
