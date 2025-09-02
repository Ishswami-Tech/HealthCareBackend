-- Create the public schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS public;

-- Grant privileges to the postgres user
GRANT ALL PRIVILEGES ON DATABASE userdb TO postgres;
GRANT ALL PRIVILEGES ON SCHEMA public TO postgres;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Set the search path
SET search_path TO public; 