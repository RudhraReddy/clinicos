
from app import create_app
from extensions import db
from sqlalchemy import text

def update_schema():
    app = create_app()
    with app.app_context():
        # Drop notes column
        try:
            db.session.execute(text("ALTER TABLE visits DROP COLUMN notes"))
            print("Dropped notes column")
        except Exception as e:
            print(f"Error dropping notes (might not exist): {e}")

        db.session.commit()
        print("Schema update completed.")

if __name__ == "__main__":
    update_schema()
