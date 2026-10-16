import pytest
from pydantic import ValidationError

from app.config import Settings


def test_production_settings_reject_default_credentials():
    with pytest.raises(ValidationError, match="Unsafe production credentials"):
        Settings(_env_file=None, API_ENV="production")


def test_production_settings_accept_strong_credentials():
    settings = Settings(
        _env_file=None,
        API_ENV="production",
        SECRET_KEY="s" * 32,
        JWT_SECRET="j" * 32,
        DEFAULT_ADMIN_PASSWORD="A-new-admin-password",
    )

    assert settings.api_env == "production"


def test_production_settings_reject_short_secrets():
    with pytest.raises(ValidationError, match="secret_key"):
        Settings(
            _env_file=None,
            API_ENV="production",
            SECRET_KEY="s" * 31,
            JWT_SECRET="j" * 32,
            DEFAULT_ADMIN_PASSWORD="A-new-admin-password",
        )


def test_development_settings_keep_development_defaults():
    settings = Settings(_env_file=None, API_ENV="development")

    assert settings.secret_key == "change-me"
    assert settings.jwt_secret == "change-me"
    assert settings.default_admin_password == "Admin@123"
