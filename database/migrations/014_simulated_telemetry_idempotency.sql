BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM telemetry_readings
        WHERE source = 'SIMULATED'
        GROUP BY machine_id, farm_id, measurement_type_id, recorded_at
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Não foi possível aplicar a idempotência: há medições simuladas duplicadas.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM machine_locations
        WHERE source = 'SIMULATED'
        GROUP BY machine_id, farm_id, recorded_at
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Não foi possível aplicar a idempotência: há localizações simuladas duplicadas.';
    END IF;
END $$;

CREATE UNIQUE INDEX uq_simulated_telemetry_event
    ON telemetry_readings (machine_id, farm_id, measurement_type_id, recorded_at)
    WHERE source = 'SIMULATED';

CREATE UNIQUE INDEX uq_simulated_location_event
    ON machine_locations (machine_id, farm_id, recorded_at)
    WHERE source = 'SIMULATED';

COMMIT;
