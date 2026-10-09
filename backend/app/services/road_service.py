from app.repositories.road_repository import RoadRepository


class RoadService:
    def __init__(self, repository=None):
        self.repository = repository or RoadRepository()

    def create_road(self, payload, farm_id: int):
        return self.repository.create(payload, farm_id)

    def list_roads(self, farm_id: int):
        return self.repository.list_all(farm_id)

    def get_road(self, road_id: int, farm_id: int):
        return self.repository.get_by_id(road_id, farm_id)