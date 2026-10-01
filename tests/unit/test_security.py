from app.core.security import create_access_token, get_password_hash, verify_password


def test_hash_and_verify_password():
    password = "Admin@123"
    hashed = get_password_hash(password)
    assert verify_password(password, hashed) is True


def test_generate_token():
    token = create_access_token("admin")
    assert isinstance(token, str)
    assert token


def test_wrong_password_verification():
    password = "Admin@123"
    hashed = get_password_hash(password)
    assert verify_password("OutraSenha@123", hashed) is False
