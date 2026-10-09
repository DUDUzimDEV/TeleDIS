BEGIN;

CREATE TABLE IF NOT EXISTS farms (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL CHECK (BTRIM(name) <> ''),
    code VARCHAR(40) NOT NULL UNIQUE CHECK (BTRIM(code) <> ''),
    tax_identifier VARCHAR(32),
    municipality VARCHAR(120),
    state CHAR(2),
    area_ha DOUBLE PRECISION CHECK (area_ha IS NULL OR area_ha > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO farms (name, code)
VALUES ('Fazenda Dev/Teste TeleDis', 'DEV-TEST-001')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS full_name VARCHAR(160),
    ADD COLUMN IF NOT EXISTS phone VARCHAR(40),
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS permissions (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_farms (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    assigned_machine_id INTEGER,
    last_access_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, farm_id)
);

CREATE INDEX IF NOT EXISTS idx_user_farms_farm_role
    ON user_farms (farm_id, role_id, status);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id INTEGER NOT NULL,
    farm_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    allowed BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, farm_id, permission_id),
    FOREIGN KEY (user_id, farm_id)
        REFERENCES user_farms(user_id, farm_id) ON DELETE CASCADE
);

INSERT INTO roles (name, description) VALUES
    ('OWNER', 'Proprietário da fazenda'),
    ('FARM_ADMIN', 'Administrador da fazenda'),
    ('COORDINATOR', 'Coordenador operacional'),
    ('SUPERVISOR', 'Supervisor de campo'),
    ('OPERATOR', 'Operador de máquina'),
    ('TECHNICIAN', 'Técnico ou manutenção'),
    ('ANALYST', 'Analista somente leitura')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
    ('farm.view', 'Visualizar fazenda'),
    ('farm.create', 'Criar fazenda'),
    ('farm.update', 'Alterar fazenda'),
    ('farm.delete', 'Desativar fazenda'),
    ('users.view', 'Visualizar usuários'),
    ('users.create', 'Criar usuários'),
    ('users.update', 'Alterar usuários'),
    ('users.delete', 'Desativar usuários'),
    ('users.permissions', 'Gerenciar permissões individuais'),
    ('machines.view', 'Visualizar máquinas'),
    ('machines.create', 'Cadastrar máquinas'),
    ('machines.update', 'Alterar máquinas'),
    ('machines.delete', 'Desativar máquinas'),
    ('telemetry.view', 'Visualizar telemetria'),
    ('telemetry.history', 'Consultar histórico de telemetria'),
    ('fields.view', 'Visualizar talhões'),
    ('fields.create', 'Cadastrar talhões'),
    ('fields.update', 'Alterar talhões'),
    ('fields.delete', 'Remover talhões'),
    ('structures.view', 'Visualizar estruturas'),
    ('structures.create', 'Cadastrar estruturas'),
    ('structures.update', 'Alterar estruturas'),
    ('structures.delete', 'Remover estruturas'),
    ('roads.view', 'Visualizar estradas'),
    ('roads.create', 'Cadastrar estradas'),
    ('roads.update', 'Alterar estradas'),
    ('roads.delete', 'Remover estradas'),
    ('routes.view', 'Consultar rotas'),
    ('routes.create', 'Calcular rotas'),
    ('routes.execute', 'Executar rotas'),
    ('road_problems.view', 'Visualizar problemas viários'),
    ('road_problems.create', 'Registrar problemas viários'),
    ('road_problems.update', 'Atualizar problemas viários'),
    ('road_problems.resolve', 'Resolver problemas viários'),
    ('alerts.view', 'Visualizar alertas'),
    ('alerts.manage', 'Gerenciar alertas'),
    ('maintenance.view', 'Visualizar manutenção'),
    ('maintenance.create', 'Registrar manutenção'),
    ('maintenance.update', 'Atualizar manutenção'),
    ('reports.view', 'Visualizar relatórios'),
    ('reports.export', 'Exportar relatórios'),
    ('audit.view', 'Consultar auditoria'),
    ('settings.view', 'Visualizar configurações'),
    ('settings.update', 'Alterar configurações')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'OWNER'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'FARM_ADMIN'
  AND permissions.code NOT IN ('farm.create', 'farm.delete')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'COORDINATOR'
  AND permissions.code IN (
      'farm.view', 'machines.view', 'telemetry.view', 'telemetry.history',
      'fields.view', 'structures.view', 'roads.view', 'routes.view',
      'routes.create', 'road_problems.view', 'road_problems.create',
      'road_problems.update', 'road_problems.resolve', 'alerts.view',
      'reports.view'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'SUPERVISOR'
  AND permissions.code IN (
      'farm.view', 'machines.view', 'telemetry.view', 'telemetry.history',
      'fields.view', 'structures.view', 'roads.view', 'routes.view',
      'routes.create', 'road_problems.view', 'road_problems.create',
      'road_problems.update', 'alerts.view'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'OPERATOR'
  AND permissions.code IN (
      'farm.view', 'machines.view', 'telemetry.view', 'telemetry.history',
      'roads.view', 'routes.view',
      'routes.execute', 'road_problems.view', 'road_problems.create',
      'alerts.view'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'TECHNICIAN'
  AND permissions.code IN (
      'farm.view', 'machines.view', 'telemetry.view', 'telemetry.history',
      'alerts.view', 'maintenance.view', 'maintenance.create',
      'maintenance.update', 'reports.view'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'ANALYST'
  AND permissions.code IN (
      'farm.view', 'machines.view', 'telemetry.view', 'telemetry.history',
      'fields.view', 'structures.view', 'roads.view', 'routes.view',
      'road_problems.view', 'alerts.view', 'reports.view'
  )
ON CONFLICT DO NOTHING;

ALTER TABLE machines ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE fields ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE structures ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE roads ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE road_problems ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE route_plans ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE route_locations ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE network_nodes ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE network_segments ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE machine_locations ADD COLUMN IF NOT EXISTS farm_id BIGINT;
ALTER TABLE telemetry_readings ADD COLUMN IF NOT EXISTS farm_id BIGINT;

UPDATE machines SET farm_id = (SELECT id FROM farms WHERE code = 'DEV-TEST-001') WHERE farm_id IS NULL;
UPDATE fields SET farm_id = (SELECT id FROM farms WHERE code = 'DEV-TEST-001') WHERE farm_id IS NULL;
UPDATE structures SET farm_id = (SELECT id FROM farms WHERE code = 'DEV-TEST-001') WHERE farm_id IS NULL;
UPDATE roads SET farm_id = (SELECT id FROM farms WHERE code = 'DEV-TEST-001') WHERE farm_id IS NULL;
UPDATE road_problems AS problems
SET farm_id = roads.farm_id
FROM roads
WHERE problems.road_id = roads.id AND problems.farm_id IS NULL;
UPDATE route_plans AS plans
SET farm_id = machines.farm_id
FROM machines
WHERE plans.machine_id = machines.id AND plans.farm_id IS NULL;
UPDATE network_segments AS segments
SET farm_id = roads.farm_id
FROM roads
WHERE segments.road_id = roads.id AND segments.farm_id IS NULL;
UPDATE route_locations AS locations
SET farm_id = plans.farm_id
FROM route_plans AS plans
WHERE locations.route_id = plans.id AND locations.farm_id IS NULL;
UPDATE machine_locations AS locations
SET farm_id = machines.farm_id
FROM machines
WHERE locations.machine_id = machines.id AND locations.farm_id IS NULL;
UPDATE telemetry_readings AS readings
SET farm_id = machines.farm_id
FROM machines
WHERE readings.machine_id = machines.id AND readings.farm_id IS NULL;
WITH node_farms AS (
    SELECT connected.node_id, MIN(connected.farm_id) AS farm_id
    FROM (
        SELECT segments.from_node_id AS node_id, roads.farm_id
        FROM network_segments AS segments
        JOIN roads ON roads.id = segments.road_id
        UNION ALL
        SELECT segments.to_node_id AS node_id, roads.farm_id
        FROM network_segments AS segments
        JOIN roads ON roads.id = segments.road_id
    ) AS connected
    GROUP BY connected.node_id
    HAVING COUNT(DISTINCT connected.farm_id) = 1
)
UPDATE network_nodes AS nodes
SET farm_id = node_farms.farm_id
FROM node_farms
WHERE nodes.id = node_farms.node_id AND nodes.farm_id IS NULL;

ALTER TABLE machines ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE fields ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE structures ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE roads ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE road_problems ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE route_plans ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE route_locations ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE network_nodes ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE network_segments ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE machine_locations ALTER COLUMN farm_id SET NOT NULL;
ALTER TABLE telemetry_readings ALTER COLUMN farm_id SET NOT NULL;

ALTER TABLE machines ADD CONSTRAINT machines_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE fields ADD CONSTRAINT fields_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE structures ADD CONSTRAINT structures_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE roads ADD CONSTRAINT roads_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE road_problems ADD CONSTRAINT road_problems_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE route_plans ADD CONSTRAINT route_plans_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE route_locations ADD CONSTRAINT route_locations_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE network_nodes ADD CONSTRAINT network_nodes_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE network_segments ADD CONSTRAINT network_segments_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE machine_locations ADD CONSTRAINT machine_locations_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;
ALTER TABLE telemetry_readings ADD CONSTRAINT telemetry_readings_farm_fk
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_machines_farm_id ON machines (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_fields_farm_id ON fields (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_structures_farm_id ON structures (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_roads_farm_id ON roads (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_road_problems_farm_id ON road_problems (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_route_plans_farm_id ON route_plans (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_route_locations_farm_id ON route_locations (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_network_nodes_farm_id ON network_nodes (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_network_segments_farm_id ON network_segments (farm_id, id);
CREATE INDEX IF NOT EXISTS idx_machine_locations_farm_id ON machine_locations (farm_id, machine_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_readings_farm_id ON telemetry_readings (farm_id, machine_id, recorded_at DESC);

ALTER TABLE machines ADD CONSTRAINT machines_id_farm_unique UNIQUE (id, farm_id);
ALTER TABLE roads ADD CONSTRAINT roads_id_farm_unique UNIQUE (id, farm_id);
ALTER TABLE network_nodes ADD CONSTRAINT network_nodes_id_farm_unique UNIQUE (id, farm_id);
ALTER TABLE route_plans ADD CONSTRAINT route_plans_id_farm_unique UNIQUE (id, farm_id);

ALTER TABLE road_problems ADD CONSTRAINT road_problems_road_same_farm_fk
    FOREIGN KEY (road_id, farm_id) REFERENCES roads(id, farm_id) ON DELETE CASCADE;
ALTER TABLE network_segments ADD CONSTRAINT network_segments_road_same_farm_fk
    FOREIGN KEY (road_id, farm_id) REFERENCES roads(id, farm_id) ON DELETE CASCADE;
ALTER TABLE network_segments ADD CONSTRAINT network_segments_from_node_same_farm_fk
    FOREIGN KEY (from_node_id, farm_id) REFERENCES network_nodes(id, farm_id) ON DELETE CASCADE;
ALTER TABLE network_segments ADD CONSTRAINT network_segments_to_node_same_farm_fk
    FOREIGN KEY (to_node_id, farm_id) REFERENCES network_nodes(id, farm_id) ON DELETE CASCADE;
ALTER TABLE user_farms ADD CONSTRAINT user_farms_machine_same_farm_fk
    FOREIGN KEY (assigned_machine_id, farm_id) REFERENCES machines(id, farm_id) ON DELETE RESTRICT;
ALTER TABLE route_plans ADD CONSTRAINT route_plans_machine_same_farm_fk
    FOREIGN KEY (machine_id, farm_id) REFERENCES machines(id, farm_id) ON DELETE RESTRICT;
ALTER TABLE route_locations ADD CONSTRAINT route_locations_plan_same_farm_fk
    FOREIGN KEY (route_id, farm_id) REFERENCES route_plans(id, farm_id) ON DELETE CASCADE;
ALTER TABLE machine_locations ADD CONSTRAINT machine_locations_machine_same_farm_fk
    FOREIGN KEY (machine_id, farm_id) REFERENCES machines(id, farm_id) ON DELETE CASCADE;
ALTER TABLE telemetry_readings ADD CONSTRAINT telemetry_readings_machine_same_farm_fk
    FOREIGN KEY (machine_id, farm_id) REFERENCES machines(id, farm_id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    farm_id BIGINT REFERENCES farms(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100),
    result VARCHAR(20) NOT NULL DEFAULT 'success'
        CHECK (result IN ('success', 'failure')),
    ip_address INET,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_farm_time
    ON audit_logs (farm_id, created_at DESC);

COMMIT;
