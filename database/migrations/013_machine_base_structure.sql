BEGIN;

ALTER TABLE machines
    ADD COLUMN IF NOT EXISTS base_structure_id BIGINT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_machines_base_structure' AND table_name = 'machines'
    ) THEN
        ALTER TABLE machines
            ADD CONSTRAINT fk_machines_base_structure
            FOREIGN KEY (base_structure_id) REFERENCES structures(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_machine_base_structure_farm()
RETURNS trigger AS $$
BEGIN
    IF NEW.base_structure_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM structures s
        WHERE s.id = NEW.base_structure_id
          AND s.farm_id = NEW.farm_id
    ) THEN
        RAISE EXCEPTION 'A estrutura-base da máquina deve pertencer à mesma fazenda da máquina.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_machines_base_structure_farm ON machines;

CREATE TRIGGER trg_machines_base_structure_farm
BEFORE INSERT OR UPDATE OF base_structure_id, farm_id
ON machines
FOR EACH ROW
EXECUTE FUNCTION validate_machine_base_structure_farm();

COMMIT;
