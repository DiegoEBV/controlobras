import React, { useEffect, useState } from 'react';
import { Form, Button, Card, Alert, Spinner, Table } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';

interface Obra {
    id: string;
    nombre_obra: string;
    type?: string;
    parent_id?: string;
}

interface Incidencia {
    id: string;
    fecha_reporte: string;
    descripcion: string;
    impacto_estimado: string;
    estado_actual: string;
    porcentaje_resolucion: number;
}

const FormularioIncidencia: React.FC = () => {
    const { user } = useAuth();
    const [obras, setObras] = useState<Obra[]>([]);
    const [incidents, setIncidents] = useState<Incidencia[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'danger', text: string } | null>(null);

    // Form Field State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedObra, setSelectedObra] = useState('');
    const [components, setComponents] = useState<Obra[]>([]);
    const [selectedComponent, setSelectedComponent] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [impacto, setImpacto] = useState('');
    const [estado, setEstado] = useState('Registrada');
    const [resolucion, setResolucion] = useState(0);

    useEffect(() => {
        fetchObras();
    }, [user]);

    useEffect(() => {
        if (selectedObra) {
            fetchComponents(selectedObra);
            setSelectedComponent(selectedObra); // Default to main work
        } else {
            setComponents([]);
            setSelectedComponent('');
            setIncidents([]);
        }
    }, [selectedObra]);

    useEffect(() => {
        if (selectedComponent) {
            fetchIncidents(selectedComponent);
        } else {
            setIncidents([]);
        }
    }, [selectedComponent]);

    const fetchObras = async () => {
        if (!user) return;
        try {
            // Only fetch main works (parent_id IS NULL)
            const { data, error } = await supabase
                .from('obras')
                .select('id, nombre_obra, type, parent_id')
                .is('parent_id', null);

            if (error) throw error;
            setObras(data || []);
        } catch (err: any) {
            console.error(err);
            setMessage({ type: 'danger', text: 'Error al cargar obras' });
        } finally {
            setLoading(false);
        }
    };

    const fetchComponents = async (parentId: string) => {
        try {
            const { data, error } = await supabase
                .from('obras')
                .select('*')
                .eq('parent_id', parentId);

            if (error) throw error;
            setComponents(data || []);
        } catch (err) {
            console.error('Error fetching components:', err);
            setComponents([]);
        }
    };

    const fetchIncidents = async (obraId: string) => {
        try {
            const { data, error } = await supabase
                .from('incidencias')
                .select('*')
                .eq('obra_id', obraId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setIncidents(data || []);
        } catch (err) {
            console.error("Error loading incidents:", err);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedObra) return setMessage({ type: 'danger', text: 'Seleccione una obra' });

        setSubmitting(true);
        setMessage(null);

        try {
            let error;

            if (editingId) {
                // UPDATE EXISTING
                const { error: updateError } = await supabase.from('incidencias').update({
                    descripcion,
                    impacto_estimado: impacto,
                    estado_actual: estado,
                    porcentaje_resolucion: resolucion
                }).eq('id', editingId);
                error = updateError;
            } else {
                // CREATE NEW
                const { error: insertError } = await supabase.from('incidencias').insert([
                    {
                        obra_id: selectedObra,
                        descripcion,
                        impacto_estimado: impacto,
                        estado_actual: estado,
                        porcentaje_resolucion: resolucion,
                        responsable_id: user?.id
                    }
                ]);
                error = insertError;
            }

            if (error) throw error;

            setMessage({ type: 'success', text: editingId ? 'Incidencia actualizada correctamente' : 'Incidencia registrada correctamente' });

            // Reset form
            resetForm();

            // Refresh list
            fetchIncidents(selectedObra);
        } catch (err: any) {
            console.error(err);
            setMessage({ type: 'danger', text: err.message || 'Error al guardar incidencia' });
        } finally {
            setSubmitting(false);
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setDescripcion('');
        setImpacto('');
        setResolucion(0);
        setEstado('Registrada');
        // Do not reset selectedObra so they can keep working in context
    };

    const handleEdit = (inc: Incidencia) => {
        setEditingId(inc.id);
        setDescripcion(inc.descripcion);
        setImpacto(inc.impacto_estimado);
        setEstado(inc.estado_actual);
        setResolucion(inc.porcentaje_resolucion);
        // Scroll to top to see form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('¿Está seguro de eliminar esta incidencia?')) return;

        try {
            const { error } = await supabase
                .from('incidencias')
                .delete()
                .eq('id', id);

            if (error) throw error;

            // Refresh
            fetchIncidents(selectedObra);
        } catch (err: any) {
            alert('Error al eliminar: ' + err.message);
        }
    };

    // Quick Update from Table (Status/Progress)
    const handleQuickUpdate = async (id: string, newEstado: string, newRes: number) => {
        try {
            const { error } = await supabase
                .from('incidencias')
                .update({ estado_actual: newEstado, porcentaje_resolucion: newRes })
                .eq('id', id);

            if (error) throw error;
            fetchIncidents(selectedComponent);
        } catch (err: any) {
            alert('Error al actualizar: ' + err.message);
        }
    };

    if (loading) return <Spinner animation="border" />;

    return (
        <div className="container py-5">
            <div className="row justify-content-center">
                <div className="col-lg-10">
                    <Card className="shadow-lg border-0 mb-5">
                        <Card.Body className="p-5">
                            <div className="text-center mb-5">
                                <h3 className="fw-bold text-primary mb-2">Gestión de Incidencias</h3>
                                <p className="text-muted">Reporte y seguimiento de problemas en obra</p>
                            </div>

                            {message && <Alert variant={message.type} className="mb-4 border-0 shadow-sm" onClose={() => setMessage(null)} dismissible>{message.text}</Alert>}

                            <Form onSubmit={handleSubmit}>
                                <Form.Group className="mb-4">
                                    <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Obra Afectada</Form.Label>
                                    <Form.Select
                                        size="lg"
                                        className="bg-light border-0"
                                        value={selectedObra}
                                        onChange={(e) => {
                                            setSelectedObra(e.target.value);
                                            resetForm(); // Reset edit mode if changing context
                                        }}
                                        required
                                        disabled={!!editingId} // Lock obra while editing to prevent accidents
                                    >
                                        <option value="">-- Seleccionar Obra --</option>
                                        {obras.map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
                                    </Form.Select>
                                </Form.Group>

                                {/* Component Selector */}
                                {components.length > 0 && (
                                    <Form.Group className="mb-4">
                                        <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Componente / Adicional</Form.Label>
                                        <Form.Select
                                            size="lg"
                                            className="bg-light border-0"
                                            value={selectedComponent}
                                            onChange={(e) => setSelectedComponent(e.target.value)}
                                            disabled={!!editingId}
                                        >
                                            <option value={selectedObra}>Contrato Principal</option>
                                            {components.map(c => (
                                                <option key={c.id} value={c.id}>
                                                    {c.type === 'adicional' ? 'Adicional: ' : c.type === 'entregable' ? 'Entregable: ' : ''}
                                                    {c.nombre_obra}
                                                </option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                )}

                                <Form.Group className="mb-4">
                                    <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Descripción del Problema</Form.Label>
                                    <Form.Control
                                        as="textarea"
                                        rows={3}
                                        size="lg"
                                        className="bg-light border-0"
                                        value={descripcion}
                                        onChange={(e) => setDescripcion(e.target.value)}
                                        required
                                        placeholder="Describa los detalles de la incidencia..."
                                    />
                                </Form.Group>

                                <div className="row g-4 mb-4">
                                    <div className="col-md-6">
                                        <Form.Group>
                                            <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Impacto Estimado</Form.Label>
                                            <Form.Control
                                                type="text"
                                                size="lg"
                                                className="bg-light border-0"
                                                value={impacto}
                                                onChange={(e) => setImpacto(e.target.value)}
                                                placeholder="Ej: 3 días de retraso"
                                            />
                                        </Form.Group>
                                    </div>
                                    <div className="col-md-3">
                                        <Form.Group>
                                            <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Estado</Form.Label>
                                            <Form.Select
                                                size="lg"
                                                className="bg-light border-0"
                                                value={estado}
                                                onChange={(e) => setEstado(e.target.value)}
                                            >
                                                <option value="Registrada">Registrada</option>
                                                <option value="En Proceso">En Proceso</option>
                                                <option value="Cerrada">Cerrada</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </div>
                                    <div className="col-md-3">
                                        <Form.Group>
                                            <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">% Resolución</Form.Label>
                                            <Form.Control
                                                type="number"
                                                min="0" max="100"
                                                size="lg"
                                                className="bg-light border-0"
                                                value={resolucion}
                                                onChange={(e) => setResolucion(parseInt(e.target.value))}
                                            />
                                        </Form.Group>
                                    </div>
                                </div>

                                <div className="d-grid mt-4 gap-2 d-md-flex justify-content-md-end">
                                    {editingId && (
                                        <Button variant="light" size="lg" onClick={resetForm} className="px-4">
                                            Cancelar
                                        </Button>
                                    )}
                                    <Button
                                        variant={editingId ? "success" : "primary"}
                                        type="submit"
                                        disabled={submitting}
                                        size="lg"
                                        className="px-5 fw-bold text-uppercase ls-1 shadow-primary flex-grow-1 flex-md-grow-0"
                                    >
                                        {submitting ? <Spinner animation="border" size="sm" /> : (editingId ? 'Actualizar Incidencia' : 'Registrar Incidencia')}
                                    </Button>
                                </div>
                            </Form>
                        </Card.Body>
                    </Card>

                    {/* SEGUIMIENTO SECTION */}
                    <Card className="shadow-lg border-0">
                        <Card.Body className="p-5">
                            <h4 className="fw-bold text-secondary mb-4">Seguimiento de Incidencias</h4>

                            {!selectedObra ? (
                                <Alert variant="info" className="text-center border-0 bg-light text-secondary">
                                    <i className="bi bi-info-circle me-2"></i>
                                    Seleccione una <strong>Obra Afectada</strong> en el formulario de arriba para ver sus incidencias.
                                </Alert>
                            ) : incidents.length === 0 ? (
                                <p className="text-muted text-center py-4">No hay incidencias registradas para esta obra.</p>
                            ) : (
                                <div className="table-responsive">
                                    <Table hover className="align-middle">
                                        <thead className="bg-light">
                                            <tr className="text-uppercase small text-secondary">
                                                <th style={{ width: '30%' }}>Descripción</th>
                                                <th>Impacto</th>
                                                <th>Estado</th>
                                                <th>% Avance</th>
                                                <th>Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {incidents.map(inc => (
                                                <tr key={inc.id} className={editingId === inc.id ? 'table-primary' : ''}>
                                                    <td>
                                                        <div className="fw-semibold text-dark">{inc.descripcion}</div>
                                                        <small className="text-muted">{new Date(inc.fecha_reporte || Date.now()).toLocaleDateString()}</small>
                                                    </td>
                                                    <td>{inc.impacto_estimado}</td>
                                                    <td>
                                                        <Form.Select
                                                            size="sm"
                                                            value={inc.estado_actual}
                                                            onChange={(e) => handleQuickUpdate(inc.id, e.target.value, inc.porcentaje_resolucion)}
                                                            className={`border-0 fw-bold ${inc.estado_actual === 'Cerrada' ? 'text-success' :
                                                                inc.estado_actual === 'En Proceso' ? 'text-warning' : 'text-danger'
                                                                }`}
                                                        >
                                                            <option value="Registrada">Registrada</option>
                                                            <option value="En Proceso">En Proceso</option>
                                                            <option value="Cerrada">Cerrada</option>
                                                        </Form.Select>
                                                    </td>
                                                    <td style={{ width: '15%' }}>
                                                        <div className="d-flex align-items-center gap-2">
                                                            <Form.Control
                                                                type="number"
                                                                size="sm"
                                                                min="0" max="100"
                                                                value={inc.porcentaje_resolucion}
                                                                onChange={(e) => handleQuickUpdate(inc.id, inc.estado_actual, parseInt(e.target.value))}
                                                            />
                                                            <span className="small text-muted">%</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="d-flex gap-2">
                                                            <Button
                                                                variant="outline-primary"
                                                                size="sm"
                                                                onClick={() => handleEdit(inc)}
                                                                title="Editar"
                                                            >
                                                                <i className="bi bi-pencil">Actualizar</i>
                                                            </Button>
                                                            <Button
                                                                variant="outline-danger"
                                                                size="sm"
                                                                onClick={() => handleDelete(inc.id)}
                                                                title="Eliminar"
                                                            >
                                                                <i className="bi bi-trash">Eliminar</i>
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </div>
                            )}
                        </Card.Body>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default FormularioIncidencia;
