
import io
import csv
from flask import Blueprint, request, jsonify, g, send_file
from models import Patient
from extensions import db, get_ist_now
from sqlalchemy import func
from .auth import require_auth, log_activity

patients = Blueprint('patients', __name__)

@patients.route('/patients', methods=['POST'])
@require_auth
def create_patient():
    data = request.get_json()

    if not all(k in data for k in ('phone_number', 'name')):
        return jsonify({'error': 'Missing required fields: name, phone_number'}), 400

    patient_id = Patient.generate_patient_id()

    ref_id = data.get('reference_patient_id')
    if ref_id:
        if ref_id == patient_id:
            return jsonify({'error': 'Patient cannot reference themselves'}), 400
        if not Patient.query.filter_by(patient_id=ref_id).first():
            return jsonify({'error': 'Referenced patient not found'}), 404

    new_patient = Patient(
        patient_id=patient_id,
        phone_number=data['phone_number'],
        name=data['name'],
        age=int(data['age']) if data.get('age') else None,
        sex=data.get('sex'),
        address=data.get('address'),
        dob=data.get('dob'),
        reference_patient_id=ref_id,
        created_by_user_id=g.current_user.get('user_id'),
    )
    db.session.add(new_patient)
    db.session.commit()

    log_activity(
        action='CREATE',
        resource_type='patient',
        resource_id=patient_id,
        resource_label=data['name'],
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Patient created', 'patient_id': patient_id}), 201

@patients.route('/patients', methods=['GET'])
@require_auth
def get_patients():
    query_str = request.args.get('q', '').lower().strip()
    phone = request.args.get('phone_number')
    page = int(request.args.get('page', 1))
    limit = int(request.args.get('limit', 50))

    q = Patient.query

    if phone:
        # Normalize search: remove hyphens and spaces
        clean_phone = phone.replace('-', '').replace(' ', '')
        q = q.filter(func.replace(func.replace(Patient.phone_number, '-', ''), ' ', '').contains(clean_phone))
    elif query_str:
        q = q.filter(
            (func.lower(Patient.name).contains(query_str)) |
            (Patient.phone_number.contains(query_str)) |
            (Patient.patient_id.contains(query_str.upper()))
        )

    patients_list = q.offset((page - 1) * limit).limit(limit).all()

    # Batch-load reference names (one extra query at most)
    ref_ids = [p.reference_patient_id for p in patients_list if p.reference_patient_id]
    ref_map: dict = {}
    if ref_ids:
        refs = Patient.query.filter(Patient.patient_id.in_(ref_ids)).all()
        ref_map = {r.patient_id: r.name for r in refs}

    results = []
    for p in patients_list:
        results.append({
            'patient_id': p.patient_id,
            'name': p.name,
            'phone_number': p.phone_number,
            'age': p.age,
            'sex': p.sex,
            'address': p.address,
            'reference_patient_id': p.reference_patient_id,
            'reference_patient_name': ref_map.get(p.reference_patient_id) if p.reference_patient_id else None,
            'created_at': p.created_at.isoformat() if p.created_at else None,
        })
    return jsonify(results), 200

@patients.route('/patients/<patient_id>', methods=['GET'])
@require_auth
def get_patient_detail(patient_id):
    patient = Patient.query.filter_by(patient_id=patient_id).first_or_404()
    ref_name = None
    if patient.reference_patient_id:
        ref = Patient.query.filter_by(patient_id=patient.reference_patient_id).first()
        ref_name = ref.name if ref else None
    return jsonify({
        'patient_id': patient.patient_id,
        'name': patient.name,
        'phone_number': patient.phone_number,
        'age': patient.age,
        'sex': patient.sex,
        'address': patient.address,
        'reference_patient_id': patient.reference_patient_id,
        'reference_patient_name': ref_name,
        'created_at': patient.created_at.isoformat() if patient.created_at else None,
    }), 200

@patients.route('/patients/<patient_id>', methods=['PUT'])
@require_auth
def update_patient(patient_id):
    data = request.get_json()
    patient = Patient.query.filter_by(patient_id=patient_id).first_or_404()
    
    if 'name' in data:
        patient.name = data['name']
    if 'phone_number' in data:
        patient.phone_number = data['phone_number']
    if 'age' in data:
        patient.age = int(data['age']) if data['age'] else None
    if 'sex' in data:
        patient.sex = data['sex']
    if 'address' in data:
        patient.address = data['address']
    if 'reference_patient_id' in data:
        ref_id = data['reference_patient_id']
        if ref_id is not None:
            if ref_id == patient_id:
                return jsonify({'error': 'Patient cannot reference themselves'}), 400
            if not Patient.query.filter_by(patient_id=ref_id).first():
                return jsonify({'error': 'Referenced patient not found'}), 404
        patient.reference_patient_id = ref_id

    db.session.commit()

    log_activity(
        action='UPDATE',
        resource_type='patient',
        resource_id=patient_id,
        resource_label=patient.name,
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Patient updated'}), 200


@patients.route('/patients/export', methods=['GET'])
@require_auth
def export_patients():
    """
    Generates a streamable CSV record of all registered clinic patients.
    """
    all_patients = Patient.query.order_by(Patient.created_at.desc()).all()
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Headers
    writer.writerow(['Patient ID', 'Name', 'Phone Number', 'Age', 'Sex', 'Address', 'Referred By', 'Registration Date'])

    # Batch-load reference names
    all_ref_ids = [p.reference_patient_id for p in all_patients if p.reference_patient_id]
    all_ref_map: dict = {}
    if all_ref_ids:
        refs = Patient.query.filter(Patient.patient_id.in_(all_ref_ids)).all()
        all_ref_map = {r.patient_id: r.name for r in refs}

    for p in all_patients:
        writer.writerow([
            p.patient_id,
            p.name,
            p.phone_number,
            p.age if p.age is not None else '',
            p.sex or '',
            p.address or '',
            all_ref_map.get(p.reference_patient_id, '') if p.reference_patient_id else '',
            p.created_at.strftime('%Y-%m-%d %H:%M') if p.created_at else ''
        ])
        
    output.seek(0)
    filename = f'patients_export_{get_ist_now().strftime("%Y%m%d_%H%M")}.csv'
    
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=filename
    )


@patients.route('/patients/import', methods=['POST'])
@require_auth
def import_patients():
    """
    High-efficiency CSV processor for bulk hydrating patient database.
    Deduplicates automatically via (Name + Phone) unique-combination validation.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'File attachment absent'}), 400
        
    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({'error': 'Filename cannot be parsed'}), 400
        
    try:
        # Read and stream
        content = file.stream.read().decode("UTF8", errors='ignore')
        stream = io.StringIO(content, newline=None)
        csv_input = csv.DictReader(stream)
        
        if not csv_input.fieldnames:
             return jsonify({'error': 'Uploaded document must contain column headers.'}), 400
             
        inserted = 0
        updated = 0
        
        def safe_get(row, variants):
            for v in variants:
                for k in row.keys():
                    if k and k.strip().lower() == v.lower():
                        return row[k]
            return None

        row_count = 0
        for row in csv_input:
            row_count += 1
            p_name = safe_get(row, ['Name', 'Patient Name'])
            p_phone = safe_get(row, ['Phone Number', 'Phone', 'Contact'])
            
            if not p_name or not p_phone:
                continue # Ignore junk/incomplete rows
                
            raw_name = p_name.strip()
            raw_phone = p_phone.strip()
            
            # Boundary Check validations matching database definitions to prevent SQL crashes
            if len(raw_name) > 100:
                db.session.rollback()
                return jsonify({'error': f"Row {row_count + 1}: The patient name exceeds the maximum allowed limit of 100 characters."}), 400
                
            if len(raw_phone) > 20:
                db.session.rollback()
                return jsonify({'error': f"Row {row_count + 1}: The value '{raw_phone}' exceeds the maximum phone number limit of 20 characters. Please double check that columns are correctly aligned."}), 400

            # Pre-emptive duplicate collision prevention
            existing = Patient.query.filter(
                func.lower(Patient.name) == raw_name.lower(),
                Patient.phone_number == raw_phone
            ).first()
            
            # Data sanitation
            raw_age = safe_get(row, ['Age', 'Years'])
            try:
                clean_age = int(float(raw_age)) if raw_age else None
            except:
                clean_age = None
                
            sex_val = safe_get(row, ['Sex', 'Gender'])
            clean_sex = str(sex_val).strip() if sex_val else None
            if clean_sex and len(clean_sex) > 10:
                db.session.rollback()
                return jsonify({'error': f"Row {row_count + 1}: Sex field '{clean_sex}' exceeds the maximum limit of 10 characters."}), 400

            addr_val = safe_get(row, ['Address', 'Residence'])
            clean_addr = str(addr_val).strip() if addr_val else None

            if existing:
                # Perform subtle attribute alignment
                if clean_age is not None: existing.age = clean_age
                if clean_sex: existing.sex = clean_sex
                if clean_addr: existing.address = clean_addr
                updated += 1
            else:
                # Genesis insert
                new_entity = Patient(
                    patient_id=Patient.generate_patient_id(),
                    name=raw_name,
                    phone_number=raw_phone,
                    age=clean_age,
                    sex=clean_sex,
                    address=clean_addr,
                    created_by_user_id=g.current_user.get('user_id')
                )
                db.session.add(new_entity)
                inserted += 1
        
        db.session.commit()
        
        log_activity(
            action='IMPORT',
            resource_type='patients',
            resource_id=f"BULK-{get_ist_now().strftime('%H%M%S')}",
            resource_label='Patient CSV Sync',
            details=f"Ingested {inserted} new entities, Synchronized {updated} assets.",
            user_id=g.current_user.get('user_id'),
            username=g.current_user.get('username'),
            ip_address=request.remote_addr,
        )
        
        return jsonify({
            'message': 'Ingestion successful',
            'counts': {'new': inserted, 'updated': updated}
        }), 200
        
    except Exception as ex:
        db.session.rollback()
        return jsonify({'error': f'Backend parser fault: {str(ex)}'}), 500
