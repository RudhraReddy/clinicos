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
        print("Starting Prescription & User Schema Migration...")
        try:
            # 1. Add User Columns (Placeholders)
            print("Adding User Columns...")
            try:
                db.session.execute(text("ALTER TABLE visits ADD COLUMN IF NOT EXISTS doctor_id VARCHAR(50);"))
            except Exception as e: print(f"doctor_id exists or error: {e}")

            try:
                db.session.execute(text("ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(50);"))
            except Exception as e: print(f"created_by_user_id exists or error: {e}")

            # 2. Create Prescription Items Table
            print("Creating Prescription Items Table...")
            db.session.execute(text("""
                CREATE TABLE IF NOT EXISTS prescription_items (
                    id SERIAL PRIMARY KEY, 
                    visit_id VARCHAR(50) NOT NULL, 
                    inventory_id VARCHAR(10), 
                    item_name VARCHAR(100),
                    quantity INTEGER, 
                    dosage_instructions TEXT, 
                    duration VARCHAR(50),
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_presc_visit FOREIGN KEY(visit_id) REFERENCES visits(visit_id), 
                    CONSTRAINT fk_presc_inv FOREIGN KEY(inventory_id) REFERENCES inventory(id)
                );
            """))
            
            db.session.commit()
            print("Migration Successful!")
        except Exception as e:
            print(f"Error during migration: {e}")
            db.session.rollback()

if __name__ == "__main__":
    run_migration()
