
from datetime import timedelta
from flask import Blueprint, request, jsonify, send_file, g
from extensions import db, get_ist_now
from models import PatientImage, Patient
import os
from .auth import require_auth, log_activity

images = Blueprint('images', __name__)

@images.route('/patients/<patient_id>/images', methods=['POST'])
@require_auth
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
        safe_filename = file.filename.replace(" ", "_")
        filename = f"{timestamp}_{safe_filename}"
        filepath = os.path.join(patient_folder, filename)

        file.save(filepath)

        image = PatientImage(
            patient_id=patient_id,
            visit_id=visit_id if visit_id else None,
            image_path=filepath,
            notes=notes,
            tag=request.form.get('tag', 'Medical Record'),
            created_by_user_id=g.current_user.get('user_id')
        )
        db.session.add(image)
        db.session.commit()

        log_activity(
            action='CREATE',
            resource_type='patient_image',
            resource_id=str(image.id),
            resource_label=f"Patient {patient_id} — {request.form.get('tag', 'Medical Record')}",
            user_id=g.current_user.get('user_id'),
            username=g.current_user.get('username'),
            ip_address=request.remote_addr,
        )

        return jsonify({'message': 'Image uploaded successfully', 'id': image.id}), 201

    except Exception as e:
        print(f"Error uploading image: {e}")
        return jsonify({'error': str(e)}), 500


@images.route('/patients/<patient_id>/images', methods=['GET'])
@require_auth
def get_patient_images(patient_id):
    images_list = (
        PatientImage.query
        .filter_by(patient_id=patient_id)
        .filter(PatientImage.deleted_at == None)
        .order_by(PatientImage.timestamp.desc())
        .all()
    )
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
@require_auth
def get_patient_image_file(image_id):
    img = PatientImage.query.get_or_404(image_id)
    if img.image_path and os.path.exists(img.image_path):
        return send_file(img.image_path)
    return jsonify({'error': 'Image file not found'}), 404


# NOTE: /patients/images/trash must be registered BEFORE /patients/images/<int:image_id>
# to avoid Flask interpreting "trash" as an integer image_id.

@images.route('/patients/images/trash', methods=['GET'])
@require_auth
def get_trash_images():
    """
    Return all soft-deleted patient images.
    Optional ?patient_id= to filter by patient.
    Lazily purges rows older than 30 days before returning results.
    """
    patient_id = request.args.get('patient_id')
    now = get_ist_now()
    cutoff = now - timedelta(days=30)

    # --- Lazy purge: permanently delete rows trashed more than 30 days ago ---
    purge_query = PatientImage.query.filter(
        PatientImage.deleted_at != None,
        PatientImage.deleted_at < cutoff
    )
    if patient_id:
        purge_query = purge_query.filter_by(patient_id=patient_id)

    for img in purge_query.all():
        try:
            if img.image_path and os.path.exists(img.image_path):
                os.remove(img.image_path)
        except Exception as e:
            print(f"Warning: could not delete file {img.image_path}: {e}")
        try:
            db.session.delete(img)
        except Exception as e:
            print(f"Warning: could not delete DB row {img.id}: {e}")

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f"Warning: purge commit failed: {e}")

    # --- Return remaining trashed rows ---
    trash_query = (
        db.session.query(PatientImage, Patient)
        .join(Patient, PatientImage.patient_id == Patient.patient_id)
        .filter(PatientImage.deleted_at != None)
    )
    if patient_id:
        trash_query = trash_query.filter(PatientImage.patient_id == patient_id)

    trash_query = trash_query.order_by(PatientImage.deleted_at.desc())

    results = []
    for img, patient in trash_query.all():
        results.append({
            'id': img.id,
            'patient_id': img.patient_id,
            'patient_name': patient.name,
            'visit_id': img.visit_id,
            'timestamp': img.timestamp.isoformat(),
            'deleted_at': img.deleted_at.isoformat(),
            'notes': img.notes,
            'tag': img.tag,
            'filename': os.path.basename(img.image_path)
        })
    return jsonify(results), 200


@images.route('/patients/images', methods=['GET'])
@require_auth
def get_all_patient_images():
    """Fetch all non-deleted patient images sorted by timestamp desc, joining with Patient info."""
    try:
        images_list_query = (
            db.session.query(PatientImage, Patient)
            .join(Patient, PatientImage.patient_id == Patient.patient_id)
            .filter(PatientImage.deleted_at == None)
            .order_by(PatientImage.timestamp.desc())
        )

        created_by = request.args.get('created_by')
        if created_by and created_by != 'all':
            if g.current_user.get('role') == 'doctor':
                from models import DoctorStaffAssignment
                assignment = DoctorStaffAssignment.query.filter_by(
                    doctor_id=g.current_user['user_id'],
                    staff_id=created_by
                ).first()
                if not assignment:
                    return jsonify({'error': 'Staff not assigned to you'}), 403
            images_list_query = images_list_query.filter(PatientImage.created_by_user_id == created_by)

        images_list = images_list_query.all()

        results = []
        for img, patient in images_list:
            results.append({
                'id': img.id,
                'patient_id': img.patient_id,
                'patient_name': patient.name if patient else "Unknown",
                'visit_id': img.visit_id,
                'timestamp': img.timestamp.isoformat() if img.timestamp else None,
                'notes': img.notes,
                'tag': img.tag,
                'filename': os.path.basename(img.image_path) if img.image_path else ""
            })
        return jsonify(results), 200
    except Exception as e:
        import traceback
        print("ERROR in get_all_patient_images:")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@images.route('/patients/images/<int:image_id>', methods=['PUT'])
@require_auth
def update_patient_image(image_id):
    img = PatientImage.query.get_or_404(image_id)
    data = request.json

    if 'notes' in data:
        img.notes = data['notes']
    if 'tag' in data:
        img.tag = data['tag']

    db.session.commit()

    log_activity(
        action='UPDATE',
        resource_type='patient_image',
        resource_id=str(image_id),
        resource_label=f"Image {image_id}",
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Image updated successfully'}), 200


@images.route('/patients/images/<int:image_id>', methods=['DELETE'])
@require_auth
def soft_delete_patient_image(image_id):
    """Move an image to trash (soft-delete)."""
    img = PatientImage.query.get_or_404(image_id)
    if img.deleted_at is not None:
        return jsonify({'message': 'Image already in trash'}), 200
    img.deleted_at = get_ist_now()
    db.session.commit()

    log_activity(
        action='DELETE',
        resource_type='patient_image',
        resource_id=str(image_id),
        resource_label=f"Image {image_id} (Patient {img.patient_id})",
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'moved to trash'}), 200


@images.route('/patients/images/<int:image_id>/restore', methods=['POST'])
@require_auth
def restore_patient_image(image_id):
    """Restore an image from trash."""
    img = PatientImage.query.get_or_404(image_id)
    img.deleted_at = None
    db.session.commit()
    return jsonify({'message': 'restored'}), 200


@images.route('/patients/images/<int:image_id>/permanent', methods=['DELETE'])
@require_auth
def permanent_delete_patient_image(image_id):
    """Permanently delete an image: removes the file and the DB row."""
    img = PatientImage.query.get_or_404(image_id)
    try:
        if img.image_path and os.path.exists(img.image_path):
            os.remove(img.image_path)
    except Exception as e:
        print(f"Warning: could not delete file {img.image_path}: {e}")
    db.session.delete(img)
    db.session.commit()
    return '', 204
