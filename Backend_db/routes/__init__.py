
from .auth import auth_bp
from .admin import admin_bp
from .patients import patients
from .inventory import inventory
from .visits import visits
from .billing import billing
from .images import images
from .upload import upload_bp
from .ledger import ledger

blueprints = [auth_bp, admin_bp, patients, inventory, visits, billing, images, upload_bp, ledger]
