from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_db, require_permission
from app.models.user import AuditLog, User

router = APIRouter(tags=["audit"])


@router.get("")
def list_audit_logs(
    action: str | None = Query(default=None, max_length=100),
    user_id: int | None = Query(default=None, gt=0),
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    context: dict = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
):
    query = (
        db.query(AuditLog, User.username)
        .outerjoin(User, User.id == AuditLog.user_id)
        .filter(AuditLog.farm_id == context["farm_id"])
    )
    if action:
        query = query.filter(AuditLog.action == action)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if since:
        query = query.filter(AuditLog.created_at >= since)
    if until:
        query = query.filter(AuditLog.created_at <= until)
    rows = query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit).all()
    return {
        "success": True,
        "data": [
            {
                "id": entry.id,
                "user_id": entry.user_id,
                "username": username,
                "farm_id": entry.farm_id,
                "action": entry.action,
                "resource": entry.resource,
                "resource_id": entry.resource_id,
                "result": entry.result,
                "ip_address": entry.ip_address,
                "details": entry.details,
                "created_at": entry.created_at,
            }
            for entry, username in rows
        ],
    }
