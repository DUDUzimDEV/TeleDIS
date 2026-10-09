import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.security import get_farm_context, get_password_hash
from app.database import SessionLocal
from app.main import app
from app.models.machine import Machine
from app.models.telemetry import MachineLocation, MeasurementType, RouteLocation, RoutePlan, TelemetryReading
from app.models.user import AuditLog, Farm, Permission, Role, User, UserFarm, UserPermission
from app.repositories.route_network_repository import RouteNetworkRepository


pytestmark = pytest.mark.real_database
PASSWORD = "TestPassword!2026"


@pytest.fixture(scope="module")
def farm_pair():
    if os.environ.get("TELEDIS_REAL_DB_TESTS") != "1":
        pytest.skip("Set TELEDIS_REAL_DB_TESTS=1 with an isolated PostgreSQL/PostGIS database.")

    suffix = uuid4().hex[:10]
    now = datetime.now(timezone.utc)
    with SessionLocal.begin() as db:
        roles = {role.name: role for role in db.query(Role).all()}
        permissions = {permission.code: permission for permission in db.query(Permission).all()}
        farms = {
            key: Farm(
                name=f"Isolation {key} {suffix}",
                code=f"ISO-{key}-{suffix}",
                municipality="Teste",
                state="SP",
                status="active",
                created_at=now,
                updated_at=now,
            )
            for key in ("A", "B")
        }
        db.add_all(farms.values())

        users = {}
        for farm_key in ("A", "B"):
            for role_name in (
                "OWNER", "FARM_ADMIN", "COORDINATOR", "SUPERVISOR",
                "OPERATOR", "TECHNICIAN", "ANALYST",
            ):
                username = f"iso_{farm_key.lower()}_{role_name.lower()}_{suffix}"
                user = User(
                    username=username,
                    email=f"{username}@example.invalid",
                    password_hash=get_password_hash(PASSWORD),
                    is_active=True,
                    role_id=roles[role_name].id,
                    full_name=f"{farm_key} {role_name}",
                    auth_version=0,
                )
                users[(farm_key, role_name)] = user
                db.add(user)
        db.flush()

        for farm_key, farm in farms.items():
            farm.owner_user_id = users[(farm_key, "OWNER")].id
            for role_name in (
                "OWNER", "FARM_ADMIN", "COORDINATOR", "SUPERVISOR",
                "OPERATOR", "TECHNICIAN", "ANALYST",
            ):
                db.add(UserFarm(
                    user_id=users[(farm_key, role_name)].id,
                    farm_id=farm.id,
                    role_id=roles[role_name].id,
                    status="active",
                    created_at=now,
                ))
        db.flush()

        machines = {
            "A": Machine(name=f"ISO Machine A {suffix}", code=f"ISO-A-{suffix}",
                         status="active", farm_id=farms["A"].id),
            "A_EXTRA": Machine(name=f"ISO Unassigned A {suffix}", code=f"ISO-A2-{suffix}",
                               status="active", farm_id=farms["A"].id),
            "B": Machine(name=f"ISO Machine B {suffix}", code=f"ISO-B-{suffix}",
                         status="active", farm_id=farms["B"].id),
        }
        db.add_all(machines.values())
        db.flush()

        for key, machine_key in (("A", "A"), ("A_EXTRA", "A_EXTRA"), ("B", "B")):
            operator_key = "A" if key.startswith("A") else "B"
            membership = db.get(
                UserFarm,
                (users[(operator_key, "OPERATOR")].id, farms[operator_key].id),
            )
            if key == "A":
                membership.assigned_machine_id = machines[machine_key].id

        for key, longitude, latitude in (("A", 0.0, 0.0), ("B", 10.0, 10.0)):
            farm_id = farms[key].id
            field_id = db.execute(
                text(
                    """
                    INSERT INTO fields (nome, cultura, safra, area_ha, geometry, farm_id)
                    VALUES (:name, 'cana', '2026', 1.0,
                            ST_GeomFromText(:geometry, 4326), :farm_id)
                    RETURNING id
                    """
                ),
                {
                    "name": f"ISO Field {key} {suffix}",
                    "geometry": (
                        f"POLYGON(({longitude} {latitude},"
                        f"{longitude + 0.001} {latitude},"
                        f"{longitude + 0.001} {latitude + 0.001},"
                        f"{longitude} {latitude + 0.001},"
                        f"{longitude} {latitude}))"
                    ),
                    "farm_id": farm_id,
                },
            ).scalar_one()
            structure_id = db.execute(
                text(
                    """
                    INSERT INTO structures (nome, tipo, geometry, farm_id)
                    VALUES (:name, 'GALPAO', ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326), :farm_id)
                    RETURNING id
                    """
                ),
                {
                    "name": f"ISO Structure {key} {suffix}",
                    "longitude": longitude + 0.0099,
                    "latitude": latitude,
                    "farm_id": farm_id,
                },
            ).scalar_one()
            road_id = db.execute(
                text(
                    """
                    INSERT INTO roads (nome, tipo, geometry, farm_id)
                    VALUES (:name, 'PRINCIPAL',
                            ST_GeomFromText(:geometry, 4326), :farm_id)
                    RETURNING id
                    """
                ),
                {
                    "name": f"ISO Road {key} {suffix}",
                    "geometry": (
                        f"LINESTRING({longitude} {latitude},"
                        f"{longitude + 0.01} {latitude})"
                    ),
                    "farm_id": farm_id,
                },
            ).scalar_one()
            problem_id = db.execute(
                text(
                    """
                    INSERT INTO road_problems
                        (road_id, tipo, gravidade, status, descricao, geometry, farm_id)
                    VALUES (:road_id, 'BURACO', 'BAIXA', 'ABERTO', :description,
                            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326), :farm_id)
                    RETURNING id
                    """
                ),
                {
                    "road_id": road_id,
                    "description": f"ISO Problem {key} {suffix}",
                    "longitude": longitude + 0.005,
                    "latitude": latitude,
                    "farm_id": farm_id,
                },
            ).scalar_one()
            farms[key].test_structure_id = structure_id
            farms[key].test_field_id = field_id
            farms[key].test_road_id = road_id
            farms[key].test_problem_id = problem_id

        measurement = db.query(MeasurementType).filter(MeasurementType.name == "iso_temperature").one_or_none()
        if measurement is None:
            measurement = MeasurementType(name="iso_temperature", unit="C", type_name="temperature")
            db.add(measurement)
            db.flush()

        for key, machine_key, longitude, latitude in (
            ("A", "A", 0.0001, 0.0),
            ("A_EXTRA", "A_EXTRA", 0.0002, 0.0),
            ("B", "B", 10.0001, 10.0),
        ):
            machine = machines[machine_key]
            db.add(MachineLocation(
                machine_id=machine.id,
                farm_id=machine.farm_id,
                recorded_at=now,
                latitude=latitude,
                longitude=longitude,
            ))
            db.add(TelemetryReading(
                machine_id=machine.id,
                farm_id=machine.farm_id,
                measurement_type_id=measurement.id,
                recorded_at=now,
                value=42.0,
            ))
            route_plan = RoutePlan(
                machine_id=machine.id,
                farm_id=machine.farm_id,
                name=f"ISO Route {key} {suffix}",
            )
            db.add(route_plan)
            db.flush()
            db.add(RouteLocation(
                route_id=route_plan.id,
                farm_id=machine.farm_id,
                latitude=latitude,
                longitude=longitude,
                recorded_at=now,
            ))

        operator_a = users[("A", "OPERATOR")]
        db.add(UserPermission(
            user_id=operator_a.id,
            farm_id=farms["A"].id,
            permission_id=permissions["routes.create"].id,
            allowed=True,
        ))
        for key in ("A", "B"):
            db.add(AuditLog(
                user_id=users[(key, "OWNER")].id,
                farm_id=farms[key].id,
                action=f"iso.{key.lower()}",
                resource="test",
                result="success",
                details={},
                created_at=now,
            ))

        result = {
            "farms": {key: farm.id for key, farm in farms.items()},
            "users": {key: user.id for key, user in users.items()},
            "usernames": {key: user.username for key, user in users.items()},
            "machines": {key: machine.id for key, machine in machines.items()},
            "resources": {
                key: {
                    "field": farm.test_field_id,
                    "structure": farm.test_structure_id,
                    "road": farm.test_road_id,
                    "problem": farm.test_problem_id,
                }
                for key, farm in farms.items()
            },
            "suffix": suffix,
        }

    RouteNetworkRepository().rebuild(result["farms"]["A"])
    RouteNetworkRepository().rebuild(result["farms"]["B"])
    return result


