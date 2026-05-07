"""
One-time migration: add deleted_at column to patient_images table.
Run once against the live production database:

    cd Backend_db
    source venv/bin/activate
    python scripts/add_deleted_at.py
"""
import os
import sys

# Allow imports from the Backend_db directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get('DATABASE_URL', '')
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable is not set.")
    sys.exit(1)

# Render uses postgres:// but SQLAlchemy 2.x requires postgresql://
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    conn.execute(text(
        "ALTER TABLE patient_images ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;"
    ))
    conn.commit()
    print("Migration complete: deleted_at column added to patient_images (or already existed).")
