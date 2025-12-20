import React, { useEffect, useState } from 'react';
import { Table, Button, Card, Spinner, Alert, Badge, Modal, Form } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { Link } from 'react-router-dom';
import { createObra, fetchCoordinators } from '../services/adminService';

interface Obra {
    id: string;
    nombre_obra: string;
    ubicacion?: string;
    entidad_contratante?: string;
    fecha_inicio_plazo?: string;
    estado?: string;
}

const GestionObras: React.FC = () => {
    const [obras, setObras] = useState<Obra[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'danger', text: string } | null>(null);

    // Create Modal State
    const [showModal, setShowModal] = useState(false);
    const [newObraName, setNewObraName] = useState('');
    const [coordinators, setCoordinators] = useState<any[]>([]);
    const [selectedCoord, setSelectedCoord] = useState('');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        fetchObras();
        fetchCoordinatorsData();
    }, []);

    const fetchCoordinatorsData = async () => {
        try {
            const coords = await fetchCoordinators();
            setCoordinators(coords);
        } catch (err) {
            console.error('Error fetching coordinators:', err);
        }
    };

    const fetchObras = async () => {
        try {
            const { data, error } = await supabase
                .from('obras')
                .select('*')
                .is('parent_id', null) // Only main works
                .order('created_at', { ascending: false });

            if (error) throw error;
            setObras(data || []);
        } catch (err) {
            console.error('Error fetching obras:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateObra = async () => {
        if (!newObraName || !selectedCoord) return;
        setCreating(true);
        const { error } = await createObra(newObraName, selectedCoord);
        setCreating(false);

        if (error) {
            alert('Error al crear la obra: ' + error.message);
        } else {
            setShowModal(false);
            setNewObraName('');
            setSelectedCoord('');
            fetchObras(); // Refresh list
        }
    };

    const handleCascadeDelete = async (obraId: string) => {
        if (!window.confirm('¡ADVERTENCIA CRÍTICA!\n\nEsta acción eliminará PERMANENTEMENTE la obra, sus COMPONENTES/ADICIONALES y TODOS sus datos relacionados:\n- Actividades\n- Incidencias\n- Reportes\n- Valorizaciones\n- Asignaciones\n\n¿Estás absolutamente seguro de continuar?')) {
            return;
        }

        setDeletingId(obraId);
        setMessage(null);

        try {
            // 0. Identify ALL Works to delete (Main + Children)
            // First, find children (Components/Adicionales)
            const { data: children } = await supabase
                .from('obras')
                .select('id')
                .eq('parent_id', obraId);

            const childIds = children?.map(c => c.id) || [];
            const allTargetIds = [obraId, ...childIds]; // Main + Children

            // 1. Delete Dependencies for ALL targets (Main + Children)
            // a. Incidents & Comments
            const { data: incidentes } = await supabase
                .from('incidencias')
                .select('id')
                .in('obra_id', allTargetIds);

            if (incidentes && incidentes.length > 0) {
                const incIds = incidentes.map(i => i.id);
                const { error: commError } = await supabase
                    .from('incidencia_comentarios')
                    .delete()
                    .in('incidencia_id', incIds);
                if (commError) throw commError;
            }

            // b. Direct dependencies
            const tablesToDelete = [
                'hitos',
                'incidencias',
                'actividades_obra',
                'valorizaciones',
                'obra_usuario'
            ];

            for (const table of tablesToDelete) {
                const { error } = await supabase
                    .from(table)
                    .delete()
                    .in('obra_id', allTargetIds); // Delete for all involved IDs

                if (error) {
                    console.error(`Error deleting from ${table}:`, error);
                    throw error;
                }
            }

            // 2. Delete Child Works FIRST (to clear FK constraint on Parent)
            if (childIds.length > 0) {
                const { error: childError } = await supabase
                    .from('obras')
                    .delete()
                    .in('id', childIds);
                if (childError) throw childError;
            }

            // 3. Finally Delete the Main Obra
            const { error: finalError } = await supabase
                .from('obras')
                .delete()
                .eq('id', obraId);

            if (finalError) throw finalError;

            setMessage({ type: 'success', text: 'Obra y todos sus componentes eliminados correctamente.' });
            fetchObras();

        } catch (err: any) {
            console.error(err);
            setMessage({ type: 'danger', text: 'Error al eliminar: ' + (err.message || 'Error desconocido') });
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;

    return (
        <div className="container py-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h3 className="mb-1">Gestión de Obras</h3>
                    <p className="text-muted mb-0">Administración general de contratos</p>
                </div>
                <div className="d-flex gap-2">
                    <Button variant="primary" onClick={() => setShowModal(true)}>
                        <i className="bi bi-plus-lg me-2"></i>Nueva Obra
                    </Button>
                    <Link to="/dashboard" className="btn btn-outline-secondary">
                        <i className="bi bi-arrow-left me-2"></i>Volver
                    </Link>
                </div>
            </div>

            {message && <Alert variant={message.type} onClose={() => setMessage(null)} dismissible>{message.text}</Alert>}

            <Card className="shadow-sm">
                <Card.Body>
                    <Table hover responsive className="align-middle">
                        <thead className="bg-light">
                            <tr>
                                <th>Nombre Obra</th>
                                <th>Ubicación</th>
                                <th>Entidad</th>
                                <th>Inicio Plazo</th>
                                <th>Estado</th>
                                <th className="text-end">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {obras.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-4 text-muted">No hay obras registradas.</td>
                                </tr>
                            ) : (
                                obras.map(obra => (
                                    <tr key={obra.id}>
                                        <td className="fw-bold">{obra.nombre_obra}</td>
                                        <td>{obra.ubicacion || '-'}</td>
                                        <td>{obra.entidad_contratante || '-'}</td>
                                        <td>{obra.fecha_inicio_plazo || '-'}</td>
                                        <td>
                                            {obra.estado && <Badge bg={obra.estado === 'Activo' ? 'success' : 'secondary'}>{obra.estado}</Badge>}
                                        </td>
                                        <td className="text-end">
                                            <Button
                                                variant="outline-danger"
                                                size="sm"
                                                onClick={() => handleCascadeDelete(obra.id)}
                                                disabled={deletingId === obra.id}
                                            >
                                                {deletingId === obra.id ? <Spinner animation="border" size="sm" /> : <i className="bi bi-trash"></i>} Eliminar
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </Table>
                </Card.Body>
            </Card>

            {/* Create Obra Modal */}
            <Modal show={showModal} onHide={() => setShowModal(false)} centered>
                <Modal.Header closeButton className="border-0">
                    <Modal.Title className="fw-bold text-primary">Nueva Obra</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Nombre de la Obra</Form.Label>
                            <Form.Control
                                type="text"
                                placeholder="Ej. Residencial Los Andes"
                                value={newObraName}
                                onChange={(e) => setNewObraName(e.target.value)}
                                autoFocus
                            />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Asignar Coordinador</Form.Label>
                            <Form.Select
                                value={selectedCoord}
                                onChange={(e) => setSelectedCoord(e.target.value)}
                            >
                                <option value="">Seleccionar...</option>
                                {coordinators.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.email || c.nombre || c.id}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer className="border-0">
                    <Button variant="light" onClick={() => setShowModal(false)}>Cancelar</Button>
                    <Button variant="primary" onClick={handleCreateObra} disabled={creating || !newObraName || !selectedCoord}>
                        {creating ? <Spinner size="sm" animation="border" /> : 'Crear Obra'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
};

export default GestionObras;
