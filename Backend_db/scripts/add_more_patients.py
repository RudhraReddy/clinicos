import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import create_app
from extensions import db
from models import Patient
import datetime
import random

def add_specific_patients():
    app = create_app()
    with app.app_context():
        print("Adding specific patients...")
        
        patients = []
        names = ["Frank Castle", "Grace Hopper", "Hank Pym", "Ivy Poison", "Jack Napier"]
        
        for i, name in enumerate(names):
            # Generate a consistent but unique phone number starting with 666
            phone = f"666-{random.randint(1000, 9999)}"
            
            p = Patient(
                patient_id=Patient.generate_patient_id(),
                name=name,
                phone_number=phone,
                dob=datetime.date(1985 + i, random.randint(1, 12), random.randint(1, 28))
            )
            db.session.add(p)
            patients.append(p)
        
        try:
            db.session.commit()
            print(f"Successfully added {len(patients)} patients with '666' phone numbers.")
        except Exception as e:
            db.session.rollback()
            print(f"Error adding patients: {e}")

if __name__ == "__main__":
    add_specific_patients()
