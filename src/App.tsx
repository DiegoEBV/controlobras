import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import Layout from './components/common/Layout';
import Login from './pages/Login';
import DashboardGlobal from './pages/DashboardGlobal';
import ReporteAvance from './pages/ReporteAvance';
import GestionIncidencias from './pages/GestionIncidencias';
import GestionActividades from './pages/GestionActividades';
import GestionObras from './pages/GestionObras';

import Home from './pages/Home';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Rutas Protegidas */}
          <Route element={<ProtectedRoute />}>
            {/* Landing Page - Ahora es Home */}
            <Route path="/" element={<Layout><Home /></Layout>} />

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

            {/* Rutas Solo Jefe */}
            <Route element={<ProtectedRoute allowedRoles={['jefe']} />}>
              <Route path="/obras" element={<Layout><GestionObras /></Layout>} />
            </Route>
          </Route>

        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
