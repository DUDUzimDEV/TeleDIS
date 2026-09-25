class TelemetryRepository:
    def list_recent(self, machine_id: int | None = None):
        if machine_id:
            return [{"maquina_id": machine_id, "valor": 87.5}]
        return [{"maquina_id": 1, "valor": 87.5}, {"maquina_id": 2, "valor": 72.1}]
