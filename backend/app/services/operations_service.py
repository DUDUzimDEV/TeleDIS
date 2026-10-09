from datetime import datetime, timezone
import json
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, aliased

from app.config import get_settings
from app.database import SessionLocal
from app.models.field import Field
from app.models.machine import Machine
from app.models.operations import (
    MachineAssignment,
    Operation,
    OperationOccurrence,
    OperationRouteHistory,
    OperationStatusHistory,
    Team,
    TeamMember,
)
from app.models.telemetry import MachineLocation, RouteLocation, RoutePlan
from app.models.user import Role, User, UserFarm
from app.repositories.route_network_repository import RouteNetworkRepository
from app.services.audit_service import record_audit
from app.services.route_service import (
    RouteRequestError,
    RouteService,
)


STATUSES = {
    "PLANEJADA", "ATRIBUIDA", "ACEITA", "EM_EXECUCAO",
    "INTERROMPIDA", "CONCLUIDA", "CANCELADA",
}
ACTIVE_STATUSES = {"ATRIBUIDA", "ACEITA", "EM_EXECUCAO", "INTERROMPIDA"}
ALLOWED_TRANSITIONS = {
    "ATRIBUIDA": {"PLANEJADA"},
    "ACEITA": {"ATRIBUIDA"},
    "EM_EXECUCAO": {"ACEITA", "INTERROMPIDA"},
    "INTERROMPIDA": {"EM_EXECUCAO"},
    "CONCLUIDA": {"EM_EXECUCAO"},
    "CANCELADA": {"PLANEJADA", "ATRIBUIDA", "ACEITA", "INTERROMPIDA"},
}


