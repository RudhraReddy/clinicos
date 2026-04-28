
from extensions import db
from app import create_app
from models import PatientImage
import os

app = create_app()

with app.app_context():
    images = PatientImage.query.all()
    print(f"Total Images: {len(images)}")
    for img in images:
        print(f"ID: {img.id}, Tag: '{img.tag}', Notes: '{img.notes}', Path: {os.path.basename(img.image_path)}")
