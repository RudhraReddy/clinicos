
import secrets
import string
from extensions import get_ist_now
from datetime import datetime
import calendar
import re

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


_BARE_PACK_RE = re.compile(r'^\s*(\d+)(?:\.0+)?\s*$')


def normalize_pack_size(value):
    """A pack size that is just a whole number means "strip/pack of N":
    "10" -> "10's pack" (also "10.0", which Excel can produce). Anything with
    text or units ("10ml", "10 mg", "strip of 10", "1x10") is returned
    stripped but otherwise unchanged. Keep in sync with normalizePackSize in
    frontend/lib/utils.ts."""
    if value is None:
        return value
    text = str(value).strip()
    m = _BARE_PACK_RE.match(text)
    if m:
        return f"{int(m.group(1))}'s pack"
    return text


_MEASURE_RE = re.compile(r'\d\s*(ml|mg|mcg|gm|g|kg|l|ltr|iu)\b')


def pack_multiplier(pack_size):
    """Tablets per stored quantity (stock and MRP are stored per pack).
    Mirrors packMultiplier in frontend/lib/utils.ts -- keep in sync.
    "10's pack" / "strip of 10" -> 10, "10ml"/"10 mg" -> 1, anything else
    -> 1. "AxB" forms like "1x10" are deliberately not supported (-> 1)."""
    pack = (pack_size or '').lower()
    if _MEASURE_RE.search(pack):
        return 1
    if 's' in pack:
        m = re.search(r'(\d+)', pack)
        if m and int(m.group(1)) > 1:
            return int(m.group(1))
    return 1
