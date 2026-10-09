CREATE TABLE IF NOT EXISTS structures (
    id BIGSERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL CHECK (BTRIM(nome) <> ''),
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN (
        'OFICINA',
        'GALPAO',
        'ABASTECIMENTO',
        'SEDE',
        'ALMOXARIFADO',
        'APOIO',
        'OUTRO'
    )),
    descricao TEXT,
    geometry geometry(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT structures_geometry_valid CHECK (ST_IsValid(geometry))
);

CREATE INDEX IF NOT EXISTS idx_structures_geometry
    ON structures USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_structures_type
    ON structures (tipo);