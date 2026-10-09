from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from app.core.security import require_permission
from app.schemas.operations import MachineAssignmentCreate, TeamCreate, TeamMemberCreate, TeamUpdate
from app.services.operations_service import OperationalService

router = APIRouter(tags=["teams"])
service = OperationalService()


@router.get("")
def list_teams(context: dict = Depends(require_permission("teams.view"))):
    supervisor_id = context["user"]["id"] if context["role"] == "SUPERVISOR" else None
    return {"success": True, "data": service.list_teams(
        context["farm_id"], supervisor_id=supervisor_id
    )}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_team(payload: TeamCreate, request: Request,
                context: dict = Depends(require_permission("teams.manage"))):
    try:
        return {"success": True, "data": service.create_team(context, payload.dict(), request)}
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="O código da equipe já está cadastrado.") from exc


@router.get("/{team_id}")
def get_team(team_id: int, context: dict = Depends(require_permission("teams.view"))):
    supervisor_id = context["user"]["id"] if context["role"] == "SUPERVISOR" else None
    team = service.get_team(context["farm_id"], team_id, supervisor_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Equipe não encontrada.")
    return {"success": True, "data": team}


@router.patch("/{team_id}")
def update_team(team_id: int, payload: TeamUpdate,
                request: Request,
                context: dict = Depends(require_permission("teams.manage"))):
    try:
        return {"success": True, "data": service.update_team(
            context, team_id, payload.dict(exclude_unset=True), request
        )}
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="A equipe não pôde ser atualizada.") from exc


@router.get("/{team_id}/members")
def list_team_members(team_id: int, context: dict = Depends(require_permission("teams.view"))):
    supervisor_id = context["user"]["id"] if context["role"] == "SUPERVISOR" else None
    return {"success": True, "data": service.list_team_members(
        context["farm_id"], team_id, supervisor_id
    )}


@router.get("/{team_id}/member-candidates")
def list_team_member_candidates(
    team_id: int,
    team_role: str,
    context: dict = Depends(require_permission("teams.manage")),
):
    if team_role not in {"OPERATOR", "SUPERVISOR", "TECHNICIAN"}:
        raise HTTPException(status_code=422, detail="Perfil de membro inválido.")
    return {"success": True, "data": service.list_team_member_candidates(
        context["farm_id"], team_id, team_role
    )}


@router.post("/{team_id}/members", status_code=status.HTTP_201_CREATED)
def add_team_member(team_id: int, payload: TeamMemberCreate, request: Request,
                    context: dict = Depends(require_permission("teams.manage"))):
    return {"success": True, "data": service.add_team_member(
        context, team_id, payload.user_id, payload.team_role, request
    )}


@router.delete("/{team_id}/members/{user_id}")
def remove_team_member(team_id: int, user_id: int, request: Request,
                       context: dict = Depends(require_permission("teams.manage"))):
    return service.remove_team_member(context, team_id, user_id, request)


@router.get("/{team_id}/machines")
def list_team_machine_assignments(team_id: int,
                                  context: dict = Depends(require_permission("teams.view"))):
    supervisor_id = context["user"]["id"] if context["role"] == "SUPERVISOR" else None
    assignments = service.list_team_machine_assignments(
        context["farm_id"], team_id, supervisor_id
    )
    return {"success": True, "data": assignments}


@router.post("/{team_id}/machines/{machine_id}/assignments", status_code=status.HTTP_201_CREATED)
def assign_team_machine(team_id: int, machine_id: int, payload: MachineAssignmentCreate,
                        request: Request,
                        context: dict = Depends(require_permission("teams.manage"))):
    data = payload.dict()
    data["team_id"] = team_id
    try:
        return {"success": True, "data": service.assign_machine(context, machine_id, data, request)}
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="A máquina já possui uma atribuição ativa.") from exc
