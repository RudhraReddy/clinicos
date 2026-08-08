import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from dotenv import load_dotenv
from extensions import db

# Load environment variables
load_dotenv()

# Initialize extensions
# db is imported from extensions


def _apply_migrations(db):
    """
    Idempotent column-addition migrations.
    db.create_all() only creates missing tables; it never adds columns to
    existing tables. Add each new column here with IF NOT EXISTS so the
    statement is safe to run on every startup.
    """
    from sqlalchemy import text
    stmts = [
        # 2026-05-08: formula column added to product_master
        "ALTER TABLE product_master ADD COLUMN IF NOT EXISTS formula TEXT",
        # 2026-05-09: updated_at column added to visits
        "ALTER TABLE visits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
        # Auth: created_by_user_id columns on visits, patient_images, and bills
        "ALTER TABLE visits ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(36)",
        "ALTER TABLE patient_images ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(36)",
        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(50)",
        # 2026-05-09: Audit system — user tagging on remaining tables
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(36)",
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(36)",
        "ALTER TABLE product_master ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(36)",
        "ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(36)",
        "ALTER TABLE inventory_history ADD COLUMN IF NOT EXISTS user_id VARCHAR(36)",
        "ALTER TABLE inventory_history ADD COLUMN IF NOT EXISTS username VARCHAR(100)",
        # 2026-05-11: location dimension columns added to bills, purchase_invoices, visits
        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS location VARCHAR(50) DEFAULT 'Main'",
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS location VARCHAR(50) DEFAULT 'Main'",
        "ALTER TABLE visits ADD COLUMN IF NOT EXISTS location VARCHAR(50) DEFAULT 'Main'",
        "ALTER TABLE expense_ledger ADD COLUMN IF NOT EXISTS location VARCHAR(50) DEFAULT 'Main'",
        # SP1: location_id FK columns on existing tables (locations table created by db.create_all())
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)",
        "ALTER TABLE visits ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)",
        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)",
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)",
        "ALTER TABLE expense_ledger ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)",
        "ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)",
        # 2026-06-15: min_stock_override flag for default vs custom min stock tracking
        "ALTER TABLE product_master ADD COLUMN IF NOT EXISTS min_stock_override BOOLEAN DEFAULT FALSE",
        "UPDATE product_master SET min_stock_override = (min_stock_level != 10) WHERE min_stock_override = FALSE",
        # Task 1: replace free-text reference string with FK to self
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS reference_patient_id VARCHAR(8) REFERENCES patients(patient_id) ON DELETE SET NULL",
        "ALTER TABLE patients DROP COLUMN IF EXISTS reference",
        # 2026-08-06: cash/UPI payment mode on visits (replaces full/partial/unpaid picker on booking)
        "ALTER TABLE visits ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20)",
        # 2026-08-08: paid_date/payment_mode on purchase invoices (vendor payment tracking)
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS paid_date DATE",
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20)",
    ]
    with db.engine.connect() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))
        conn.commit()


def create_app():
    app = Flask(__name__)

    allowed_origins = os.environ.get('CORS_ORIGINS', '*').split(',')
    CORS(app, origins=allowed_origins, supports_credentials=True)

    app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'dev-secret-change-in-prod')

    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    # Render injects "postgres://" but SQLAlchemy 2.0 requires "postgresql://"
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    db.init_app(app)

    with app.app_context():
        from routes import blueprints
        for bp in blueprints:
             app.register_blueprint(bp, url_prefix='/api')
        db.create_all()
        _apply_migrations(db)

    return app

if __name__ == '__main__':
    app = create_app()
    debug = os.environ.get('FLASK_DEBUG', 'False') == 'True'
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=debug, host='0.0.0.0', port=port)
