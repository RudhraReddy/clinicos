import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import create_app
from extensions import db
import sys

def reset_db():
    app = create_app()
    with app.app_context():
        try:
            print("Dropping all tables...")
            db.drop_all()
            print("Creating all tables...")
            db.create_all()
            print("Database reset successfully! New schema applied.")
        except Exception as e:
            print(f"Error resetting database: {e}")
            sys.exit(1)

if __name__ == "__main__":
    reset_db()
