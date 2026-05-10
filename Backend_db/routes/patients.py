
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
    
    new_patient = Patient(
        patient_id=patient_id,
        phone_number=data['phone_number'],
        name=data['name'],
        age=int(data.get('age', 0)) if data.get('age') else None,
        sex=data.get('sex'),
        address=data.get('address'),
        reference=data.get('reference'),
        dob=None,
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
        
    results = []
    for p in patients_list:
        results.append({
            'patient_id': p.patient_id,
            'name': p.name,
            'phone_number': p.phone_number,
            'age': p.age,
            'sex': p.sex,
            'address': p.address,
            'reference': p.reference,
            'created_at': p.created_at.isoformat() if p.created_at else None,
        })
    return jsonify(results), 200

@patients.route('/patients/<patient_id>', methods=['GET'])
@require_auth
def get_patient_detail(patient_id):
    patient = Patient.query.filter_by(patient_id=patient_id).first_or_404()
    return jsonify({
        'patient_id': patient.patient_id,
        'name': patient.name,
        'phone_number': patient.phone_number,
        'age': patient.age,
        'sex': patient.sex,
        'address': patient.address,
        'reference': patient.reference,
        'created_at': patient.created_at
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
    if 'reference' in data:
        patient.reference = data['reference']
        
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
    writer.writerow(['Patient ID', 'Name', 'Phone Number', 'Age', 'Sex', 'Address', 'Reference', 'Registration Date'])
    
    for p in all_patients:
        writer.writerow([
            p.patient_id,
            p.name,
            p.phone_number,
            p.age if p.age is not None else '',
            p.sex or '',
            p.address or '',
            p.reference or '',
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

        for row in csv_input:
            p_name = safe_get(row, ['Name', 'Patient Name'])
            p_phone = safe_get(row, ['Phone Number', 'Phone', 'Contact'])
            
            if not p_name or not p_phone:
                continue # Ignore junk/incomplete rows
                
            raw_name = p_name.strip()
            raw_phone = p_phone.strip()
            
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
            addr_val = safe_get(row, ['Address', 'Residence'])
            ref_val = safe_get(row, ['Reference', 'Referred By'])
            
            if existing:
                # Perform subtle attribute alignment
                if clean_age is not None: existing.age = clean_age
                if sex_val: existing.sex = str(sex_val).strip()
                if addr_val: existing.address = str(addr_val).strip()
                if ref_val: existing.reference = str(ref_val).strip()
                updated += 1
            else:
                # Genesis insert
                new_entity = Patient(
                    patient_id=Patient.generate_patient_id(),
                    name=raw_name,
                    phone_number=raw_phone,
                    age=clean_age,
                    sex=str(sex_val).strip() if sex_val else None,
                    address=str(addr_val).strip() if addr_val else None,
                    reference=str(ref_val).strip() if ref_val else None,
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
