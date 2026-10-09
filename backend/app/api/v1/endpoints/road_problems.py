from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.security import require_permission
from app.database import SessionLocal
from app.repositories.road_problem_repository import (
    InvalidRoadProblemGeometry,
    RoadProblemRoadNotFound,
    RoadProblemTooFarFromRoad,
)
from app.schemas.road_problem import RoadProblemCreate, RoadProblemRead, RoadProblemStatusUpdate
from app.services.road_problem_service import RoadProblemService
from app.services.audit_service import record_audit

router = APIRouter(tags=["road-problems"])
service = RoadProblemService()


@router.post("", response_model=RoadProblemRead, status_code=status.HTTP_201_CREATED)
def create_road_problem(
    payload: RoadProblemCreate,
    request: Request,
    context: dict = Depends(require_permission("road_problems.create")),
):
    try:
        problem = service.create_problem(payload, context["farm_id"])
        with SessionLocal.begin() as db:
            record_audit(db, context=context, action="road_problems.create", resource="road_problem",
                         resource_id=problem["id"], request=request)
        return problem
    except RoadProblemRoadNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RoadProblemTooFarFromRoad as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except InvalidRoadProblemGeometry as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("", response_model=list[RoadProblemRead])
def list_road_problems(context: dict = Depends(require_permission("road_problems.view"))):
    return service.list_problems(context["farm_id"])


@router.get("/{problem_id}", response_model=RoadProblemRead)
def get_road_problem(problem_id: int, context: dict = Depends(require_permission("road_problems.view"))):
    problem = service.get_problem(problem_id, context["farm_id"])
    if problem is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problema na via não encontrado.")
    return problem


@router.patch("/{problem_id}", response_model=RoadProblemRead)
def update_road_problem_status(
    problem_id: int,
    payload: RoadProblemStatusUpdate,
    request: Request,
    context: dict = Depends(require_permission("road_problems.update")),
):
    if payload.status == "RESOLVIDO" and "road_problems.resolve" not in context["permissions"]:
        raise HTTPException(status_code=403, detail="Permissão necessária: road_problems.resolve")
    problem = service.update_status(problem_id, context["farm_id"], payload.status)
    if problem is None:
        raise HTTPException(status_code=404, detail="Problema na via não encontrado.")
    with SessionLocal.begin() as db:
        record_audit(
            db, context=context, action="road_problems.update", resource="road_problem",
            resource_id=problem_id, request=request, details={"status": payload.status},
        )
    return problem