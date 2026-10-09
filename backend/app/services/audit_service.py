from datetime import datetime, timezone
from ipaddress import ip_address

from app.models.user import AuditLog


def record_audit(
    db,
    *,
    context: dict | None,
    action: str,
    resource: str,
    resource_id: int | str | None = None,
    request=None,
    details: dict | None = None,
) -> None:
    user = context["user"] if context else None
    client_host = request.client.host if request and request.client else None
    try:
        client_ip = str(ip_address(client_host)) if client_host else None
    except ValueError:
        client_ip = None
    db.add(AuditLog(
        user_id=user["id"] if user else None,
        farm_id=context["farm_id"] if context else None,
        action=action,
        resource=resource,
        resource_id=str(resource_id) if resource_id is not None else None,
        result="success",
        ip_address=client_ip,
        details=details or {},
        created_at=datetime.now(timezone.utc),
    ))
