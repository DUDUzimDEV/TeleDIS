BEGIN;

ALTER TABLE telemetry_readings
    ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'REAL',
    ADD CONSTRAINT telemetry_readings_source_check
        CHECK (source IN ('REAL', 'SIMULATED'));

ALTER TABLE machine_locations
    ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'REAL',
    ADD CONSTRAINT machine_locations_source_check
        CHECK (source IN ('REAL', 'SIMULATED'));

COMMIT;
