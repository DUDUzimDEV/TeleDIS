BEGIN;

ALTER TABLE fields
    ADD CONSTRAINT fields_id_farm_unique UNIQUE (id, farm_id);

ALTER TABLE route_plans
    ADD COLUMN distance_m DOUBLE PRECISION CHECK (distance_m IS NULL OR distance_m >= 0),
    ADD COLUMN total_cost DOUBLE PRECISION CHECK (total_cost IS NULL OR total_cost >= 0),
    ADD COLUMN route_geometry JSONB,
    ADD COLUMN calculated_at TIMESTAMPTZ;

CREATE TABLE teams (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE RESTRICT,
    name VARCHAR(120) NOT NULL CHECK (BTRIM(name) <> ''),
    code VARCHAR(40) NOT NULL CHECK (BTRIM(code) <> ''),
    description TEXT,
    supervisor_id INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, farm_id),
    UNIQUE (farm_id, code),
    FOREIGN KEY (supervisor_id, farm_id)
        REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT
);

CREATE TABLE team_members (
    team_id BIGINT NOT NULL,
    farm_id BIGINT NOT NULL,
    user_id INTEGER NOT NULL,
    team_role VARCHAR(20) NOT NULL
        CHECK (team_role IN ('SUPERVISOR', 'OPERATOR', 'TECHNICIAN')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id, farm_id) REFERENCES teams(id, farm_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT
);

CREATE TABLE machine_assignments (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL,
    machine_id INTEGER NOT NULL,
    user_id INTEGER,
    team_id BIGINT,
    assigned_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_until TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (assigned_until IS NULL OR assigned_until >= assigned_from),
    CHECK (user_id IS NOT NULL OR team_id IS NOT NULL),
    FOREIGN KEY (machine_id, farm_id) REFERENCES machines(id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (team_id, farm_id) REFERENCES teams(id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_machine_assignments_active_machine
    ON machine_assignments (farm_id, machine_id) WHERE is_active;
CREATE INDEX idx_machine_assignments_farm_user
    ON machine_assignments (farm_id, user_id, assigned_from DESC);
CREATE INDEX idx_machine_assignments_farm_team
    ON machine_assignments (farm_id, team_id, assigned_from DESC);

CREATE TABLE operations (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE RESTRICT,
    code VARCHAR(50) NOT NULL,
    operation_type VARCHAR(30) NOT NULL CHECK (
        operation_type IN (
            'PLANTIO', 'COLHEITA', 'APLICACAO', 'PULVERIZACAO', 'ADUBACAO',
            'PREPARO_SOLO', 'TRANSPORTE', 'MANUTENCAO', 'DESLOCAMENTO', 'OUTRA'
        )
    ),
    name VARCHAR(160) NOT NULL CHECK (BTRIM(name) <> ''),
    description TEXT,
    field_id INTEGER NOT NULL,
    machine_id INTEGER,
    operator_id INTEGER,
    supervisor_id INTEGER,
    team_id BIGINT,
    route_plan_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'PLANEJADA' CHECK (
        status IN ('PLANEJADA', 'ATRIBUIDA', 'ACEITA', 'EM_EXECUCAO',
                   'INTERROMPIDA', 'CONCLUIDA', 'CANCELADA')
    ),
    priority VARCHAR(10) NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE')),
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    completion_summary TEXT,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, farm_id),
    UNIQUE (farm_id, code),
    CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end >= scheduled_start),
    CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
    FOREIGN KEY (field_id, farm_id) REFERENCES fields(id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (machine_id, farm_id) REFERENCES machines(id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (operator_id, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supervisor_id, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (team_id, farm_id) REFERENCES teams(id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (route_plan_id, farm_id) REFERENCES route_plans(id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT
);

CREATE INDEX idx_operations_farm_status_schedule
    ON operations (farm_id, status, scheduled_start);
CREATE INDEX idx_operations_farm_operator
    ON operations (farm_id, operator_id, created_at DESC);
CREATE INDEX idx_operations_farm_machine
    ON operations (farm_id, machine_id, created_at DESC);
CREATE INDEX idx_operations_farm_team
    ON operations (farm_id, team_id, created_at DESC);
CREATE INDEX idx_operations_farm_field
    ON operations (farm_id, field_id, created_at DESC);

CREATE TABLE operation_status_history (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL,
    operation_id BIGINT NOT NULL,
    old_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL CHECK (
        new_status IN ('PLANEJADA', 'ATRIBUIDA', 'ACEITA', 'EM_EXECUCAO',
                       'INTERROMPIDA', 'CONCLUIDA', 'CANCELADA')
    ),
    changed_by INTEGER NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (operation_id, farm_id) REFERENCES operations(id, farm_id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT
);
CREATE INDEX idx_operation_status_history_operation
    ON operation_status_history (farm_id, operation_id, created_at);

CREATE TABLE operation_route_history (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL,
    operation_id BIGINT NOT NULL,
    route_plan_id INTEGER NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    route_geometry JSONB NOT NULL,
    distance_m DOUBLE PRECISION NOT NULL CHECK (distance_m >= 0),
    total_cost DOUBLE PRECISION NOT NULL CHECK (total_cost >= 0),
    reason TEXT,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (farm_id, operation_id, version),
    FOREIGN KEY (operation_id, farm_id) REFERENCES operations(id, farm_id) ON DELETE CASCADE,
    FOREIGN KEY (route_plan_id, farm_id) REFERENCES route_plans(id, farm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT
);
CREATE INDEX idx_operation_route_history_operation
    ON operation_route_history (farm_id, operation_id, version DESC);

CREATE TABLE operation_occurrences (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT NOT NULL,
    operation_id BIGINT NOT NULL,
    occurrence_type VARCHAR(20) NOT NULL
        CHECK (occurrence_type IN ('PROBLEMA_VIA', 'MAQUINA', 'PARADA', 'DESVIO', 'OUTRO')),
    description TEXT NOT NULL CHECK (BTRIM(description) <> ''),
    geometry geometry(Point, 4326),
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (operation_id, farm_id) REFERENCES operations(id, farm_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, farm_id) REFERENCES user_farms(user_id, farm_id) ON DELETE RESTRICT
);
CREATE INDEX idx_operation_occurrences_operation
    ON operation_occurrences (farm_id, operation_id, created_at);
CREATE INDEX idx_operation_occurrences_geometry
    ON operation_occurrences USING GIST (geometry);

INSERT INTO permissions (code, description) VALUES
    ('teams.view', 'Visualizar equipes'),
    ('teams.manage', 'Gerenciar equipes e membros'),
    ('operations.view', 'Visualizar operações'),
    ('operations.create', 'Planejar operações'),
    ('operations.update', 'Alterar operações planejadas'),
    ('operations.assign', 'Atribuir e gerenciar operações'),
    ('operations.execute', 'Executar operação atribuída'),
    ('operations.history', 'Consultar histórico operacional')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name IN ('OWNER', 'FARM_ADMIN')
  AND permissions.code IN (
      'teams.view', 'teams.manage', 'operations.view', 'operations.create',
      'operations.update', 'operations.assign', 'operations.execute', 'operations.history'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'COORDINATOR'
  AND permissions.code IN (
      'teams.view', 'teams.manage', 'operations.view', 'operations.create',
      'operations.update', 'operations.assign', 'operations.history'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'SUPERVISOR'
  AND permissions.code IN ('teams.view', 'operations.view', 'operations.assign', 'routes.create',
                           'operations.execute', 'operations.history')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name = 'OPERATOR'
  AND permissions.code IN ('operations.view', 'operations.execute', 'operations.history')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.name IN ('TECHNICIAN', 'ANALYST')
  AND permissions.code IN ('operations.view', 'operations.history')
ON CONFLICT DO NOTHING;

COMMIT;
