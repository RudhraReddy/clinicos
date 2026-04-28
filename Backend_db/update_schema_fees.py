
from app import create_app
from extensions import db
from sqlalchemy import text

def update_schema():
    app = create_app()
    with app.app_context():
        # Add visiting_fee column
        try:
            db.session.execute(text("ALTER TABLE visits ADD COLUMN visiting_fee INTEGER DEFAULT 0"))
            print("Added visiting_fee column")
        except Exception as e:
            print(f"Error adding visiting_fee (might already exist): {e}")

        # Add payment_status column
        try:
            db.session.execute(text("ALTER TABLE visits ADD COLUMN payment_status VARCHAR(20) DEFAULT 'unpaid'"))
            print("Added payment_status column")
        except Exception as e:
            print(f"Error adding payment_status (might already exist): {e}")

        db.session.commit()
        print("Schema update completed.")

if __name__ == "__main__":
    update_schema()
