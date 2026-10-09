from app.repositories.route_network_repository import RouteNetworkRepository


class RouteNetworkService:
    def __init__(self, repository=None):
        self.repository = repository or RouteNetworkRepository()

    def rebuild(self, farm_id: int):
        return self.repository.rebuild(farm_id)

    def list_nodes(self, farm_id: int):
        return self.repository.list_nodes(farm_id)

    def list_segments(self, farm_id: int):
        return self.repository.load_graph(farm_id)
