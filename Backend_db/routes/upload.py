
from flask import Blueprint, request, jsonify
from extensions import db, get_ist_now
from models import UploadSession, PatientImage
import uuid
import json
import os
from werkzeug.utils import secure_filename

upload_bp = Blueprint('upload', __name__)

UPLOAD_FOLDER = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'temp')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@upload_bp.route('/upload/session', methods=['POST'])
def create_session():
    data = request.json
    context_type = data.get('context_type')
    context_id = data.get('context_id')
    
    session_id = str(uuid.uuid4())
    session = UploadSession(
        session_id=session_id,
        context_type=context_type,
        context_id=context_id,
        status='WAITING',
        files='[]'
    )
    db.session.add(session)
    db.session.commit()
    
    return jsonify({'session_id': session_id, 'url_path': f'/connect/{session_id}'}), 201

@upload_bp.route('/upload/session/<session_id>', methods=['GET'])
def get_session_status(session_id):
    session = UploadSession.query.get(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    
    files = json.loads(session.files) if session.files else []
    return jsonify({
        'status': session.status,
        'files': files,
        'context_type': session.context_type,
        'context_id': session.context_id
    })

@upload_bp.route('/upload/mobile/<session_id>', methods=['POST'])
def mobile_upload(session_id):
    session = UploadSession.query.get(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
        
    files = request.files.getlist('file')
    tags = request.form.getlist('tags') # Or loop if multiple files have diff tags
    notes = request.form.get('notes', '')
    
    # If single file/tag is sent differently, handle it. 
    # Frontend might send one by one.
    
    saved_files = []
    current_files = json.loads(session.files) if session.files else []

    context_folder = UPLOAD_FOLDER
    
    # If we know the patient, maybe save directly? 
    # But plan said "temporary". Let's stick to temp or organize by session.
    session_folder = os.path.join(UPLOAD_FOLDER, session_id)
    if not os.path.exists(session_folder):
        os.makedirs(session_folder)

    for i, file in enumerate(files):
        if file.filename == '':
            continue
            
        filename = secure_filename(file.filename)
        timestamp = int(get_ist_now().timestamp())
        unique_filename = f"{timestamp}_{i}_{filename}"
        filepath = os.path.join(session_folder, unique_filename)
        file.save(filepath)
        
        tag = tags[i] if i < len(tags) else 'Uncategorized'
        
        file_info = {
            'path': filepath,
            'tag': tag,
            'notes': notes,
            'filename': unique_filename
        }
        saved_files.append(file_info)
        current_files.append(file_info)

    session.files = json.dumps(current_files)
    session.status = 'UPLOADED'
    db.session.commit()
    
    return jsonify({'message': 'Uploaded successfully', 'files': saved_files}), 200

@upload_bp.route('/upload/session/<session_id>/finalize', methods=['POST'])
def finalize_session(session_id):
    """
    Called by Desktop to move files to permanent storage (Patient Images)
    """
    session = UploadSession.query.get(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
        
    uploaded_files = json.loads(session.files)
    
    # Optional Invoice ID if finalizing from Billing
    # Not yet passed from frontend in this flow, but useful to have.
    # Actually context_id is patient_id for "patient" type.
    
    final_images = []
    
    if session.context_type == 'patient':
        patient_id = session.context_id
        base_folder = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'patients')
        patient_folder = os.path.join(base_folder, patient_id)
        if not os.path.exists(patient_folder):
            os.makedirs(patient_folder)
            
        for f in uploaded_files:
            # Move file
            src = f['path']
            if os.path.exists(src):
                dst = os.path.join(patient_folder, f['filename'])
                os.rename(src, dst)
                
                # Check tag, if not set or 'Uncategorized', default to 'Prescription'
                # User requested "when we uploade its always prescription"
                tag = f.get('tag')
                if not tag or tag == 'Uncategorized':
                    tag = 'Prescription'
                
                # Create DB Entry
                img = PatientImage(
                    patient_id=patient_id,
                    image_path=dst,
                    notes=f.get('notes', ''),
                    tag=tag,
                    # We can't link invoice here yet unless passed in context or body
                    # For now just confirming tag logic.
                )
                db.session.add(img)
                final_images.append(img)
    
    session.status = 'COMPLETED'
    db.session.commit()
    
    return jsonify({'message': 'Files finalized', 'count': len(final_images)}), 200