@pytest.fixture
def client():
    app.dependency_overrides.pop(get_farm_context, None)
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient, farm_pair: dict, farm_key: str, role: str) -> tuple[str, dict[str, str]]:
    username = farm_pair["usernames"][(farm_key, role)]
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return token, {
        "Authorization": f"Bearer {token}",
        "X-Farm-Id": str(farm_pair["farms"][farm_key]),
    }


def payload_data(response):
    payload = response.json()
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def test_farm_header_and_farm_list_are_membership_scoped(client, farm_pair):
    _, headers_a = login(client, farm_pair, "A", "OWNER")
    farms = payload_data(client.get("/api/v1/farms", headers=headers_a))
    assert [farm["id"] for farm in farms] == [farm_pair["farms"]["A"]]

    assert client.get(
        f"/api/v1/farms/{farm_pair['farms']['B']}",
        headers=headers_a,
    ).status_code == 404
    assert client.get(
        "/api/v1/machines",
        headers={**headers_a, "X-Farm-Id": str(farm_pair["farms"]["B"])},
    ).status_code == 403
    assert client.get(
        "/api/v1/machines",
        headers={**headers_a, "X-Farm-Id": "not-a-farm-id"},
    ).status_code == 422


def test_cross_farm_machine_access_and_list(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    own = payload_data(client.get(f"/api/v1/machines/{farm_pair['machines']['A']}", headers=headers))
    assert own["id"] == farm_pair["machines"]["A"]

    other = client.get(f"/api/v1/machines/{farm_pair['machines']['B']}", headers=headers)
    assert other.status_code == 404
    listed = payload_data(client.get("/api/v1/machines", headers=headers))
    assert {machine["id"] for machine in listed} == {
        farm_pair["machines"]["A"],
        farm_pair["machines"]["A_EXTRA"],
    }
    changed = client.patch(
        f"/api/v1/machines/{farm_pair['machines']['B']}",
        headers=headers,
        json={"status": "inactive"},
    )
    assert changed.status_code == 404


def test_farm_id_payload_cannot_select_or_move_machine(client, farm_pair):
    _, owner_headers = login(client, farm_pair, "A", "OWNER")
    response = client.post(
        "/api/v1/machines",
        headers=owner_headers,
        json={
            "name": f"Forged farm machine {farm_pair['suffix']}",
            "code": f"FORGED-{farm_pair['suffix']}",
            "status": "active",
            "farm_id": farm_pair["farms"]["B"],
        },
    )
    assert response.status_code == 201, response.text
    machine_id = response.json()["data"]["id"]

    with SessionLocal() as db:
        machine = db.get(Machine, machine_id)
        assert machine is not None
        assert machine.farm_id == farm_pair["farms"]["A"]

    patched = client.patch(
        f"/api/v1/machines/{machine_id}",
        headers=owner_headers,
        json={"status": "inactive", "farm_id": farm_pair["farms"]["B"]},
    )
    assert patched.status_code == 200, patched.text

    _, owner_b_headers = login(client, farm_pair, "B", "OWNER")
    assert client.get(f"/api/v1/machines/{machine_id}", headers=owner_b_headers).status_code == 404


def test_cross_farm_field_access(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    listed = payload_data(client.get("/api/v1/fields", headers=headers))
    assert listed
    assert all(field["nome"].find("ISO Field A") >= 0 for field in listed)
    assert client.get(
        f"/api/v1/fields/{farm_pair['resources']['A']['field']}",
        headers=headers,
    ).status_code == 200
    assert client.get(
        f"/api/v1/fields/{farm_pair['resources']['B']['field']}",
        headers=headers,
    ).status_code == 404


def test_cross_farm_structure_access(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    own_id = farm_pair["resources"]["A"]["structure"]
    other_id = farm_pair["resources"]["B"]["structure"]
    assert client.get(f"/api/v1/structures/{own_id}", headers=headers).status_code == 200
    response = client.get(f"/api/v1/structures/{other_id}", headers=headers)
    assert response.status_code == 404
    listed = payload_data(client.get("/api/v1/structures", headers=headers))
    assert all("ISO Structure A" in item["nome"] for item in listed)


def test_cross_farm_road_access(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    own_id = farm_pair["resources"]["A"]["road"]
    other_id = farm_pair["resources"]["B"]["road"]
    assert client.get(f"/api/v1/roads/{own_id}", headers=headers).status_code == 200
    assert client.get(f"/api/v1/roads/{other_id}", headers=headers).status_code == 404
    listed = payload_data(client.get("/api/v1/roads", headers=headers))
    assert all("ISO Road A" in item["nome"] for item in listed)


def test_cross_farm_problem_access_and_create(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    own_problem = farm_pair["resources"]["A"]["problem"]
    other_problem = farm_pair["resources"]["B"]["problem"]
    assert client.get(f"/api/v1/road-problems/{own_problem}", headers=headers).status_code == 200
    assert client.get(f"/api/v1/road-problems/{other_problem}", headers=headers).status_code == 404
    listed = payload_data(client.get("/api/v1/road-problems", headers=headers))
    assert all("ISO Problem A" in (item["descricao"] or "") for item in listed)

    other_road = farm_pair["resources"]["B"]["road"]
    response = client.post(
        "/api/v1/road-problems",
        headers=headers,
        json={
            "road_id": other_road,
            "tipo": "BURACO",
            "gravidade": "BAIXA",
            "geometry": {"type": "Point", "coordinates": [10.005, 10.0]},
        },
    )
    assert response.status_code == 404
    changed = client.patch(
        f"/api/v1/road-problems/{other_problem}",
        headers=headers,
        json={"status": "RESOLVIDO"},
    )
    assert changed.status_code == 404


def test_cross_farm_route_and_network_isolation(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    nodes = payload_data(client.get("/api/v1/routes/nodes", headers=headers))
    segments = payload_data(client.get("/api/v1/routes/segments", headers=headers))
    assert nodes and segments
    assert all(node["geometry"]["coordinates"][0] < 1 for node in nodes)
    assert all(segment["geometry"]["coordinates"][0][0] < 1 for segment in segments)

    own_route = client.post(
        f"/api/v1/routes/machine/{farm_pair['machines']['A']}/to-structure/"
        f"{farm_pair['resources']['A']['structure']}",
        headers=headers,
    )
    assert own_route.status_code == 200, own_route.text
    cross_machine = client.post(
        f"/api/v1/routes/machine/{farm_pair['machines']['B']}/to-structure/"
        f"{farm_pair['resources']['A']['structure']}",
        headers=headers,
    )
    assert cross_machine.status_code == 404
    cross_destination = client.post(
        f"/api/v1/routes/machine/{farm_pair['machines']['A']}/to-structure/"
        f"{farm_pair['resources']['B']['structure']}",
        headers=headers,
    )
    assert cross_destination.status_code == 404
    cross_network_coordinates = client.post(
        "/api/v1/routes/calculate",
        headers=headers,
        json={
            "origin": {"latitude": 10.0, "longitude": 10.0001},
            "destination": {"latitude": 10.0, "longitude": 10.0099},
        },
    )
    assert cross_network_coordinates.status_code == 422


def test_cross_farm_locations_and_telemetry(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    locations = payload_data(client.get("/api/v1/locations", headers=headers))
    readings = payload_data(client.get("/api/v1/telemetry", headers=headers))
    assert locations and all(row["maquina_id"] != farm_pair["machines"]["B"] for row in locations)
    assert readings and all(row["maquina_id"] != farm_pair["machines"]["B"] for row in readings)

    location_history = payload_data(client.get(
        f"/api/v1/locations/{farm_pair['machines']['B']}",
        headers=headers,
    ))
    telemetry_history = payload_data(client.get(
        f"/api/v1/telemetry/{farm_pair['machines']['B']}",
        headers=headers,
    ))
    assert location_history["historico"] == []
    assert telemetry_history["historico"] == []
    assert "ISO Machine B" not in json.dumps([locations, readings, location_history, telemetry_history])


def test_cross_farm_user_access(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    users = payload_data(client.get("/api/v1/users", headers=headers))
    assert users
    assert {user["id"] for user in users} == {
        user_id for (farm, _), user_id in farm_pair["users"].items() if farm == "A"
    }
    other_user = farm_pair["users"][("B", "OWNER")]
    assert client.get(f"/api/v1/users/{other_user}", headers=headers).status_code == 404
    assert client.patch(
        f"/api/v1/users/{other_user}",
        headers=headers,
        json={"role": "ANALYST"},
    ).status_code == 404


def test_cross_farm_audit_access(client, farm_pair):
    _, headers = login(client, farm_pair, "A", "OWNER")
    response = client.get("/api/v1/audit-logs", headers=headers)
    assert response.status_code == 200
    entries = payload_data(response)
    assert all(entry["farm_id"] == farm_pair["farms"]["A"] for entry in entries)
    assert not any(entry["action"] == "iso.b" for entry in entries)


def test_operator_machine_and_route_isolation(client, farm_pair):
    token, headers = login(client, farm_pair, "A", "OPERATOR")
    assigned_id = farm_pair["machines"]["A"]
    other_same_farm_id = farm_pair["machines"]["A_EXTRA"]
    assert client.get(f"/api/v1/machines/{assigned_id}", headers=headers).status_code == 200
    assert client.get(f"/api/v1/machines/{other_same_farm_id}", headers=headers).status_code == 404
    assert client.get(
        f"/api/v1/locations/{other_same_farm_id}",
        headers=headers,
    ).status_code == 404
    assert client.get(
        f"/api/v1/telemetry/{other_same_farm_id}",
        headers=headers,
    ).status_code == 404
    assert client.post(
        f"/api/v1/routes/machine/{other_same_farm_id}/to-structure/"
        f"{farm_pair['resources']['A']['structure']}",
        headers=headers,
    ).status_code == 404
    assert token


def test_all_seeded_profiles_are_enforced_by_live_api(client, farm_pair):
    for role in ("OWNER", "FARM_ADMIN", "COORDINATOR", "SUPERVISOR", "OPERATOR", "TECHNICIAN", "ANALYST"):
        _, headers = login(client, farm_pair, "A", role)
        assert client.get("/api/v1/machines", headers=headers).status_code == 200
        users_response = client.get("/api/v1/users", headers=headers)
        audit_response = client.get("/api/v1/audit-logs", headers=headers)
        should_administer = role in ("OWNER", "FARM_ADMIN")
        assert users_response.status_code == (200 if should_administer else 403)
        assert audit_response.status_code == (200 if should_administer else 403)

        route_response = client.get("/api/v1/routes/segments", headers=headers)
        may_view_routes = role in ("OWNER", "FARM_ADMIN", "COORDINATOR", "SUPERVISOR", "OPERATOR", "ANALYST")
        assert route_response.status_code == (200 if may_view_routes else 403)

        if role in ("COORDINATOR", "SUPERVISOR", "OPERATOR", "TECHNICIAN", "ANALYST"):
            assert client.post(
                "/api/v1/users",
                headers=headers,
                json={
                    "username": f"forbidden_{role.lower()}_{farm_pair['suffix']}",
                    "email": f"forbidden_{role.lower()}_{farm_pair['suffix']}@example.invalid",
                    "password": PASSWORD,
                    "full_name": f"Forbidden {role}",
                    "role": "ANALYST",
                },
            ).status_code == 403


def test_farm_admin_cannot_modify_owner_and_owner_cannot_be_reassigned(client, farm_pair):
    _, admin_headers = login(client, farm_pair, "A", "FARM_ADMIN")
    owner_id = farm_pair["users"][("A", "OWNER")]
    assert client.patch(
        f"/api/v1/users/{owner_id}",
        headers=admin_headers,
        json={"role": "ANALYST"},
    ).status_code == 403
    assert client.patch(
        f"/api/v1/users/{owner_id}",
        headers=admin_headers,
        json={"status": "inactive"},
    ).status_code == 403

    _, owner_headers = login(client, farm_pair, "A", "OWNER")
    assert client.patch(
        f"/api/v1/users/{owner_id}",
        headers=owner_headers,
        json={"role": "ANALYST"},
    ).status_code == 403
    second_owner_response = client.post(
        "/api/v1/users",
        headers=owner_headers,
        json={
            "username": f"second_owner_{farm_pair['suffix']}",
            "email": f"second_owner_{farm_pair['suffix']}@example.invalid",
            "password": PASSWORD,
            "full_name": "Second owner",
            "role": "OWNER",
        },
    )
    assert second_owner_response.status_code in (403, 422)


def test_logout_invalidates_old_jwt(client, farm_pair):
    token, headers = login(client, farm_pair, "A", "OWNER")
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    stale_headers = {**headers, "Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/auth/me", headers=stale_headers).status_code == 401


def test_farm_scoped_schema_has_non_null_columns_foreign_keys_and_indexes(farm_pair):
    tenant_tables = (
        "machines", "fields", "structures", "roads", "road_problems", "route_plans",
        "route_locations", "network_nodes", "network_segments", "machine_locations",
        "telemetry_readings",
    )
    with SessionLocal() as db:
        columns = db.execute(
            text(
                """
                SELECT table_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND column_name = 'farm_id'
                  AND table_name = ANY(:table_names)
                """
            ),
            {"table_names": list(tenant_tables)},
        ).all()
        assert {table for table, _ in columns} == set(tenant_tables)
        assert all(nullable == "NO" for _, nullable in columns)

        missing_indexes = db.execute(
            text(
                """
                SELECT table_name
                FROM unnest(CAST(:table_names AS text[])) AS t(table_name)
                WHERE NOT EXISTS (
                    SELECT 1 FROM pg_indexes i
                    WHERE i.schemaname = 'public'
                      AND i.tablename = t.table_name
                      AND i.indexdef ILIKE '%farm_id%'
                )
                """
            ),
            {"table_names": list(tenant_tables)},
        ).all()
        assert missing_indexes == []

        missing_fk = db.execute(
            text(
                """
                SELECT table_name
                FROM unnest(CAST(:table_names AS text[])) AS t(table_name)
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints c
                    JOIN information_schema.key_column_usage k
                      ON k.constraint_name = c.constraint_name
                     AND k.table_schema = c.table_schema
                    WHERE c.table_schema = 'public'
                      AND c.table_name = t.table_name
                      AND c.constraint_type = 'FOREIGN KEY'
                      AND k.column_name = 'farm_id'
                )
                """
            ),
            {"table_names": list(tenant_tables)},
        ).all()
        assert missing_fk == []

        null_counts = {
            table: db.execute(text(f"SELECT count(*) FROM {table} WHERE farm_id IS NULL")).scalar_one()
            for table in tenant_tables
        }
        assert set(null_counts.values()) == {0}
        postgis = db.execute(text("SELECT postgis_full_version()")).scalar_one()
        assert "POSTGIS=" in postgis


def test_operational_cycle_and_cross_farm_isolation(client, farm_pair):
    from app.models.machine import Machine
    from app.models.telemetry import MachineLocation
    from app.models.user import User

    coordinator_id, coordinator_headers = login(client, farm_pair, "A", "COORDINATOR")
    del coordinator_id
    created_team = client.post(
        "/api/v1/teams",
        headers=coordinator_headers,
        json={"name": f"Cycle team {farm_pair['suffix']}", "code": f"CY-{farm_pair['suffix']}"},
    )
    assert created_team.status_code == 201, created_team.text
    team_id = created_team.json()["data"]["id"]

    candidates = client.get(
        f"/api/v1/teams/{team_id}/member-candidates?team_role=OPERATOR",
        headers=coordinator_headers,
    )
    assert candidates.status_code == 200, candidates.text
    assert [candidate["id"] for candidate in candidates.json()["data"]] == [
        farm_pair["users"][("A", "OPERATOR")]
    ]

    member = client.post(
        f"/api/v1/teams/{team_id}/members",
        headers=coordinator_headers,
        json={"user_id": farm_pair["users"][("A", "OPERATOR")], "team_role": "OPERATOR"},
    )
    assert member.status_code == 201, member.text
    candidates = client.get(
        f"/api/v1/teams/{team_id}/member-candidates?team_role=OPERATOR",
        headers=coordinator_headers,
    )
    assert candidates.status_code == 200, candidates.text
    assert candidates.json()["data"] == []

    with SessionLocal() as db:
        field_id = farm_pair["resources"]["A"]["field"]
        machine = db.get(Machine, farm_pair["machines"]["A"])
        operator = db.get(User, farm_pair["users"][("A", "OPERATOR")])
        supervisor = db.query(User).filter(
            User.username == farm_pair["usernames"][("A", "SUPERVISOR")]
        ).one()

    planned = client.post(
        "/api/v1/operations",
        headers=coordinator_headers,
        json={
            "operation_type": "COLHEITA",
            "name": f"Cycle operation {farm_pair['suffix']}",
            "field_id": field_id,
            "priority": "ALTA",
        },
    )
    assert planned.status_code == 201, planned.text
    operation_id = planned.json()["data"]["id"]
    assigned = client.post(
        f"/api/v1/operations/{operation_id}/assign",
        headers=coordinator_headers,
        json={
            "machine_id": machine.id,
            "operator_id": operator.id,
            "team_id": team_id,
            "supervisor_id": supervisor.id,
        },
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["data"]["status"] == "ATRIBUIDA"

    route = client.post(
        f"/api/v1/operations/{operation_id}/route",
        headers=coordinator_headers,
        json={"reason": "Rota inicial"},
    )
    assert route.status_code == 200, route.text
    assert route.json()["data"]["version"] == 1
    assert route.json()["data"]["distance_m"] > 0

    _, operator_headers = login(client, farm_pair, "A", "OPERATOR")
    accepted = client.post(
        f"/api/v1/operations/{operation_id}/accept", headers=operator_headers, json={}
    )
    assert accepted.status_code == 200, accepted.text
    started = client.post(
        f"/api/v1/operations/{operation_id}/start", headers=operator_headers, json={}
    )
    assert started.status_code == 200, started.text
    started_at = datetime.now(timezone.utc)
    with SessionLocal.begin() as db:
        db.add_all([
            MachineLocation(
                machine_id=machine.id, farm_id=farm_pair["farms"]["A"],
                recorded_at=started_at, latitude=0.0, longitude=0.0002,
            ),
            MachineLocation(
                machine_id=machine.id, farm_id=farm_pair["farms"]["A"],
                recorded_at=started_at + timedelta(microseconds=1),
                latitude=0.0, longitude=0.0003,
            ),
        ])
    occurrence = client.post(
        f"/api/v1/operations/{operation_id}/occurrences",
        headers=operator_headers,
        json={
            "occurrence_type": "PARADA",
            "description": "Parada registrada em teste de integração",
            "latitude": 0.0,
            "longitude": 0.0002,
        },
    )
    assert occurrence.status_code == 201, occurrence.text
    completed = client.post(
        f"/api/v1/operations/{operation_id}/complete",
        headers=operator_headers,
        json={"reason": "Atividade concluída"},
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["data"]["status"] == "CONCLUIDA"
    with SessionLocal() as db:
        assert db.get(UserFarm, (operator.id, farm_pair["farms"]["A"])).assigned_machine_id == machine.id

    history = client.get(
        f"/api/v1/operations/{operation_id}/history", headers=coordinator_headers
    )
    assert history.status_code == 200
    assert len(history.json()["data"]["statuses"]) == 5
    assert len(history.json()["data"]["routes"]) == 1
    locations = client.get(
        f"/api/v1/operations/{operation_id}/locations", headers=coordinator_headers
    )
    assert locations.status_code == 200
    comparison = locations.json()["data"]["comparison"]
    assert comparison["sufficient_data"] is True
    assert comparison["actual_distance_m"] > 0
    assert comparison["adherence_sufficient_data"] is True
    assert comparison["points_outside_tolerance"] == 0
    assert comparison["route_adherence_pct"] == 100.0
    assert locations.json()["data"]["current_position"]["longitude"] == pytest.approx(0.0003)
    assert locations.json()["data"]["locations"][-1]["speed"] is None
    summary = client.get("/api/v1/operations/summary", headers=coordinator_headers)
    assert summary.status_code == 200
    assert summary.json()["data"]["operations_by_status"]["CONCLUIDA"] == 1
    assert summary.json()["data"]["occurrences_recorded"] == 1
    occurrences = client.get(
        f"/api/v1/operations/{operation_id}/occurrences", headers=coordinator_headers
    )
    assert occurrences.status_code == 200
    assert len(occurrences.json()["data"]) == 1

    _, owner_b_headers = login(client, farm_pair, "B", "OWNER")
    cross_farm = client.get(f"/api/v1/operations/{operation_id}", headers=owner_b_headers)
    assert cross_farm.status_code == 404
