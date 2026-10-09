from app.repositories.field_repository import FieldRepository


class FieldService:
    def __init__(self, repository=None):
        self.repository = repository or FieldRepository()

    def create_field(self, payload, farm_id: int):
        return self.repository.create(payload, farm_id)

    def list_fields(self, farm_id: int):
        return self.repository.list_all(farm_id)

    def get_field(self, field_id: int, farm_id: int):
        return self.repository.get_by_id(field_id, farm_id)