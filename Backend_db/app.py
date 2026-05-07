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


def create_app():
    app = Flask(__name__)

    allowed_origins = os.environ.get('CORS_ORIGINS', '*').split(',')
    CORS(app, origins=allowed_origins)

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

    return app

if __name__ == '__main__':
    app = create_app()
    debug = os.environ.get('FLASK_DEBUG', 'False') == 'True'
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=debug, host='0.0.0.0', port=port)
