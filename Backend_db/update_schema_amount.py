
from app import create_app
from extensions import db
from sqlalchemy import text

def update_schema():
    app = create_app()
    with app.app_context():
        # Add amount_paid column
        try:
            db.session.execute(text("ALTER TABLE visits ADD COLUMN amount_paid INTEGER DEFAULT 0"))
            print("Added amount_paid column")
        except Exception as e:
            print(f"Error adding amount_paid (might already exist): {e}")

        db.session.commit()
        print("Schema update completed.")

if __name__ == "__main__":
    update_schema()
