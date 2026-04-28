import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import create_app
from extensions import db
from models import Patient, Visit
import datetime
import random
import secrets

def seed_data():
    app = create_app()
    with app.app_context():
        print("Seeding data...")
        
        # Create Patients
        patients = []
        names = ["Alice Smith", "Bob Jones", "Charlie Brown", "Diana Prince", "Evan Wright"]
        for name in names:
            p = Patient(
                patient_id=Patient.generate_patient_id(),
                name=name,
                phone_number=f"555-{random.randint(1000,9999)}",
                dob=datetime.date(1980 + random.randint(0, 20), random.randint(1, 12), random.randint(1, 28))
            )
            db.session.add(p)
            patients.append(p)
        
        try:
            db.session.commit()
            print(f"Created {len(patients)} patients.")
        except Exception as e:
            db.session.rollback()
            print(f"Error creating patients (might already exist): {e}")
            # If failed, try to fetch existing to continue seeding visits
            patients = Patient.query.limit(5).all()

        # Create Visits for Today
        today = datetime.date.today()
        
        statuses = ["done", "done", "in_progress", "scheduled", "scheduled", "cancelled"]
        reasons = ["Checkup", "Fever", "Follow-up", "Consultation", "Vaccination", "Emergency"]
        
        for i, status in enumerate(statuses):
            if not patients:
                break
            patient = patients[i % len(patients)]
            
            # Generate Visit ID
            # Format: patient_id-DDMMYY-XXX-XXX
            date_str = today.strftime("%d%m%y")
            unique_part = secrets.token_hex(3).upper() + "-" + secrets.token_hex(3).upper()
            visit_id = f"{patient.patient_id}-{date_str}-{unique_part}"
            
            # Times: 9:00, 10:00, etc.
            hour = 9 + i
            visit_time = datetime.time(hour, 0)
            
            v = Visit(
                visit_id=visit_id,
                patient_id=patient.patient_id,
                visit_date=today,
                visit_time=visit_time,
                status=status,
                reason=reasons[i],
                notes=None
            )
            db.session.add(v)

        try:
            db.session.commit()
            print("Created visits for today.")
        except Exception as e:
            print(f"Error creating visits: {e}")
            db.session.rollback()

        print("Seeding complete!")

if __name__ == "__main__":
    seed_data()
