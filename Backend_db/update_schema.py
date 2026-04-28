from app import create_app
from extensions import db
from sqlalchemy import text

app = create_app()

def update_schema():
    with app.app_context():
        # 1. Add invoice_id to patient_images
        print("Adding invoice_id to patient_images...")
        try:
            with db.engine.connect() as conn:
                conn.execute(text("ALTER TABLE patient_images ADD COLUMN invoice_id VARCHAR(50)"))
                conn.commit()
            print("Success: invoice_id column added.")
        except Exception as e:
            print(f"Skipped adding column (migth exist): {e}")

        # 2. Drop prescription_items table
        print("Dropping prescription_items table...")
        try:
            with db.engine.connect() as conn:
                conn.execute(text("DROP TABLE IF EXISTS prescription_items"))
                conn.commit()
            print("Success: prescription_items table dropped.")
        except Exception as e:
            print(f"Error dropping table: {e}")

if __name__ == "__main__":
    update_schema()
