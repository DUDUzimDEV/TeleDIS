import json

from fastapi import HTTPException
from sqlalchemy import text

from app.config import get_settings
from app.database import SessionLocal
from app.services.spatial_validation_service import (
    SpatialValidationError,
    spatial_validation_service,
)
from app.services.route_service import RouteRequestError, RouteService


ACTIVE_OPERATION_STATUSES = {"ATRIBUIDA", "ACEITA", "EM_EXECUCAO", "INTERROMPIDA"}
PENDING_OPERATION_STATUSES = {"PLANEJADA", "ATRIBUIDA", "ACEITA"}
TERMINAL_OPERATION_STATUSES = {"CONCLUIDA", "CANCELADA"}


class SimulatorContextResolver:
    def __init__(self, route_service=None):
        self.route_service = route_service or RouteService()

    def resolve(self, machine_id: int, farm_id: int) -> dict:
        with SessionLocal() as db:
            machine = db.execute(
                text("""
                    SELECT id, farm_id, name, code, status, base_structure_id
                    FROM machines
                    WHERE id = :machine_id AND farm_id = :farm_id
                """),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).mappings().one_or_none()
            if machine is None:
                raise HTTPException(status_code=404, detail="Máquina não encontrada nesta fazenda.")

            farm = db.execute(
                text("""
                    SELECT id, operational_area IS NOT NULL AS operational_area_configured,
                           proximity_radius_m
                    FROM farms
                    WHERE id = :farm_id
                """),
                {"farm_id": farm_id},
            ).mappings().one()
            base_structure = None
            if machine["base_structure_id"] is not None:
                base_structure_row = db.execute(
                    text("""
                        SELECT id, nome, tipo, ST_AsGeoJSON(geometry) AS geometry_json
                        FROM structures
                        WHERE id = :structure_id AND farm_id = :farm_id
                    """),
                    {"structure_id": machine["base_structure_id"], "farm_id": farm_id},
                ).mappings().one_or_none()
                if base_structure_row is not None:
                    base_geometry = base_structure_row["geometry_json"]
                    base_geometry = (
                        json.loads(base_geometry)
                        if isinstance(base_geometry, str)
                        else base_geometry
                    )
                    base_structure = {
                        "id": base_structure_row["id"],
                        "name": base_structure_row["nome"],
                        "type": base_structure_row["tipo"],
                        "geometry": base_geometry,
                        "location": (
                            {
                                "latitude": base_geometry["coordinates"][1],
                                "longitude": base_geometry["coordinates"][0],
                            }
                            if isinstance(base_geometry, dict)
                            and base_geometry.get("type") == "Point"
                            and len(base_geometry.get("coordinates", [])) >= 2
                            else None
                        ),
                    }
            location = db.execute(
                text("""
                    SELECT id, latitude, longitude, recorded_at, source
                    FROM machine_locations
                    WHERE machine_id = :machine_id AND farm_id = :farm_id
                    ORDER BY recorded_at DESC, id DESC
                    LIMIT 1
                """),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).mappings().one_or_none()
            previous_location = db.execute(
                text("""
                    SELECT id, latitude, longitude, recorded_at
                    FROM machine_locations
                    WHERE machine_id = :machine_id AND farm_id = :farm_id
                    ORDER BY recorded_at DESC, id DESC
                    OFFSET 1
                    LIMIT 1
                """),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).mappings().one_or_none()
            operation = db.execute(
                text("""
                    SELECT id, code, operation_type, name, status, field_id,
                           machine_id, operator_id, team_id, supervisor_id,
                           route_plan_id, scheduled_start, scheduled_end,
                           accepted_at, started_at, completed_at, cancelled_at,
                           created_at, updated_at
                    FROM operations
                    WHERE farm_id = :farm_id AND machine_id = :machine_id
                    ORDER BY
                        CASE
                            WHEN status IN ('EM_EXECUCAO', 'INTERROMPIDA') THEN 0
                            WHEN status IN ('ATRIBUIDA', 'ACEITA') THEN 1
                            WHEN status = 'PLANEJADA' THEN 2
                            ELSE 3
                        END,
                        scheduled_start ASC NULLS LAST,
                        updated_at DESC,
                        id DESC
                    LIMIT 1
                """),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).mappings().one_or_none()
            active_operation_count = db.execute(
                text("""
                    SELECT COUNT(*)
                    FROM operations
                    WHERE farm_id = :farm_id AND machine_id = :machine_id
                      AND status IN ('ATRIBUIDA', 'ACEITA', 'EM_EXECUCAO', 'INTERROMPIDA')
                """),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).scalar_one()
            status_history = []
            if operation is not None:
                status_history = [
                    dict(row)
                    for row in db.execute(
                        text("""
                            SELECT old_status, new_status, reason, created_at
                            FROM operation_status_history
                            WHERE operation_id = :operation_id AND farm_id = :farm_id
                            ORDER BY created_at, id
                        """),
                        {"operation_id": operation["id"], "farm_id": farm_id},
                    ).mappings().all()
                ]

            field = None
            planned_route = None
            location_in_field = False
            location_on_route = False
            moving_towards_operation = False
            route_progress = None
            if operation is not None:
                field_row = db.execute(
                    text("""
                        SELECT id, nome, ST_AsGeoJSON(geometry) AS geometry_json,
                               ST_Y(ST_Centroid(geometry)) AS latitude,
                               ST_X(ST_Centroid(geometry)) AS longitude
                        FROM fields
                        WHERE id = :field_id AND farm_id = :farm_id
                    """),
                    {"field_id": operation["field_id"], "farm_id": farm_id},
                ).mappings().one_or_none()
                if field_row is not None:
                    field = {
                        "id": field_row["id"],
                        "name": field_row["nome"],
                        "geometry": json.loads(field_row["geometry_json"]),
                        "location": {
                            "latitude": field_row["latitude"],
                            "longitude": field_row["longitude"],
                        },
                    }

                if operation["route_plan_id"] is not None:
                    route_row = db.execute(
                        text("""
                            SELECT id, name, route_geometry, distance_m, calculated_at
                            FROM route_plans
                            WHERE id = :route_plan_id AND farm_id = :farm_id
                              AND machine_id = :machine_id
                        """),
                        {
                            "route_plan_id": operation["route_plan_id"],
                            "farm_id": farm_id,
                            "machine_id": machine_id,
                        },
                    ).mappings().one_or_none()
                    if route_row is not None:
                        route_points = db.execute(
                            text("""
                                SELECT latitude, longitude, recorded_at
                                FROM route_locations
                                WHERE route_id = :route_id AND farm_id = :farm_id
                                ORDER BY recorded_at, id
                            """),
                            {"route_id": route_row["id"], "farm_id": farm_id},
                        ).mappings().all()
                        geometry = route_row["route_geometry"]
                        if isinstance(geometry, str):
                            geometry = json.loads(geometry)
                        line_geometry = geometry
                        if isinstance(line_geometry, dict) and line_geometry.get("type") == "Feature":
                            line_geometry = line_geometry.get("geometry")
                        coordinates = (
                            line_geometry.get("coordinates", [])
                            if isinstance(line_geometry, dict)
                            and line_geometry.get("type") == "LineString"
                            else []
                        )
                        planned_route = {
                            "id": route_row["id"],
                            "name": route_row["name"],
                            "geometry": geometry,
                            "origin": (
                                {"longitude": coordinates[0][0], "latitude": coordinates[0][1]}
                                if len(coordinates) >= 2 else None
                            ),
                            "destination": (
                                {
                                    "longitude": coordinates[-1][0],
                                    "latitude": coordinates[-1][1],
                                }
                                if len(coordinates) >= 2 else None
                            ),
                            "distance_m": route_row["distance_m"],
                            "calculated_at": route_row["calculated_at"],
                            "points": [
                                {
                                    "latitude": point["latitude"],
                                    "longitude": point["longitude"],
                                    "recorded_at": point["recorded_at"],
                                }
                                for point in route_points
                            ],
                        }

                if location is not None:
                    spatial_state = db.execute(
                        text("""
                            WITH current_point AS (
                                SELECT ST_SetSRID(
                                    ST_MakePoint(:longitude, :latitude), 4326
                                ) AS geom
                            )
                            SELECT CASE WHEN fields.geometry IS NOT NULL
                                        THEN ST_Covers(fields.geometry, current_point.geom)
                                        ELSE FALSE END AS location_in_field,
                                   CASE WHEN route.line IS NOT NULL
                                        THEN ST_DWithin(
                                            route.line::geography,
                                            current_point.geom::geography,
                                            :tolerance_m
                                        ) OR ST_DWithin(
                                            ST_StartPoint(route.line)::geography,
                                            current_point.geom::geography,
                                            :route_snap_tolerance_m
                                        )
                                        ELSE FALSE END AS location_on_route,
                                   CASE WHEN route.line IS NOT NULL
                                        THEN ST_LineLocatePoint(route.line, current_point.geom)
                                        ELSE NULL END AS route_progress,
                                   CASE WHEN route.line IS NOT NULL
                                             AND previous_point.geom IS NOT NULL
                                             AND ST_DWithin(
                                                 route.line::geography,
                                                 previous_point.geom::geography,
                                                 :tolerance_m
                                             )
                                             AND ST_DWithin(
                                                 route.line::geography,
                                                 current_point.geom::geography,
                                                 :tolerance_m
                                             )
                                        THEN ST_LineLocatePoint(route.line, current_point.geom)
                                             > ST_LineLocatePoint(route.line, previous_point.geom)
                                        ELSE FALSE END AS moving_towards_operation
                            FROM current_point
                            LEFT JOIN LATERAL (
                                SELECT ST_SetSRID(
                                    ST_GeomFromGeoJSON(:route_geometry), 4326
                                ) AS line
                                WHERE :route_geometry IS NOT NULL
                            ) AS route ON TRUE
                            LEFT JOIN LATERAL (
                                SELECT ST_SetSRID(
                                    ST_MakePoint(:previous_longitude, :previous_latitude), 4326
                                ) AS geom
                                WHERE :previous_latitude IS NOT NULL
                                  AND :previous_longitude IS NOT NULL
                            ) AS previous_point ON TRUE
                            LEFT JOIN fields
                              ON fields.id = :field_id AND fields.farm_id = :farm_id
                        """),
                        {
                            "longitude": location["longitude"],
                            "latitude": location["latitude"],
                            "field_id": operation["field_id"],
                            "farm_id": farm_id,
                            "route_geometry": self._route_line_geojson(planned_route),
                            "previous_latitude": (
                                previous_location["latitude"] if previous_location else None
                            ),
                            "previous_longitude": (
                                previous_location["longitude"] if previous_location else None
                            ),
                            "tolerance_m": get_settings().route_deviation_tolerance_m,
                            "route_snap_tolerance_m": get_settings().route_snap_max_distance_m,
                        },
                    ).mappings().one()
                    location_in_field = spatial_state["location_in_field"]
                    location_on_route = spatial_state["location_on_route"]
                    moving_towards_operation = spatial_state["moving_towards_operation"]
                    route_progress = spatial_state["route_progress"]

            location_at_base = False
            if location is not None and base_structure is not None and base_structure["location"] is not None:
                base_state = db.execute(
                    text("""
                        SELECT ST_DWithin(
                            ST_SetSRID(ST_MakePoint(:base_longitude, :base_latitude), 4326)::geography,
                            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
                            :tolerance_m
                        )
                    """),
                    {
                        "base_longitude": base_structure["location"]["longitude"],
                        "base_latitude": base_structure["location"]["latitude"],
                        "longitude": location["longitude"],
                        "latitude": location["latitude"],
                        "tolerance_m": 5,
                    },
                ).scalar_one()
                location_at_base = bool(base_state)

            return_route = None
            return_route_error = None
            is_operation_terminal_or_absent = (
                operation is None
                or operation["status"] in TERMINAL_OPERATION_STATUSES
            )
            if (
                is_operation_terminal_or_absent
                and location is not None
                and base_structure is not None
                and base_structure["location"] is not None
                and not location_at_base
            ):
                try:
                    route = self.route_service.calculate(
                        {
                            "latitude": location["latitude"],
                            "longitude": location["longitude"],
                        },
                        base_structure["location"],
                        farm_id,
                    )
                    return_route = {
                        "id": None,
                        "name": f"Retorno à base {base_structure['name']}",
                        "geometry": route["route"],
                        "distance_m": route["distance_m"],
                        "points": [],
                    }
                except RouteRequestError as exc:
                    return_route_error = exc.message

            simulator_state, state_reason = self._derive_state(
                operation,
                location,
                field,
                planned_route,
                location_in_field,
                location_on_route,
                moving_towards_operation,
                active_operation_count,
                base_structure,
                location_at_base,
                return_route is not None,
                return_route_error,
            )
            return {
                "machine": dict(machine),
                "farm": dict(farm),
                "current_location": dict(location) if location is not None else None,
                "operation": dict(operation) if operation is not None else None,
                "active_operation": (
                    dict(operation)
                    if operation is not None
                    and operation["status"] in ACTIVE_OPERATION_STATUSES
                    and active_operation_count == 1
                    else None
                ),
                "active_operation_count": active_operation_count,
                "operation_state": operation["status"] if operation is not None else None,
                "operation_status_history": status_history,
                "field": field,
                "planned_route": planned_route,
                "route_progress": route_progress,
                "return_route": return_route,
                "base_structure": base_structure,
                "location_at_base": location_at_base,
                "simulator_state": simulator_state,
                "state_reason": state_reason,
            }

    @staticmethod
    def _route_line_geojson(planned_route):
        if planned_route is None or not isinstance(planned_route["geometry"], dict):
            return None
        geometry = planned_route["geometry"]
        if geometry.get("type") == "Feature":
            geometry = geometry.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
            return None
        return json.dumps(geometry)

    @staticmethod
    def _derive_state(
        operation,
        location,
        field,
        planned_route,
        location_in_field: bool,
        location_on_route: bool,
        moving_towards_operation: bool = False,
        active_operation_count: int = 1,
        base_structure=None,
        location_at_base: bool = False,
        return_route_available: bool = False,
        return_route_error: str | None = None,
    ) -> tuple[str, str]:
        if active_operation_count > 1:
            return "ERROR", "MULTIPLE_ACTIVE_OPERATIONS"
        if operation is None or operation["status"] in TERMINAL_OPERATION_STATUSES:
            if base_structure is None or base_structure.get("location") is None:
                return "NO_BASE_CONFIGURED", "NO_ACTIVE_OPERATION_AND_NO_BASE"
            if location is None or location_at_base:
                return "AT_BASE", "MACHINE_AT_BASE"
            if return_route_available:
                return "RETURNING_TO_BASE", "NO_ACTIVE_OPERATION_RETURNING_TO_BASE"
            return "ERROR", return_route_error or "RETURN_ROUTE_NOT_AVAILABLE"
        operation_status = operation["status"]
        if operation_status in PENDING_OPERATION_STATUSES:
            if field is not None and planned_route is not None:
                return "READY_FOR_OPERATION", "OPERATION_READY_FOR_EXECUTION"
            if base_structure is not None and planned_route is None:
                return "OPERATION_NOT_READY", "BASE_AVAILABLE_BUT_ROUTE_NOT_DEFINED"
            return "OPERATION_NOT_READY", f"OPERATION_{operation_status}"
        if operation_status == "INTERROMPIDA":
            return "PAUSED", "OPERATION_INTERRUPTED"
        if operation_status == "EM_EXECUCAO":
            if location is None:
                return "ERROR", "CURRENT_LOCATION_NOT_AVAILABLE"
            if field is None:
                return "ERROR", "OPERATION_FIELD_NOT_AVAILABLE"
            if location_in_field:
                return "EXECUTING_OPERATION", "LOCATION_INSIDE_OPERATION_FIELD"
            if planned_route is None:
                return "ERROR", "PLANNED_ROUTE_NOT_AVAILABLE"
            if location_on_route:
                return "TRAVELING", "LOCATION_ON_PLANNED_ROUTE"
            return "ERROR", "LOCATION_NOT_ON_PLANNED_ROUTE"
        return "ERROR", "UNSUPPORTED_OPERATION_STATUS"


class SimulatedLocationValidator:
    def validate(self, machine_id: int, farm_id: int, latitude: float, longitude: float) -> dict:
        with SessionLocal() as db:
            machine = db.execute(
                text("""
                    SELECT id FROM machines
                    WHERE id = :machine_id AND farm_id = :farm_id
                """),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).one_or_none()
            if machine is None:
                raise HTTPException(status_code=404, detail="Máquina não encontrada nesta fazenda.")
            try:
                result = spatial_validation_service.validate_simulated_location(
                    db, farm_id, latitude, longitude
                )
            except SpatialValidationError as exc:
                status_code = 409 if exc.code == "OPERATIONAL_AREA_NOT_CONFIGURED" else 422
                raise HTTPException(
                    status_code=status_code,
                    detail={"code": exc.code, "message": str(exc)},
                ) from exc
            return {"valid": True, **result}


simulator_context_resolver = SimulatorContextResolver()
simulated_location_validator = SimulatedLocationValidator()
