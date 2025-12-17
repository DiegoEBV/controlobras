import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import Layout from './components/common/Layout';
import Login from './pages/Login';
import DashboardGlobal from './pages/DashboardGlobal';
import ReporteAvance from './pages/ReporteAvance';
import GestionIncidencias from './pages/GestionIncidencias';
import GestionActividades from './pages/GestionActividades';
import { Spinner } from 'react-bootstrap';

const DashboardRedirect = () => {
  const { role, loading } = useAuth();
  if (loading) return <Spinner animation="border" />;

  // Both roles go to dashboard by default
  if (role === 'jefe' || role === 'coordinador') return <Navigate to="/dashboard" />;

  return <div>Rol no asignado o desconocido. Contacte al administrador.</div>;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Rutas Protegidas */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashboardRedirect />} />

            {/* Rutas Compartidas */}
            <Route element={<ProtectedRoute allowedRoles={['jefe', 'coordinador']} />}>
              <Route path="/dashboard" element={<Layout><DashboardGlobal /></Layout>} />
            </Route>

            {/* Rutas Coordinador/Jefe */}
            <Route element={<ProtectedRoute allowedRoles={['coordinador', 'jefe']} />}>
              <Route path="/reportes/nuevo" element={<Layout><ReporteAvance /></Layout>} />
              <Route path="/incidencias" element={<Layout><GestionIncidencias /></Layout>} />
              <Route path="/actividades" element={<Layout><GestionActividades /></Layout>} />
            </Route>
          </Route>

        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
