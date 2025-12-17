import React, { useEffect, useState } from 'react';
import { Button, Form, Card, Table, Modal } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Chart } from "react-google-charts";
import { Link, useSearchParams } from 'react-router-dom';

interface Obra {
    id: string;
    nombre_obra: string;
}

interface Actividad {
    id: string;
    descripcion: string;
    duracion: number;
    dependencias: string[];
    es_critica: boolean;
    start_date?: Date;
    end_date?: Date;
}

const GestionActividades: React.FC = () => {
    const { user, role } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    // State for Selector
    const [obras, setObras] = useState<Obra[]>([]);
    const [selectedObraId, setSelectedObraId] = useState<string>(searchParams.get('obra_id') || '');

    const [actividades, setActividades] = useState<Actividad[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form State
    const [desc, setDesc] = useState('');
    const [duracion, setDuracion] = useState(1);
    const [preds, setPreds] = useState<string[]>([]); // Array of IDs

    // Fetch Obras on mount
    useEffect(() => {
        if (user) fetchObras();
    }, [user]);

    // Fetch Actividades when Obra changes
    useEffect(() => {
        if (selectedObraId) {
            fetchActividades();
            // Update URL
            setSearchParams({ obra_id: selectedObraId });
        } else {
            setActividades([]);
        }
    }, [selectedObraId]);

    const fetchObras = async () => {
        try {
            let query = supabase.from('obras').select('id, nombre_obra').is('parent_id', null);

            if (role === 'coordinador' && user) {
                const { data: rels } = await supabase.from('obra_usuario').select('obra_id').eq('usuario_id', user.id);
                const ids = rels?.map(r => r.obra_id) || [];
                if (ids.length > 0) query = query.in('id', ids);
                else { setObras([]); return; }
            }

            const { data, error } = await query;
            if (error) throw error;
            setObras(data || []);

            // Auto-select if only one
            if (data && data.length === 1 && !selectedObraId) {
                setSelectedObraId(data[0].id);
            }
        } catch (err) {
            console.error('Error fetching obras', err);
        }
    };

    const fetchActividades = async () => {
        if (!selectedObraId) return;
        try {
            const { data, error } = await supabase
                .from('actividades_obra')
                .select('*')
                .eq('obra_id', selectedObraId);

            if (error) throw error;

            // Map DB fields to interface
            const mapped: Actividad[] = (data || []).map(d => ({
                id: d.id,
                descripcion: d.descripcion,
                duracion: d.duracion || 1,
                dependencias: d.dependencias || [], // UUID array
                es_critica: d.es_critica || false
            }));

            // TODO: Calculate Dates (CPM) here based on duration & dependencies
            // For now, simple mapping for demo
            const calculated = calculateCPM(mapped);
            setActividades(calculated);
        } catch (err) {
            console.error(err);
        }
    };

    // --- CPM LOGIC placeholder ---
    const calculateCPM = (tasks: Actividad[]): Actividad[] => {
        // This is a simplified Forward Pass.
        // A real implementation needs a topological sort first.

        // 1. Initialize starts 
        const taskMap = new Map<string, Actividad>();
        tasks.forEach(t => {
            t.start_date = new Date(); // Default today
            t.end_date = new Date();
            taskMap.set(t.id, t);
        });

        let changed = true;
        while (changed) {
            changed = false;
            tasks.forEach(t => {
                let maxPrevEnd = new Date().getTime(); // Project Start

                if (t.dependencias && t.dependencias.length > 0) {
                    t.dependencias.forEach(depId => {
                        const dep = taskMap.get(depId);
                        if (dep && dep.end_date) {
                            if (dep.end_date.getTime() > maxPrevEnd) {
                                maxPrevEnd = dep.end_date.getTime();
                            }
                        }
                    });
                }

                const newStart = new Date(maxPrevEnd);
                const newEnd = new Date(maxPrevEnd + (t.duracion * 24 * 60 * 60 * 1000));

                if (t.start_date?.getTime() !== newStart.getTime() || t.end_date?.getTime() !== newEnd.getTime()) {
                    t.start_date = newStart;
                    t.end_date = newEnd;
                    changed = true;
                }
            });
        }
        return tasks;
    }

    const handleSave = async () => {
        if (!selectedObraId) return;
        try {
            const payload = {
                obra_id: selectedObraId,
                descripcion: desc,
                duracion: duracion,
                dependencias: preds
            };

            if (editingId) {
                await supabase.from('actividades_obra').update(payload).eq('id', editingId);
            } else {
                await supabase.from('actividades_obra').insert(payload);
            }
            setShowModal(false);
            fetchActividades();
        } catch (err) {
            alert('Error al guardar');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Eliminar actividad?')) return;
        await supabase.from('actividades_obra').delete().eq('id', id);
        fetchActividades();
    };

    // Prepare Gantt Data
    const ganttData = [
        [
            { type: "string", label: "Task ID" },
            { type: "string", label: "Task Name" },
            { type: "string", label: "Resource" },
            { type: "date", label: "Start Date" },
            { type: "date", label: "End Date" },
            { type: "number", label: "Duration" },
            { type: "number", label: "Percent Complete" },
            { type: "string", label: "Dependencies" },
        ],
        ...actividades.map(t => [
            t.id,
            t.descripcion,
            t.es_critica ? "critical" : null,
            t.start_date,
            t.end_date,
            null, // Duration calculated by dates
            0, // Percent complete
            t.dependencias?.join(',') || null
        ])
    ];

    return (
        <div className="container py-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h3>Gestión de Actividades y Gantt</h3>
                <Link to="/reporte-avance" className="btn btn-outline-secondary">Volver</Link>
            </div>

            <Card className="mb-4 shadow-sm bg-light">
                <Card.Body className="d-flex align-items-center gap-3 p-3">
                    <Form.Label className="fw-bold mb-0 text-nowrap">Seleccionar Obra:</Form.Label>
                    <Form.Select
                        value={selectedObraId}
                        onChange={(e) => setSelectedObraId(e.target.value)}
                        style={{ maxWidth: '400px' }}
                    >
                        <option value="">-- Seleccione una obra --</option>
                        {obras.map(o => (
                            <option key={o.id} value={o.id}>{o.nombre_obra}</option>
                        ))}
                    </Form.Select>
                </Card.Body>
            </Card>

            {selectedObraId ? (
                <>

                    <Card className="mb-4">
                        <Card.Header className="d-flex justify-content-between align-items-center">
                            <h5 className="mb-0">Lista de Actividades</h5>
                            <Button onClick={() => {
                                setEditingId(null);
                                setDesc('');
                                setDuracion(1);
                                setPreds([]);
                                setShowModal(true);
                            }}>Nueva Actividad</Button>
                        </Card.Header>
                        <Card.Body>
                            <Table striped hover responsive>
                                <thead>
                                    <tr>
                                        <th>Descripción</th>
                                        <th>Duración (días)</th>
                                        <th>Dependencias (IDs)</th>
                                        <th>Inicio (Est.)</th>
                                        <th>Fin (Est.)</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {actividades.map(a => (
                                        <tr key={a.id} className={a.es_critica ? 'table-danger' : ''}>
                                            <td>{a.descripcion} {a.es_critica && <span className="badge bg-danger">Crítica</span>}</td>
                                            <td>{a.duracion}</td>
                                            <td>
                                                {a.dependencias?.map(d => (
                                                    <span key={d} className="badge bg-secondary me-1">{d.substring(0, 4)}...</span>
                                                ))}
                                            </td>
                                            <td>{a.start_date?.toLocaleDateString()}</td>
                                            <td>{a.end_date?.toLocaleDateString()}</td>
                                            <td>
                                                <Button size="sm" variant="outline-primary" className="me-1" onClick={() => {
                                                    setEditingId(a.id);
                                                    setDesc(a.descripcion);
                                                    setDuracion(a.duracion);
                                                    setPreds(a.dependencias);
                                                    setShowModal(true);
                                                }}><i className="bi bi-pencil"></i></Button>
                                                <Button size="sm" variant="outline-danger" onClick={() => handleDelete(a.id)}>
                                                    <i className="bi bi-trash"></i>
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </Card.Body>
                    </Card>

                    <Card>
                        <Card.Header>Diagrama de Gantt</Card.Header>
                        <Card.Body>
                            {actividades.length > 0 ? (
                                <Chart
                                    chartType="Gantt"
                                    width="100%"
                                    height="400px"
                                    data={ganttData}
                                    options={{
                                        height: 400,
                                        gantt: {
                                            trackHeight: 30,
                                            criticalPathEnabled: true,
                                            criticalPathStyle: {
                                                stroke: '#e64a19',
                                                strokeWidth: 2,
                                            }
                                        }
                                    }}
                                />
                            ) : <p className="text-center py-5">No hay actividades para mostrar</p>}
                        </Card.Body>
                    </Card>

                    <Modal show={showModal} onHide={() => setShowModal(false)}>
                        <Modal.Header closeButton>
                            <Modal.Title>{editingId ? 'Editar' : 'Nueva'} Actividad</Modal.Title>
                        </Modal.Header>
                        <Modal.Body>
                            <Form>
                                <Form.Group className="mb-3">
                                    <Form.Label>Descripción</Form.Label>
                                    <Form.Control value={desc} onChange={e => setDesc(e.target.value)} />
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label>Duración (Días)</Form.Label>
                                    <Form.Control type="number" min="1" value={duracion} onChange={e => setDuracion(parseInt(e.target.value))} />
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label>Dependencias (Seleccionar Predecesoras)</Form.Label>
                                    <Form.Select multiple value={preds} onChange={e => {
                                        const options = [...e.target.selectedOptions];
                                        const values = options.map(option => option.value);
                                        setPreds(values);
                                    }}>
                                        {actividades.filter(a => a.id !== editingId).map(a => (
                                            <option key={a.id} value={a.id}>{a.descripcion}</option>
                                        ))}
                                    </Form.Select>
                                    <Form.Text className="text-muted">Ctrl+Click para seleccionar múltiples</Form.Text>
                                </Form.Group>
                            </Form>
                        </Modal.Body>
                        <Modal.Footer>
                            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
                            <Button variant="primary" onClick={handleSave}>Guardar</Button>
                        </Modal.Footer>
                    </Modal>

                </>
            ) : (
                <div className="text-center py-5 text-muted">
                    <h4>Seleccione una obra para ver sus actividades</h4>
                    <i className="bi bi-arrow-up-circle fs-1"></i>
                </div>
            )}
        </div>
    );
};

export default GestionActividades;
