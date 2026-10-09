import pytest

from app.services.route_algorithm import RouteSnap
from app.services.route_service import (
    DestinationTooFar,
    MachineLocationNotFound,
    MachineNotFound,
    NoRoadNetwork,
    OriginTooFar,
    RouteNotFound,
    RouteService,
    StructureNotFound,
)


class FakeRouteRepository:
    def __init__(self):
        self.segments = [{
            "id": 1,
            "road_id": 1,
            "from_node_id": 1,
            "to_node_id": 2,
            "coordinates": [[-50.0, -21.0], [-50.001, -21.0]],
            "geometry": {"type": "LineString", "coordinates": [[-50.0, -21.0], [-50.001, -21.0]]},
            "length_m": 100.0,
            "base_cost": 100.0,
            "cost_multiplier": 1.0,
            "cost": 100.0,
            "is_blocked": False,
            "problems": [],
        }]
        self.origin_snap = {
            "segment_id": 1,
            "fraction": 0.0,
            "coordinates": (-50.0, -21.0),
            "distance_m": 0.0,
        }
        self.destination_snap = {
            "segment_id": 1,
            "fraction": 1.0,
            "coordinates": (-50.001, -21.0),
            "distance_m": 0.0,
        }
        self.snap_results = [self.origin_snap, self.destination_snap]
        self.machine_status = "ok"
        self.structure_location = {"latitude": -21.0, "longitude": -50.001}

    def network_has_roads(self, farm_id):
        return True

    def load_graph(self, farm_id):
        return self.segments

    def nearest_segment(self, latitude, longitude, maximum_distance_m, farm_id):
        return self.snap_results.pop(0)

    def get_machine_location(self, machine_id, farm_id):
        return self.machine_status, {"latitude": -21.0, "longitude": -50.0}

    def get_structure_location(self, structure_id, farm_id):
        return self.structure_location


def test_calculates_route_and_returns_geojson_feature():
    result = RouteService(FakeRouteRepository()).calculate(
        {"latitude": -21.0, "longitude": -50.0},
        {"latitude": -21.0, "longitude": -50.001},
        farm_id=1,
    )

    assert result["found"] is True
    assert result["segments"] == [1]
    assert result["distance_m"] == pytest.approx(100.0)
    assert result["total_cost"] == pytest.approx(100.0)
    assert result["route"]["type"] == "Feature"
    assert result["route"]["geometry"]["coordinates"] == [
        (-50.0, -21.0),
        (-50.001, -21.0),
    ]


def test_rejects_empty_network():
    repository = FakeRouteRepository()
    repository.network_has_roads = lambda farm_id: False

    with pytest.raises(NoRoadNetwork):
        RouteService(repository).calculate({}, {}, farm_id=1)


@pytest.mark.parametrize(
    ("origin_snap", "destination_snap", "expected_error"),
    [
        (None, {}, OriginTooFar),
        ({}, None, DestinationTooFar),
    ],
)
def test_distinguishes_origin_and_destination_outside_network(
    origin_snap,
    destination_snap,
    expected_error,
):
    repository = FakeRouteRepository()
    repository.nearest_segment = lambda latitude, longitude, maximum_distance_m, farm_id: (
        origin_snap if longitude == -50.0 else destination_snap
    )

    with pytest.raises(expected_error):
        RouteService(repository).calculate(
            {"latitude": -21.0, "longitude": -50.0},
            {"latitude": -21.0, "longitude": -50.001},
            farm_id=1,
        )


def test_reports_disconnected_network():
    repository = FakeRouteRepository()
    repository.segments[0]["is_blocked"] = True

    with pytest.raises(RouteNotFound):
        RouteService(repository).calculate(
            {"latitude": -21.0, "longitude": -50.0},
            {"latitude": -21.0, "longitude": -50.001},
            farm_id=1,
        )


@pytest.mark.parametrize(
    ("machine_status", "expected_error"),
    [
        ("machine_not_found", MachineNotFound),
        ("location_not_found", MachineLocationNotFound),
    ],
)
def test_machine_route_reports_missing_machine_or_gps(machine_status, expected_error):
    repository = FakeRouteRepository()
    repository.machine_status = machine_status

    with pytest.raises(expected_error):
        RouteService(repository).calculate_machine_to_structure(1, 1, farm_id=1)


def test_machine_route_reports_missing_destination_structure():
    repository = FakeRouteRepository()
    repository.structure_location = None

    with pytest.raises(StructureNotFound):
        RouteService(repository).calculate_machine_to_structure(1, 1, farm_id=1)


def test_machine_to_structure_uses_latest_location_and_structure_coordinate():
    repository = FakeRouteRepository()
    result = RouteService(repository).calculate_machine_to_structure(1, 2, farm_id=1)

    assert result["found"] is True
    assert result["origin"] == {"latitude": -21.0, "longitude": -50.0}
    assert result["destination"] == {"latitude": -21.0, "longitude": -50.001}
