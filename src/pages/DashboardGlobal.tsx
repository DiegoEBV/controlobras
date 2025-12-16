
import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Form, Badge, Table, Alert, Spinner } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { createObra, createComponent, fetchCoordinators, fetchObraComponents } from '../services/adminService';
import CurvaSChart, { type CurveDataPoint } from '../components/charts/CurvaSChart';
import { Modal, Button } from 'react-bootstrap';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

// Types
interface Obra {
    id: string;
    nombre_obra: string;
    type?: string;
    parent_id?: string;
}
interface Incidencia {
    id: string;
    descripcion: string; // Fixed: descripcion instead of titulo
    estado_actual: string;
    impacto_estimado: string;
}
interface Actividad {
    id: string;
    nombre_partida: string;
    es_critica: boolean;
}

const DashboardGlobal: React.FC = () => {
    const { role, user } = useAuth();
    const [obras, setObras] = useState<Obra[]>([]);
    const [selectedObraId, setSelectedObraId] = useState<string>('');
    const [components, setComponents] = useState<Obra[]>([]);
    const [selectedComponentId, setSelectedComponentId] = useState<string>('');

    const [curveData, setCurveData] = useState<CurveDataPoint[]>([]);
    const [incidents, setIncidents] = useState<Incidencia[]>([]);
    const [criticalActivities, setCriticalActivities] = useState<Actividad[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal State
    const [showModal, setShowModal] = useState(false);
    const [newObraName, setNewObraName] = useState('');
    const [coordinators, setCoordinators] = useState<any[]>([]);
    const [selectedCoord, setSelectedCoord] = useState('');
    const [creating, setCreating] = useState(false);

    // Component Modal State
    const [showComponentModal, setShowComponentModal] = useState(false);
    const [newComponentName, setNewComponentName] = useState('');
    const [newComponentType, setNewComponentType] = useState<'adicional' | 'entregable'>('adicional');

    useEffect(() => {
        fetchObras();
        if (role === 'jefe') {
            loadCoordinators();
        }
    }, [role]);

    const loadCoordinators = async () => {
        const coords = await fetchCoordinators();
        setCoordinators(coords);
    };

    useEffect(() => {
        if (selectedObraId) {
            // Fetch children
            loadComponents(selectedObraId);
            // Default to main contract
            setSelectedComponentId(selectedObraId);
        } else {
            setComponents([]);
            setSelectedComponentId('');
        }
    }, [selectedObraId]);

    useEffect(() => {
        if (selectedComponentId || selectedObraId) {
            // Prefer component ID if selected
            fetchDashboardData(selectedComponentId || selectedObraId);
        } else {
            setCurveData([]);
            setIncidents([]);
            setCriticalActivities([]);
        }
    }, [selectedComponentId, selectedObraId]);

    const loadComponents = async (parentId: string) => {
        const children = await fetchObraComponents(parentId);
        setComponents(children);
    };

    const fetchObras = async () => {
        try {
            // Only fetch main works (obras principales), not components
            const { data, error } = await supabase
                .from('obras')
                .select('id, nombre_obra, type, parent_id')
                .is('parent_id', null); // Only get obras without parent (main works)

            if (error) throw error;
            setObras(data || []);
            if (data && data.length > 0) {
                setSelectedObraId(data[0].id); // Select first by default
            }
        } catch (err) {
            console.error('Error fetching obras:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchDashboardData = async (obraId: string) => {
        setLoading(true);
        try {
            // 1. Fetch Curve Data (View)
            // Note: Views are accessed like tables in Supabase JS
            const { data: curve, error: curveError } = await supabase
                .from('vista_curva_s')
                .select('*')
                .eq('obra_id', obraId)
                .order('periodo_reporte', { ascending: true });

            if (curveError) console.error('Error fetching curve:', curveError);

            // Map to chart format
            const formattedCurve: CurveDataPoint[] = (curve || []).map(item => ({
                periodo: item.periodo_reporte,
                programado_acumulado: item.programado_acumulado,
                ejecutado_acumulado: item.ejecutado_acumulado
            }));
            setCurveData(formattedCurve);

            // 2. Fetch Open Incidents
            const { data: incs, error: incError } = await supabase
                .from('incidencias')
                .select('*')
                .eq('obra_id', obraId)
                .neq('estado_actual', 'Cerrada');

            if (incError) console.error('Error fetching incidents:', incError);
            setIncidents(incs || []);

            // 3. Fetch Critical Activities (Optional: Logic for "Desviacion significativa" would go here)
            // For now, just show Critical Activities
            const { data: acts, error: actError } = await supabase
                .from('actividades_obra')
                .select('*')
                .eq('obra_id', obraId)
                .eq('es_critica', true);

            if (actError) console.error('Error fetching activities:', actError);
            setCriticalActivities(acts || []);

        } catch (err) {
            console.error(err);
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

    const handleCreateComponent = async () => {
        if (!newComponentName || !selectedObraId || !user) return;
        setCreating(true);

        // Use the current authenticated user's ID as the coordinator
        // This way coordinators create components assigned to themselves
        const coordinatorId = user.id;

        const { error } = await createComponent(selectedObraId, newComponentName, newComponentType, coordinatorId);
        setCreating(false);

        if (error) {
            alert('Error al crear componente: ' + error.message);
        } else {
            setShowComponentModal(false);
            setNewComponentName('');
            loadComponents(selectedObraId); // Refresh components list
        }
    };

    const handleExportPDF = async () => {
        if (!selectedObraId) return;
        const btn = document.getElementById('btn-export-pdf');
        if (btn) btn.innerText = 'Generando...';

        try {
            // Fetch detailed Valorizaciones for Table
            const { data: vals } = await supabase.from('valorizaciones').select('*').eq('obra_id', selectedObraId).order('periodo_reporte');

            const doc = new jsPDF();
            const obraName = obras.find(o => o.id === selectedObraId)?.nombre_obra || 'Obra';

            // Title
            doc.setFontSize(18);
            doc.text(`Reporte de Control: ${obraName}`, 14, 20);
            doc.setFontSize(12);
            doc.text(`Fecha de Emisión: ${new Date().toLocaleDateString()}`, 14, 28);
            doc.text(`Generado por: Jefe de Obra`, 14, 34);

            let yPos = 45;

            // Chart Capture
            const input = document.getElementById('s-curve-chart');
            if (input) {
                doc.setFontSize(14);
                doc.text("1. Avance - Curva S", 14, yPos);
                yPos += 5;

                const canvas = await html2canvas(input, { scale: 2 });
                const imgData = canvas.toDataURL('image/png');
                const imgWidth = 180;
                const imgHeight = (canvas.height * imgWidth) / canvas.width;

                doc.addImage(imgData, 'PNG', 14, yPos, imgWidth, imgHeight);
                yPos += imgHeight + 10;
            }

            // Financial Table
            if (yPos > 250) { doc.addPage(); yPos = 20; }
            doc.setFontSize(14);
            doc.text("2. Detalle Financiero", 14, yPos);
            yPos += 5;

            const tableBody = (vals || []).map(v => [
                new Date(v.periodo_reporte).toLocaleDateString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
                `S/ ${(v.monto_programado_periodo || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`,
                `S/ ${(v.monto_ejecutado_periodo || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`
            ]);

            autoTable(doc, {
                startY: yPos,
                head: [['Periodo', 'Programado', 'Ejecutado']],
                body: tableBody,
                headStyles: { fillColor: [13, 110, 253] }, // Bootstrap Primary
            });

            // Update yPos after table
            yPos = (doc as any).lastAutoTable.finalY + 15;

            // Incidents Table
            if (yPos > 240) { doc.addPage(); yPos = 20; }
            doc.text("3. Incidencias Abiertas", 14, yPos);
            yPos += 5;
            const incidentsBody = incidents.map(i => [
                i.descripcion,
                i.impacto_estimado,
                i.estado_actual
            ]);

            autoTable(doc, {
                startY: yPos,
                head: [['Descripción', 'Impacto', 'Estado']],
                body: incidentsBody,
                headStyles: { fillColor: [220, 53, 69] }, // Bootstrap Danger color for incidents
            });

            doc.save(`Reporte_${obraName.replace(/\s+/g, '_')}.pdf`);
        } catch (err) {
            console.error("Error generating PDF", err);
            alert("Error al generar PDF");
        } finally {
            if (btn) btn.innerText = 'Exportar Reporte PDF';
        }
    };

    // Calculate SPI
    const calculateSPI = () => {
        if (!curveData || curveData.length === 0) return { value: '--', color: 'text-muted' };

        // Find the last period with executed data or just the last period
        // Depending on logic, usually SPI is based on current progress vs planned at that point.
        // We will take the last data point that has a non-zero executed value, 
        // OR if all are zero, the very first one or just return --.

        // Let's take the latest record from the view. 
        // Assuming view is ordered by date.

        // Filter for points where executed_accum is present (>0 to avoid early months if data is sparse, but executed_accum usually starts at 0 and goes up)
        // Actually, if we are in month 5, we want month 5's accumulation.
        const latestPoint = curveData[curveData.length - 1];

        if (!latestPoint || !latestPoint.programado_acumulado) return { value: '--', color: 'text-muted' };

        const ev = latestPoint.ejecutado_acumulado;
        const pv = latestPoint.programado_acumulado;

        if (pv === 0) return { value: '--', color: 'text-muted' };

        const spi = ev / pv;
        const color = spi >= 1 ? 'text-success' : 'text-danger';

        return { value: spi.toFixed(2), color };
    };

    const spiData = calculateSPI();

    if (loading && obras.length === 0) return <Spinner animation="border" />;

    return (
        <div className="animate-fade-in">
            <Row className="mb-4 align-items-center">
                <Col md={8}>
                    <h2 className="mb-0 fw-bold">Dashboard de Control</h2>
                    <p className="text-muted">Vista consolidada del estado de las obras</p>
                </Col>
                <Col md={4} className="d-flex gap-2 align-items-end">
                    <div className="flex-grow-1">
                        <Form.Label className="small text-muted text-uppercase fw-bold">Seleccionar Obra</Form.Label>
                        <Form.Select
                            value={selectedObraId}
                            onChange={(e) => setSelectedObraId(e.target.value)}
                            className="bg-light border-0 shadow-sm"
                        >
                            {obras.map(o => (
                                <option key={o.id} value={o.id}>{o.nombre_obra}</option>
                            ))}
                        </Form.Select>
                    </div>

                    {/* Sub-Work Selector */}
                    {components.length > 0 && (
                        <div className="flex-grow-1">
                            <Form.Label className="small text-muted text-uppercase fw-bold">Componente / Adicional</Form.Label>
                            <Form.Select
                                value={selectedComponentId}
                                onChange={(e) => setSelectedComponentId(e.target.value)}
                                className="bg-light border-0 shadow-sm"
                            >
                                <option value={selectedObraId}>Contrato Principal</option>
                                {components.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.type === 'adicional' ? 'Adicional: ' : c.type === 'entregable' ? 'Entregable: ' : ''}
                                        {c.nombre_obra}
                                    </option>
                                ))}
                            </Form.Select>
                        </div>
                    )}
                    {role === 'jefe' && (
                        <Button
                            variant="primary"
                            className="shadow-primary text-nowrap"
                            onClick={() => setShowModal(true)}
                        >
                            + Nueva Obra
                        </Button>
                    )}
                    {(role === 'coordinador') && selectedObraId && (
                        <Button
                            variant="outline-primary"
                            className="shadow-sm ms-2"
                            onClick={() => setShowComponentModal(true)}
                        >
                            + Componente
                        </Button>
                    )}
                    {role === 'jefe' && (
                        <Button
                            id="btn-export-pdf"
                            variant="outline-danger"
                            className="shadow-sm ms-2"
                            onClick={handleExportPDF}
                        >
                            <i className="bi bi-file-earmark-pdf me-2"></i>Exportar Reporte PDF
                        </Button>
                    )}
                </Col>
            </Row>

            {obras.length === 0 ? (
                <Alert variant="info">No hay obras registradas en el sistema.</Alert>
            ) : (
                <>
                    {/* KPI Cards Placeholder */}
                    <Row className="mb-4">
                        <Col md={3}>
                            <Card className="text-center shadow-sm border-0">
                                <Card.Body>
                                    <h3 className="text-muted opacity-75">SPI</h3>
                                    <div className={`display-4 fw-bold ${spiData.color}`}>{spiData.value}</div>
                                    <small className="text-muted">Índice de Desempeño del Cronograma</small>
                                </Card.Body>
                            </Card>
                        </Col>
                        {/* Add more KPIs if needed */}
                    </Row>

                    <Row className="mb-4">
                        <Col md={12}>
                            <CurvaSChart data={curveData} title={`Curva S: ${obras.find(o => o.id === selectedObraId)?.nombre_obra || ''}`} />
                        </Col>
                    </Row>

                    <Row>
                        <Col md={6}>
                            <Card className="shadow-sm border-0 h-100">
                                <Card.Header className="bg-white fw-bold text-danger">🚨 Incidencias Abiertas</Card.Header>
                                <Card.Body>
                                    {incidents.length === 0 ? (
                                        <p className="text-muted text-center my-3">No hay incidencias activas.</p>
                                    ) : (
                                        <Table hover responsive size="sm">
                                            <thead>
                                                <tr>
                                                    <th>Descripción</th>
                                                    <th>Impacto</th>
                                                    <th>Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {incidents.map(inc => (
                                                    <tr key={inc.id}>
                                                        <td>{inc.descripcion}</td>
                                                        <td>{inc.impacto_estimado}</td>
                                                        <td><Badge bg="warning" text="dark">{inc.estado_actual}</Badge></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>

                        <Col md={6}>
                            <Card className="shadow-sm border-0 h-100">
                                <Card.Header className="bg-white fw-bold text-warning">⚠️ Partidas Críticas</Card.Header>
                                <Card.Body>
                                    {criticalActivities.length === 0 ? (
                                        <p className="text-muted text-center my-3">No hay partidas críticas registradas.</p>
                                    ) : (
                                        <Table hover responsive size="sm">
                                            <thead>
                                                <tr>
                                                    <th>Partida</th>
                                                    <th>Critica</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {criticalActivities.map(act => (
                                                    <tr key={act.id}>
                                                        <td>{act.nombre_partida}</td>
                                                        <td><Badge bg="danger">CRÍTICA</Badge></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>
                </>
            )}
            {/* Modal Nueva Obra */}
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

            {/* Modal Nuevo Componente */}
            <Modal show={showComponentModal} onHide={() => setShowComponentModal(false)} centered>
                <Modal.Header closeButton className="border-0">
                    <Modal.Title className="fw-bold text-primary">Agregar Componente</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Tipo</Form.Label>
                            <Form.Select
                                value={newComponentType}
                                onChange={(e) => setNewComponentType(e.target.value as any)}
                            >
                                <option value="adicional">Adicional</option>
                                <option value="entregable">Entregable</option>
                            </Form.Select>
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Nombre</Form.Label>
                            <Form.Control
                                type="text"
                                placeholder="Ej. Adicional N° 1 - Cerco Perimétrico"
                                value={newComponentName}
                                onChange={(e) => setNewComponentName(e.target.value)}
                                autoFocus
                            />
                        </Form.Group>
                        <input type="hidden" value={selectedCoord} />
                    </Form>
                </Modal.Body>
                <Modal.Footer className="border-0">
                    <Button variant="light" onClick={() => setShowComponentModal(false)}>Cancelar</Button>
                    <Button variant="primary" onClick={handleCreateComponent} disabled={creating || !newComponentName}>
                        {creating ? <Spinner size="sm" animation="border" /> : 'Crear'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
};

export default DashboardGlobal;
