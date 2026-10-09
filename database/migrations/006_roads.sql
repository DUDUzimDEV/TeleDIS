CREATE TABLE IF NOT EXISTS roads (
    id BIGSERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL CHECK (BTRIM(nome) <> ''),
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN (
        'PRINCIPAL',
        'SECUNDARIA',
        'ACESSO',
        'SERVICO',
        'OUTRA'
    )),
    descricao TEXT,
    geometry geometry(LineString, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roads_geometry_valid CHECK (ST_IsValid(geometry)),
    CONSTRAINT roads_geometry_has_length CHECK (
        ST_NPoints(geometry) >= 2 AND ST_Length(geometry::geography) > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_roads_geometry
    ON roads USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_roads_type
    ON roads (tipo);