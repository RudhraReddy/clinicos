import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import logging
from app import create_app, db
from sqlalchemy import text

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate_patients():
    app = create_app()
    with app.app_context():
        try:
            logger.info("Starting migration for patients table...")
            
            with db.engine.connect() as conn:
                # Add check for columns before adding? IF NOT EXISTS handles it in Postgres.
                conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS age INTEGER;"))
                conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS sex VARCHAR(20);"))
                conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS address TEXT;"))
                conn.execute(text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS reference VARCHAR(255);"))
                conn.execute(text("ALTER TABLE patients ALTER COLUMN dob DROP NOT NULL;"))
                conn.commit()
                
            logger.info("Migration completed successfully.")
            
        except Exception as e:
            logger.error(f"Migration failed: {e}")
            raise

if __name__ == "__main__":
    migrate_patients()
