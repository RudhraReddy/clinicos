import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import create_app
from extensions import db
from models import Visit
import datetime

def update_status():
    app = create_app()
    with app.app_context():
        print("Updating today's visits...")
        
        today = datetime.date.today()
        visits = Visit.query.filter_by(visit_date=today).all()
        
        for visit in visits:
            visit.status = 'scheduled'
        
        try:
            db.session.commit()
            print(f"Updated {len(visits)} visits to 'scheduled' (Next/Waiting).")
        except Exception as e:
            db.session.rollback()
            print(f"Error updating visits: {e}")

if __name__ == "__main__":
    update_status()
