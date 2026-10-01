from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_login_endpoint():
    payload = {"username": "admin", "password": "Admin@123"}
    response = client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["username"] == "admin"


def test_login_wrong_password():
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "SenhaErrada@123"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Credenciais inválidas"


def test_login_wrong_user():
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
