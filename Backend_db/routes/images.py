
from flask import Blueprint, request, jsonify, send_file
from extensions import db, get_ist_now
from models import PatientImage, Patient
import os

images = Blueprint('images', __name__)

@images.route('/patients/<patient_id>/images', methods=['POST'])
def upload_patient_image(patient_id):
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    visit_id = request.form.get('visit_id')
    notes = request.form.get('notes')
    
    base_folder = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'patients')
    patient_folder = os.path.join(base_folder, patient_id)
    
    try:
        if not os.path.exists(patient_folder):
            os.makedirs(patient_folder)
            
        timestamp = int(get_ist_now().timestamp())
        safe_filename = file.filename.replace(" ", "_") # Simple sanitization
        filename = f"{timestamp}_{safe_filename}"
        filepath = os.path.join(patient_folder, filename)
        
        file.save(filepath)
        
        # Save to DB
        image = PatientImage(
            patient_id=patient_id,
            visit_id=visit_id if visit_id else None,
            image_path=filepath,
            notes=notes,
            tag=request.form.get('tag', 'Medical Record') # Default to Medical Record for Doctor uploads
        )
        db.session.add(image)
        db.session.commit()
        
        return jsonify({'message': 'Image uploaded successfully', 'id': image.id}), 201
        
    except Exception as e:
        print(f"Error uploading image: {e}")
        return jsonify({'error': str(e)}), 500

@images.route('/patients/<patient_id>/images', methods=['GET'])
def get_patient_images(patient_id):
    images_list = PatientImage.query.filter_by(patient_id=patient_id).order_by(PatientImage.timestamp.desc()).all()
    results = []
    for img in images_list:
        results.append({
            'id': img.id,
            'visit_id': img.visit_id,
            'timestamp': img.timestamp.isoformat(),
            'notes': img.notes,
            'tag': img.tag,
            'filename': os.path.basename(img.image_path)
        })
    return jsonify(results), 200

@images.route('/patients/images/<int:image_id>/file', methods=['GET'])
def get_patient_image_file(image_id):
    img = PatientImage.query.get_or_404(image_id)
    if img.image_path and os.path.exists(img.image_path):
        return send_file(img.image_path)
    return jsonify({'error': 'Image file not found'}), 404

@images.route('/patients/images', methods=['GET'])
def get_all_patient_images():
    """Fetch all patient images sorted by timestamp desc, joining with Patient info."""
    # Join PatientImage with Patient
    images_list = db.session.query(PatientImage, Patient).join(Patient, PatientImage.patient_id == Patient.patient_id).order_by(PatientImage.timestamp.desc()).all()
    
    results = []
    for img, patient in images_list:
        results.append({
            'id': img.id,
            'patient_id': img.patient_id,
            'patient_name': patient.name,
            'visit_id': img.visit_id,
            'timestamp': img.timestamp.isoformat(),
            'notes': img.notes,
            'tag': img.tag,
            'filename': os.path.basename(img.image_path)
        })
    return jsonify(results), 200

@images.route('/patients/images/<int:image_id>', methods=['PUT'])
def update_patient_image(image_id):
    img = PatientImage.query.get_or_404(image_id)
    data = request.json
    
    if 'notes' in data:
        img.notes = data['notes']
    if 'tag' in data:
        img.tag = data['tag']
        
    db.session.commit()
    return jsonify({'message': 'Image updated successfully'}), 200
