from fastapi.testclient import TestClient

from app.main import app
from app.services.auth_service import AuthService

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_login_endpoint(monkeypatch):
    payload = {"username": "admin", "password": "Admin@123"}
    monkeypatch.setattr(AuthService, "authenticate_session", lambda self, identifier, password: {
        "access_token": "test-token",
        "token_type": "bearer",
        "user": {"username": identifier, "role": "OWNER"},
        "farms": [{"id": 1, "name": "Test Farm", "role": "OWNER"}],
    })
    response = client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["username"] == "admin"


def test_login_wrong_password(monkeypatch):
    def reject_credentials(self, identifier, password):
        raise ValueError("Credenciais inválidas")

    monkeypatch.setattr(AuthService, "authenticate_session", reject_credentials)
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "SenhaErrada@123"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Credenciais inválidas"


def test_login_wrong_user(monkeypatch):
    def reject_credentials(self, identifier, password):
        raise ValueError("Credenciais inválidas")

    monkeypatch.setattr(AuthService, "authenticate_session", reject_credentials)
    response = client.post("/api/v1/auth/login", json={"username": "usuario_inexistente", "password": "Admin@123"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Credenciais inválidas"


def test_login_missing_fields():
    response = client.post("/api/v1/auth/login", json={"username": "admin"})
    assert response.status_code == 422

    response = client.post("/api/v1/auth/login", json={"password": "Admin@123"})
    assert response.status_code == 422


def test_openapi_has_bearer_security_scheme():
    schema = app.openapi()
    security_schemes = schema["components"]["securitySchemes"]
    assert "BearerAuth" in security_schemes
    assert security_schemes["BearerAuth"]["type"] == "http"
    assert security_schemes["BearerAuth"]["scheme"] == "bearer"
