
from .patients import patients
from .inventory import inventory
from .visits import visits
from .billing import billing
from .images import images
from .upload import upload_bp
from .ledger import ledger

# Optional: List them for easy iteration
blueprints = [patients, inventory, visits, billing, images, upload_bp, ledger]
