from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_machine_list_route():
    response = client.get("/api/v1/machines")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert len(payload["data"]) >= 1
