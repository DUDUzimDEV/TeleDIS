CREATE TABLE IF NOT EXISTS fields (
    id BIGSERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL CHECK (BTRIM(nome) <> ''),
    cultura VARCHAR(80) NOT NULL CHECK (BTRIM(cultura) <> ''),
    safra VARCHAR(20) NOT NULL CHECK (BTRIM(safra) <> ''),
    area_ha DOUBLE PRECISION NOT NULL CHECK (area_ha > 0),
    geometry geometry(Polygon, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fields_geometry_valid CHECK (ST_IsValid(geometry))
);

CREATE INDEX IF NOT EXISTS idx_fields_geometry
    ON fields USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_fields_created_at
    ON fields (created_at DESC);