class OperationalService:
    def __init__(self, route_service=None, route_repository=None):
        self.route_service = route_service or RouteService()
        self.route_repository = route_repository or RouteNetworkRepository()

    @staticmethod
    def _require(condition: bool, status_code: int, message: str):
        if not condition:
            raise HTTPException(status_code=status_code, detail=message)

    @staticmethod
    def _farm_user(db: Session, user_id: int, farm_id: int, allowed_roles=None):
        row = (
            db.query(UserFarm, Role)
            .join(Role, Role.id == UserFarm.role_id)
            .filter(
                UserFarm.user_id == user_id,
                UserFarm.farm_id == farm_id,
                UserFarm.status == "active",
            )
            .one_or_none()
        )
        if row is None or (allowed_roles and row[1].name not in allowed_roles):
            return None
        return row[0], row[1]

    @staticmethod
    def _close_machine_assignments(
        db: Session, farm_id: int, now: datetime, *,
        machine_id: int | None = None, user_id: int | None = None,
    ):
        query = db.query(MachineAssignment).filter(
            MachineAssignment.farm_id == farm_id,
            MachineAssignment.is_active.is_(True),
        )
        if machine_id is not None and user_id is not None:
            query = query.filter(
                or_(MachineAssignment.machine_id == machine_id,
                    MachineAssignment.user_id == user_id)
            )
        elif machine_id is not None:
            query = query.filter(MachineAssignment.machine_id == machine_id)
        elif user_id is not None:
            query = query.filter(MachineAssignment.user_id == user_id)
        assignments = query.with_for_update().all()
        for assignment in assignments:
            if assignment.user_id is not None:
                membership = db.get(UserFarm, (assignment.user_id, farm_id))
                if membership is not None and membership.assigned_machine_id == assignment.machine_id:
                    membership.assigned_machine_id = None
            assignment.is_active = False
            assignment.assigned_until = now
        if machine_id is not None:
            db.query(UserFarm).filter(
                UserFarm.farm_id == farm_id,
                UserFarm.assigned_machine_id == machine_id,
            ).update({"assigned_machine_id": None}, synchronize_session="fetch")
        return assignments

    @staticmethod
    def _team_read(db: Session, team: Team):
        supervisor = db.get(User, team.supervisor_id) if team.supervisor_id else None
        member_count = (
            db.query(func.count(TeamMember.user_id))
            .filter(TeamMember.team_id == team.id, TeamMember.is_active.is_(True))
            .scalar()
        )
        return {
            "id": team.id,
            "farm_id": team.farm_id,
            "name": team.name,
            "code": team.code,
            "description": team.description,
            "supervisor_id": team.supervisor_id,
            "supervisor_name": supervisor.full_name or supervisor.username if supervisor else None,
            "is_active": team.is_active,
            "member_count": member_count,
            "created_at": team.created_at,
            "updated_at": team.updated_at,
        }

    def list_teams(self, farm_id: int, active_only=True, supervisor_id: int | None = None):
        with SessionLocal() as db:
            query = db.query(Team).filter(Team.farm_id == farm_id)
            if active_only:
                query = query.filter(Team.is_active.is_(True))
            if supervisor_id is not None:
                query = query.filter(Team.supervisor_id == supervisor_id)
            return [self._team_read(db, team) for team in query.order_by(Team.name).all()]

    def get_team(self, farm_id: int, team_id: int, supervisor_id: int | None = None):
        with SessionLocal() as db:
            team = db.query(Team).filter(Team.id == team_id, Team.farm_id == farm_id).one_or_none()
            if team is not None and supervisor_id is not None and team.supervisor_id != supervisor_id:
                return None
            return self._team_read(db, team) if team else None

    def create_team(self, context: dict, payload: dict, request=None):
        with SessionLocal.begin() as db:
            supervisor_id = payload.get("supervisor_id")
            if supervisor_id is not None:
                self._require(
                    self._farm_user(
                        db, supervisor_id, context["farm_id"],
                        {"SUPERVISOR", "COORDINATOR", "FARM_ADMIN", "OWNER"},
                    ) is not None,
                    404,
                    "Supervisor não encontrado nesta fazenda.",
                )
            team = Team(
                farm_id=context["farm_id"],
                name=payload["name"].strip(),
                code=payload["code"].strip(),
                description=payload.get("description"),
                supervisor_id=supervisor_id,
                is_active=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(team)
            db.flush()
            if supervisor_id is not None:
                db.add(TeamMember(
                    team_id=team.id, farm_id=team.farm_id, user_id=supervisor_id,
                    team_role="SUPERVISOR", is_active=True, created_at=datetime.now(timezone.utc),
                ))
            record_audit(db, context=context, action="teams.create", resource="team",
                         resource_id=team.id, request=request)
            return self._team_read(db, team)

    def update_team(self, context: dict, team_id: int, changes: dict, request=None):
        with SessionLocal.begin() as db:
            team = db.query(Team).filter(
                Team.id == team_id, Team.farm_id == context["farm_id"]
            ).with_for_update().one_or_none()
            self._require(team is not None, 404, "Equipe não encontrada.")
            if "supervisor_id" in changes and changes["supervisor_id"] is not None:
                self._require(
                    self._farm_user(
                        db, changes["supervisor_id"], context["farm_id"],
                        {"SUPERVISOR", "COORDINATOR", "FARM_ADMIN", "OWNER"},
                    ) is not None,
                    404,
                    "Supervisor não encontrado nesta fazenda.",
                )
            for key, value in changes.items():
                if key == "name" and value is not None:
                    value = value.strip()
                setattr(team, key, value)
            team.updated_at = datetime.now(timezone.utc)
            if "supervisor_id" in changes:
                old_membership = db.query(TeamMember).filter(
                    TeamMember.team_id == team.id,
                    TeamMember.farm_id == team.farm_id,
                    TeamMember.team_role == "SUPERVISOR",
                    TeamMember.is_active.is_(True),
                )
                old_membership.update({"is_active": False}, synchronize_session=False)
                if team.supervisor_id is not None:
                    db.merge(TeamMember(
                        team_id=team.id, farm_id=team.farm_id, user_id=team.supervisor_id,
                        team_role="SUPERVISOR", is_active=True, created_at=datetime.now(timezone.utc),
                    ))
            record_audit(db, context=context, action="teams.update", resource="team",
                         resource_id=team.id, request=request, details={"fields": sorted(changes)})
            db.flush()
            return self._team_read(db, team)

    def list_team_members(self, farm_id: int, team_id: int, supervisor_id: int | None = None):
        with SessionLocal() as db:
            team = db.query(Team).filter(Team.id == team_id, Team.farm_id == farm_id).one_or_none()
            self._require(team is not None, 404, "Equipe não encontrada.")
            if supervisor_id is not None:
                self._require(team.supervisor_id == supervisor_id, 404, "Equipe não encontrada.")
            rows = (
                db.query(TeamMember, User)
                .join(User, User.id == TeamMember.user_id)
                .filter(TeamMember.team_id == team_id, TeamMember.farm_id == farm_id)
                .order_by(TeamMember.is_active.desc(), User.full_name, User.username)
                .all()
            )
            return [{
                "user_id": member.user_id,
                "full_name": user.full_name,
                "username": user.username,
                "email": user.email,
                "team_role": member.team_role,
                "is_active": member.is_active,
                "created_at": member.created_at,
            } for member, user in rows]

    def list_team_member_candidates(self, farm_id: int, team_id: int, team_role: str):
        role_names = {
            "OPERATOR": {"OPERATOR"},
            "SUPERVISOR": {"SUPERVISOR", "COORDINATOR", "FARM_ADMIN", "OWNER"},
            "TECHNICIAN": {"TECHNICIAN"},
        }
        with SessionLocal() as db:
            team = db.query(Team).filter(
                Team.id == team_id, Team.farm_id == farm_id, Team.is_active.is_(True)
            ).one_or_none()
            self._require(team is not None, 404, "Equipe não encontrada.")
            rows = (
                db.query(User, Role)
                .join(UserFarm, UserFarm.user_id == User.id)
                .join(Role, Role.id == UserFarm.role_id)
                .filter(
                    UserFarm.farm_id == farm_id,
                    UserFarm.status == "active",
                    User.is_active.is_(True),
                    Role.name.in_(role_names[team_role]),
                    ~db.query(TeamMember.user_id).filter(
                        TeamMember.team_id == team_id,
                        TeamMember.farm_id == farm_id,
                        TeamMember.user_id == User.id,
                        TeamMember.is_active.is_(True),
                    ).exists(),
                )
                .order_by(User.full_name, User.username)
                .all()
            )
            return [{
                "id": user.id,
                "full_name": user.full_name,
                "username": user.username,
                "role": role.name,
                "status": "active",
            } for user, role in rows]

    def add_team_member(
        self, context: dict, team_id: int, user_id: int, team_role: str, request=None
    ):
        role_names = {
            "OPERATOR": {"OPERATOR"},
            "SUPERVISOR": {"SUPERVISOR", "COORDINATOR", "FARM_ADMIN", "OWNER"},
            "TECHNICIAN": {"TECHNICIAN"},
        }
        with SessionLocal.begin() as db:
            team = db.query(Team).filter(
                Team.id == team_id, Team.farm_id == context["farm_id"], Team.is_active.is_(True)
            ).one_or_none()
            self._require(team is not None, 404, "Equipe não encontrada.")
            self._require(
                self._farm_user(db, user_id, context["farm_id"], role_names[team_role]) is not None,
                404,
                "Usuário com o perfil solicitado não encontrado nesta fazenda.",
            )
            member = db.get(TeamMember, (team_id, user_id))
            if member is None:
                member = TeamMember(
                    team_id=team_id, farm_id=context["farm_id"], user_id=user_id,
                    team_role=team_role, is_active=True, created_at=datetime.now(timezone.utc),
                )
                db.add(member)
            else:
                member.team_role = team_role
                member.is_active = True
            if team_role == "SUPERVISOR":
                team.supervisor_id = user_id
                team.updated_at = datetime.now(timezone.utc)
            record_audit(db, context=context, action="teams.member.add", resource="team",
                         resource_id=team_id, request=request,
                         details={"user_id": user_id, "team_role": team_role})
            db.flush()
            return {"user_id": user_id, "team_role": team_role, "is_active": True}

    def remove_team_member(self, context: dict, team_id: int, user_id: int, request=None):
        with SessionLocal.begin() as db:
            member = db.query(TeamMember).filter(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user_id,
                TeamMember.farm_id == context["farm_id"],
                TeamMember.is_active.is_(True),
            ).with_for_update().one_or_none()
            self._require(member is not None, 404, "Membro ativo não encontrado nesta equipe.")
            member.is_active = False
            team = db.query(Team).filter(
                Team.id == team_id, Team.farm_id == context["farm_id"]
            ).one()
            if team.supervisor_id == user_id:
                team.supervisor_id = None
            record_audit(db, context=context, action="teams.member.remove", resource="team",
                         resource_id=team_id, request=request, details={"user_id": user_id})
            return {"success": True}

    def list_team_machine_assignments(
        self, farm_id: int, team_id: int, supervisor_id: int | None = None
    ):
        with SessionLocal() as db:
            team = db.query(Team).filter(
                Team.id == team_id, Team.farm_id == farm_id
            ).one_or_none()
            self._require(team is not None, 404, "Equipe não encontrada.")
            if supervisor_id is not None:
                self._require(team.supervisor_id == supervisor_id, 404, "Equipe não encontrada.")
            rows = (
                db.query(MachineAssignment, Machine, User)
                .join(Machine, (Machine.id == MachineAssignment.machine_id)
                      & (Machine.farm_id == MachineAssignment.farm_id))
                .outerjoin(User, User.id == MachineAssignment.user_id)
                .filter(
                    MachineAssignment.team_id == team_id,
                    MachineAssignment.farm_id == farm_id,
                )
                .order_by(MachineAssignment.assigned_from.desc())
                .all()
            )
            return [{
                "id": assignment.id, "machine_id": machine.id, "machine_name": machine.name,
                "operator_id": assignment.user_id,
                "operator_name": (
                    user.full_name or user.username if user else None
                ),
                "assigned_from": assignment.assigned_from,
                "assigned_until": assignment.assigned_until,
                "is_active": assignment.is_active,
            } for assignment, machine, user in rows]

    def assign_machine(self, context: dict, machine_id: int, payload: dict, request=None):
        farm_id = context["farm_id"]
        operator_id = payload.get("operator_id")
        team_id = payload.get("team_id")
        with SessionLocal.begin() as db:
            machine = db.query(Machine).filter(
                Machine.id == machine_id, Machine.farm_id == farm_id
            ).with_for_update().one_or_none()
            self._require(machine is not None, 404, "Máquina não encontrada nesta fazenda.")
            self._require(machine.status.lower() not in {"maintenance", "manutencao", "indisponivel", "parada"},
                          409, "A máquina não está disponível para uma operação.")
            if operator_id is not None:
                operator_membership = self._farm_user(db, operator_id, farm_id, {"OPERATOR"})
                self._require(operator_membership is not None, 404,
                              "Operador não encontrado nesta fazenda.")
                db.query(UserFarm).filter(
                    UserFarm.user_id == operator_id, UserFarm.farm_id == farm_id
                ).with_for_update().one()
                active_operation = db.query(Operation.id).filter(
                    Operation.farm_id == farm_id,
                    Operation.operator_id == operator_id,
                    Operation.status.in_(ACTIVE_STATUSES),
                ).first()
                self._require(active_operation is None, 409,
                              "O operador já está vinculado a uma operação ativa.")
            if team_id is not None:
                team = db.query(Team).filter(
                    Team.id == team_id, Team.farm_id == farm_id, Team.is_active.is_(True)
                ).one_or_none()
                self._require(team is not None, 404, "Equipe não encontrada nesta fazenda.")
                if context["role"] == "SUPERVISOR":
                    self._require(team.supervisor_id == context["user"]["id"], 403,
                                  "Supervisores só podem atribuir operações às próprias equipes.")
                if operator_id is not None:
                    self._require(
                        db.query(TeamMember).filter(
                            TeamMember.team_id == team_id,
                            TeamMember.user_id == operator_id,
                            TeamMember.farm_id == farm_id,
                            TeamMember.team_role == "OPERATOR",
                            TeamMember.is_active.is_(True),
                        ).count() == 1,
                        422,
                        "O operador não é membro ativo da equipe selecionada.",
                    )
            now = datetime.now(timezone.utc)
            active_operation = db.query(Operation.id).filter(
                Operation.farm_id == farm_id,
                Operation.machine_id == machine_id,
                Operation.status.in_(ACTIVE_STATUSES),
            ).first()
            self._require(active_operation is None, 409,
                          "Não é possível reatribuir uma máquina durante uma operação ativa.")
            self._close_machine_assignments(
                db, farm_id, now, machine_id=machine_id, user_id=operator_id
            )
            assignment = MachineAssignment(
                farm_id=farm_id, machine_id=machine_id, user_id=operator_id, team_id=team_id,
                assigned_from=now, is_active=True, created_by=context["user"]["id"], created_at=now,
            )
            db.add(assignment)
            if operator_id is not None:
                membership = db.get(UserFarm, (operator_id, farm_id))
                membership.assigned_machine_id = machine_id
            record_audit(db, context=context, action="machines.assignment.create",
                         resource="machine", resource_id=machine_id, request=request,
                         details={"operator_id": operator_id, "team_id": team_id})
            db.flush()
            return {
                "id": assignment.id, "farm_id": farm_id, "machine_id": machine_id,
                "operator_id": operator_id, "team_id": team_id,
                "assigned_from": now, "is_active": True,
            }

    def list_machine_assignments(self, context: dict, machine_id: int):
        with SessionLocal() as db:
            self._require(db.query(Machine.id).filter(
                Machine.id == machine_id, Machine.farm_id == context["farm_id"]
            ).first() is not None, 404, "Máquina não encontrada nesta fazenda.")
            rows = db.query(MachineAssignment).filter(
                MachineAssignment.machine_id == machine_id,
                MachineAssignment.farm_id == context["farm_id"],
            ).order_by(MachineAssignment.assigned_from.desc()).all()
            return [{
                "id": row.id, "machine_id": row.machine_id, "operator_id": row.user_id,
                "team_id": row.team_id, "assigned_from": row.assigned_from,
                "assigned_until": row.assigned_until, "is_active": row.is_active,
            } for row in rows]

    @staticmethod
    def _operation_query(db: Session):
        operator = aliased(User)
        supervisor = aliased(User)
        return (
            db.query(
                Operation, Field.nome.label("field_name"), Machine.name.label("machine_name"),
                operator.full_name.label("operator_full_name"), operator.username.label("operator_username"),
                supervisor.full_name.label("supervisor_full_name"), supervisor.username.label("supervisor_username"),
                Team.name.label("team_name"),
            )
            .join(Field, (Field.id == Operation.field_id) & (Field.farm_id == Operation.farm_id))
            .outerjoin(Machine, (Machine.id == Operation.machine_id) & (Machine.farm_id == Operation.farm_id))
            .outerjoin(operator, operator.id == Operation.operator_id)
            .outerjoin(supervisor, supervisor.id == Operation.supervisor_id)
            .outerjoin(Team, (Team.id == Operation.team_id) & (Team.farm_id == Operation.farm_id))
        )

    @staticmethod
    def _operation_read(row):
        op = row[0]
        return {
            "id": op.id, "farm_id": op.farm_id, "code": op.code,
            "operation_type": op.operation_type, "name": op.name, "description": op.description,
            "field_id": op.field_id, "field_name": row.field_name,
            "machine_id": op.machine_id, "machine_name": row.machine_name,
            "operator_id": op.operator_id,
            "operator_name": row.operator_full_name or row.operator_username,
            "supervisor_id": op.supervisor_id,
            "supervisor_name": row.supervisor_full_name or row.supervisor_username,
            "team_id": op.team_id, "team_name": row.team_name,
            "route_plan_id": op.route_plan_id, "status": op.status, "priority": op.priority,
            "scheduled_start": op.scheduled_start, "scheduled_end": op.scheduled_end,
            "started_at": op.started_at, "completed_at": op.completed_at,
            "created_at": op.created_at, "updated_at": op.updated_at,
        }

    def list_operations(self, context: dict, status_filter=None, operator_id=None,
                        machine_id=None, team_id=None, field_id=None):
        with SessionLocal() as db:
            query = self._operation_query(db).filter(Operation.farm_id == context["farm_id"])
            if context["role"] == "OPERATOR":
                query = query.filter(Operation.operator_id == context["user"]["id"])
            elif context["role"] == "TECHNICIAN":
                query = query.filter(
                    Operation.machine_id == context["assigned_machine_id"]
                    if context.get("assigned_machine_id") is not None else Operation.id == -1
                )
            elif context["role"] == "SUPERVISOR":
                query = query.filter(Operation.supervisor_id == context["user"]["id"])
            if status_filter:
                query = query.filter(Operation.status == status_filter)
            if operator_id:
                query = query.filter(Operation.operator_id == operator_id)
            if machine_id:
                query = query.filter(Operation.machine_id == machine_id)
            if team_id:
                query = query.filter(Operation.team_id == team_id)
            if field_id:
                query = query.filter(Operation.field_id == field_id)
            rows = query.order_by(Operation.scheduled_start.is_(None), Operation.scheduled_start,
                                  Operation.created_at.desc()).all()
            return [self._operation_read(row) for row in rows]

    def operation_summary(self, context: dict):
        operations = self.list_operations(context)
        counts = {status: 0 for status in STATUSES}
        for operation in operations:
            counts[operation["status"]] += 1

        operation_ids = [operation["id"] for operation in operations]
        occurrences = None
        if operation_ids and "operations.history" in context["permissions"]:
            with SessionLocal() as db:
                occurrences = db.query(func.count(OperationOccurrence.id)).filter(
                    OperationOccurrence.farm_id == context["farm_id"],
                    OperationOccurrence.operation_id.in_(operation_ids),
                ).scalar()
        elif not operation_ids and "operations.history" in context["permissions"]:
            occurrences = 0

        active_statuses = {"ATRIBUIDA", "ACEITA", "EM_EXECUCAO", "INTERROMPIDA"}
        active_machines = {
            operation["machine_id"] for operation in operations
            if operation["status"] in active_statuses and operation["machine_id"] is not None
        }
        return {
            "operations_by_status": counts,
            "machines_in_active_operations": len(active_machines),
            "occurrences_recorded": occurrences,
        }

    def get_operation(self, context: dict, operation_id: int):
        with SessionLocal() as db:
            query = self._operation_query(db).filter(
                Operation.id == operation_id, Operation.farm_id == context["farm_id"]
            )
            if context["role"] == "OPERATOR":
                query = query.filter(Operation.operator_id == context["user"]["id"])
            elif context["role"] == "TECHNICIAN":
                query = query.filter(
                    Operation.machine_id == context["assigned_machine_id"]
                    if context.get("assigned_machine_id") is not None else Operation.id == -1
                )
            elif context["role"] == "SUPERVISOR":
                query = query.filter(Operation.supervisor_id == context["user"]["id"])
            row = query.one_or_none()
            return self._operation_read(row) if row else None

    def create_operation(self, context: dict, payload: dict, request=None):
        with SessionLocal.begin() as db:
            field = db.query(Field).filter(
                Field.id == payload["field_id"], Field.farm_id == context["farm_id"]
            ).one_or_none()
            self._require(field is not None, 404, "Talhão não encontrado nesta fazenda.")
            code = f"OP-{datetime.now(timezone.utc):%Y%m%d}-{uuid4().hex[:8].upper()}"
            now = datetime.now(timezone.utc)
            operation = Operation(
                farm_id=context["farm_id"], code=code,
                operation_type=payload["operation_type"], name=payload["name"].strip(),
                description=payload.get("description"), field_id=field.id,
                status="PLANEJADA", priority=payload.get("priority", "NORMAL"),
                scheduled_start=payload.get("scheduled_start"), scheduled_end=payload.get("scheduled_end"),
                created_by=context["user"]["id"], created_at=now, updated_at=now,
            )
            db.add(operation)
            db.flush()
            db.add(OperationStatusHistory(
                farm_id=context["farm_id"], operation_id=operation.id, old_status=None,
                new_status="PLANEJADA", changed_by=context["user"]["id"],
                reason="Operação planejada", created_at=now,
            ))
            record_audit(db, context=context, action="operations.create", resource="operation",
                         resource_id=operation.id, request=request)
            return self._operation_read(
                self._operation_query(db).filter(Operation.id == operation.id).one()
            )

    def update_operation(self, context: dict, operation_id: int, changes: dict, request=None):
        with SessionLocal.begin() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == context["farm_id"]
            ).with_for_update().one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._require(operation.status == "PLANEJADA", 409,
                          "Somente operações planejadas podem ser alteradas.")
            self._require(changes.get("name", operation.name) is not None
                          and changes.get("priority", operation.priority) is not None
                          and changes.get("field_id", operation.field_id) is not None,
                          422, "Nome, prioridade e talhão não podem ser nulos.")
            if "field_id" in changes and changes["field_id"] is not None:
                self._require(db.query(Field.id).filter(
                    Field.id == changes["field_id"], Field.farm_id == context["farm_id"]
                ).first() is not None, 404, "Talhão não encontrado nesta fazenda.")
            start = changes.get("scheduled_start", operation.scheduled_start)
            end = changes.get("scheduled_end", operation.scheduled_end)
            self._require(start is None or end is None or end >= start, 422,
                          "O término previsto deve ser posterior ao início.")
            for key, value in changes.items():
                setattr(operation, key, value)
            operation.updated_at = datetime.now(timezone.utc)
            record_audit(db, context=context, action="operations.update", resource="operation",
                         resource_id=operation.id, request=request,
                         details={"fields": sorted(changes)})
            db.flush()
            return self._operation_read(
                self._operation_query(db).filter(Operation.id == operation.id).one()
            )

    def assign_operation(self, context: dict, operation_id: int, payload: dict, request=None):
        farm_id = context["farm_id"]
        now = datetime.now(timezone.utc)
        with SessionLocal.begin() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == farm_id
            ).with_for_update().one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._require(operation.status == "PLANEJADA", 409,
                          "Somente operações planejadas podem ser atribuídas.")
            machine = db.query(Machine).filter(
                Machine.id == payload["machine_id"], Machine.farm_id == farm_id
            ).with_for_update().one_or_none()
            self._require(machine is not None, 404, "Máquina não encontrada nesta fazenda.")
            self._require(machine.status.lower() not in {"maintenance", "manutencao", "indisponivel", "parada"},
                          409, "A máquina não está disponível para uma operação.")
            operator_membership = self._farm_user(db, payload["operator_id"], farm_id, {"OPERATOR"})
            self._require(operator_membership is not None, 404, "Operador não encontrado nesta fazenda.")
            db.query(UserFarm).filter(
                UserFarm.user_id == payload["operator_id"], UserFarm.farm_id == farm_id
            ).with_for_update().one()
            team = db.query(Team).filter(
                Team.id == payload["team_id"], Team.farm_id == farm_id, Team.is_active.is_(True)
            ).one_or_none()
            self._require(team is not None, 404, "Equipe não encontrada nesta fazenda.")
            self._require(db.query(TeamMember).filter(
                TeamMember.team_id == team.id, TeamMember.farm_id == farm_id,
                TeamMember.user_id == payload["operator_id"], TeamMember.team_role == "OPERATOR",
                TeamMember.is_active.is_(True),
            ).first() is not None, 422, "O operador não pertence à equipe selecionada.")
            running = db.query(Operation.id).filter(
                Operation.farm_id == farm_id, Operation.machine_id == machine.id,
                Operation.status.in_(ACTIVE_STATUSES),
            ).first()
            self._require(running is None, 409, "A máquina já está vinculada a uma operação ativa.")
            operator_running = db.query(Operation.id).filter(
                Operation.farm_id == farm_id, Operation.operator_id == payload["operator_id"],
                Operation.status.in_(ACTIVE_STATUSES),
            ).first()
            self._require(operator_running is None, 409,
                          "O operador já está vinculado a uma operação ativa.")
            supervisor_id = payload.get("supervisor_id") or team.supervisor_id
            if supervisor_id is not None:
                self._require(
                    self._farm_user(
                        db, supervisor_id, farm_id,
                        {"SUPERVISOR", "COORDINATOR", "FARM_ADMIN", "OWNER"},
                    ) is not None,
                    404,
                    "Supervisor não encontrado nesta fazenda.",
                )
            if context["role"] == "SUPERVISOR":
                self._require(supervisor_id == context["user"]["id"], 403,
                              "Supervisores só podem atribuir operações sob sua supervisão.")
            operation.machine_id = machine.id
            operation.operator_id = payload["operator_id"]
            operation.team_id = team.id
            operation.supervisor_id = supervisor_id
            operation.status = "ATRIBUIDA"
            operation.updated_at = now

            self._close_machine_assignments(
                db, farm_id, now, machine_id=machine.id, user_id=payload["operator_id"]
            )
            db.add(MachineAssignment(
                farm_id=farm_id, machine_id=machine.id, user_id=payload["operator_id"], team_id=team.id,
                assigned_from=now, is_active=True, created_by=context["user"]["id"], created_at=now,
            ))
            operator_membership[0].assigned_machine_id = machine.id

            db.add(OperationStatusHistory(
                farm_id=farm_id, operation_id=operation.id, old_status="PLANEJADA",
                new_status="ATRIBUIDA", changed_by=context["user"]["id"],
                reason="Operação atribuída", created_at=now,
            ))
            record_audit(db, context=context, action="operations.assign", resource="operation",
                         resource_id=operation.id, request=request, details={
                             "machine_id": machine.id, "operator_id": payload["operator_id"],
                             "team_id": team.id, "supervisor_id": supervisor_id,
                         })
            db.flush()
            return self._operation_read(
                self._operation_query(db).filter(Operation.id == operation.id).one()
            )

    def calculate_operation_route(
        self, context: dict, operation_id: int, reason: str | None, request=None
    ):
        farm_id = context["farm_id"]
        with SessionLocal() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == farm_id
            ).one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._assert_operation_visible(context, operation)
            self._require(operation.machine_id is not None, 409,
                          "Atribua uma máquina antes de calcular a rota.")
            self._require(operation.status not in {"CONCLUIDA", "CANCELADA"}, 409,
                          "Operações concluídas ou canceladas não podem recalcular a rota.")
            field_centroid = db.execute(text("""
                SELECT ST_Y(ST_Centroid(geometry)) AS latitude,
                       ST_X(ST_Centroid(geometry)) AS longitude
                FROM fields WHERE id = :field_id AND farm_id = :farm_id
            """), {"field_id": operation.field_id, "farm_id": farm_id}).mappings().one_or_none()
            self._require(field_centroid is not None, 404, "Talhão não encontrado nesta fazenda.")
            machine_id = operation.machine_id
            destination = dict(field_centroid)
        machine_status, origin = self.route_repository.get_machine_location(machine_id, farm_id)
        if machine_status == "machine_not_found":
            raise HTTPException(status_code=404, detail="Máquina não encontrada nesta fazenda.")
        if machine_status == "location_not_found":
            raise HTTPException(status_code=409, detail="A máquina ainda não possui localização GPS.")
        try:
            route = self.route_service.calculate(origin, destination, farm_id)
        except RouteRequestError as exc:
            raise HTTPException(status_code=422, detail=exc.message) from exc

        now = datetime.now(timezone.utc)
        with SessionLocal.begin() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == farm_id
            ).with_for_update().one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._require(operation.status not in {"CONCLUIDA", "CANCELADA"}, 409,
                          "Operações concluídas ou canceladas não podem recalcular a rota.")
            self._require(operation.machine_id == machine_id, 409,
                          "A máquina da operação mudou durante o cálculo da rota.")
            version = (db.query(func.max(OperationRouteHistory.version)).filter(
                OperationRouteHistory.operation_id == operation_id,
                OperationRouteHistory.farm_id == farm_id,
            ).scalar() or 0) + 1
            route_plan = RoutePlan(
                machine_id=machine_id,
                farm_id=farm_id,
                name=f"{operation.code} rota v{version}",
                distance_m=route["distance_m"],
                total_cost=route["total_cost"],
                route_geometry=route["route"],
                calculated_at=now,
            )
            db.add(route_plan)
            db.flush()
            for longitude, latitude in route["route"]["geometry"]["coordinates"]:
                db.add(RouteLocation(
                    route_id=route_plan.id, farm_id=farm_id, latitude=latitude,
                    longitude=longitude, recorded_at=now,
                ))
            operation.route_plan_id = route_plan.id
            operation.updated_at = now
            db.add(OperationRouteHistory(
                farm_id=farm_id, operation_id=operation_id, route_plan_id=route_plan.id,
                version=version, route_geometry=route["route"],
                distance_m=route["distance_m"], total_cost=route["total_cost"],
                reason=reason, created_by=context["user"]["id"], created_at=now,
            ))
            record_audit(db, context=context, action="operations.route.calculate",
                         resource="operation", resource_id=operation_id, request=request,
                         details={"route_plan_id": route_plan.id, "version": version,
                                  "distance_m": route["distance_m"], "reason": reason})
            return {
                "route_plan_id": route_plan.id, "version": version,
                "distance_m": route["distance_m"], "total_cost": route["total_cost"],
                "route": route["route"], "problems": route["problems"],
            }

    def _assert_operation_visible(self, context: dict, operation: Operation):
        self._require(operation.farm_id == context["farm_id"], 404, "Operação não encontrada.")
        if context["role"] == "OPERATOR":
            self._require(operation.operator_id == context["user"]["id"], 404,
                          "Operação não atribuída a este operador.")
        elif context["role"] == "TECHNICIAN" and context.get("assigned_machine_id") is not None:
            self._require(operation.machine_id == context["assigned_machine_id"], 404,
                          "Operação não encontrada para a máquina atribuída.")
        elif context["role"] == "TECHNICIAN":
            self._require(False, 404, "Nenhuma máquina está atribuída a este técnico.")
        elif context["role"] == "SUPERVISOR":
            self._require(operation.supervisor_id == context["user"]["id"], 404,
                          "Operação não atribuída a este supervisor.")

    def change_status(
        self, context: dict, operation_id: int, new_status: str, reason: str | None, request=None
    ):
        now = datetime.now(timezone.utc)
        with SessionLocal.begin() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == context["farm_id"]
            ).with_for_update().one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._assert_operation_visible(context, operation)
            old_status = operation.status
            self._require(old_status in ALLOWED_TRANSITIONS.get(new_status, set()), 409,
                          f"Transição inválida: {old_status} → {new_status}.")
            if new_status in {"ACEITA", "EM_EXECUCAO", "INTERROMPIDA", "CONCLUIDA"}:
                self._require(
                    context["role"] == "OPERATOR"
                    and operation.operator_id == context["user"]["id"],
                    403,
                    "Somente o operador atribuído pode executar esta ação.",
                )
            if new_status == "CANCELADA" and context["role"] == "OPERATOR":
                self._require(operation.status in {"ATRIBUIDA", "ACEITA", "INTERROMPIDA"},
                              409, "Operação não pode ser cancelada neste estado.")
            if new_status == "CANCELADA" and context["role"] == "SUPERVISOR":
                self._require(operation.supervisor_id == context["user"]["id"], 404,
                              "Operação não atribuída a este supervisor.")
            if new_status == "ACEITA":
                operation.accepted_at = now
            if new_status == "EM_EXECUCAO" and old_status == "ACEITA":
                operation.started_at = now
            if new_status == "CONCLUIDA":
                operation.completed_at = now
                operation.completion_summary = reason
            if new_status == "CANCELADA":
                operation.cancelled_at = now
            operation.status = new_status
            operation.updated_at = now
            db.add(OperationStatusHistory(
                farm_id=context["farm_id"], operation_id=operation_id,
                old_status=old_status, new_status=new_status,
                changed_by=context["user"]["id"], reason=reason, created_at=now,
            ))
            record_audit(db, context=context, action=f"operations.{new_status.lower()}",
                         resource="operation", resource_id=operation_id, request=request,
                         details={"old_status": old_status, "new_status": new_status, "reason": reason})
            db.flush()
            return self._operation_read(
                self._operation_query(db).filter(Operation.id == operation_id).one()
            )

    def operation_history(self, context: dict, operation_id: int):
        with SessionLocal() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == context["farm_id"]
            ).one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._assert_operation_visible(context, operation)
            statuses = db.query(OperationStatusHistory).filter(
                OperationStatusHistory.operation_id == operation_id,
                OperationStatusHistory.farm_id == context["farm_id"],
            ).order_by(OperationStatusHistory.created_at).all()
            routes = db.query(OperationRouteHistory).filter(
                OperationRouteHistory.operation_id == operation_id,
                OperationRouteHistory.farm_id == context["farm_id"],
            ).order_by(OperationRouteHistory.version).all()
            user_names = {
                user.id: user.full_name or user.username
                for user in db.query(User).filter(
                    User.id.in_({row.changed_by for row in statuses} |
                                {row.created_by for row in routes})
                ).all()
            } if statuses or routes else {}
            return {
                "statuses": [{
                    "old_status": row.old_status, "new_status": row.new_status,
                    "changed_by": row.changed_by, "changed_by_name": user_names.get(row.changed_by),
                    "reason": row.reason, "created_at": row.created_at,
                } for row in statuses],
                "routes": [{
                    "version": row.version, "route_plan_id": row.route_plan_id,
                    "route_geometry": row.route_geometry, "distance_m": row.distance_m,
                    "total_cost": row.total_cost, "reason": row.reason,
                    "created_by": row.created_by, "created_by_name": user_names.get(row.created_by),
                    "created_at": row.created_at,
                } for row in routes],
            }

    def operation_locations(self, context: dict, operation_id: int):
        with SessionLocal() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == context["farm_id"]
            ).one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._assert_operation_visible(context, operation)
            if operation.started_at is None or operation.machine_id is None:
                return {
                    "locations": [],
                    "current_position": None,
                    "comparison": {
                        "sufficient_data": False,
                        "adherence_sufficient_data": False,
                        "gps_sample_count": 0,
                        "planned_distance_m": None,
                        "actual_distance_m": None,
                        "distance_difference_m": None,
                        "planned_duration_s": None,
                        "actual_duration_s": None,
                        "duration_difference_s": None,
                        "points_outside_tolerance": None,
                        "max_deviation_m": None,
                        "route_adherence_pct": None,
                        "deviation_tolerance_m": get_settings().route_deviation_tolerance_m,
                    },
                }
            until = operation.completed_at or datetime.now(timezone.utc)
            rows = db.query(MachineLocation).filter(
                MachineLocation.farm_id == context["farm_id"],
                MachineLocation.machine_id == operation.machine_id,
                MachineLocation.recorded_at >= operation.started_at,
                MachineLocation.recorded_at <= until,
            ).order_by(MachineLocation.recorded_at).all()
            planned_distance = None
            route_geometry = None
            if operation.route_plan_id:
                plan = db.query(RoutePlan).filter(
                    RoutePlan.id == operation.route_plan_id,
                    RoutePlan.farm_id == context["farm_id"],
                    RoutePlan.machine_id == operation.machine_id,
                ).one_or_none()
                if plan is not None:
                    planned_distance = plan.distance_m
                    route_geometry = plan.route_geometry
            actual_distance = None
            if len(rows) >= 2:
                actual_distance = db.execute(text("""
                    SELECT ST_Length(ST_MakeLine(
                        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                        ORDER BY recorded_at
                    )::geography)
                    FROM machine_locations
                    WHERE farm_id = :farm_id AND machine_id = :machine_id
                      AND recorded_at >= :started_at AND recorded_at <= :ended_at
                """), {
                    "farm_id": context["farm_id"], "machine_id": operation.machine_id,
                    "started_at": operation.started_at, "ended_at": until,
                }).scalar()
            duration_seconds = (
                (operation.completed_at - operation.started_at).total_seconds()
                if operation.completed_at else None
            )
            scheduled_seconds = (
                (operation.scheduled_end - operation.scheduled_start).total_seconds()
                if operation.scheduled_start and operation.scheduled_end else None
            )
            sufficient = len(rows) >= 2 and planned_distance is not None
            deviation_tolerance_m = get_settings().route_deviation_tolerance_m
            deviation_count = None
            max_deviation_m = None
            route_adherence_pct = None
            location_count = len(rows)
            adherence_sufficient = bool(rows and route_geometry and route_geometry.get("geometry"))
            if adherence_sufficient:
                deviation = db.execute(text("""
                    WITH planned AS (
                        SELECT ST_SetSRID(ST_GeomFromGeoJSON(:route_geometry), 4326)::geography AS path
                    ), distances AS (
                        SELECT ST_Distance(
                            ST_SetSRID(ST_MakePoint(location.longitude, location.latitude), 4326)::geography,
                            planned.path
                        ) AS distance_m
                        FROM machine_locations AS location
                        CROSS JOIN planned
                        WHERE location.farm_id = :farm_id
                          AND location.machine_id = :machine_id
                          AND location.recorded_at >= :started_at
                          AND location.recorded_at <= :ended_at
                    )
                    SELECT count(*) FILTER (WHERE distance_m > :tolerance_m),
                           max(distance_m),
                           count(*) FILTER (WHERE distance_m <= :tolerance_m),
                           count(*)
                    FROM distances
                """), {
                    "route_geometry": json.dumps(route_geometry["geometry"]),
                    "farm_id": context["farm_id"],
                    "machine_id": operation.machine_id,
                    "started_at": operation.started_at,
                    "ended_at": until,
                    "tolerance_m": deviation_tolerance_m,
                }).one()
                deviation_count = int(deviation[0] or 0)
                max_deviation_m = float(deviation[1]) if deviation[1] is not None else None
                on_route_count = int(deviation[2] or 0)
                location_count = int(deviation[3] or 0)
                if location_count:
                    route_adherence_pct = on_route_count * 100.0 / location_count
            if len(rows) > 1500:
                map_rows = [
                    rows[round(index * (len(rows) - 1) / 1499)]
                    for index in range(1500)
                ]
            else:
                map_rows = rows
            return {
                "locations": [{
                    "latitude": row.latitude, "longitude": row.longitude,
                    "recorded_at": row.recorded_at,
                    "speed": None,
                    "heading": None,
                } for row in map_rows],
                "current_position": ({
                    "latitude": rows[-1].latitude,
                    "longitude": rows[-1].longitude,
                    "recorded_at": rows[-1].recorded_at,
                } if rows else None),
                "comparison": {
                    "sufficient_data": sufficient,
                    "adherence_sufficient_data": adherence_sufficient,
                    "gps_sample_count": location_count,
                    "planned_distance_m": planned_distance,
                    "actual_distance_m": actual_distance,
                    "distance_difference_m": (
                        actual_distance - planned_distance
                        if actual_distance is not None and planned_distance is not None else None
                    ),
                    "planned_duration_s": scheduled_seconds,
                    "actual_duration_s": duration_seconds,
                    "duration_difference_s": (
                        duration_seconds - scheduled_seconds
                        if duration_seconds is not None and scheduled_seconds is not None else None
                    ),
                    "points_outside_tolerance": deviation_count,
                    "max_deviation_m": max_deviation_m,
                    "route_adherence_pct": route_adherence_pct,
                    "deviation_tolerance_m": deviation_tolerance_m,
                },
            }

    def list_occurrences(self, context: dict, operation_id: int):
        with SessionLocal() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == context["farm_id"]
            ).one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._assert_operation_visible(context, operation)
            rows = db.execute(text("""
                SELECT occurrence.id, occurrence.occurrence_type, occurrence.description,
                       ST_Y(occurrence.geometry) AS latitude,
                       ST_X(occurrence.geometry) AS longitude,
                       occurrence.created_by, users.full_name, users.username, occurrence.created_at
                FROM operation_occurrences AS occurrence
                JOIN users ON users.id = occurrence.created_by
                WHERE occurrence.operation_id = :operation_id
                  AND occurrence.farm_id = :farm_id
                ORDER BY occurrence.created_at
            """), {"operation_id": operation_id, "farm_id": context["farm_id"]}).mappings().all()
            return [{
                "id": row["id"], "occurrence_type": row["occurrence_type"],
                "description": row["description"], "latitude": row["latitude"],
                "longitude": row["longitude"], "created_by": row["created_by"],
                "created_by_name": row["full_name"] or row["username"],
                "created_at": row["created_at"],
            } for row in rows]

    def create_occurrence(self, context: dict, operation_id: int, payload: dict, request=None):
        now = datetime.now(timezone.utc)
        with SessionLocal.begin() as db:
            operation = db.query(Operation).filter(
                Operation.id == operation_id, Operation.farm_id == context["farm_id"]
            ).with_for_update().one_or_none()
            self._require(operation is not None, 404, "Operação não encontrada.")
            self._assert_operation_visible(context, operation)
            self._require(operation.status in {"EM_EXECUCAO", "INTERROMPIDA"}, 409,
                          "Ocorrências só podem ser registradas durante uma operação ativa.")
            if context["role"] == "OPERATOR":
                self._require(operation.operator_id == context["user"]["id"], 404,
                              "Operação não atribuída a este operador.")
            occurrence = OperationOccurrence(
                farm_id=context["farm_id"], operation_id=operation_id,
                occurrence_type=payload["occurrence_type"],
                description=payload["description"].strip(), created_by=context["user"]["id"],
                created_at=now,
            )
            db.add(occurrence)
            db.flush()
            if payload.get("latitude") is not None:
                db.execute(text("""
                    UPDATE operation_occurrences
                    SET geometry = ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)
                    WHERE id = :id AND farm_id = :farm_id
                """), {
                    "longitude": payload["longitude"], "latitude": payload["latitude"],
                    "id": occurrence.id, "farm_id": context["farm_id"],
                })
            record_audit(db, context=context, action="operations.occurrence.create",
                         resource="operation", resource_id=operation_id, request=request,
                         details={"occurrence_id": occurrence.id,
                                  "occurrence_type": occurrence.occurrence_type})
            return {
                "id": occurrence.id, "operation_id": operation_id,
                "occurrence_type": occurrence.occurrence_type,
                "description": occurrence.description, "latitude": payload.get("latitude"),
                "longitude": payload.get("longitude"), "created_at": now,
            }
