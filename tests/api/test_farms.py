from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.api.v1.endpoints import farms
from app.main import app
from app.models.user import Farm
from app.services.spatial_validation_service import SpatialValidationError, spatial_validation_service

client = TestClient(app)

polygon = {
    "type": "Polygon",
    "coordinates": [[
        [-50.123, -21.123],
        [-50.122, -21.123],
        [-50.122, -21.124],
        [-50.123, -21.124],
        [-50.123, -21.123],
    ]],
}


class FakeTransaction:
    def __init__(self, db):
        self.db = db
        self.committed = False
        self.rolled_back = False

    def __enter__(self):
        return self.db

    def __exit__(self, exc_type, exc, traceback):
        self.rolled_back = exc_type is not None
        self.committed = exc_type is None
        return False


class FakeFarmQuery:
    def filter(self, *_args):
        return self

    def one(self):
        return SimpleNamespace(id=1)


class FakeFarmSession:
    def __init__(self):
        self.added = []

    def query(self, _model):
        return FakeFarmQuery()

    def add(self, item):
        self.added.append(item)

    def flush(self):
        for item in self.added:
            if isinstance(item, Farm) and item.id is None:
                item.id = 52


def install_fake_transaction(monkeypatch):
    db = FakeFarmSession()
    transaction = FakeTransaction(db)
    monkeypatch.setattr(farms, "SessionLocal", SimpleNamespace(begin=lambda: transaction))
    monkeypatch.setattr(farms, "record_audit", lambda *args, **kwargs: None)
    return db, transaction


def test_create_farm_with_operational_area_is_one_transaction(monkeypatch):
    db, transaction = install_fake_transaction(monkeypatch)
    saved = {}

    def save_area(db_session, farm_id, geometry, radius):
        saved.update(db=db_session, farm_id=farm_id, geometry=geometry, radius=radius)

    monkeypatch.setattr(spatial_validation_service, "save_area_in_session", save_area)

    response = client.post(
        "/api/v1/farms",
        json={
            "name": "Fazenda de Teste",
            "code": "TEST-FARM",
            "operational_area": {"geometry": polygon, "proximity_radius_m": 350},
        },
    )

    assert response.status_code == 201
    assert response.json()["data"]["operational_area_configured"] is True
    assert response.json()["data"]["proximity_radius_m"] == 350
    assert saved == {
        "db": db,
        "farm_id": 52,
        "geometry": polygon,
        "radius": 350,
    }
    assert transaction.committed
    assert not transaction.rolled_back


def test_create_farm_rolls_back_when_operational_area_is_rejected(monkeypatch):
    _db, transaction = install_fake_transaction(monkeypatch)

    def reject_area(*_args):
        raise SpatialValidationError("INVALID_OPERATIONAL_AREA", "Polígono inválido.")

    monkeypatch.setattr(spatial_validation_service, "save_area_in_session", reject_area)

    response = client.post(
        "/api/v1/farms",
        json={
            "name": "Fazenda de Teste",
            "code": "TEST-FARM",
            "operational_area": {"geometry": polygon, "proximity_radius_m": 350},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_OPERATIONAL_AREA"
    assert transaction.rolled_back
    assert not transaction.committed


def test_farm_update_persists_area_with_farm_data_in_one_transaction(monkeypatch):
    db, transaction = install_fake_transaction(monkeypatch)
    farm = Farm(
        id=1,
        name="Fazenda Original",
        code="TEST-FARM",
        status="active",
        created_at=None,
        updated_at=None,
    )
    db.get = lambda model, farm_id: farm if model is Farm and farm_id == 1 else None
    saved = {}

    def save_area(db_session, farm_id, geometry, radius):
        saved.update(db=db_session, farm_id=farm_id, geometry=geometry, radius=radius)

    monkeypatch.setattr(spatial_validation_service, "save_area_in_session", save_area)

    response = client.patch(
        "/api/v1/farms/1",
        json={
            "name": "Fazenda Atualizada",
            "operational_area": {"geometry": polygon, "proximity_radius_m": 250},
        },
    )

    assert response.status_code == 200
    assert farm.name == "Fazenda Atualizada"
    assert saved == {
        "db": db,
        "farm_id": 1,
        "geometry": polygon,
        "radius": 250,
    }
    assert transaction.committed


def test_farm_update_explicit_null_removes_area_inside_transaction(monkeypatch):
    _db, transaction = install_fake_transaction(monkeypatch)
    farm = Farm(
        id=1,
        name="Fazenda Original",
        code="TEST-FARM",
        status="active",
        created_at=None,
        updated_at=None,
    )
    _db.get = lambda model, farm_id: farm if model is Farm and farm_id == 1 else None
    deleted = []
    monkeypatch.setattr(
        spatial_validation_service,
        "delete_area_in_session",
        lambda db_session, farm_id: deleted.append((db_session, farm_id)),
    )

    response = client.patch("/api/v1/farms/1", json={"operational_area": None})

    assert response.status_code == 200
    assert deleted == [(_db, 1)]
    assert transaction.committed
