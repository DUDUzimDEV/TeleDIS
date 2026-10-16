from types import SimpleNamespace

import pytest

from app.services.spatial_validation_service import (
    SpatialValidationError,
    SpatialValidationService,
)


class FakeResult:
    def __init__(self, row):
        self.row = row

    def one_or_none(self):
        return self.row


class FakeDatabase:
    def __init__(self, row):
        self.row = row
        self.statement = None
        self.parameters = None

    def execute(self, statement, parameters):
        self.statement = str(statement)
        self.parameters = parameters
        return FakeResult(self.row)


def test_simulated_location_uses_configured_area_and_proximity_radius():
    db = FakeDatabase(SimpleNamespace(
        configured=True,
        valid_area=True,
        inside_area=False,
        within_proximity=True,
    ))

    result = SpatialValidationService.validate_simulated_location(
        db, farm_id=42, latitude=-23.5, longitude=-47.4
    )

    assert result == {"valid": True, "location_scope": "WITHIN_PROXIMITY_ZONE"}
    assert "ST_Buffer" in db.statement
    assert "::geography" in db.statement
    assert "ST_Covers" in db.statement
    assert db.parameters == {"farm_id": 42, "latitude": -23.5, "longitude": -47.4}


def test_simulated_location_inside_area_is_accepted():
    db = FakeDatabase(SimpleNamespace(
        configured=True,
        valid_area=True,
        inside_area=True,
        within_proximity=True,
    ))

    result = SpatialValidationService.validate_simulated_location(
        db, farm_id=42, latitude=-23.5, longitude=-47.4
    )

    assert result["location_scope"] == "INSIDE_OPERATIONAL_AREA"


def test_simulated_location_requires_configured_operational_area():
    db = FakeDatabase(SimpleNamespace(
        configured=False,
        valid_area=False,
        inside_area=False,
        within_proximity=False,
    ))

    with pytest.raises(SpatialValidationError, match="ainda não foi configurada") as error:
        SpatialValidationService.validate_simulated_location(
            db, farm_id=42, latitude=-23.5, longitude=-47.4
        )

    assert error.value.code == "OPERATIONAL_AREA_NOT_CONFIGURED"


def test_simulated_location_rejects_invalid_area_and_out_of_bounds_point():
    invalid_area = FakeDatabase(SimpleNamespace(
        configured=True,
        valid_area=False,
        inside_area=False,
        within_proximity=False,
    ))
    outside_area = FakeDatabase(SimpleNamespace(
        configured=True,
        valid_area=True,
        inside_area=False,
        within_proximity=False,
    ))

    with pytest.raises(SpatialValidationError) as area_error:
        SpatialValidationService.validate_simulated_location(
            invalid_area, farm_id=42, latitude=-23.5, longitude=-47.4
        )
    with pytest.raises(SpatialValidationError) as location_error:
        SpatialValidationService.validate_simulated_location(
            outside_area, farm_id=42, latitude=-23.5, longitude=-47.4
        )

    assert area_error.value.code == "INVALID_OPERATIONAL_AREA"
    assert location_error.value.code == "OUTSIDE_OPERATIONAL_AREA"
