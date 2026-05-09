
from flask import Blueprint, request, jsonify
from models import Patient
from extensions import db, get_ist_now
from sqlalchemy import func
from .auth import require_auth

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
        dob=None # Deprecated
    )
    
    db.session.add(new_patient)
    db.session.commit()
    
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
    
    return jsonify({'message': 'Patient updated'}), 200
