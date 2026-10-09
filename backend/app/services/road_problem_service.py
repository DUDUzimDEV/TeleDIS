from app.repositories.road_problem_repository import RoadProblemRepository


class RoadProblemService:
    def __init__(self, repository=None):
        self.repository = repository or RoadProblemRepository()

    def create_problem(self, payload, farm_id: int):
        return self.repository.create(payload, farm_id)

    def list_problems(self, farm_id: int):
        return self.repository.list_all(farm_id)

    def get_problem(self, problem_id: int, farm_id: int):
        return self.repository.get_by_id(problem_id, farm_id)

    def update_status(self, problem_id: int, farm_id: int, status: str):
        return self.repository.update_status(problem_id, farm_id, status)