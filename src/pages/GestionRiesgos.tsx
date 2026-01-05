import React, { useEffect, useState } from 'react';
import { Button, Form, Card, Table, Modal, Badge, Row, Col, Alert } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';

interface Obra {
    id: string;
    nombre_obra: string;
}

interface Riesgo {
    id: string;
    obra_id: string;
    descripcion: string;
    probabilidad: number; // 1-5
    impacto: number; // 1-5
    nivel_riesgo: number; // Prob * Imp
    estado: 'Identificado' | 'En Monitoreo' | 'Mitigado' | 'Cerrado';
    estrategia: 'Evitar' | 'Mitigar' | 'Transferir' | 'Aceptar';
    acciones_mitigacion: string;
    fecha_identificacion: string;
}

const GestionRiesgos = () => {
    const { } = useAuth();
    const [obras, setObras] = useState<Obra[]>([]);
    const [riesgos, setRiesgos] = useState<Riesgo[]>([]);
    const [selectedObraId, setSelectedObraId] = useState<string>('');
    const [showModal, setShowModal] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<Riesgo>>({
        probabilidad: 3,
        impacto: 3,
        estado: 'Identificado',
        estrategia: 'Mitigar',
        acciones_mitigacion: '',
        descripcion: ''
    });
    const [editingId, setEditingId] = useState<string | null>(null);

    const fetchObras = async () => {
        try {
            // Fetch allowed obras based on role (reuse logic or fetch all for now, assuming RLS handles it)
            const { data, error } = await supabase
                .from('obras')
                .select('id, nombre_obra')

            if (error) throw error;
            setObras(data || []);
            if (data && data.length > 0) {
                // If query param exists? or just first one
                if (!selectedObraId) setSelectedObraId(data[0].id);
            }
        } catch (err: any) {
            console.error('Error fetching obras:', err);
        }
    };

    const fetchRiesgos = async () => {
        if (!selectedObraId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('riesgos')
                .select('*')
                .eq('obra_id', selectedObraId)
                .order('nivel_riesgo', { ascending: false });

            if (error) throw error;
            setRiesgos(data || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchObras();
    }, []);

    useEffect(() => {
        fetchRiesgos();
    }, [selectedObraId]);

    const handleSave = async () => {
        if (!selectedObraId || !formData.descripcion) {
            setError('Por favor complete la descripción.');
            return;
        }

        const nivel = (formData.probabilidad || 1) * (formData.impacto || 1);
        const payload = {
            ...formData,
            obra_id: selectedObraId,
            nivel_riesgo: nivel,
            fecha_identificacion: formData.fecha_identificacion || new Date().toISOString().split('T')[0]
        };

        setLoading(true);
        try {
            if (editingId) {
                const { error } = await supabase.from('riesgos').update(payload).eq('id', editingId);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('riesgos').insert([payload]);
                if (error) throw error;
            }
            setShowModal(false);
            resetForm();
            fetchRiesgos();
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('¿Eliminar este riesgo?')) return;
        try {
            const { error } = await supabase.from('riesgos').delete().eq('id', id);
            if (error) throw error;
            fetchRiesgos();
        } catch (err: any) {
            setError(err.message);
        }
    }

    const resetForm = () => {
        setFormData({
            probabilidad: 3,
            impacto: 3,
            estado: 'Identificado',
            estrategia: 'Mitigar',
            acciones_mitigacion: '',
            descripcion: '',
            fecha_identificacion: new Date().toISOString().split('T')[0]
        });
        setEditingId(null);
    };

    const openEdit = (r: Riesgo) => {
        setFormData(r);
        setEditingId(r.id);
        setShowModal(true);
    };

    // --- Heatmap Logic ---
    const getRiskColor = (prob: number, imp: number) => {
        const score = prob * imp;
        if (score >= 15) return 'danger'; // Extreme
        if (score >= 10) return 'warning'; // High
        if (score >= 5) return 'info'; // Medium (yellowish)
        return 'success'; // Low
    };

    // Helper to place items in matrix
    const getMatrixItems = (p: number, i: number) => {
        return riesgos.filter(r => r.probabilidad === p && r.impacto === i);
    };

    return (
        <div className="container-fluid p-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2>🛡️ Matriz de Riesgos y Restricciones</h2>
                <Button onClick={() => { resetForm(); setShowModal(true); }}>+ Nuevo Riesgo</Button>
            </div>

            {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}

            <Card className="mb-4">
                <Card.Body>
                    <Form.Group as={Row}>
                        <Form.Label column sm="2">Seleccionar Obra:</Form.Label>
                        <Col sm="10">
                            <Form.Select
                                value={selectedObraId}
                                onChange={(e) => setSelectedObraId(e.target.value)}
                            >
                                <option value="">Seleccione una obra...</option>
                                {obras.map(o => (
                                    <option key={o.id} value={o.id}>{o.nombre_obra}</option>
                                ))}
                            </Form.Select>
                        </Col>
                    </Form.Group>
                </Card.Body>
            </Card>

            <Row>
                <Col md={6}>
                    <Card className="h-100">
                        <Card.Header>Mapa de Calor (Heatmap)</Card.Header>
                        <Card.Body>
                            <div className="d-flex">
                                {/* Y-Axis Label */}
                                <div className="d-flex align-items-center justify-content-center bg-light rounded me-2" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', width: '30px', fontWeight: 'bold' }}>
                                    PROBABILIDAD
                                </div>

                                {/* Matrix Grid */}
                                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '30px repeat(5, 1fr)', gap: '5px' }}>
                                    {/* Header Row (Impact X-Axis) */}
                                    <div></div> {/* Corner */}
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <div key={`h-${i}`} className="text-center fw-bold">{i}</div>
                                    ))}

                                    {/* Matrix Rows (5 to 1) */}
                                    {[5, 4, 3, 2, 1].map(prob => (
                                        <React.Fragment key={`row-${prob}`}>
                                            {/* Row Header */}
                                            <div className="fw-bold text-center d-flex align-items-center justify-content-center">{prob}</div>

                                            {/* Cells */}
                                            {[1, 2, 3, 4, 5].map(imp => {
                                                const items = getMatrixItems(prob, imp);
                                                const score = prob * imp;

                                                // Custom Risk Colors
                                                let bg = '#ccffcc'; // Green
                                                if (score >= 15) bg = '#ffcccc'; // Red
                                                else if (score >= 10) bg = '#ffebcc'; // Orange
                                                else if (score >= 5) bg = '#ffffcc'; // Yellow

                                                return (
                                                    <div
                                                        key={`cell-${prob}-${imp}`}
                                                        style={{ backgroundColor: bg, border: '1px solid #ddd', minHeight: '60px', padding: '5px', fontSize: '0.8rem' }}
                                                        className="d-flex flex-wrap gap-1 align-content-start"
                                                        onClick={() => {
                                                            // Optional: click empty cell to add risk there?
                                                            // For now, just keep item clicks
                                                        }}
                                                    >
                                                        {items.map(msg => (
                                                            <div
                                                                key={msg.id}
                                                                title={`${msg.descripcion} (Nivel: ${msg.nivel_riesgo})`}
                                                                className="rounded-circle bg-dark text-white d-flex justify-content-center align-items-center"
                                                                style={{ width: '24px', height: '24px', cursor: 'pointer', fontSize: '0.7em' }}
                                                                onClick={(e) => { e.stopPropagation(); openEdit(msg); }}
                                                            >
                                                                {msg.id.substring(0, 2)}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )
                                            })}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>

                            <div className="text-center fw-bold mt-2">IMPACTO</div>

                            <div className="mt-3 small text-muted text-center border-top pt-2">
                                <div className="d-flex justify-content-center gap-3">
                                    <span className="d-flex align-items-center"><span style={{ width: 15, height: 15, background: '#ccffcc', display: 'inline-block', marginRight: 5, border: '1px solid #ccc' }}></span> 1-4 Bajo</span>
                                    <span className="d-flex align-items-center"><span style={{ width: 15, height: 15, background: '#ffffcc', display: 'inline-block', marginRight: 5, border: '1px solid #ccc' }}></span> 5-9 Medio</span>
                                    <span className="d-flex align-items-center"><span style={{ width: 15, height: 15, background: '#ffebcc', display: 'inline-block', marginRight: 5, border: '1px solid #ccc' }}></span> 10-14 Alto</span>
                                    <span className="d-flex align-items-center"><span style={{ width: 15, height: 15, background: '#ffcccc', display: 'inline-block', marginRight: 5, border: '1px solid #ccc' }}></span> 15-25 Extremo</span>
                                </div>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={6}>
                    <Card className="h-100">
                        <Card.Header>Listado de Riesgos</Card.Header>
                        <Card.Body style={{ overflowY: 'auto', maxHeight: '500px' }}>
                            <Table striped bordered hover size="sm">
                                <thead>
                                    <tr>
                                        <th>Desc</th>
                                        <th>P x I</th>
                                        <th>Nivel</th>
                                        <th>Estado</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {riesgos.map(r => (
                                        <tr key={r.id}>
                                            <td>{r.descripcion}</td>
                                            <td>{r.probabilidad} x {r.impacto}</td>
                                            <td>
                                                <Badge bg={getRiskColor(r.probabilidad, r.impacto) === 'info' ? 'warning' : getRiskColor(r.probabilidad, r.impacto)}>
                                                    {r.nivel_riesgo}
                                                </Badge>
                                            </td>
                                            <td>{r.estado}</td>
                                            <td>
                                                <Button size="sm" variant="outline-primary" onClick={() => openEdit(r)}>✏️</Button>
                                                {' '}
                                                <Button size="sm" variant="outline-danger" onClick={() => handleDelete(r.id)}>🗑️</Button>
                                            </td>
                                        </tr>
                                    ))}
                                    {riesgos.length === 0 && <tr><td colSpan={5} className="text-center">No hay riesgos registrados.</td></tr>}
                                </tbody>
                            </Table>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>{editingId ? 'Editar Riesgo' : 'Nuevo Riesgo'}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Row>
                            <Col md={12}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Descripción del Riesgo</Form.Label>
                                    <Form.Control
                                        as="textarea" rows={2}
                                        value={formData.descripcion}
                                        onChange={e => setFormData({ ...formData, descripcion: e.target.value })}
                                        placeholder="Ej: Retraso en llegada de cemento por bloqueo de carretera..."
                                    />
                                </Form.Group>
                            </Col>
                        </Row>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Probabilidad (1: Raro - 5: Casi Seguro)</Form.Label>
                                    <Form.Range
                                        min={1} max={5}
                                        value={formData.probabilidad}
                                        onChange={e => setFormData({ ...formData, probabilidad: parseInt(e.target.value) })}
                                    />
                                    <div className="text-center fw-bold">{formData.probabilidad}</div>
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Impacto (1: Insignificante - 5: Catastrófico)</Form.Label>
                                    <Form.Range
                                        min={1} max={5}
                                        value={formData.impacto}
                                        onChange={e => setFormData({ ...formData, impacto: parseInt(e.target.value) })}
                                    />
                                    <div className="text-center fw-bold">{formData.impacto}</div>
                                </Form.Group>
                            </Col>
                        </Row>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Estrategia</Form.Label>
                                    <Form.Select
                                        value={formData.estrategia}
                                        onChange={(e: any) => setFormData({ ...formData, estrategia: e.target.value })}
                                    >
                                        <option>Mitigar</option>
                                        <option>Evitar</option>
                                        <option>Transferir</option>
                                        <option>Aceptar</option>
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Estado</Form.Label>
                                    <Form.Select
                                        value={formData.estado}
                                        onChange={(e: any) => setFormData({ ...formData, estado: e.target.value })}
                                    >
                                        <option>Identificado</option>
                                        <option>En Monitoreo</option>
                                        <option>Mitigado</option>
                                        <option>Cerrado</option>
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                        </Row>
                        <Form.Group className="mb-3">
                            <Form.Label>Acciones de Mitigación / Contingencia</Form.Label>
                            <Form.Control
                                as="textarea" rows={3}
                                value={formData.acciones_mitigacion}
                                onChange={e => setFormData({ ...formData, acciones_mitigacion: e.target.value })}
                                placeholder="Plan de acción..."
                            />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Fecha Identificación</Form.Label>
                            <Form.Control
                                type="date"
                                value={formData.fecha_identificacion}
                                onChange={e => setFormData({ ...formData, fecha_identificacion: e.target.value })}
                            />
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
                    <Button variant="primary" onClick={handleSave} disabled={loading}>
                        {loading ? 'Guardando...' : 'Guardar Riesgo'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
};

export default GestionRiesgos;
