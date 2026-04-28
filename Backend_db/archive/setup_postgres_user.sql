-- Run this script as the postgres user (superuser)
-- Command: sudo -u postgres psql -f setup_postgres_user.sql

-- 1. Create the database
CREATE DATABASE clinic_db;

-- 2. Create the user 'Rize' with password 'vs@9699'
CREATE USER "Rize" WITH PASSWORD 'vs@9699';

-- 3. Grant privileges
GRANT ALL PRIVILEGES ON DATABASE clinic_db TO "Rize";

-- 4. Set owner
ALTER DATABASE clinic_db OWNER TO "Rize";
