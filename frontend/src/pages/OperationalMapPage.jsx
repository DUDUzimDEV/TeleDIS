import React, { useEffect, useMemo, useRef, useState } from 'react';
import { latLngBounds } from 'leaflet';
import { Layers3, MapPin, Sprout, Tractor, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

import FieldFormModal from '../components/map/FieldFormModal';
import MapToolbar from '../components/map/MapToolbar';
import OperationalMap from '../components/map/OperationalMap';
import RoadProblemFormModal, { roadProblemSeverityOptions, roadProblemTypeOptions } from '../components/map/RoadProblemFormModal';
import RoadFormModal, { roadTypeOptions } from '../components/map/RoadFormModal';
import RoutePlanningPanel from '../components/map/RoutePlanningPanel';
import StructureFormModal, { structureTypeOptions } from '../components/map/StructureFormModal';
import PageHeading from '../components/ui/PageHeading';
import { apiFetch } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { snapPointToRoad } from '../utils/roadSnapping';
import { routeErrorMessage, routeResponseToMap } from '../utils/routeUtils';
import { formatDateTime, geoLineToLeaflet } from '../utils/geoData';
import { getCommunicationStatus, getLatestTimestamp } from '../utils/liveStatus';

const ROAD_PROBLEM_SNAP_TOLERANCE_METERS = 30;
const LIVE_REFRESH_INTERVAL_MS = 5000;

const defaultForm = {
  name: 'Talhão 01',
  crop: 'Cana-de-açúcar',
  season: '2026/27',
};

function calculatePolygonAreaHa(points) {
  if (points.length < 3) {
    return 0;
  }

  const earthRadius = 6371000;
  let area = 0;

  for (let i = 0; i < points.length; i += 1) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[(i + 1) % points.length];

    const lat1Rad = (lat1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;
    const deltaLng = ((lng2 - lng1) * Math.PI) / 180;

    area += (2 * Math.atan2(Math.sin(deltaLng / 2), Math.sqrt(1 - Math.sin(deltaLng / 2) ** 2))) * earthRadius ** 2;
    area += (lat2Rad - lat1Rad) * earthRadius ** 2;
  }

  const absArea = Math.abs(area / 2);
  return absArea / 10000;
}

function normalizeArea(points) {
  if (points.length < 3) {
    return 0;
  }

  const radians = points.map(([lat, lng]) => [lat * Math.PI / 180, lng * Math.PI / 180]);
  let area = 0;

  for (let i = 0; i < radians.length; i += 1) {
    const [lat1, lng1] = radians[i];
    const [lat2, lng2] = radians[(i + 1) % radians.length];

    area += lng1 * Math.sin(lat2) - lng2 * Math.sin(lat1);
  }

  const sphericalArea = Math.abs(area * 6371000 * 6371000 / 2);
  return sphericalArea / 10000;
}

function estimateRoadLengthMeters(points) {
  const earthRadius = 6371000;
  let length = 0;

  for (let index = 1; index < points.length; index += 1) {
    const [latitude1, longitude1] = points[index - 1].map((value) => value * Math.PI / 180);
    const [latitude2, longitude2] = points[index].map((value) => value * Math.PI / 180);
    const deltaLatitude = latitude2 - latitude1;
    const deltaLongitude = longitude2 - longitude1;
    const haversine = Math.sin(deltaLatitude / 2) ** 2
      + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
    length += 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  return length;
}

function apiErrorMessage(payload, status, fallback) {
  const detail = payload?.detail;
  const message = typeof detail === 'string'
    ? detail
    : detail?.message || (Array.isArray(detail) ? detail.map((issue) => issue.msg).join(' ') : '');
  return message || `${fallback} (HTTP ${status}).`;
}

export default function OperationalMapPage() {
  const { activeFarm, activeFarmId, can } = useAuth();
  const operationalAreaResource = useApiResource(
    activeFarmId ? `/api/v1/farms/${activeFarmId}/operational-area` : '',
    0,
    { enabled: Boolean(activeFarmId && can('farm.view')) },
  );
  const operationsResource = useApiResource(
    '/api/v1/operations',
    0,
    { enabled: can('operations.view'), pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS },
  );
  const telemetryResource = useApiResource(
    '/api/v1/telemetry',
    0,
    {
      enabled: can('telemetry.view') && !can('telemetry.history'),
      pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    },
  );
  const locationsResource = useApiResource(
    '/api/v1/locations?limit=1000',
    0,
    { enabled: can('machines.view'), pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS },
  );
  const [fields, setFields] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [structures, setStructures] = useState([]);
  const [isLoadingStructures, setIsLoadingStructures] = useState(true);
  const [structuresLoadError, setStructuresLoadError] = useState('');
  const [structuresLoadAttempt, setStructuresLoadAttempt] = useState(0);
  const [roads, setRoads] = useState([]);
  const [isLoadingRoads, setIsLoadingRoads] = useState(true);
  const [roadsLoadError, setRoadsLoadError] = useState('');
  const [roadsLoadAttempt, setRoadsLoadAttempt] = useState(0);
  const [drawingMode, setDrawingMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState(defaultForm);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [placingStructure, setPlacingStructure] = useState(false);
  const [structureType, setStructureType] = useState('OFICINA');
  const [structurePoint, setStructurePoint] = useState(null);
  const [showStructureForm, setShowStructureForm] = useState(false);
  const [structureFormData, setStructureFormData] = useState({ name: '', description: '' });
  const [structureError, setStructureError] = useState('');
  const [isSavingStructure, setIsSavingStructure] = useState(false);
  const [structureSuccess, setStructureSuccess] = useState('');
  const [drawingRoad, setDrawingRoad] = useState(false);
  const [draftRoadPoints, setDraftRoadPoints] = useState([]);
  const [showRoadForm, setShowRoadForm] = useState(false);
  const [roadType, setRoadType] = useState('PRINCIPAL');
  const [roadFormData, setRoadFormData] = useState({ name: '', description: '' });
  const [roadError, setRoadError] = useState('');
  const [isSavingRoad, setIsSavingRoad] = useState(false);
  const [roadSuccess, setRoadSuccess] = useState('');
  const [roadProblems, setRoadProblems] = useState([]);
  const [isLoadingRoadProblems, setIsLoadingRoadProblems] = useState(true);
  const [roadProblemsLoadError, setRoadProblemsLoadError] = useState('');
  const [roadProblemsLoadAttempt, setRoadProblemsLoadAttempt] = useState(0);
  const [placingRoadProblem, setPlacingRoadProblem] = useState(false);
  const [roadProblemPoint, setRoadProblemPoint] = useState(null);
  const [showRoadProblemForm, setShowRoadProblemForm] = useState(false);
  const [roadProblemFormData, setRoadProblemFormData] = useState({ roadId: '', type: 'BURACO', severity: 'MEDIA', description: '' });
  const [roadProblemError, setRoadProblemError] = useState('');
  const [isSavingRoadProblem, setIsSavingRoadProblem] = useState(false);
  const [roadProblemSuccess, setRoadProblemSuccess] = useState('');
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [routeMethod, setRouteMethod] = useState('coordinates');
  const [routePickTarget, setRoutePickTarget] = useState(null);
  const [routeOrigin, setRouteOrigin] = useState(null);
  const [routeDestination, setRouteDestination] = useState(null);
  const [machines, setMachines] = useState([]);
  const [selectedMapMachineId, setSelectedMapMachineId] = useState(null);
  const [selectedMapRoadId, setSelectedMapRoadId] = useState(null);
  const [selectedMapStructureId, setSelectedMapStructureId] = useState(null);
  const [selectedMapProblemId, setSelectedMapProblemId] = useState(null);
  const [machineFilter, setMachineFilter] = useState('all');
  const [machineStatusFilter, setMachineStatusFilter] = useState('all');
  const [operationFilter, setOperationFilter] = useState('all');
  const [structureTypeFilter, setStructureTypeFilter] = useState('all');
  const [problemSeverityFilter, setProblemSeverityFilter] = useState('all');
  const [visibleLayers, setVisibleLayers] = useState({
    operationalArea: true,
    proximityZone: true,
    fields: true,
    roads: true,
    structures: true,
    problems: true,
    machines: true,
    routes: true,
  });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const mapRef = useRef(null);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [selectedStructureId, setSelectedStructureId] = useState('');
  const [routeError, setRouteError] = useState('');
  const [routeNotice, setRouteNotice] = useState('');
  const [calculatedRoute, setCalculatedRoute] = useState(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [isRebuildingNetwork, setIsRebuildingNetwork] = useState(false);
  const [spatialValidation, setSpatialValidation] = useState({ status: 'idle', message: '' });

  const draftAreaHa = useMemo(() => normalizeArea(draftPoints), [draftPoints]);
  const estimatedRoadLengthM = useMemo(() => estimateRoadLengthMeters(draftRoadPoints), [draftRoadPoints]);
  const draftResource = useMemo(() => {
    if (drawingMode && draftPoints.length >= 3) {
      const ring = draftPoints.map(([latitude, longitude]) => [longitude, latitude]);
      ring.push(ring[0]);
      return { resource_type: 'field', geometry: { type: 'Polygon', coordinates: [ring] } };
    }
    if (showStructureForm && structurePoint) {
      return {
        resource_type: 'structure',
        geometry: { type: 'Point', coordinates: [structurePoint.longitude, structurePoint.latitude] },
      };
    }
    if (drawingRoad && draftRoadPoints.length >= 2) {
      return {
        resource_type: 'road',
        geometry: {
          type: 'LineString',
          coordinates: draftRoadPoints.map(([latitude, longitude]) => [longitude, latitude]),
        },
      };
    }
    return null;
  }, [draftPoints, draftRoadPoints, drawingMode, drawingRoad, showStructureForm, structurePoint]);

  const selectedField = fields.find((field) => field.id === selectedFieldId) || null;
  const operations = Array.isArray(operationsResource.data) ? operationsResource.data : [];
  const locationRows = Array.isArray(locationsResource.data) ? locationsResource.data : [];
  const machineLocationsById = new Map();
  [...locationRows]
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    .forEach((location) => {
      if (!machineLocationsById.has(String(location.maquina_id))) {
        machineLocationsById.set(String(location.maquina_id), location);
      }
    });
  const machineLocations = machines.map((machine) => {
    const location = machineLocationsById.get(String(machine.id));
    if (location) return { ...location, nome: machine.nome, status: machine.status };
    const base = structures.find((structure) => String(structure.id) === String(machine.base_structure_id));
    if (!base?.coordinates) return null;
    return {
      maquina_id: machine.id,
      nome: machine.nome,
      status: machine.status,
      latitude: base.coordinates[0],
      longitude: base.coordinates[1],
      source: 'BASE',
      coordinate_source: 'BASE',
      base_name: base.nome,
    };
  }).filter(Boolean);
  const machineStatuses = [...new Set(machines.map((machine) => machine.status).filter(Boolean))];
  const mapMachineLocations = machineLocations.filter((location) => {
    const machine = machines.find((item) => String(item.id) === String(location.maquina_id));
    const matchesMachine = machineFilter === 'all' || String(location.maquina_id) === machineFilter;
    const matchesStatus = machineStatusFilter === 'all' || machine?.status === machineStatusFilter;
    const machineOperations = operations
      .filter((item) => String(item.machine_id) === String(location.maquina_id))
      .sort((left, right) => new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0));
    const operation = machineOperations.find((item) => String(item.id) === operationFilter)
      || machineOperations.find((item) => !['CONCLUIDA', 'CANCELADA'].includes(item.status))
      || machineOperations[0];
    const matchesOperation = operationFilter === 'all' || String(operation?.id) === operationFilter;
    return matchesMachine && matchesStatus && matchesOperation;
  });
  const mapStructures = structures.filter((structure) => (
    structureTypeFilter === 'all' || structure.tipo === structureTypeFilter
  ));
  const mapRoadProblems = roadProblems.filter((problem) => (
    problemSeverityFilter === 'all' || problem.gravidade === problemSeverityFilter
  ));
  const structureTypes = [...new Set(structures.map((structure) => structure.tipo).filter(Boolean))];
  const problemSeverities = [...new Set(roadProblems.map((problem) => problem.gravidade).filter(Boolean))];
  const selectedMapMachine = mapMachineLocations.find(
    (machine) => String(machine.maquina_id) === String(selectedMapMachineId),
  );
  const selectedMapRoad = roads.find((road) => String(road.id) === String(selectedMapRoadId));
  const selectedMapStructure = mapStructures.find((structure) => String(structure.id) === String(selectedMapStructureId));
  const selectedMapProblem = mapRoadProblems.find((problem) => String(problem.id) === String(selectedMapProblemId));
  const selectedMachineOperations = operations
    .filter((operation) => Boolean(selectedMapMachine)
      && String(operation.machine_id) === String(selectedMapMachine.maquina_id))
    .sort((left, right) => new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0));
  const selectedMachineOperation = selectedMachineOperations.find((operation) => (
    String(operation.id) === operationFilter
  )) || selectedMachineOperations.find((operation) => (
    !['CONCLUIDA', 'CANCELADA'].includes(operation.status)
  )) || selectedMachineOperations[0] || null;
  const selectedMachineTelemetryResource = useApiResource(
    selectedMapMachineId ? `/api/v1/telemetry/${selectedMapMachineId}` : '',
    0,
    {
      enabled: Boolean(selectedMapMachineId && can('telemetry.history')),
      pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    },
  );
  const telemetry = can('telemetry.history')
    ? Array.isArray(selectedMachineTelemetryResource.data?.historico)
      ? selectedMachineTelemetryResource.data.historico
      : []
    : Array.isArray(telemetryResource.data) ? telemetryResource.data : [];
  const selectedMachineReadings = telemetry
    .filter((reading) => Boolean(selectedMapMachine)
      && String(reading.maquina_id) === String(selectedMapMachine.maquina_id))
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  const selectedMachineSpeed = selectedMachineReadings.find((reading) => (
    /velocidade|speed/i.test(String(reading.metric || ''))
  ));
  const selectedTelemetryTimestamp = selectedMachineReadings[0]?.timestamp;
  const selectedLastUpdate = getLatestTimestamp(
    selectedMapMachine?.timestamp,
    selectedTelemetryTimestamp,
  );
  const connectionStatus = getCommunicationStatus(selectedLastUpdate);
  const machineContextResource = useApiResource(
    selectedMapMachineId ? `/api/v1/simulator/machines/${selectedMapMachineId}/context` : '',
    0,
    {
      enabled: Boolean(selectedMapMachineId && can('machines.view')),
      pollingIntervalMs: ['EM_EXECUCAO', 'INTERROMPIDA'].includes(selectedMachineOperation?.status)
        ? LIVE_REFRESH_INTERVAL_MS
        : 0,
    },
  );
  const operationLocationsResource = useApiResource(
    selectedMachineOperation && can('operations.history')
      ? `/api/v1/operations/${selectedMachineOperation.id}/locations`
      : '',
    0,
    {
      enabled: Boolean(selectedMachineOperation?.started_at && can('operations.history')),
      pollingIntervalMs: ['EM_EXECUCAO', 'INTERROMPIDA'].includes(selectedMachineOperation?.status)
        ? LIVE_REFRESH_INTERVAL_MS
        : 0,
    },
  );
  const operationComparison = operationLocationsResource.data?.comparison;
  const operationProgress = ['EM_EXECUCAO', 'INTERROMPIDA'].includes(selectedMachineOperation?.status)
    && machineContextResource.data?.route_progress != null
    && Number.isFinite(Number(machineContextResource.data?.route_progress))
    ? Math.max(0, Math.min(100, Number(machineContextResource.data.route_progress) * 100))
    : null;
  const operationTrack = (operationLocationsResource.data?.locations || [])
    .map((location) => [Number(location.latitude), Number(location.longitude)])
    .filter((point) => point.every(Number.isFinite));
  const plannedRouteCoordinates = geoLineToLeaflet(
    machineContextResource.data?.operation?.id === selectedMachineOperation?.id
      ? machineContextResource.data?.planned_route?.geometry
      : null,
  );

  useEffect(() => {
    if (selectedMapMachineId != null || !mapMachineLocations.length) return;
    const preferredOperation = operations.find((operation) => (
      ['EM_EXECUCAO', 'INTERROMPIDA'].includes(operation.status) && operation.machine_id != null
    )) || [...operations]
      .filter((operation) => operation.machine_id != null && operation.route_plan_id != null)
      .sort((left, right) => new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0))[0];
    const preferredMachine = preferredOperation?.machine_id != null
      ? mapMachineLocations.find((machine) => String(machine.maquina_id) === String(preferredOperation.machine_id))
      : null;
    setSelectedMapMachineId(preferredMachine?.maquina_id ?? mapMachineLocations[0].maquina_id);
  }, [mapMachineLocations, operations, selectedMapMachineId]);

  useEffect(() => {
    if (!draftResource || !activeFarmId) {
      setSpatialValidation({ status: 'idle', message: '' });
      return undefined;
    }
    const controller = new AbortController();
    setSpatialValidation({ status: 'checking', message: 'Validando a posição com a área operacional...' });
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiFetch(
          `/api/v1/farms/${activeFarmId}/operational-area/validate-resource`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draftResource),
            signal: controller.signal,
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload.detail;
          const message = typeof detail === 'string' ? detail : detail?.message;
          throw new Error(message || `Não foi possível validar a posição (HTTP ${response.status}).`);
        }
        if (!controller.signal.aborted) {
          const result = payload.data;
          setSpatialValidation({
            status: result.location_scope === 'WITHIN_PROXIMITY_ZONE' ? 'proximity' : 'valid',
            message: result.message,
          });
        }
      } catch (error) {
        if (error.name !== 'AbortError' && !controller.signal.aborted) {
          setSpatialValidation({ status: 'invalid', message: error.message || 'Não foi possível validar a posição.' });
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeFarmId, draftResource]);

  useEffect(() => {
    let isCurrentRequest = true;

    async function loadMachines() {
      try {
        const response = await apiFetch('/api/v1/machines');
        if (!response.ok) {
          throw new Error(`Não foi possível carregar as máquinas (HTTP ${response.status}).`);
        }
        const payload = await response.json();
        if (isCurrentRequest) {
          setMachines(payload.data || []);
        }
      } catch (error) {
        if (isCurrentRequest) {
          setRouteError(error.message || 'Não foi possível carregar as máquinas.');
        }
      }
    }

    loadMachines();
    return () => {
      isCurrentRequest = false;
    };
  }, [activeFarmId]);

  useEffect(() => {
    let isCurrentRequest = true;

    async function loadStructures() {
      setIsLoadingStructures(true);
      setStructuresLoadError('');

      try {
        const response = await apiFetch('/api/v1/structures');
        if (!response.ok) {
          throw new Error(`Não foi possível carregar as estruturas (HTTP ${response.status}).`);
        }

        const savedStructures = await response.json();
        if (isCurrentRequest) {
          setStructures(savedStructures.map((structure) => ({
            ...structure,
            coordinates: [structure.geometry.coordinates[1], structure.geometry.coordinates[0]],
          })));
        }
      } catch (error) {
        if (isCurrentRequest) {
          setStructuresLoadError(error.message || 'Não foi possível carregar as estruturas.');
        }
      } finally {
        if (isCurrentRequest) {
          setIsLoadingStructures(false);
        }
      }
    }

    loadStructures();
    return () => {
      isCurrentRequest = false;
    };
  }, [activeFarmId, structuresLoadAttempt]);

  useEffect(() => {
    let isCurrentRequest = true;

    async function loadRoads() {
      setIsLoadingRoads(true);
      setRoadsLoadError('');

      try {
        const response = await apiFetch('/api/v1/roads');
        if (!response.ok) {
          throw new Error(`Não foi possível carregar as vias (HTTP ${response.status}).`);
        }

        const savedRoads = await response.json();
        if (isCurrentRequest) {
          setRoads(savedRoads.map((road) => ({
            ...road,
            points: road.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
          })));
        }
      } catch (error) {
        if (isCurrentRequest) {
          setRoadsLoadError(error.message || 'Não foi possível carregar as vias.');
        }
      } finally {
        if (isCurrentRequest) {
          setIsLoadingRoads(false);
        }
      }
    }

    loadRoads();
    return () => {
      isCurrentRequest = false;
    };
  }, [activeFarmId, roadsLoadAttempt]);

  useEffect(() => {
    let isCurrentRequest = true;

    async function loadRoadProblems() {
      setIsLoadingRoadProblems(true);
      setRoadProblemsLoadError('');

      try {
        const response = await apiFetch('/api/v1/road-problems');
        if (!response.ok) {
          throw new Error(`Não foi possível carregar os problemas nas vias (HTTP ${response.status}).`);
        }

        const savedProblems = await response.json();
        if (isCurrentRequest) {
          setRoadProblems(savedProblems.map((problem) => ({
            ...problem,
            coordinates: [problem.geometry.coordinates[1], problem.geometry.coordinates[0]],
          })));
        }
      } catch (error) {
        if (isCurrentRequest) {
          setRoadProblemsLoadError(error.message || 'Não foi possível carregar os problemas nas vias.');
        }
      } finally {
        if (isCurrentRequest) {
          setIsLoadingRoadProblems(false);
        }
      }
    }

    loadRoadProblems();
    return () => {
      isCurrentRequest = false;
    };
  }, [activeFarmId, roadProblemsLoadAttempt]);

  useEffect(() => {
    let isCurrentRequest = true;

    async function loadFields() {
      setIsLoading(true);
      setLoadError('');

      try {
        const response = await apiFetch('/api/v1/fields');
        if (!response.ok) {
          throw new Error(`Não foi possível carregar os talhões (HTTP ${response.status}).`);
        }

        const savedFields = await response.json();
        if (isCurrentRequest) {
          setFields(savedFields.map((field) => ({
            ...field,
            name: field.nome,
            crop: field.cultura,
            season: field.safra,
            areaHa: field.area_ha,
            points: field.geometry.coordinates[0].map(([longitude, latitude]) => [latitude, longitude]),
          })));
        }
      } catch (error) {
        if (isCurrentRequest) {
          setLoadError(error.message || 'Não foi possível carregar os talhões.');
        }
      } finally {
        if (isCurrentRequest) {
          setIsLoading(false);
        }
      }
    }

    loadFields();
    return () => {
      isCurrentRequest = false;
    };
  }, [activeFarmId, loadAttempt]);

  const openDrawingMode = () => {
    setIsPlanningRoute(false);
    setRoutePickTarget(null);
    setPlacingStructure(false);
    setDrawingRoad(false);
    setPlacingRoadProblem(false);
    setShowRoadProblemForm(false);
    setDraftRoadPoints([]);
    setShowRoadForm(false);
    setShowStructureForm(false);
    setStructurePoint(null);
    setDrawingMode(true);
    setDraftPoints([]);
    setShowForm(false);
    setFormError('');
    setSuccessMessage('');
  };

  const cancelDrawing = () => {
    setDrawingMode(false);
    setDraftPoints([]);
    setShowForm(false);
    setFormError('');
  };

  const startStructurePlacement = () => {
    setIsPlanningRoute(false);
    setRoutePickTarget(null);
    setDrawingMode(false);
    setDrawingRoad(false);
    setPlacingRoadProblem(false);
    setShowRoadProblemForm(false);
    setDraftRoadPoints([]);
    setShowRoadForm(false);
    setDraftPoints([]);
    setShowForm(false);
    setFormError('');
    setStructureSuccess('');
    setStructureError('');
    setStructurePoint(null);
    setPlacingStructure(true);
  };

  const cancelStructurePlacement = () => {
    setPlacingStructure(false);
    setStructurePoint(null);
    setShowStructureForm(false);
    setStructureError('');
  };

  const handleMapClick = (latlng) => {
    if (!drawingMode) {
      return;
    }

    setDraftPoints((current) => [...current, [latlng.lat, latlng.lng]]);
    setFormError('');
  };

  const handleStructureMapClick = (latlng) => {
    if (!placingStructure) {
      return;
    }

    const typeLabel = structureTypeOptions.find((option) => option.value === structureType)?.label || 'Estrutura';
    setStructurePoint({ latitude: latlng.lat, longitude: latlng.lng });
    setStructureFormData({ name: `${typeLabel} 01`, description: '' });
    setStructureError('');
    setShowStructureForm(true);
  };

  const startRoadDrawing = () => {
    setIsPlanningRoute(false);
    setRoutePickTarget(null);
    setDrawingMode(false);
    setDraftPoints([]);
    setShowForm(false);
    setPlacingStructure(false);
    setPlacingRoadProblem(false);
    setShowRoadProblemForm(false);
    setStructurePoint(null);
    setShowStructureForm(false);
    setDrawingRoad(true);
    setDraftRoadPoints([]);
    setShowRoadForm(false);
    setRoadError('');
    setRoadSuccess('');
  };

  const cancelRoadDrawing = () => {
    setDrawingRoad(false);
    setDraftRoadPoints([]);
    setShowRoadForm(false);
    setRoadError('');
  };

  const handleRoadMapClick = (latlng) => {
    if (!drawingRoad || showRoadForm) {
      return;
    }

    setDraftRoadPoints((current) => [...current, [latlng.lat, latlng.lng]]);
    setRoadError('');
  };

  const startRoadProblemPlacement = () => {
    setIsPlanningRoute(false);
    setRoutePickTarget(null);
    setDrawingMode(false);
    setDraftPoints([]);
    setShowForm(false);
    setPlacingStructure(false);
    setStructurePoint(null);
    setShowStructureForm(false);
    setDrawingRoad(false);
    setDraftRoadPoints([]);
    setShowRoadForm(false);
    setRoadProblemError('');
    setRoadProblemSuccess('');
    setRoadProblemFormData((current) => ({
      ...current,
      roadId: current.roadId || String(roads[0]?.id || ''),
    }));
    setPlacingRoadProblem(true);
  };

  const cancelRoadProblemPlacement = () => {
    setPlacingRoadProblem(false);
    setRoadProblemPoint(null);
    setShowRoadProblemForm(false);
    setRoadProblemError('');
  };

  const handleRoadProblemMapClick = (latlng) => {
    if (!placingRoadProblem) {
      return;
    }
    if (isLoadingRoads) {
      setRoadProblemError('Aguarde o carregamento das estradas antes de registrar o problema.');
      return;
    }
    if (roads.length === 0) {
      setRoadProblemError('Cadastre uma estrada antes de associar um problema.');
      return;
    }

    const selectedRoad = roads.find((road) => String(road.id) === roadProblemFormData.roadId);
    if (!selectedRoad) {
      setRoadProblemError('Selecione uma estrada antes de marcar a posição do problema.');
      return;
    }

    const snapped = snapPointToRoad(
      [latlng.lat, latlng.lng],
      selectedRoad.points,
      ROAD_PROBLEM_SNAP_TOLERANCE_METERS,
    );
    if (!snapped) {
      setRoadProblemError('Clique próximo à estrada selecionada para registrar o problema.');
      return;
    }

    setRoadProblemPoint({
      latitude: snapped.coordinates[0],
      longitude: snapped.coordinates[1],
      snapDistanceMeters: snapped.distanceMeters,
    });
    setRoadProblemError('');
    setShowRoadProblemForm(true);
  };

  const startRoutePlanning = () => {
    setDrawingMode(false);
    setPlacingStructure(false);
    setDrawingRoad(false);
    setPlacingRoadProblem(false);
    setShowForm(false);
    setShowStructureForm(false);
    setShowRoadForm(false);
    setShowRoadProblemForm(false);
    setRouteError('');
    setRouteNotice('');
    setCalculatedRoute(null);
    setIsPlanningRoute(true);
  };

  const toggleRoutePlanning = () => {
    if (isPlanningRoute) {
      setIsPlanningRoute(false);
      setRoutePickTarget(null);
      return;
    }
    startRoutePlanning();
  };

  const handleRouteMapClick = (latlng, target) => {
    const coordinate = { latitude: latlng.lat, longitude: latlng.lng };
    if (target === 'origin') {
      setRouteOrigin(coordinate);
    } else {
      setRouteDestination(coordinate);
    }
    setRoutePickTarget(null);
    setCalculatedRoute(null);
    setRouteError('');
  };

  const handleRebuildNetwork = async () => {
    setIsRebuildingNetwork(true);
    setRouteError('');
    try {
      const response = await apiFetch('/api/v1/routes/network/rebuild', { method: 'POST' });
      if (!response.ok) {
        throw new Error(await routeErrorMessage(response));
      }
      const result = await response.json();
      setCalculatedRoute(null);
      setRouteNotice(`Rede reconstruída: ${result.nodes_created} nós e ${result.segments_created} segmentos.`);
    } catch (error) {
      setRouteError(error.message || 'Não foi possível reconstruir a rede.');
    } finally {
      setIsRebuildingNetwork(false);
    }
  };

  const handleCalculateRoute = async () => {
    setIsCalculatingRoute(true);
    setRouteError('');
    setRouteNotice('');
    setCalculatedRoute(null);
    try {
      let url = '/api/v1/routes/calculate';
      let body;
      if (routeMethod === 'machine-structure') {
        if (!selectedMachineId || !selectedStructureId) {
          throw new Error('Selecione a máquina de origem e a estrutura de destino.');
        }
        url = `/api/v1/routes/machine/${selectedMachineId}/to-structure/${selectedStructureId}`;
      } else {
        if (!routeOrigin || !routeDestination) {
          throw new Error('Selecione a origem e o destino no mapa.');
        }
        body = JSON.stringify({ origin: routeOrigin, destination: routeDestination });
      }

      const response = await apiFetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        ...(body ? { body } : {}),
      });
      if (!response.ok) {
        throw new Error(await routeErrorMessage(response));
      }
      setCalculatedRoute(routeResponseToMap(await response.json()));
    } catch (error) {
      setRouteError(error.message || 'Não foi possível calcular a rota.');
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  const handleFinalizeRoad = () => {
    if (draftRoadPoints.length < 2) {
      setRoadError('Uma estrada precisa possuir pelo menos dois pontos.');
      return;
    }

    setRoadError('');
    setShowRoadForm(true);
  };

  const handleFinalizeField = () => {
    if (draftPoints.length < 3) {
      setFormError('Adicione pelo menos 3 pontos para criar o talhão.');
      return;
    }

    if (draftAreaHa <= 0.01) {
      setFormError('O polígono desenhado não gerou área válida. Verifique os pontos do talhão.');
      return;
    }

    setShowForm(true);
    setFormError('');
  };

  const handleFormChange = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const handleStructureFormChange = (field, value) => {
    setStructureFormData((current) => ({ ...current, [field]: value }));
  };

  const handleRoadFormChange = (field, value) => {
    setRoadFormData((current) => ({ ...current, [field]: value }));
  };

  const handleRoadProblemFormChange = (field, value) => {
    setRoadProblemFormData((current) => ({ ...current, [field]: value }));
  };

  const handleConfirmField = () => {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setFormError('');
    setSuccessMessage('');

    const ring = draftPoints.map(([latitude, longitude]) => [longitude, latitude]);
    ring.push(ring[0]);

    apiFetch('/api/v1/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: formData.name,
        cultura: formData.crop,
        safra: formData.season,
        geometry: { type: 'Polygon', coordinates: [ring] },
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(apiErrorMessage(payload, response.status, 'Não foi possível salvar o talhão'));
        }
        return payload;
      })
      .then((field) => {
        const savedField = {
          ...field,
          name: field.nome,
          crop: field.cultura,
          season: field.safra,
          areaHa: field.area_ha,
          points: field.geometry.coordinates[0].map(([longitude, latitude]) => [latitude, longitude]),
        };

        setFields((current) => [...current, savedField]);
        setSelectedFieldId(savedField.id);
        setDraftPoints([]);
        setDrawingMode(false);
        setShowForm(false);
        setFormData(defaultForm);
        setFormError('');
        setSuccessMessage(`${savedField.name} cadastrado com ${savedField.areaHa.toFixed(2)} ha.`);
      })
      .catch((error) => {
        setFormError(error.message || 'Não foi possível salvar o talhão. Revise os dados e tente novamente.');
      })
      .finally(() => setIsSaving(false));
  };

  const handleConfirmStructure = () => {
    if (isSavingStructure) {
      return;
    }

    if (!structurePoint || !structureFormData.name.trim()) {
      setStructureError('Informe o nome da estrutura e selecione um ponto no mapa.');
      return;
    }

    setIsSavingStructure(true);
    setStructureError('');
    setStructureSuccess('');

    apiFetch('/api/v1/structures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: structureFormData.name,
        tipo: structureType,
        descricao: structureFormData.description,
        geometry: {
          type: 'Point',
          coordinates: [structurePoint.longitude, structurePoint.latitude],
        },
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(apiErrorMessage(payload, response.status, 'Não foi possível cadastrar a estrutura'));
        }
        return payload;
      })
      .then((structure) => {
        setStructures((current) => [...current, {
          ...structure,
          coordinates: [structure.geometry.coordinates[1], structure.geometry.coordinates[0]],
        }]);
        setShowStructureForm(false);
        setPlacingStructure(false);
        setStructurePoint(null);
        setStructureFormData({ name: '', description: '' });
        setStructureError('');
        setStructureSuccess(`${structure.nome} cadastrada com sucesso.`);
      })
      .catch((error) => {
        setStructureError(error.message || 'Não foi possível cadastrar a estrutura. Tente novamente.');
      })
      .finally(() => setIsSavingStructure(false));
  };

  const handleConfirmRoad = () => {
    if (isSavingRoad) {
      return;
    }

    if (draftRoadPoints.length < 2 || !roadFormData.name.trim()) {
      setRoadError('Informe o nome e desenhe uma estrada com pelo menos dois pontos.');
      return;
    }

    setIsSavingRoad(true);
    setRoadError('');
    setRoadSuccess('');

    apiFetch('/api/v1/roads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: roadFormData.name,
        tipo: roadType,
        descricao: roadFormData.description,
        geometry: {
          type: 'LineString',
          coordinates: draftRoadPoints.map(([latitude, longitude]) => [longitude, latitude]),
        },
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(apiErrorMessage(payload, response.status, 'Não foi possível cadastrar a estrada'));
        }
        return payload;
      })
      .then((road) => {
        setRoads((current) => [...current, {
          ...road,
          points: road.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
        }]);
        setDrawingRoad(false);
        setDraftRoadPoints([]);
        setShowRoadForm(false);
        setRoadFormData({ name: '', description: '' });
        setRoadError('');
        setRoadSuccess(`${road.nome} cadastrada com ${road.comprimento_m.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m.`);
      })
      .catch((error) => {
        setRoadError(error.message || 'Não foi possível cadastrar a estrada. Tente novamente.');
      })
      .finally(() => setIsSavingRoad(false));
  };

  const handleConfirmRoadProblem = () => {
    if (isSavingRoadProblem) {
      return;
    }

    if (!roadProblemPoint || !roadProblemFormData.roadId) {
      setRoadProblemError('Selecione uma estrada e marque a posição do problema no mapa.');
      return;
    }

    setIsSavingRoadProblem(true);
    setRoadProblemError('');
    setRoadProblemSuccess('');

    apiFetch('/api/v1/road-problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        road_id: Number(roadProblemFormData.roadId),
        tipo: roadProblemFormData.type,
        gravidade: roadProblemFormData.severity,
        descricao: roadProblemFormData.description,
        geometry: {
          type: 'Point',
          coordinates: [roadProblemPoint.longitude, roadProblemPoint.latitude],
        },
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(apiErrorMessage(payload, response.status, 'Não foi possível registrar o problema'));
        }
        return payload;
      })
      .then((problem) => {
        setRoadProblems((current) => [...current, {
          ...problem,
          coordinates: [problem.geometry.coordinates[1], problem.geometry.coordinates[0]],
        }]);
        setPlacingRoadProblem(false);
        setRoadProblemPoint(null);
        setShowRoadProblemForm(false);
        setRoadProblemFormData({ roadId: '', type: 'BURACO', severity: 'MEDIA', description: '' });
        setRoadProblemError('');
        setRoadProblemSuccess('Problema na via registrado com sucesso.');
      })
      .catch((error) => {
        setRoadProblemError(error.message || 'Não foi possível registrar o problema. Tente novamente.');
      })
      .finally(() => setIsSavingRoadProblem(false));
  };

  const centerMap = () => {
    const coordinates = [
      ...fields.flatMap((field) => field.points),
      ...structures.map((structure) => structure.coordinates),
      ...roads.flatMap((road) => road.points),
      ...roadProblems.map((problem) => problem.coordinates),
      ...machineLocations.map((machine) => [machine.latitude, machine.longitude]),
    ];
    if (mapRef.current && coordinates.length) {
      mapRef.current.fitBounds(latLngBounds(coordinates), { padding: [40, 40], maxZoom: 15 });
    } else if (mapRef.current) {
      mapRef.current.setView([0, 0], 2);
    }
  };

  const selectMode = () => {
    setDrawingMode(false);
    setPlacingStructure(false);
    setDrawingRoad(false);
    setPlacingRoadProblem(false);
    setIsPlanningRoute(false);
    setRoutePickTarget(null);
    setShowForm(false);
    setShowStructureForm(false);
    setShowRoadForm(false);
    setShowRoadProblemForm(false);
  };

  const isSelecting = !drawingMode && !placingStructure && !drawingRoad && !placingRoadProblem && !isPlanningRoute;
  const updateLayerVisibility = (layer) => {
    setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }));
  };
  const selectMapEntity = (entity, id) => {
    setSelectedMapMachineId(entity === 'machine' ? id : null);
    setSelectedFieldId(entity === 'field' ? id : null);
    setSelectedMapRoadId(entity === 'road' ? id : null);
    setSelectedMapStructureId(entity === 'structure' ? id : null);
    setSelectedMapProblemId(entity === 'problem' ? id : null);
  };

  return (
    <div className="operational-map-page">
      <PageHeading
        eyebrow="GIS operacional"
        title="Mapa operacional"
        description="Camadas geográficas, ativos e ferramentas de operação."
        className="map-page-heading"
        actions={<span className="map-entity-count">{fields.length + roads.length + structures.length + roadProblems.length} entidades cartografadas</span>}
      />
      <MapToolbar
        isDrawing={drawingMode}
        onToggleDrawing={() => (drawingMode ? cancelDrawing() : openDrawingMode())}
        onFinalizeField={handleFinalizeField}
        canFinalize={draftPoints.length >= 3}
        onCancelDrawing={cancelDrawing}
        isPlacingStructure={placingStructure}
        onStartStructure={startStructurePlacement}
        onCancelStructure={cancelStructurePlacement}
        isDrawingRoad={drawingRoad}
        onStartRoad={startRoadDrawing}
        onFinalizeRoad={handleFinalizeRoad}
        onCancelRoad={cancelRoadDrawing}
        isPlacingRoadProblem={placingRoadProblem}
        onStartRoadProblem={startRoadProblemPlacement}
        onCancelRoadProblem={cancelRoadProblemPlacement}
        isPlanningRoute={isPlanningRoute}
        onToggleRoutePlanning={toggleRoutePlanning}
        showMachines={visibleLayers.machines}
        onToggleMachines={() => updateLayerVisibility('machines')}
        onSelectMode={selectMode}
        onCenter={centerMap}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((open) => !open)}
        isSelecting={isSelecting}
        canCreateFields={can('fields.create')}
        canCreateRoads={can('roads.create')}
        canCreateStructures={can('structures.create')}
        canCreateRoadProblems={can('road_problems.create')}
        canPlanRoutes={can('routes.create')}
      />

      {drawingMode ? (
        <div className="field-drawing-banner">
          <strong>Modo de cadastro de talhão ativo</strong>
          <span>Clique no mapa para marcar os limites do novo talhão.</span>
          <small>{draftPoints.length} ponto(s) adicionados</small>
        </div>
      ) : null}

      {placingStructure ? (
        <div className="structure-placement-banner">
          <strong>Modo de cadastro de estrutura ativo</strong>
          <label>
            <span>Tipo</span>
            <select value={structureType} onChange={(event) => setStructureType(event.target.value)}>
              {structureTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <span>Clique no mapa para escolher a localização.</span>
          <button type="button" className="banner-action" onClick={cancelStructurePlacement}>Cancelar</button>
        </div>
      ) : null}

      {drawingRoad ? (
        <div className="road-drawing-banner">
          <strong>Modo de desenho de estrada ativo</strong>
          <span>Clique no mapa para adicionar pontos à linha.</span>
          <small>{draftRoadPoints.length} ponto(s) · Aproximadamente {estimatedRoadLengthM.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m</small>
        </div>
      ) : null}

      {placingRoadProblem ? (
        <div className="road-problem-placement-banner">
          <strong>Modo de registro de problema ativo</strong>
          <label>
            <span>Estrada</span>
            <select
              value={roadProblemFormData.roadId}
              onChange={(event) => {
                setRoadProblemFormData((current) => ({ ...current, roadId: event.target.value }));
                setRoadProblemError('');
                setRoadProblemPoint(null);
              }}
              disabled={isLoadingRoads || roads.length === 0}
            >
              <option value="">Selecione uma estrada</option>
              {roads.map((road) => (
                <option key={road.id} value={String(road.id)}>{road.nome}</option>
              ))}
            </select>
          </label>
          <span>
            {roads.length > 0
              ? `Clique até ${ROAD_PROBLEM_SNAP_TOLERANCE_METERS} m da estrada selecionada; o ponto será encaixado na linha.`
              : 'Cadastre uma estrada antes de registrar um problema.'}
          </span>
          <button type="button" className="banner-action" onClick={cancelRoadProblemPlacement}>Cancelar</button>
        </div>
      ) : null}

      {operationalAreaResource.error ? (
        <div className="field-error-banner" role="alert">
          <span>Não foi possível carregar a área operacional: {operationalAreaResource.error}</span>
          <button type="button" className="banner-action" onClick={operationalAreaResource.reload}>Tentar novamente</button>
        </div>
      ) : null}
      {draftResource && spatialValidation.status !== 'idle' ? (
        <div
          className={`operational-spatial-validation ${spatialValidation.status}`}
          role={spatialValidation.status === 'invalid' ? 'alert' : 'status'}
        >
          {spatialValidation.message}
        </div>
      ) : null}

      {isLoading ? <div className="field-loading-banner" role="status">Carregando talhões...</div> : null}
      {loadError ? (
        <div className="field-error-banner" role="alert">
          <span>{loadError}</span>
          <button type="button" className="banner-action" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : null}
      {isLoadingStructures ? (
        <div className="field-loading-banner" role="status">Carregando estruturas...</div>
      ) : null}
      {structuresLoadError ? (
        <div className="field-error-banner" role="alert">
          <span>{structuresLoadError}</span>
          <button
            type="button"
            className="banner-action"
            onClick={() => setStructuresLoadAttempt((attempt) => attempt + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}
      {isLoadingRoads ? <div className="field-loading-banner" role="status">Carregando vias...</div> : null}
      {roadsLoadError ? (
        <div className="field-error-banner" role="alert">
          <span>{roadsLoadError}</span>
          <button type="button" className="banner-action" onClick={() => setRoadsLoadAttempt((attempt) => attempt + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : null}
      {isLoadingRoadProblems ? (
        <div className="field-loading-banner" role="status">Carregando problemas nas vias...</div>
      ) : null}
      {roadProblemsLoadError ? (
        <div className="field-error-banner" role="alert">
          <span>{roadProblemsLoadError}</span>
          <button
            type="button"
            className="banner-action"
            onClick={() => setRoadProblemsLoadAttempt((attempt) => attempt + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}
      {formError ? <div className="field-error-banner">{formError}</div> : null}
      {successMessage ? (
        <div className="field-success-banner" role="status">
          <span>{successMessage}</span>
          <button type="button" className="banner-dismiss" onClick={() => setSuccessMessage('')} aria-label="Fechar confirmação">
            ×
          </button>
        </div>
      ) : null}
      {structureSuccess ? (
        <div className="field-success-banner" role="status">
          <span>{structureSuccess}</span>
          <button type="button" className="banner-dismiss" onClick={() => setStructureSuccess('')} aria-label="Fechar confirmação">
            ×
          </button>
        </div>
      ) : null}
      {roadError && !showRoadForm ? <div className="field-error-banner" role="alert">{roadError}</div> : null}
      {roadSuccess ? (
        <div className="field-success-banner" role="status">
          <span>{roadSuccess}</span>
          <button type="button" className="banner-dismiss" onClick={() => setRoadSuccess('')} aria-label="Fechar confirmação">
            ×
          </button>
        </div>
      ) : null}
      {roadProblemError && !showRoadProblemForm ? (
        <div className="field-error-banner" role="alert">{roadProblemError}</div>
      ) : null}
      {roadProblemSuccess ? (
        <div className="field-success-banner" role="status">
          <span>{roadProblemSuccess}</span>
          <button type="button" className="banner-dismiss" onClick={() => setRoadProblemSuccess('')} aria-label="Fechar confirmação">
            ×
          </button>
        </div>
      ) : null}
      {locationsResource.error ? (
        <div className="field-error-banner" role="alert">
          <span>{locationsResource.error}</span>
          <button type="button" className="banner-action" onClick={locationsResource.reload}>Tentar novamente</button>
        </div>
      ) : null}
      {telemetryResource.error ? (
        <div className="field-error-banner" role="alert">
          <span>{telemetryResource.error}</span>
          <button type="button" className="banner-action" onClick={telemetryResource.reload}>Tentar novamente</button>
        </div>
      ) : null}
      {selectedMachineTelemetryResource.error ? (
        <div className="field-error-banner" role="alert">
          <span>{selectedMachineTelemetryResource.error}</span>
          <button type="button" className="banner-action" onClick={selectedMachineTelemetryResource.reload}>Tentar novamente</button>
        </div>
      ) : null}
      {operationsResource.error ? (
        <div className="field-error-banner" role="alert">
          <span>{operationsResource.error}</span>
          <button type="button" className="banner-action" onClick={operationsResource.reload}>Tentar novamente</button>
        </div>
      ) : null}

      <div className="map-stage-layout">
        <section className="map-canvas-column">
      <OperationalMap
        drawingMode={drawingMode}
        placingStructure={placingStructure}
        drawingRoad={drawingRoad}
        placingRoadProblem={placingRoadProblem}
        draftPoints={draftPoints}
        draftRoadPoints={draftRoadPoints}
        draftRoadProblemPoint={showRoadProblemForm ? roadProblemPoint : null}
        onMapClick={handleMapClick}
        onStructureMapClick={handleStructureMapClick}
        onRoadMapClick={handleRoadMapClick}
        onRoadProblemMapClick={handleRoadProblemMapClick}
        routePickTarget={isPlanningRoute ? routePickTarget : null}
        onRouteMapClick={handleRouteMapClick}
        calculatedRoute={calculatedRoute}
        operationalArea={operationalAreaResource.data}
        machines={mapMachineLocations}
        plannedRouteCoordinates={plannedRouteCoordinates}
        actualRouteCoordinates={operationTrack}
        draftValidity={spatialValidation.status === 'checking' ? 'pending' : spatialValidation.status}
        visibleLayers={visibleLayers}
        onSelectMachine={(id) => selectMapEntity('machine', id)}
        onSelectRoad={(id) => selectMapEntity('road', id)}
        onSelectStructure={(id) => selectMapEntity('structure', id)}
        onSelectRoadProblem={(id) => selectMapEntity('problem', id)}
        onMapReady={(map) => { mapRef.current = map; }}
        fields={fields}
        structures={mapStructures}
        roads={roads}
        roadProblems={mapRoadProblems}
        selectedRoadProblemRoadId={placingRoadProblem ? roadProblemFormData.roadId : null}
        fitToPersistedEntities={!isLoading && !isLoadingStructures && !isLoadingRoads && !isLoadingRoadProblems}
        selectedFieldId={selectedFieldId}
        onSelectField={(id) => selectMapEntity('field', id)}
      />

      <FieldFormModal
        isOpen={showForm}
        areaHa={draftAreaHa}
        formData={formData}
        error={formError}
        onClose={() => {
          setShowForm(false);
          setFormError('');
        }}
        onChange={handleFormChange}
        onConfirm={handleConfirmField}
        isSaving={isSaving}
      />

      <StructureFormModal
        isOpen={showStructureForm}
        structureTypes={structureTypeOptions}
        structureType={structureType}
        selectedPoint={structurePoint}
        formData={structureFormData}
        error={structureError}
        isSaving={isSavingStructure}
        onClose={cancelStructurePlacement}
        onTypeChange={setStructureType}
        onChange={handleStructureFormChange}
        onConfirm={handleConfirmStructure}
      />

      <RoadFormModal
        isOpen={showRoadForm}
        roadTypes={roadTypeOptions}
        roadType={roadType}
        lengthMeters={estimatedRoadLengthM}
        formData={roadFormData}
        error={roadError}
        isSaving={isSavingRoad}
        onClose={cancelRoadDrawing}
        onTypeChange={setRoadType}
        onChange={handleRoadFormChange}
        onConfirm={handleConfirmRoad}
      />

      <RoadProblemFormModal
        isOpen={showRoadProblemForm}
        selectedRoad={roads.find((road) => String(road.id) === roadProblemFormData.roadId) || null}
        selectedPoint={roadProblemPoint}
        formData={roadProblemFormData}
        error={roadProblemError}
        isSaving={isSavingRoadProblem}
        onClose={cancelRoadProblemPlacement}
        onChange={handleRoadProblemFormChange}
        onConfirm={handleConfirmRoadProblem}
      />

      {selectedField ? (
        <div className="field-info-card">
          <h3>{selectedField.name}</h3>
          <div className="field-info-grid">
            <span>Cultura</span>
            <strong>{selectedField.crop}</strong>
            <span>Safra</span>
            <strong>{selectedField.season}</strong>
            <span>Área</span>
            <strong>{selectedField.areaHa ? `${selectedField.areaHa.toFixed(2)} ha` : '—'}</strong>
          </div>
        </div>
      ) : null}
        </section>
        {inspectorOpen ? <aside className="map-inspector-panel">
          <section className="map-filter-panel" aria-label="Filtros do mapa">
            <header><MapPin size={16} aria-hidden="true" /><strong>Filtrar entidades</strong></header>
            {machineLocations.length ? (
              <label>
                Máquina
                <select value={machineFilter} onChange={(event) => {
                  const value = event.target.value;
                  setMachineFilter(value);
                  if (value !== 'all') selectMapEntity('machine', Number(value));
                }}>
                  <option value="all">Todas as máquinas</option>
                  {machines.filter((machine) => machineLocations.some(
                    (location) => String(location.maquina_id) === String(machine.id),
                  )).map((machine) => (
                    <option key={machine.id} value={String(machine.id)}>{machine.nome || `Máquina ${machine.id}`}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {machineStatuses.length ? (
              <label>
                Status da máquina
                <select value={machineStatusFilter} onChange={(event) => setMachineStatusFilter(event.target.value)}>
                  <option value="all">Todos os status</option>
                  {machineStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
            ) : null}
            {can('operations.view') ? (
              <label>
                Operação associada
                <select value={operationFilter} onChange={(event) => {
                  const value = event.target.value;
                  setOperationFilter(value);
                  const operation = operations.find((item) => String(item.id) === value);
                  if (operation?.machine_id != null) selectMapEntity('machine', operation.machine_id);
                }}>
                  <option value="all">Todas as operações</option>
                  {operations.filter((operation) => operation.machine_id).map((operation) => (
                    <option key={operation.id} value={String(operation.id)}>
                      {operation.name || operation.code || `Operação ${operation.id}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {structureTypes.length ? (
              <label>
                Tipo de estrutura
                <select value={structureTypeFilter} onChange={(event) => setStructureTypeFilter(event.target.value)}>
                  <option value="all">Todos os tipos</option>
                  {structureTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
            ) : null}
            {problemSeverities.length ? (
              <label>
                Gravidade do problema
                <select value={problemSeverityFilter} onChange={(event) => setProblemSeverityFilter(event.target.value)}>
                  <option value="all">Todas as gravidades</option>
                  {problemSeverities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
                </select>
              </label>
            ) : null}
            {(machineFilter !== 'all' || machineStatusFilter !== 'all' || operationFilter !== 'all'
              || structureTypeFilter !== 'all' || problemSeverityFilter !== 'all') ? (
                <button
                  className="map-filter-reset"
                  type="button"
                  onClick={() => {
                    setMachineFilter('all');
                    setMachineStatusFilter('all');
                    setOperationFilter('all');
                    setStructureTypeFilter('all');
                    setProblemSeverityFilter('all');
                    selectMapEntity(null, null);
                  }}
                >
                  Limpar filtros
                </button>
              ) : null}
          </section>
          {isPlanningRoute ? (
            <RoutePlanningPanel
              method={routeMethod}
              onMethodChange={(method) => {
                setRouteMethod(method);
                setRoutePickTarget(null);
                setRouteError('');
                setRouteNotice('');
                setCalculatedRoute(null);
              }}
              origin={routeOrigin}
              destination={routeDestination}
              onPickOrigin={() => setRoutePickTarget('origin')}
              onPickDestination={() => setRoutePickTarget('destination')}
              routePickTarget={routePickTarget}
              machines={machines}
              structures={structures}
              machineId={selectedMachineId}
              structureId={selectedStructureId}
              onMachineChange={setSelectedMachineId}
              onStructureChange={setSelectedStructureId}
              canRebuildNetwork={can('roads.update')}
              onRebuild={handleRebuildNetwork}
              isRebuilding={isRebuildingNetwork}
              onCalculate={handleCalculateRoute}
              isCalculating={isCalculatingRoute}
              error={routeError}
              notice={routeNotice}
              route={calculatedRoute}
            />
          ) : null}
          <section className="map-layer-panel">
            <header><Layers3 size={17} /><strong>Camadas do mapa</strong></header>
            {[
              ['operationalArea', 'Área da fazenda', operationalAreaResource.data?.geometry ? 1 : 0, Sprout],
              ['proximityZone', 'Zona de proximidade', operationalAreaResource.data?.proximity_zone ? 1 : 0, MapPin],
              ['machines', 'Máquinas', machineLocations.length, Tractor],
              ['fields', 'Talhões', fields.length, MapPin],
              ['roads', 'Estradas', roads.length, MapPin],
              ['structures', 'Estruturas', mapStructures.length, MapPin],
              ['problems', 'Problemas', mapRoadProblems.length, TriangleAlert],
              ['routes', 'Rotas calculadas', calculatedRoute ? 1 : 0, MapPin],
            ].map(([key, label, count, Icon]) => (
              <label className="map-layer-toggle" key={key}>
                <input type="checkbox" checked={visibleLayers[key]} onChange={() => updateLayerVisibility(key)} />
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
                <small>{count}</small>
              </label>
            ))}
          </section>
          <section className="map-legend-panel" aria-label="Legenda do mapa">
            <header><Layers3 size={16} aria-hidden="true" /><strong>Legenda</strong></header>
            <div><i className="map-legend-swatch farm-boundary" /><span>Perímetro e área da fazenda</span></div>
            <div><i className="map-legend-swatch field-area" /><span>Talhão</span></div>
            <div><i className="map-legend-swatch road-line" /><span>Estrada</span></div>
            <div><i className="map-legend-swatch planned-line" /><span>Rota calculada</span></div>
            <div><i className="map-legend-swatch actual-line" /><span>Trajetória GPS da operação</span></div>
            <div><i className="map-legend-swatch machine-point" /><span>Localização da máquina</span></div>
            <div><i className="map-legend-swatch structure-point" /><span>Estrutura</span></div>
            <div><i className="map-legend-swatch problem-point" /><span>Problema viário</span></div>
          </section>
          {selectedMapMachine ? (
            <section className="map-entity-card">
              <span className="section-overline">Máquina selecionada</span>
              <h3>{selectedMapMachine.nome || `Máquina ${selectedMapMachine.maquina_id}`}</h3>
              <div><span>Status</span><strong>{selectedMapMachine.status || 'Não informado'}</strong></div>
              <div><span>Código</span><strong>{machines.find((machine) => String(machine.id) === String(selectedMapMachine.maquina_id))?.code || '—'}</strong></div>
              <div><span>Posição</span><strong>{selectedMapMachine.latitude}, {selectedMapMachine.longitude}{selectedMapMachine.coordinate_source === 'BASE' ? ` · Base ${selectedMapMachine.base_name}` : ''}</strong></div>
              <div><span>Última atualização</span><strong>{selectedMapMachine.timestamp ? formatDateTime(selectedMapMachine.timestamp) : 'Sem posição GPS registrada'}</strong></div>
              <div><span>Comunicação</span><strong className={`live-status live-status-${connectionStatus.toLowerCase()}`}>{connectionStatus === 'ONLINE' ? 'Online' : connectionStatus === 'STALE' ? 'Desatualizada' : 'Sem dados'}</strong></div>
              <div><span>Velocidade</span><strong>{selectedMachineSpeed ? `${selectedMachineSpeed.valor} ${selectedMachineSpeed.unidade || ''} · ${formatDateTime(selectedMachineSpeed.timestamp)}` : 'Não disponível'}</strong></div>
              <div><span>Operação</span><strong>{selectedMachineOperation?.name || 'Nenhuma operação associada'}{selectedMachineOperation ? ` · ${selectedMachineOperation.status.replaceAll('_', ' ')}` : ''}</strong></div>
              <div><span>Estado operacional</span><strong>{machineContextResource.data?.operation_state || selectedMachineOperation?.status?.replaceAll('_', ' ') || 'Sem operação associada'}</strong></div>
              {operationProgress != null ? <div><span>Progresso da rota reportado</span><strong>{operationProgress.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong></div> : null}
              {operationComparison?.planned_distance_m != null ? <div><span>Distância planejada</span><strong>{Number(operationComparison.planned_distance_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m</strong></div> : null}
              {operationComparison?.actual_distance_m != null ? <div><span>Distância observada</span><strong>{Number(operationComparison.actual_distance_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m</strong></div> : null}
              {operationComparison?.gps_sample_count != null ? <div><span>Amostras GPS da operação</span><strong>{operationComparison.gps_sample_count}</strong></div> : null}
              <div><span>Origem da posição</span><strong>{selectedMapMachine.coordinate_source === 'BASE' ? 'Base cadastrada (não é posição GPS)' : selectedMapMachine.source === 'SIMULATED' ? 'DADO SIMULADO' : selectedMapMachine.source === 'REAL' ? 'DADO REAL' : 'Não informada'}</strong></div>
              {selectedMachineOperation ? <Link className="text-link" to={`/operacoes/${selectedMachineOperation.id}`}>Abrir acompanhamento da operação</Link> : null}
              {can('telemetry.view') ? <Link className="text-link" to={`/telemetria?machineId=${selectedMapMachine.maquina_id}`}>Ver telemetria da máquina</Link> : null}
              {machineContextResource.error ? <small className="live-data-error">Contexto operacional indisponível: {machineContextResource.error}</small> : null}
              {operationLocationsResource.error ? <small className="live-data-error">Trilha indisponível: {operationLocationsResource.error}</small> : null}
            </section>
          ) : null}
          {selectedField ? (
            <section className="map-entity-card">
              <span className="section-overline">Talhão selecionado</span>
              <h3>{selectedField.name}</h3>
              <div><span>Cultura</span><strong>{selectedField.crop || '—'}</strong></div>
              <div><span>Safra</span><strong>{selectedField.season || '—'}</strong></div>
              <div><span>Área</span><strong>{selectedField.areaHa ? `${selectedField.areaHa.toFixed(2)} ha` : '—'}</strong></div>
              <div><span>Fazenda</span><strong>{activeFarm?.name || 'Contexto ativo'}</strong></div>
            </section>
          ) : null}
          {selectedMapStructure ? (
            <section className="map-entity-card">
              <span className="section-overline">Estrutura selecionada</span>
              <h3>{selectedMapStructure.nome || `Estrutura ${selectedMapStructure.id}`}</h3>
              <div><span>Tipo</span><strong>{selectedMapStructure.tipo || 'Não informado'}</strong></div>
              <div><span>Descrição</span><strong>{selectedMapStructure.descricao || 'Não informada'}</strong></div>
              <div><span>Coordenadas</span><strong>{selectedMapStructure.coordinates?.join(', ') || 'Não disponíveis'}</strong></div>
            </section>
          ) : null}
          {selectedMapRoad ? (
            <section className="map-entity-card">
              <span className="section-overline">Estrada selecionada</span>
              <h3>{selectedMapRoad.nome || `Estrada ${selectedMapRoad.id}`}</h3>
              <div><span>Tipo</span><strong>{selectedMapRoad.tipo || 'Não informado'}</strong></div>
              <div><span>Situação</span><strong>{selectedMapRoad.status || 'Não informada pela API'}</strong></div>
              <div><span>Comprimento</span><strong>{selectedMapRoad.comprimento_m != null && Number.isFinite(Number(selectedMapRoad.comprimento_m)) ? `${Number(selectedMapRoad.comprimento_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m` : 'Não informado'}</strong></div>
            </section>
          ) : null}
          {selectedMapProblem ? (
            <section className="map-entity-card">
              <span className="section-overline">Problema viário selecionado</span>
              <h3>{selectedMapProblem.tipo || `Problema ${selectedMapProblem.id}`}</h3>
              <div><span>Gravidade</span><strong>{selectedMapProblem.gravidade || 'Não informada'}</strong></div>
              <div><span>Status</span><strong>{selectedMapProblem.status || 'Não informado'}</strong></div>
              <div><span>Estrada</span><strong>{selectedMapProblem.road_nome || 'Não informada'}</strong></div>
              <div><span>Localização</span><strong>{selectedMapProblem.coordinates?.join(', ') || 'Não disponível'}</strong></div>
              {selectedMapProblem.descricao ? <div><span>Descrição</span><strong>{selectedMapProblem.descricao}</strong></div> : null}
            </section>
          ) : null}
          {!selectedMapMachine && !selectedField && !selectedMapStructure && !selectedMapRoad && !selectedMapProblem ? (
            <div className="map-inspector-empty"><MapPin size={18} /><span>Selecione uma entidade no mapa para consultar seus detalhes.</span></div>
          ) : null}
        </aside> : null}
      </div>
    </div>
  );
}
