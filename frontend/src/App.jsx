import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import Layout from './components/layout/Layout';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import FarmSelectionPage from './pages/FarmSelectionPage';
import DashboardPage from './pages/DashboardPage';
import { useAuth } from './context/AuthContext';

// Dynamic code-splitting for operational modules
const OperationalMapPage = lazy(() => import('./pages/OperationalMapPage'));
const MachinesPage = lazy(() => import('./pages/MachinesPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const OperationDetailPage = lazy(() => import('./pages/OperationDetailPage'));
const OperationReportPage = lazy(() => import('./pages/OperationReportPage'));
const RoutesPage = lazy(() => import('./pages/RoutesPage'));
const TelemetryPage = lazy(() => import('./pages/TelemetryPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const FieldsPage = lazy(() => import('./pages/FieldsPage'));
const StructuresPage = lazy(() => import('./pages/StructuresPage'));
const RoadProblemsPage = lazy(() => import('./pages/RoadProblemsPage'));
const RecommendationsPage = lazy(() => import('./pages/RecommendationsPage'));
const OperatorsPage = lazy(() => import('./pages/OperatorsPage'));
const TeamsPage = lazy(() => import('./pages/TeamsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const FarmsPage = lazy(() => import('./pages/FarmsPage'));
const OperationalAreaPage = lazy(() => import('./pages/OperationalAreaPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const OperatorPage = lazy(() => import('./pages/OperatorPage'));

function AccessDenied() {
  return (
    <section className="access-denied-panel">
      <span>403</span>
      <h1>Acesso não autorizado</h1>
      <p>Seu perfil não possui a permissão necessária para esta área nesta fazenda.</p>
    </section>
  );
}

function ProtectedRoute({ children, permission, allowFarmSelection = false }) {
  const { isAuthenticated, activeFarmId, loading, error, can } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (loading) return <div className="auth-loading-panel">Validando sessão e fazenda...</div>;
  if (error) return <div className="auth-loading-panel" role="alert">{error}</div>;
  if (!activeFarmId && !allowFarmSelection) return <FarmSelectionPage />;
  if (permission && !can(permission)) return <AccessDenied />;
  return children;
}

function DashboardByRole() {
  const { role } = useAuth();
  return role === 'OPERATOR' ? <Navigate to="/operacao" replace /> : <DashboardPage />;
}

function OperatorRoute({ children }) {
  const { loading, role } = useAuth();
  if (loading) return <ProtectedRoute permission="machines.view">{children}</ProtectedRoute>;
  if (role !== 'OPERATOR') return <Navigate to="/dashboard" replace />;
  return <ProtectedRoute permission="machines.view">{children}</ProtectedRoute>;
}

function ProtectedPage({ children, permission }) {
  return (
    <ProtectedRoute permission={permission}>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

function MachinesByRole() {
  const { role } = useAuth();
  if (role === 'OPERATOR') return <OperatorRoute><OperatorPage /></OperatorRoute>;
  return <ProtectedPage permission="machines.view"><MachinesPage /></ProtectedPage>;
}

function RoutesByRole() {
  const { role } = useAuth();
  if (role === 'OPERATOR') return <OperatorRoute><OperatorPage /></OperatorRoute>;
  return <ProtectedPage permission="routes.view"><RoutesPage /></ProtectedPage>;
}

export default function App() {
  const { isAuthenticated, role } = useAuth();
  const home = isAuthenticated
    ? (role === 'OPERATOR' ? '/operacao' : '/dashboard')
    : '/login';

  return (
    <Suspense fallback={<div className="auth-loading-panel">Carregando painel operacional...</div>}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to={home} replace /> : <LoginPage />} />
        <Route path="/selecionar-fazenda" element={<ProtectedRoute allowFarmSelection><FarmSelectionPage /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedPage permission="farm.view"><DashboardByRole /></ProtectedPage>} />
        <Route path="/mapa" element={<ProtectedPage permission="fields.view"><OperationalMapPage /></ProtectedPage>} />
        <Route path="/mapa-operacional" element={<Navigate to="/mapa" replace />} />
        <Route path="/maquinas" element={<MachinesByRole />} />
        <Route path="/talhoes" element={<ProtectedPage permission="fields.view"><FieldsPage /></ProtectedPage>} />
        <Route path="/estruturas" element={<ProtectedPage permission="structures.view"><StructuresPage /></ProtectedPage>} />
        <Route path="/rotas" element={<RoutesByRole />} />
        <Route path="/alertas" element={<ProtectedPage permission="alerts.view"><AlertsPage /></ProtectedPage>} />
        <Route path="/telemetria" element={<ProtectedPage permission="telemetry.view"><TelemetryPage /></ProtectedPage>} />
        <Route path="/recomendacoes" element={<ProtectedPage permission="reports.view"><RecommendationsPage /></ProtectedPage>} />
        <Route path="/problemas-vias" element={<ProtectedPage permission="road_problems.view"><RoadProblemsPage /></ProtectedPage>} />
        <Route path="/operadores" element={<ProtectedPage permission="users.view"><OperatorsPage /></ProtectedPage>} />
        <Route path="/equipes" element={<ProtectedPage permission="teams.view"><TeamsPage /></ProtectedPage>} />
        <Route path="/operacoes" element={<ProtectedPage permission="operations.view"><OperationsPage /></ProtectedPage>} />
        <Route path="/operacoes/:id" element={<ProtectedPage permission="operations.view"><OperationDetailPage /></ProtectedPage>} />
        <Route path="/operacoes/:id/relatorio" element={<ProtectedPage permission="operations.view"><OperationReportPage /></ProtectedPage>} />
        <Route path="/configuracoes" element={<ProtectedPage permission="settings.view"><SettingsPage /></ProtectedPage>} />
        <Route path="/usuarios" element={<ProtectedPage permission="users.view"><UsersPage /></ProtectedPage>} />
        <Route path="/fazendas" element={<ProtectedPage permission="farm.update"><FarmsPage /></ProtectedPage>} />
        <Route path="/fazendas/:farmId/area-operacional" element={<ProtectedPage permission="farm.view"><OperationalAreaPage /></ProtectedPage>} />
        <Route path="/auditoria" element={<ProtectedPage permission="audit.view"><AuditPage /></ProtectedPage>} />
        <Route path="/operacao" element={<OperatorRoute><OperatorPage /></OperatorRoute>} />
        <Route path="/minha-maquina" element={<OperatorRoute><OperatorPage /></OperatorRoute>} />
        <Route path="/minha-rota" element={<OperatorRoute><OperatorPage initialTab="route" /></OperatorRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
