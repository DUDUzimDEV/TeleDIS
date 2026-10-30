BEGIN;

ALTER TABLE telemetry_readings
    ADD COLUMN IF NOT EXISTS operation_id BIGINT;

ALTER TABLE machine_locations
    ADD COLUMN IF NOT EXISTS operation_id BIGINT;

ALTER TABLE telemetry_readings
    ADD CONSTRAINT telemetry_readings_operation_fk
        FOREIGN KEY (operation_id, farm_id)
        REFERENCES operations(id, farm_id) ON DELETE SET NULL;

ALTER TABLE machine_locations
    ADD CONSTRAINT machine_locations_operation_fk
        FOREIGN KEY (operation_id, farm_id)
        REFERENCES operations(id, farm_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_telemetry_readings_operation_id
    ON telemetry_readings (farm_id, operation_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_machine_locations_operation_id
    ON machine_locations (farm_id, operation_id, recorded_at DESC);

COMMIT;
