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
    categoria?: string;
    prioridad?: string;
    responsable_id?: string;
    fotos?: string[];
}

interface Usuario {
    id: string;
    nombre: string;
    email: string;
    rol: string;
}

interface Comentario {
    id: string;
    comentario: string;
    created_at: string;
    usuario: { nombre: string; email: string };
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

    // New Fields State
    const [categoria, setCategoria] = useState('otros');
    const [prioridad, setPrioridad] = useState('media');
    const [responsable, setResponsable] = useState('');
    const [fotos, setFotos] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);

    const [usersList, setUsersList] = useState<Usuario[]>([]);

    // Comments State
    const [comentarios, setComentarios] = useState<Comentario[]>([]);
    const [newComment, setNewComment] = useState('');
    const [loadingComments, setLoadingComments] = useState(false);

    useEffect(() => {
        fetchObras();
        fetchUsers();
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

    const fetchUsers = async () => {
        try {
            const { data, error } = await supabase
                .from('usuarios')
                .select('*')
                .order('nombre');

            if (error) throw error;
            setUsersList(data || []);
        } catch (err) {
            console.error('Error fetching users:', err);
        }
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        setUploading(true);

        try {
            const file = e.target.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('incidencias-fotos')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // Get Public URL
            const { data } = supabase.storage
                .from('incidencias-fotos')
                .getPublicUrl(filePath);

            setFotos([...fotos, data.publicUrl]);
        } catch (error: any) {
            alert('Error al subir foto: ' + error.message);
        } finally {
            setUploading(false);
        }
    };

    const fetchComentarios = async (incidenciaId: string) => {
        setLoadingComments(true);
        try {
            const { data, error } = await supabase
                .from('incidencia_comentarios')
                .select(`
                    id, 
                    comentario, 
                    created_at, 
                    usuario:usuario_id (nombre, email)
                `)
                .eq('incidencia_id', incidenciaId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            // Map result to match interface (Supabase returns array generic)
            const mapped = (data || []).map((c: any) => ({
                id: c.id,
                comentario: c.comentario,
                created_at: c.created_at,
                usuario: c.usuario
            }));
            setComentarios(mapped);
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingComments(false);
        }
    };

    const handleAddComentario = async () => {
        if (!newComment.trim() || !editingId || !user) return;

        try {
            const { error } = await supabase
                .from('incidencia_comentarios')
                .insert([{
                    incidencia_id: editingId,
                    usuario_id: user.id,
                    comentario: newComment
                }]);

            if (error) throw error;

            setNewComment('');
            fetchComentarios(editingId);
        } catch (err: any) {
            alert('Error al agregar comentario: ' + err.message);
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
        const { getTelegramConfig, sendTelegramMessage } = await import('../services/telegramService');
        const { getWhatsAppConfig, sendWhatsAppMessage } = await import('../services/whatsappService');

        if (!selectedObra) return setMessage({ type: 'danger', text: 'Seleccione una obra' });

        setSubmitting(true);
        setMessage(null);

        try {
            if (!editingId) {
                // Create new
                const { error } = await supabase
                    .from('incidencias')
                    .insert([{
                        obra_id: selectedComponent, // Always link to component/obra selected
                        descripcion,
                        impacto_estimado: impacto,
                        fecha_reporte: new Date().toISOString(),
                        estado_actual: estado,
                        porcentaje_resolucion: resolucion,
                        categoria,
                        prioridad,
                        responsable_id: responsable || null,
                        fotos
                    }]);
                if (error) throw error;
                setMessage({ type: 'success', text: 'Incidencia registrada' });

                // TELEGRAM & WHATSAPP ALERT
                if (prioridad === 'alta' || prioridad === 'critica') {
                    const { token, chatId } = getTelegramConfig();
                    const { phone, apiKey } = getWhatsAppConfig();
                    const workName = obras.find(o => o.id === selectedObra)?.nombre_obra;

                    const msg = `🚨 *NUEVA INCIDENCIA CRÍTICA*\n\n*Obra:* ${workName}\n*Gravedad:* ${prioridad.toUpperCase()}\n*Categoría:* ${categoria}\n*Descripción:* ${descripcion}\n*Impacto:* ${impacto}`;

                    if (token && chatId) {
                        sendTelegramMessage(token, chatId, msg);
                    }
                    if (phone && apiKey) {
                        sendWhatsAppMessage(phone, apiKey, msg);
                    }
                }

            } else {
                // Update
                const { error } = await supabase
                    .from('incidencias')
                    .update({
                        descripcion,
                        impacto_estimado: impacto,
                        estado_actual: estado,
                        porcentaje_resolucion: resolucion,
                        categoria,
                        prioridad,
                        responsable_id: responsable || null,
                        fotos
                    })
                    .eq('id', editingId);
                if (error) throw error;
                setMessage({ type: 'success', text: 'Incidencia actualizada' });
            }

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
        setCategoria('otros');
        setPrioridad('media');
        setResponsable('');
        setFotos([]);
        // Do not reset selectedObra so they can keep working in context
    };

    const handleEdit = (inc: Incidencia) => {
        setEditingId(inc.id);
        setDescripcion(inc.descripcion);
        setImpacto(inc.impacto_estimado);
        setEstado(inc.estado_actual);
        setResolucion(inc.porcentaje_resolucion);
        setCategoria(inc.categoria || 'otros');
        setPrioridad(inc.prioridad || 'media');
        setResponsable(inc.responsable_id || '');
        setFotos(inc.fotos || []);

        // Load comments
        fetchComentarios(inc.id);

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
                                            disabled={!!editingId} // Usually good to lock context when editing
                                        >
                                            {/* Logic to show correct label for parent */}
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

                                {/* New Fields Row: Categoría, Prioridad, Responsable */}
                                <div className="row g-4 mb-4">
                                    <div className="col-md-4">
                                        <Form.Group>
                                            <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Categoría</Form.Label>
                                            <Form.Select size="lg" className="bg-light border-0" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                                                <option value="otros">Otros</option>
                                                <option value="tecnica">Técnica</option>
                                                <option value="administrativa">Administrativa</option>
                                                <option value="financiera">Financiera</option>
                                                <option value="seguridad">Seguridad</option>
                                                <option value="calidad">Calidad</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </div>
                                    <div className="col-md-4">
                                        <Form.Group>
                                            <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Prioridad</Form.Label>
                                            <Form.Select size="lg" className="bg-light border-0" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
                                                <option value="baja">Baja</option>
                                                <option value="media">Media</option>
                                                <option value="alta">Alta</option>
                                                <option value="critica">Crítica</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </div>
                                    <div className="col-md-4">
                                        <Form.Group>
                                            <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Responsable</Form.Label>
                                            <Form.Select size="lg" className="bg-light border-0" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
                                                <option value="">-- Sin asignar --</option>
                                                {usersList.map(u => <option key={u.id} value={u.id}>{u.nombre || u.email}</option>)}
                                            </Form.Select>
                                        </Form.Group>
                                    </div>
                                </div>

                                {/* Photos Upload */}
                                <Form.Group className="mb-4">
                                    <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Fotos / Evidencias</Form.Label>
                                    <div className="d-flex align-items-center gap-3">
                                        <Form.Control type="file" onChange={handlePhotoUpload} disabled={uploading} className="bg-light border-0" accept="image/*" />
                                        {uploading && <Spinner animation="border" size="sm" />}
                                    </div>

                                    {fotos && fotos.length > 0 && (
                                        <div className="d-flex flex-wrap gap-2 mt-3 p-3 bg-light rounded">
                                            {fotos.map((url, idx) => (
                                                <div key={idx} className="position-relative">
                                                    <a href={url} target="_blank" rel="noreferrer">
                                                        <img src={url} alt="Evidencia" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 8 }} />
                                                    </a>
                                                    <Button
                                                        size="sm"
                                                        variant="danger"
                                                        className="position-absolute top-0 end-0 p-0 rounded-circle shadow-sm"
                                                        style={{ width: 24, height: 24, transform: 'translate(30%, -30%)' }}
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            setFotos(fotos.filter((_, i) => i !== idx));
                                                        }}
                                                    >
                                                        <i className="bi bi-x" style={{ fontSize: 16 }}></i>
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </Form.Group>

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

                                {/* COMMENTS SECTION */}
                                {editingId && (
                                    <div className="mt-5 border-top pt-4">
                                        <h5 className="fw-bold text-secondary mb-3">Comentarios y Seguimiento</h5>

                                        <div className="bg-light p-3 rounded mb-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                            {loadingComments ? <Spinner animation="border" size="sm" /> :
                                                comentarios.length === 0 ? <p className="text-muted small mb-0">No hay comentarios aún.</p> :
                                                    comentarios.map(c => (
                                                        <div key={c.id} className="mb-3 border-bottom pb-2">
                                                            <div className="d-flex justify-content-between">
                                                                <strong className="small">{c.usuario?.nombre || c.usuario?.email || 'Usuario'}</strong>
                                                                <small className="text-muted">{new Date(c.created_at).toLocaleString()}</small>
                                                            </div>
                                                            <p className="mb-0 mt-1">{c.comentario}</p>
                                                        </div>
                                                    ))}
                                        </div>

                                        <div className="d-flex gap-2">
                                            <Form.Control
                                                type="text"
                                                placeholder="Escribe un comentario..."
                                                value={newComment}
                                                onChange={(e) => setNewComment(e.target.value)}
                                                onKeyPress={(e) => e.key === 'Enter' && handleAddComentario()}
                                            />
                                            <Button variant="outline-primary" onClick={handleAddComentario} disabled={!newComment.trim()}>
                                                <i className="bi bi-send-fill"></i>
                                            </Button>
                                        </div>
                                    </div>
                                )}
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
