from app.config import get_settings
from app.repositories.route_network_repository import RouteNetworkRepository
from app.services.route_algorithm import RouteSnap, find_route


class RouteRequestError(ValueError):
    pass


class NoRoadNetwork(RouteRequestError):
    message = "Não existem estradas disponíveis."


class OriginTooFar(RouteRequestError):
    message = "A origem está muito distante da rede viária."


class DestinationTooFar(RouteRequestError):
    message = "O destino está muito distante da rede viária."


class RouteNotFound(RouteRequestError):
    message = "Não existe rota disponível entre origem e destino."


class MachineNotFound(RouteRequestError):
    message = "Máquina não encontrada."


class MachineLocationNotFound(RouteRequestError):
    message = "A máquina ainda não possui uma localização GPS registrada."


class StructureNotFound(RouteRequestError):
    message = "Estrutura não encontrada."


class RouteService:
    def __init__(self, repository=None):
        self.repository = repository or RouteNetworkRepository()

    def calculate(self, origin: dict, destination: dict, farm_id: int):
        if not self.repository.network_has_roads(farm_id):
            raise NoRoadNetwork
        segments = self.repository.load_graph(farm_id)
        if not segments:
            raise NoRoadNetwork

        settings = get_settings()
        origin_data = self.repository.nearest_segment(
            origin["latitude"],
            origin["longitude"],
            settings.route_snap_max_distance_m,
            farm_id,
        )
        if origin_data is None:
            raise OriginTooFar
        destination_data = self.repository.nearest_segment(
            destination["latitude"],
            destination["longitude"],
            settings.route_snap_max_distance_m,
            farm_id,
        )
        if destination_data is None:
            raise DestinationTooFar

        origin_snap = RouteSnap(**origin_data)
        destination_snap = RouteSnap(**destination_data)
        calculated = find_route(segments, origin_snap, destination_snap)
        if calculated is None:
            raise RouteNotFound

        segments_by_id = {segment["id"]: segment for segment in segments}
        route_problems = []
        affected_segments = []
        for segment_id in calculated["segments"]:
            segment = segments_by_id[segment_id]
            if segment["problems"]:
                affected_segments.append(segment_id)
                route_problems.extend(segment["problems"])

        unique_problems = list({problem["id"]: problem for problem in route_problems}.values())
        blocked_segments = [segment["id"] for segment in segments if segment["is_blocked"]]
        route_geometry = {
            "type": "Feature",
            "properties": {
                "distance_m": calculated["distance_m"],
                "total_cost": calculated["total_cost"],
                "segments": calculated["segments"],
            },
            "geometry": {
                "type": "LineString",
                "coordinates": calculated["coordinates"],
            },
        }
        return {
            "found": True,
            "distance_m": calculated["distance_m"],
            "total_cost": calculated["total_cost"],
            "nodes": calculated["nodes"],
            "segments": calculated["segments"],
            "affected_segments": affected_segments,
            "blocked_segments": blocked_segments,
            "problems": unique_problems,
            "origin": {
                "latitude": origin_snap.coordinates[1],
                "longitude": origin_snap.coordinates[0],
            },
            "destination": {
                "latitude": destination_snap.coordinates[1],
                "longitude": destination_snap.coordinates[0],
            },
            "route": route_geometry,
        }

    def calculate_machine_to_structure(self, machine_id: int, structure_id: int, farm_id: int):
        machine_status, machine_location = self.repository.get_machine_location(machine_id, farm_id)
        if machine_status == "machine_not_found":
            raise MachineNotFound
        if machine_status == "location_not_found":
            raise MachineLocationNotFound
        structure_location = self.repository.get_structure_location(structure_id, farm_id)
        if structure_location is None:
            raise StructureNotFound
        return self.calculate(machine_location, structure_location, farm_id)
