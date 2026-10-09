import pytest

from app.services.route_algorithm import RouteSnap, evaluate_segment_problems, find_route


def segment(
    segment_id,
    from_node,
    to_node,
    coordinates,
    *,
    cost_multiplier=1.0,
    is_blocked=False,
    problems=None,
):
    return {
        "id": segment_id,
        "road_id": segment_id,
        "from_node_id": from_node,
        "to_node_id": to_node,
        "coordinates": coordinates,
        "length_m": 100.0,
        "base_cost": 100.0,
        "cost_multiplier": cost_multiplier,
        "is_blocked": is_blocked,
        "problems": problems or [],
    }


def test_dijkstra_finds_route_across_multiple_segments_and_orders_geojson_coordinates():
    segments = [
        segment(1, 10, 11, [[-50.0, -21.0], [-50.001, -21.0]]),
        segment(2, 11, 12, [[-50.001, -21.0], [-50.002, -21.0]]),
    ]
    origin = RouteSnap(1, 0.25, (-50.00025, -21.0), 2.0)
    destination = RouteSnap(2, 0.75, (-50.00175, -21.0), 3.0)

    route = find_route(segments, origin, destination)

    assert route is not None
    assert route["segments"] == [1, 2]
    assert route["nodes"] == [11]
    assert route["total_cost"] == pytest.approx(150.0)
    assert route["distance_m"] == pytest.approx(150.0)
    assert route["coordinates"][0] == origin.coordinates
    assert route["coordinates"][-1] == destination.coordinates
    assert route["coordinates"][1] == (-50.001, -21.0)


def test_dijkstra_prefers_longer_unaffected_alternative_over_penalized_segment():
    segments = [
        segment(1, 1, 2, [[-50, -21], [-50.001, -21]], cost_multiplier=3.0),
        segment(2, 1, 3, [[-50, -21], [-50, -21.001]]),
        segment(3, 3, 2, [[-50, -21.001], [-50.001, -21]]),
    ]
    origin = RouteSnap(1, 0.0, (-50, -21), 0.0)
    destination = RouteSnap(1, 1.0, (-50.001, -21), 0.0)

    route = find_route(segments, origin, destination)

    assert route is not None
    assert route["segments"] == [2, 3]
    assert route["total_cost"] == pytest.approx(200.0)
    assert route["distance_m"] == pytest.approx(200.0)


def test_blocked_segment_is_never_used_and_no_alternative_returns_none():
    segments = [
        segment(1, 1, 2, [[-50, -21], [-50.001, -21]], is_blocked=True),
    ]
    origin = RouteSnap(1, 0.0, (-50, -21), 0.0)
    destination = RouteSnap(1, 1.0, (-50.001, -21), 0.0)

    assert find_route(segments, origin, destination) is None


@pytest.mark.parametrize(
    ("severity", "factor"),
    [("BAIXA", 1.10), ("MEDIA", 1.30), ("ALTA", 1.70), ("CRITICA", 3.00)],
)
def test_active_problem_severity_applies_configured_factor(severity, factor):
    problems = [{"status": "ABERTO", "gravidade": severity, "tipo": "BURACO"}]

    active, blocked, multiplier = evaluate_segment_problems(
        problems,
        {"BAIXA": 1.10, "MEDIA": 1.30, "ALTA": 1.70, "CRITICA": 3.00},
    )

    assert active == problems
    assert blocked is False
    assert multiplier == factor


@pytest.mark.parametrize("problem_status", ["RESOLVIDO", "INATIVO"])
def test_resolved_and_inactive_problems_do_not_affect_route_cost(problem_status):
    active, blocked, multiplier = evaluate_segment_problems(
        [{"status": problem_status, "gravidade": "CRITICA", "tipo": "VIA_BLOQUEADA"}],
        {"CRITICA": 3.0},
    )

    assert active == []
    assert blocked is False
    assert multiplier == 1.0


@pytest.mark.parametrize("problem_status", ["ABERTO", "EM_ANALISE"])
def test_active_road_blockage_marks_segment_unavailable(problem_status):
    active, blocked, multiplier = evaluate_segment_problems(
        [{"status": problem_status, "gravidade": "BAIXA", "tipo": "VIA_BLOQUEADA"}],
        {"BAIXA": 1.10},
    )

    assert len(active) == 1
    assert blocked is True
    assert multiplier == 1.10


def test_multiple_active_problems_use_the_highest_multiplier_not_compounded_cost():
    active, blocked, multiplier = evaluate_segment_problems(
        [
            {"status": "ABERTO", "gravidade": "BAIXA", "tipo": "BURACO"},
            {"status": "EM_ANALISE", "gravidade": "ALTA", "tipo": "LAMA"},
        ],
        {"BAIXA": 1.10, "ALTA": 1.70},
    )

    assert len(active) == 2
    assert blocked is False
    assert multiplier == 1.70
