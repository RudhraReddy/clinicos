
import secrets
import string
from extensions import get_ist_now
from datetime import datetime
import calendar

def generate_unique_suffix(length=3):
    """Generates a suffix like XXX-XXX"""
    parts = []
    for _ in range(2):
        parts.append(''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(length)))
    return "-".join(parts)

def generate_invoice_id():
    """Format: DDMMYY-XXX-XXX"""
    date_str = get_ist_now().strftime('%d%m%y')
    return f"{date_str}-{generate_unique_suffix()}"

def generate_visit_id(patient_id):
    """Format: patient_id-DDMMYY-XXX-XXX"""
    date_str = get_ist_now().strftime('%d%m%y')
    return f"{patient_id}-{date_str}-{generate_unique_suffix()}"

def parse_expiry_date(date_str):
    if not date_str: return None
    date_str = date_str.strip().replace(' ', '').replace('.', '/').replace('-', '/')
    
    # MM/YY or MM/YYYY — default to 1st of the month
    for fmt in ['%m/%y', '%m/%Y']:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.replace(day=1).date()
        except ValueError:
            continue

    # Try full date formats
    for fmt in ['%d/%m/%y', '%d/%m/%Y', '%Y-%m-%d']:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.date()
        except ValueError:
            continue
    return None
