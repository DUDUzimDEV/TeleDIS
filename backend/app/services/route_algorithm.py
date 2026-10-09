import heapq
import math
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RouteSnap:
    segment_id: int
    fraction: float
    coordinates: tuple[float, float]
    distance_m: float


@dataclass(frozen=True)
class Traversal:
    segment: dict[str, Any]
    start_fraction: float
    end_fraction: float
    from_node: int
    to_node: int

    @property
    def cost(self) -> float:
        return (
            self.segment["base_cost"]
            * abs(self.end_fraction - self.start_fraction)
            * self.segment["cost_multiplier"]
        )

    @property
    def distance_m(self) -> float:
        return self.segment["length_m"] * abs(self.end_fraction - self.start_fraction)


def evaluate_segment_problems(
    problems: list[dict[str, Any]],
    severity_costs: dict[str, float],
) -> tuple[list[dict[str, Any]], bool, float]:
    active = [
        problem
        for problem in problems
        if problem["status"] in {"ABERTO", "EM_ANALISE"}
    ]
    blocked = any(problem["tipo"] == "VIA_BLOQUEADA" for problem in active)
    multiplier = max(
        (severity_costs.get(problem["gravidade"], 1.0) for problem in active),
        default=1.0,
    )
    return active, blocked, multiplier


def _point_at_fraction(coordinates: list[list[float]], fraction: float) -> tuple[float, float]:
    lengths = [
        math.hypot(
            coordinates[index][0] - coordinates[index - 1][0],
            coordinates[index][1] - coordinates[index - 1][1],
        )
        for index in range(1, len(coordinates))
    ]
    total = sum(lengths)
    if total == 0:
        return tuple(coordinates[0])

    target = min(max(fraction, 0.0), 1.0) * total
    traversed = 0.0
    for index, length in enumerate(lengths, start=1):
        if traversed + length >= target or index == len(lengths):
            ratio = 0.0 if length == 0 else (target - traversed) / length
            start = coordinates[index - 1]
            end = coordinates[index]
            return (
                start[0] + ratio * (end[0] - start[0]),
                start[1] + ratio * (end[1] - start[1]),
            )
        traversed += length
    return tuple(coordinates[-1])


def _coordinates_between(
    coordinates: list[list[float]],
    start_fraction: float,
    end_fraction: float,
) -> list[tuple[float, float]]:
    start_distance = min(max(start_fraction, 0.0), 1.0)
    end_distance = min(max(end_fraction, 0.0), 1.0)
    lengths = [
        math.hypot(
            coordinates[index][0] - coordinates[index - 1][0],
            coordinates[index][1] - coordinates[index - 1][1],
        )
        for index in range(1, len(coordinates))
    ]
    total = sum(lengths)
    if total == 0:
        point = tuple(coordinates[0])
        return [point, point]

    low, high = sorted((start_distance, end_distance))
    low *= total
    high *= total
    result = [_point_at_fraction(coordinates, start_distance)]
    traversed = 0.0
    for index, length in enumerate(lengths, start=1):
        traversed += length
        if low < traversed < high:
            result.append(tuple(coordinates[index]))
    result.append(_point_at_fraction(coordinates, end_distance))
    if start_fraction > end_fraction:
        result.reverse()
    return result


def _edge_traversal(segment: dict[str, Any], start: float, end: float, from_node: int, to_node: int):
    if segment["is_blocked"]:
        return None
    return Traversal(segment, start, end, from_node, to_node)


def find_route(
    segments: list[dict[str, Any]],
    origin: RouteSnap,
    destination: RouteSnap,
) -> dict[str, Any] | None:
    segment_by_id = {segment["id"]: segment for segment in segments}
    origin_segment = segment_by_id.get(origin.segment_id)
    destination_segment = segment_by_id.get(destination.segment_id)
    if origin_segment is None or destination_segment is None:
        return None

    source = -1
    target = -2
    adjacency: dict[int, list[Traversal]] = {}

    def add(traversal: Traversal | None):
        if traversal is not None:
            adjacency.setdefault(traversal.from_node, []).append(traversal)

    for segment in segments:
        from_node = segment["from_node_id"]
        to_node = segment["to_node_id"]
        add(_edge_traversal(segment, 0.0, 1.0, from_node, to_node))
        add(_edge_traversal(segment, 1.0, 0.0, to_node, from_node))

    origin_fraction = min(max(origin.fraction, 0.0), 1.0)
    destination_fraction = min(max(destination.fraction, 0.0), 1.0)
    if origin.segment_id == destination.segment_id:
        add(
            _edge_traversal(
                origin_segment,
                origin_fraction,
                destination_fraction,
                source,
                target,
            )
        )

    add(_edge_traversal(origin_segment, origin_fraction, 0.0, source, origin_segment["from_node_id"]))
    add(_edge_traversal(origin_segment, origin_fraction, 1.0, source, origin_segment["to_node_id"]))
    add(
        _edge_traversal(
            destination_segment,
            0.0,
            destination_fraction,
            destination_segment["from_node_id"],
            target,
        )
    )
    add(
        _edge_traversal(
            destination_segment,
            1.0,
            destination_fraction,
            destination_segment["to_node_id"],
            target,
        )
    )

    costs = {source: 0.0}
    previous: dict[int, Traversal] = {}
    queue = [(0.0, source)]
    while queue:
        cost, node = heapq.heappop(queue)
        if cost != costs.get(node):
            continue
        if node == target:
            break
        for traversal in adjacency.get(node, []):
            candidate = cost + traversal.cost
            if candidate < costs.get(traversal.to_node, math.inf):
                costs[traversal.to_node] = candidate
                previous[traversal.to_node] = traversal
                heapq.heappush(queue, (candidate, traversal.to_node))

    if target not in costs:
        return None

    traversals = []
    node = target
    while node != source:
        traversal = previous[node]
        traversals.append(traversal)
        node = traversal.from_node
    traversals.reverse()

    route_coordinates: list[tuple[float, float]] = []
    route_nodes: list[int] = []
    used_segments: list[int] = []
    distance_m = 0.0
    for traversal in traversals:
        segment = traversal.segment
        if abs(traversal.end_fraction - traversal.start_fraction) > 1e-12:
            piece = _coordinates_between(
                segment["coordinates"],
                traversal.start_fraction,
                traversal.end_fraction,
            )
            if traversal.from_node == source:
                piece[0] = origin.coordinates
            if traversal.to_node == target:
                piece[-1] = destination.coordinates
            if route_coordinates and route_coordinates[-1] == piece[0]:
                route_coordinates.extend(piece[1:])
            else:
                route_coordinates.extend(piece)
            used_segments.append(segment["id"])
        if traversal.from_node not in (source, target) and (
            not route_nodes or route_nodes[-1] != traversal.from_node
        ):
            route_nodes.append(traversal.from_node)
        if traversal.to_node not in (source, target) and (
            not route_nodes or route_nodes[-1] != traversal.to_node
        ):
            route_nodes.append(traversal.to_node)
        distance_m += traversal.distance_m

    if not route_coordinates:
        route_coordinates = [origin.coordinates, destination.coordinates]
    unique_segments = list(dict.fromkeys(used_segments))
    return {
        "distance_m": distance_m,
        "total_cost": costs[target],
        "nodes": route_nodes,
        "segments": unique_segments,
        "traversals": traversals,
        "coordinates": route_coordinates,
    }
