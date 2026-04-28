import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from extensions import get_ist_now
from datetime import datetime, timezone

now_ist = get_ist_now()
now_utc = datetime.now(timezone.utc)

print(f"IST Time (Naive): {now_ist}")
print(f"UTC Time (Aware): {now_utc}")

# Approx check
diff = now_ist - now_utc.replace(tzinfo=None)
print(f"Difference (IST - UTC): {diff}")
# Should be approx 5:30
