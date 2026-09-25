CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    email VARCHAR(180) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    role_id INTEGER REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS brands (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS models (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    brand_id INTEGER REFERENCES brands(id)
);

CREATE TABLE IF NOT EXISTS machines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    brand_id INTEGER REFERENCES brands(id),
    model_id INTEGER REFERENCES models(id)
);

CREATE TABLE IF NOT EXISTS measurement_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    unit VARCHAR(20) NOT NULL,
    type_name VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_readings (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    measurement_type_id INTEGER NOT NULL REFERENCES measurement_types(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS route_plans (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    name VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS route_locations (
    id SERIAL PRIMARY KEY,
    route_id INTEGER NOT NULL REFERENCES route_plans(id),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_machines_code ON machines(code);
CREATE INDEX IF NOT EXISTS idx_telemetry_machine_time ON telemetry_readings(machine_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_route_locations_route ON route_locations(route_id);
