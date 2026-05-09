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
