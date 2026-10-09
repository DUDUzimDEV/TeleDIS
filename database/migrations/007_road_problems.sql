CREATE TABLE IF NOT EXISTS road_problems (
    id BIGSERIAL PRIMARY KEY,
    road_id BIGINT NOT NULL REFERENCES roads(id) ON DELETE RESTRICT,
    tipo VARCHAR(40) NOT NULL CHECK (tipo IN (
        'BURACO',
        'LAMA',
        'ALAGAMENTO',
        'VIA_BLOQUEADA',
        'PONTE_PROBLEMA',
        'DESLIZAMENTO',
        'OUTRO'
    )),
    gravidade VARCHAR(20) NOT NULL CHECK (gravidade IN ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
    status VARCHAR(20) NOT NULL DEFAULT 'ABERTO'
        CHECK (status IN ('ABERTO', 'EM_ANALISE', 'RESOLVIDO', 'INATIVO')),
    descricao TEXT,
    geometry geometry(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT road_problems_geometry_valid CHECK (ST_IsValid(geometry))
);

CREATE INDEX IF NOT EXISTS idx_road_problems_geometry
    ON road_problems USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_road_problems_road_id
    ON road_problems (road_id);

CREATE INDEX IF NOT EXISTS idx_road_problems_status
    ON road_problems (status);