BEGIN;

ALTER TABLE farms
    ADD COLUMN operational_area geometry(Geometry, 4326),
    ADD COLUMN proximity_radius_m INTEGER NOT NULL DEFAULT 500
        CHECK (proximity_radius_m BETWEEN 0 AND 10000);

CREATE INDEX idx_farms_operational_area_gist
    ON farms USING GIST (operational_area)
    WHERE operational_area IS NOT NULL;

COMMIT;
