from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta, timezone

db = SQLAlchemy()

def get_ist_now():
    """Returns current time in IST (Indian Standard Time) as a naive datetime."""
    ist_offset = timezone(timedelta(hours=5, minutes=30))
    # Get current time in IST
    now_ist = datetime.now(ist_offset)
    # Return as naive datetime (so it looks like local time to the DB)
    return now_ist.replace(tzinfo=None)
