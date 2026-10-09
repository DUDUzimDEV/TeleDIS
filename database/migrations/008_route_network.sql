CREATE TABLE IF NOT EXISTS network_nodes (
    id BIGSERIAL PRIMARY KEY,
    geometry geometry(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT network_nodes_geometry_valid CHECK (ST_IsValid(geometry))
);

CREATE TABLE IF NOT EXISTS network_segments (
    id BIGSERIAL PRIMARY KEY,
    road_id BIGINT NOT NULL REFERENCES roads(id) ON DELETE CASCADE,
    from_node_id BIGINT NOT NULL REFERENCES network_nodes(id) ON DELETE CASCADE,
    to_node_id BIGINT NOT NULL REFERENCES network_nodes(id) ON DELETE CASCADE,
    geometry geometry(LineString, 4326) NOT NULL,
    length_m DOUBLE PRECISION NOT NULL CHECK (length_m > 0),
    base_cost DOUBLE PRECISION NOT NULL CHECK (base_cost >= 0),
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT network_segments_geometry_valid CHECK (ST_IsValid(geometry)),
    CONSTRAINT network_segments_distinct_nodes CHECK (from_node_id <> to_node_id)
);

CREATE INDEX IF NOT EXISTS idx_network_nodes_geometry
    ON network_nodes USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_network_segments_geometry
    ON network_segments USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_network_segments_road_id
    ON network_segments (road_id);

CREATE INDEX IF NOT EXISTS idx_network_segments_from_node
    ON network_segments (from_node_id);

CREATE INDEX IF NOT EXISTS idx_network_segments_to_node
    ON network_segments (to_node_id);

CREATE INDEX IF NOT EXISTS idx_network_segments_connections
    ON network_segments (from_node_id, to_node_id);
