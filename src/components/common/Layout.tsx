
import React from 'react';
import { Navbar, Container, Nav, Button, Badge } from 'react-bootstrap';
import { useAuth } from '../../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

interface LayoutProps {
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const { user, role, signOut } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await signOut();
        navigate('/login');
    };

    return (
        <>
            <Navbar bg="dark" variant="dark" expand="lg" className="mb-4 shadow-sm">
                <Container>
                    <Navbar.Brand as={Link} to="/" className="fw-bold text-uppercase">
                        🏗️ Control Obras
                    </Navbar.Brand>
                    <Navbar.Toggle aria-controls="basic-navbar-nav" />
                    <Navbar.Collapse id="basic-navbar-nav">
                        <Nav className="me-auto">
                            <Nav.Link as={Link} to="/">Inicio</Nav.Link>
                            {(role === 'jefe' || role === 'coordinador') && <Nav.Link as={Link} to="/dashboard">Dashboard</Nav.Link>}
                            {role === 'jefe' && <Nav.Link as={Link} to="/obras" className="text-warning">Gestión Obras</Nav.Link>}
                            {role === 'coordinador' && (
                                <>
                                    <Nav.Link as={Link} to="/reportes/nuevo">Reportar Avance</Nav.Link>
                                    <Nav.Link as={Link} to="/incidencias">Incidencias</Nav.Link>
                                    <Nav.Link as={Link} to="/actividades">Actividades (Gantt)</Nav.Link>
                                </>
                            )}
                            {role === 'jefe' && (
                                <Nav.Link as={Link} to="/actividades">Actividades (Gantt)</Nav.Link>
                            )}
                        </Nav>
                        <Nav className="align-items-center gap-3">
                            {user && (
                                <div className="text-light d-flex flex-column align-items-end" style={{ fontSize: '0.85rem' }}>
                                    <span>{user.email}</span>
                                    <Badge bg="info" className="text-dark">{role?.toUpperCase()}</Badge>
                                </div>
                            )}
                            <Button variant="outline-light" size="sm" onClick={handleLogout}>
                                Salir
                            </Button>
                        </Nav>
                    </Navbar.Collapse>
                </Container>
            </Navbar>

            <Container>
                {children}
            </Container>
        </>
    );
};

export default Layout;
