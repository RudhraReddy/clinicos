import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from extensions import db
from app import create_app
from models import Visit
from sqlalchemy import text

def clear_visits_data():
    app = create_app()
    with app.app_context():
        try:
            # Delete all records from the visits table
            num_rows_deleted = db.session.query(Visit).delete()
            db.session.commit()
            print(f"Successfully deleted {num_rows_deleted} visit records.")
            
            # Reset any sequences if necessary (though we use custom IDs now)
            # db.session.execute(text("TRUNCATE TABLE visits RESTART IDENTITY CASCADE;"))
            # db.session.commit()
            
        except Exception as e:
            db.session.rollback()
            print(f"An error occurred: {e}")

if __name__ == "__main__":
    confirmation = input("Are you sure you want to delete ALL visit data? This action cannot be undone. (yes/no): ")
    if confirmation.lower() == 'yes':
        clear_visits_data()
    else:
        print("Operation cancelled.")
