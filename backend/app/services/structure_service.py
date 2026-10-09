from app.repositories.structure_repository import StructureRepository


class StructureService:
    def __init__(self, repository=None):
        self.repository = repository or StructureRepository()

    def create_structure(self, payload, farm_id: int):
        return self.repository.create(payload, farm_id)

    def list_structures(self, farm_id: int):
        return self.repository.list_all(farm_id)

    def get_structure(self, structure_id: int, farm_id: int):
        return self.repository.get_by_id(structure_id, farm_id)