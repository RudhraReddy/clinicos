import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import create_app
from extensions import db
import sys

def init_tables():
    app = create_app()
    with app.app_context():
        try:
            print("Creating database tables...")
            db.create_all()
            print("Tables created successfully!")
        except Exception as e:
            print(f"Error creating tables: {e}")
            print("Make sure PostgreSQL is running and the database 'clinic_db' exists.")
            sys.exit(1)

if __name__ == "__main__":
    init_tables()
