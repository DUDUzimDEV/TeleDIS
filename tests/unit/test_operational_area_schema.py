import pytest
from pydantic import ValidationError

from app.schemas.farm import FarmCreate, FarmUpdate
from app.schemas.operational_area import OperationalAreaWrite, SpatialResourceValidation
from app.services.spatial_validation_service import SpatialValidationError, spatial_validation_service


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


def test_operational_area_accepts_valid_polygon_and_default_radius():
    payload = OperationalAreaWrite(geometry=polygon)

    assert payload.proximity_radius_m == 500
    assert payload.geometry == polygon


def test_farm_create_accepts_optional_operational_area():
    payload = FarmCreate(
        name="Fazenda de Teste",
        code="TEST-FARM",
        operational_area={"geometry": polygon, "proximity_radius_m": 250},
    )

    assert payload.operational_area.geometry == polygon
    assert payload.operational_area.proximity_radius_m == 250
    assert FarmCreate(name="Fazenda de Teste", code="TEST-FARM").operational_area is None


def test_farm_update_distinguishes_omitted_area_from_explicit_removal():
    omitted = FarmUpdate(name="Fazenda Atualizada").dict(exclude_unset=True)
    removed = FarmUpdate(operational_area=None).dict(exclude_unset=True)

    assert "operational_area" not in omitted
    assert "operational_area" in removed
    assert removed["operational_area"] is None


def test_farm_create_rejects_invalid_operational_area():
    with pytest.raises(ValidationError):
        FarmCreate(
            name="Fazenda de Teste",
            code="TEST-FARM",
            operational_area={"geometry": {"type": "Point", "coordinates": [-50.1, -21.1]}},
        )


@pytest.mark.parametrize(
    "geometry",
    [
        {"type": "Point", "coordinates": [-50.1, -21.1]},
        {"type": "Polygon", "coordinates": [[[-50.1, -21.1], [-50.2, -21.2]]]},
        {
            "type": "Polygon",
            "coordinates": [[
                [-50.1, -21.1],
                [-50.2, -21.2],
                [-50.3, -21.3],
                [-50.4, -21.4],
            ]],
        },
        {
            "type": "Polygon",
            "coordinates": [[
                [-50.1, -21.1],
                [-50.2, -21.2],
                [-50.3, -21.3],
                [-50.1, -21.1],
            ]],
            "crs": {"type": "name", "properties": {"name": "EPSG:3857"}},
        },
        {
            "type": "Polygon",
            "coordinates": [[
                [-50.1, -21.1],
                [-50.2, -21.2],
                [-50.3, -21.3],
                [-50.1, float("nan")],
            ]],
        },
    ],
)
def test_operational_area_rejects_invalid_geojson(geometry):
    with pytest.raises(ValidationError):
        OperationalAreaWrite(geometry=geometry)


@pytest.mark.parametrize("radius", [-1, 10001])
def test_operational_area_rejects_out_of_range_radius(radius):
    with pytest.raises(ValidationError):
        OperationalAreaWrite(geometry=polygon, proximity_radius_m=radius)


@pytest.mark.parametrize(
    ("resource_type", "geometry"),
    [
        ("field", polygon),
        ("structure", {"type": "Point", "coordinates": [-50.123, -21.123]}),
        ("road", {"type": "LineString", "coordinates": [[-50.123, -21.123], [-50.122, -21.123]]}),
    ],
)
def test_spatial_resource_validation_accepts_matching_geojson(resource_type, geometry):
    payload = SpatialResourceValidation(resource_type=resource_type, geometry=geometry)

    assert payload.resource_type == resource_type


@pytest.mark.parametrize(
    ("resource_type", "geometry"),
    [
        ("field", {"type": "Point", "coordinates": [-50.123, -21.123]}),
        ("structure", {"type": "LineString", "coordinates": [[-50.1, -21.1], [-50.2, -21.2]]}),
        ("road", {"type": "LineString", "coordinates": [["invalid", -21.1], [-50.2, -21.2]]}),
    ],
)
def test_spatial_resource_validation_rejects_malformed_or_wrong_geometry(resource_type, geometry):
    with pytest.raises(ValidationError):
        SpatialResourceValidation(resource_type=resource_type, geometry=geometry)


class FakeSpatialSession:
    def __init__(self, row):
        self.row = row
        self.parameters = None

    def execute(self, statement, parameters):
        self.parameters = parameters
        return self

    def one_or_none(self):
        return self.row


def spatial_row(*, inside_area=False, within_proximity=False):
    return type(
        "SpatialRow",
        (),
        {
            "configured": True,
            "valid": True,
            "empty": False,
            "geometry_type": "ST_LineString",
            "points_count": 2,
            "inside_area": inside_area,
            "within_proximity": within_proximity,
        },
    )()


def test_road_in_proximity_zone_is_accepted_and_query_is_tenant_scoped():
    db = FakeSpatialSession(spatial_row(within_proximity=True))
    line = {"type": "LineString", "coordinates": [[-50.123, -21.123], [-50.122, -21.123]]}

    result = spatial_validation_service.validate_resource(db, 42, "road", line)

    assert db.parameters["farm_id"] == 42
    assert db.parameters["resource_type"] == "road"
    assert result["location_scope"] == "WITHIN_PROXIMITY_ZONE"


def test_road_outside_proximity_zone_is_rejected():
    db = FakeSpatialSession(spatial_row())
    line = {"type": "LineString", "coordinates": [[-50.123, -21.123], [-50.122, -21.123]]}

    with pytest.raises(SpatialValidationError) as error:
        spatial_validation_service.validate_resource(db, 42, "road", line)

    assert error.value.code == "OUTSIDE_PROXIMITY_ZONE"


def test_fields_are_not_allowed_outside_area_even_when_nearby():
    db = FakeSpatialSession(
        type(
            "SpatialRow",
            (),
            {
                "configured": True,
                "valid": True,
                "empty": False,
                "geometry_type": "ST_Polygon",
                "points_count": 5,
                "inside_area": False,
                "within_proximity": True,
            },
        )()
    )
    field = polygon

    with pytest.raises(SpatialValidationError) as error:
        spatial_validation_service.validate_resource(db, 42, "field", field)

    assert error.value.code == "OUTSIDE_OPERATIONAL_AREA"
