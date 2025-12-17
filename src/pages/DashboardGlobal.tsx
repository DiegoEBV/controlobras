
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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine } from 'recharts';
import { exportToExcel } from '../services/excelExportService';

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
    categoria?: string;
    prioridad?: string;
    responsable_id?: string;
    fotos?: string[];
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

    // Date Filter State
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    // Bar Chart Data
    const [barChartData, setBarChartData] = useState<any[]>([]);
    const [spiTrendData, setSpiTrendData] = useState<any[]>([]);

    // Component Comparison Data
    const [componentComparison, setComponentComparison] = useState<any[]>([]);

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
        // Fetch comparison data for all components
        if (children.length > 0) {
            fetchComponentComparison(parentId, children);
        }
    };

    const fetchComponentComparison = async (parentId: string, comps: Obra[]) => {
        try {
            const allComponents = [{ id: parentId, nombre_obra: 'Contrato Principal' }, ...comps];
            const comparisonData = [];

            for (const comp of allComponents) {
                // Fetch latest SPI data for each component
                // We use limit(1) to get the latest report
                const { data: curve } = await supabase
                    .from('vista_curva_s')
                    .select('*')
                    .eq('obra_id', comp.id)
                    .order('periodo_reporte', { ascending: false })
                    .limit(1)
                    .single();

                const latestPoint = curve;
                let spi = '--';
                let avance = 0;
                let presupuesto = 0;

                if (latestPoint) {
                    presupuesto = latestPoint.programado_acumulado || 0;
                    if (latestPoint.programado_acumulado > 0) {
                        const spiValue = latestPoint.ejecutado_acumulado / latestPoint.programado_acumulado;
                        spi = spiValue.toFixed(2);
                        avance = (latestPoint.ejecutado_acumulado / latestPoint.programado_acumulado) * 100;
                    }
                }

                comparisonData.push({
                    id: comp.id, // Add ID for key
                    nombre: comp.nombre_obra,
                    spi: spi,
                    avance: avance.toFixed(1) + '%',
                    presupuesto: presupuesto
                });
            }

            setComponentComparison(comparisonData);
        } catch (err) {
            console.error('Error fetching component comparison:', err);
        }
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
            // 1. Fetch Curve Data (View) with optional date filter
            let curveQuery = supabase
                .from('vista_curva_s')
                .select('*')
                .eq('obra_id', obraId);

            // Apply date filters if set
            if (startDate) {
                curveQuery = curveQuery.gte('periodo_reporte', startDate);
            }
            if (endDate) {
                curveQuery = curveQuery.lte('periodo_reporte', endDate);
            }

            const { data: curve, error: curveError } = await curveQuery
                .order('periodo_reporte', { ascending: true });

            if (curveError) console.error('Error fetching curve:', curveError);

            // Map to chart format
            const formattedCurve: CurveDataPoint[] = (curve || []).map(item => ({
                periodo: item.periodo_reporte,
                programado_acumulado: item.programado_acumulado,
                ejecutado_acumulado: item.ejecutado_acumulado
            }));
            setCurveData(formattedCurve);

            // Prepare bar chart data (monthly, not accumulated)
            const barData = (curve || []).map(item => ({
                periodo: new Date(item.periodo_reporte).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }),
                Programado: item.programado_periodo ?? item.monto_programado_periodo ?? 0,
                Ejecutado: item.ejecutado_periodo ?? item.monto_ejecutado_periodo ?? 0
            }));
            setBarChartData(barData);

            // SPI Trend Data
            const trendData = (formattedCurve || []).map(item => {
                const spi = item.programado_acumulado > 0 ? (item.ejecutado_acumulado / item.programado_acumulado) : null;
                return {
                    periodo: new Date(item.periodo).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }),
                    spi: spi ? parseFloat(spi.toFixed(2)) : null
                };
            }).filter(i => i.spi !== null);
            setSpiTrendData(trendData);

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

    const handleExportExcel = async () => {
        if (!selectedObraId) return;

        const obraName = obras.find(o => o.id === selectedObraId)?.nombre_obra || 'Reporte';
        const spi = calculateSPI();

        await exportToExcel({
            curveData,
            incidents,
            criticalActivities,
            obraName,
            spi: spi.color !== 'text-muted' ? spi.value : 'N/A'
        });
    };

    const getDataUrl = (url: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas.toDataURL('image/jpeg'));
                } else {
                    reject('Canvas context failed');
                }
            };
            img.onerror = (e) => reject(e);
            img.src = url;
            // Add a cache buster if needed to bypass some cors caches, though Supabase usually handles this well with correct headers
            img.src = url + '?t=' + new Date().getTime();
        });
    };

    const handleExportPDF = async () => {
        if (!selectedObraId) return;
        const btn = document.getElementById('btn-export-pdf');
        if (btn) btn.innerText = 'Generando (Imágenes)...';

        try {
            // Fetch detailed Valorizaciones for Table
            const { data: vals } = await supabase.from('valorizaciones').select('*').eq('obra_id', selectedObraId).order('periodo_reporte');

            // Need users for mapping responsible names? 
            // We can fetch them quickly or just use IDs. Let's fetch for better report.
            const { data: users } = await supabase.from('usuarios').select('id, nombre, email');
            const userMap = new Map(users?.map(u => [u.id, u.nombre || u.email]) || []);

            const doc = new jsPDF();
            const obraName = obras.find(o => o.id === selectedObraId)?.nombre_obra || 'Obra';

            // Title
            doc.setFontSize(18);
            doc.setTextColor(44, 62, 80); // Midnight Blue
            doc.text(`Reporte de Control: ${obraName}`, 14, 20);

            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.text(`Fecha de Emisión: ${new Date().toLocaleDateString()}`, 14, 28);
            doc.text(`Generado por: Jefe de Obra`, 14, 33);

            // Add Logo or header line
            doc.setDrawColor(13, 110, 253);
            doc.setLineWidth(1);
            doc.line(14, 38, 196, 38);

            let yPos = 45;

            // 1. Chart Capture
            const input = document.getElementById('s-curve-chart');
            if (input) {
                doc.setFontSize(14);
                doc.setTextColor(0);
                doc.text("1. Avance - Curva S", 14, yPos);
                yPos += 7;

                const canvas = await html2canvas(input, { scale: 2 });
                const imgData = canvas.toDataURL('image/png');
                const imgWidth = 180;
                const imgHeight = (canvas.height * imgWidth) / canvas.width;

                doc.addImage(imgData, 'PNG', 14, yPos, imgWidth, imgHeight);
                yPos += imgHeight + 10;
            }

            // 2. Financial Table
            if (yPos > 240) { doc.addPage(); yPos = 20; }
            doc.setFontSize(14);
            doc.setTextColor(0);
            doc.text("2. Detalle Financiero", 14, yPos);
            yPos += 7;

            const tableBody = (vals || []).map(v => [
                new Date(v.periodo_reporte).toLocaleDateString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
                `S/ ${(v.monto_programado_periodo || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`,
                `S/ ${(v.monto_ejecutado_periodo || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`
            ]);

            autoTable(doc, {
                startY: yPos,
                head: [['Periodo', 'Programado', 'Ejecutado']],
                body: tableBody,
                headStyles: { fillColor: [13, 110, 253] },
                theme: 'striped'
            });

            // Update yPos after table
            yPos = (doc as any).lastAutoTable.finalY + 15;

            // 3. Comparison Table (if data exists)
            if (componentComparison.length > 0) {
                if (yPos > 240) { doc.addPage(); yPos = 20; }
                doc.setFontSize(14);
                doc.text("3. Estado de Componentes", 14, yPos);
                yPos += 7;

                const compBody = componentComparison.map(c => [
                    c.nombre,
                    c.spi,
                    `S/ ${(c.presupuesto || 0).toLocaleString('es-PE', { compactDisplay: 'short', notation: 'compact' })}`,
                    c.avance
                ]);

                autoTable(doc, {
                    startY: yPos,
                    head: [['Componente', 'SPI', 'Costo Total', '% Avance']],
                    body: compBody,
                    headStyles: { fillColor: [25, 135, 84] }, // Success green
                    theme: 'grid'
                });
                yPos = (doc as any).lastAutoTable.finalY + 15;
            }

            // 4. Incidents Table
            if (yPos > 240) { doc.addPage(); yPos = 20; }
            doc.setFontSize(14);
            doc.text("4. Incidencias Abiertas", 14, yPos);
            yPos += 7;

            const incidentsBody = incidents.map(i => [
                i.descripcion,
                i.categoria || '-',
                i.prioridad || '-',
                userMap.get(i.responsable_id || '') || 'Sin asignar',
                i.estado_actual
            ]);

            autoTable(doc, {
                startY: yPos,
                head: [['Descripción', 'Categoría', 'Prioridad', 'Responsable', 'Estado']],
                body: incidentsBody,
                headStyles: { fillColor: [220, 53, 69] },
                theme: 'striped',
                columnStyles: { 0: { cellWidth: 60 } } // Wider description
            });

            yPos = (doc as any).lastAutoTable.finalY + 15;

            // 5. Photos Section
            const incidentsWithPhotos = incidents.filter(i => i.fotos && i.fotos.length > 0);

            if (incidentsWithPhotos.length > 0) {
                if (btn) btn.innerText = 'Procesando Fotos...';
                doc.addPage();
                yPos = 20;
                doc.setFontSize(14);
                doc.text("5. Evidencia Fotográfica", 14, yPos);
                yPos += 10;

                for (const inc of incidentsWithPhotos) {
                    if (yPos > 240) { doc.addPage(); yPos = 20; }

                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'bold');
                    doc.text(`Incidencia: ${inc.descripcion.substring(0, 80)}${inc.descripcion.length > 80 ? '...' : ''}`, 14, yPos);
                    yPos += 7;
                    doc.setFont('helvetica', 'normal');

                    // Process photos
                    // Use only first 2 photos to save space/time
                    const photosToShow = inc.fotos!.slice(0, 2);

                    let xOffset = 14;
                    for (const photoUrl of photosToShow) {
                        try {
                            const base64 = await getDataUrl(photoUrl);
                            doc.addImage(base64, 'JPEG', xOffset, yPos, 80, 60);
                            xOffset += 90;
                        } catch (e) {
                            console.error('Error loading image', e);
                            doc.text('[Error cargando imagen]', xOffset, yPos + 30);
                        }
                    }
                    yPos += 70; // 60 height + 10 margin
                }
            }

            doc.save(`Reporte_Completo_${obraName.replace(/\s+/g, '_')}.pdf`);
        } catch (err) {
            console.error("Error generating PDF", err);
            alert("Error al generar PDF: " + (err as any).message);
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

    const calculateProjection = () => {
        if (!curveData || curveData.length === 0) return null;

        const spiObj = calculateSPI();
        const spi = parseFloat(spiObj.value);
        if (isNaN(spi) || spi <= 0) return null;

        // Simplify: Start date is first record, Planned End is last record
        const start = new Date(curveData[0].periodo);
        const plannedEnd = new Date(curveData[curveData.length - 1].periodo);

        const totalDurationMs = plannedEnd.getTime() - start.getTime();
        const totalDurationDays = totalDurationMs / (1000 * 3600 * 24);

        // Projected Duration = Planned / SPI
        const projectedDurationDays = totalDurationDays / spi;
        const projectedEnd = new Date(start.getTime() + (projectedDurationDays * 24 * 3600 * 1000));

        // Days difference
        const delayDays = Math.round(projectedDurationDays - totalDurationDays);

        return {
            plannedEnd,
            projectedEnd,
            delayDays,
            color: delayDays > 0 ? 'text-danger' : 'text-success'
        };
    };

    const spiData = calculateSPI();
    const projection = calculateProjection();

    if (loading && obras.length === 0) return <Spinner animation="border" />;

    return (
        <div className="animate-fade-in">
            <Row className="mb-4 align-items-center">
                <Col xl={3} lg={4} md={12} className="mb-3 mb-lg-0">
                    <h2 className="mb-0 fw-bold">Dashboard de Control</h2>
                    <p className="text-muted mb-0">Vista consolidada del estado de las obras</p>
                </Col>
                <Col xl={9} lg={8} md={12} className="d-flex flex-wrap gap-2 align-items-end justify-content-lg-end">
                    <div className="d-flex flex-wrap gap-2 w-100 justify-content-lg-end">
                        <div style={{ minWidth: '200px', flex: '1 1 auto' }}>
                            <Form.Label className="small text-muted text-uppercase fw-bold mb-1">Seleccionar Obra</Form.Label>
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
                            <div style={{ minWidth: '200px', flex: '1 1 auto' }}>
                                <Form.Label className="small text-muted text-uppercase fw-bold mb-1">Componente / Adicional</Form.Label>
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

                        <div className="d-flex gap-2 align-items-end flex-wrap">
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
                                    className="shadow-sm"
                                    onClick={() => setShowComponentModal(true)}
                                >
                                    + Componente
                                </Button>
                            )}
                            {role === 'jefe' && (
                                <>
                                    <Button
                                        id="btn-export-excel"
                                        variant="outline-success"
                                        className="shadow-sm"
                                        onClick={handleExportExcel}
                                    >
                                        <i className="bi bi-file-earmark-spreadsheet me-2"></i>Exportar Excel
                                    </Button>
                                    <Button
                                        id="btn-export-pdf"
                                        variant="outline-danger"
                                        className="shadow-sm"
                                        onClick={handleExportPDF}
                                    >
                                        <i className="bi bi-file-earmark-pdf me-2"></i>PDF
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </Col>
            </Row>

            {obras.length === 0 ? (
                <Alert variant="info">No hay obras registradas en el sistema.</Alert>
            ) : (
                <>
                    {/* Date Filters */}
                    <Row className="mb-4">
                        <Col md={12}>
                            <Card className="shadow-sm border-0">
                                <Card.Body>
                                    <Row className="align-items-end">
                                        <Col md={3}>
                                            <Form.Label className="small text-muted text-uppercase fw-bold">Fecha Inicio</Form.Label>
                                            <Form.Control
                                                type="date"
                                                value={startDate}
                                                onChange={(e) => {
                                                    setStartDate(e.target.value);
                                                    if (selectedComponentId) {
                                                        fetchDashboardData(selectedComponentId);
                                                    }
                                                }}
                                                className="bg-light border-0"
                                            />
                                        </Col>
                                        <Col md={3}>
                                            <Form.Label className="small text-muted text-uppercase fw-bold">Fecha Fin</Form.Label>
                                            <Form.Control
                                                type="date"
                                                value={endDate}
                                                onChange={(e) => {
                                                    setEndDate(e.target.value);
                                                    if (selectedComponentId) {
                                                        fetchDashboardData(selectedComponentId);
                                                    }
                                                }}
                                                className="bg-light border-0"
                                            />
                                        </Col>
                                        <Col md={3}>
                                            <Button
                                                variant="outline-secondary"
                                                onClick={() => {
                                                    setStartDate('');
                                                    setEndDate('');
                                                    if (selectedComponentId) {
                                                        fetchDashboardData(selectedComponentId);
                                                    }
                                                }}
                                            >
                                                <i className="bi bi-x-circle me-2"></i>Limpiar Filtros
                                            </Button>
                                        </Col>
                                    </Row>
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>

                    {/* SPI Alert */}
                    {parseFloat(spiData.value) < 0.9 && spiData.value !== '--' && (
                        <Alert variant="warning" className="mb-4">
                            <i className="bi bi-exclamation-triangle-fill me-2"></i>
                            <strong>¡Atención!</strong> El SPI está por debajo de 0.9 ({spiData.value}).
                            La obra está retrasada respecto al cronograma programado.
                        </Alert>
                    )}

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

                        {projection && (
                            <Col md={4}>
                                <Card className="text-center shadow-sm border-0 h-100">
                                    <Card.Body>
                                        <h5 className="text-muted small text-uppercase">Proyección de Cierre</h5>
                                        <div className={`h4 fw-bold ${projection.color} mb-1`}>
                                            {projection.projectedEnd.toLocaleDateString()}
                                        </div>
                                        <div className="small text-muted mb-2">
                                            Fecha Programada: {projection.plannedEnd.toLocaleDateString()}
                                        </div>
                                        <span className={`badge ${projection.delayDays > 0 ? 'bg-danger' : 'bg-success'}`}>
                                            {projection.delayDays > 0 ? `+${projection.delayDays} días retraso` : `${Math.abs(projection.delayDays)} días anticipación`}
                                        </span>
                                    </Card.Body>
                                </Card>
                            </Col>
                        )}
                    </Row>

                    <Row className="mb-4">
                        <Col md={12}>
                            <CurvaSChart data={curveData} title={`Curva S: ${obras.find(o => o.id === selectedObraId)?.nombre_obra || ''}`} />
                        </Col>
                    </Row>

                    {/* Bar Chart - Monthly Comparison */}
                    <Row className="mb-4">
                        <Col md={12}>
                            <Card className="shadow-sm border-0">
                                <Card.Header className="bg-white fw-bold">
                                    <i className="bi bi-bar-chart-fill me-2"></i>
                                    Comparación Mensual: Programado vs Ejecutado
                                </Card.Header>
                                <Card.Body>
                                    {barChartData.length === 0 ? (
                                        <p className="text-muted text-center my-3">No hay datos disponibles para mostrar.</p>
                                    ) : (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <BarChart data={barChartData}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="periodo" />
                                                <YAxis />
                                                <Tooltip
                                                    formatter={(value: number | undefined) => value ? `S/ ${value.toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : 'S/ 0.00'}
                                                />
                                                <Legend />
                                                <Bar dataKey="Programado" fill="#8884d8" />
                                                <Bar dataKey="Ejecutado" fill="#82ca9d" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>

                    {/* SPI Trend Chart */}
                    <Row className="mb-5">
                        <Col md={12}>
                            <Card className="shadow-sm border-0">
                                <Card.Header className="bg-white fw-bold">
                                    <i className="bi bi-graph-up me-2"></i>
                                    Evolución del SPI (Tendencia)
                                </Card.Header>
                                <Card.Body>
                                    {spiTrendData.length === 0 ? (
                                        <p className="text-muted text-center my-3">No hay datos suficientes para la tendencia.</p>
                                    ) : (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <LineChart data={spiTrendData}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="periodo" />
                                                <YAxis domain={[0, 'auto']} />
                                                <Tooltip />
                                                <Legend />
                                                <ReferenceLine y={1} label="Meta (1.0)" stroke="red" strokeDasharray="3 3" />
                                                <Line type="monotone" dataKey="spi" name="SPI Acumulado" stroke="#ff7300" strokeWidth={2} activeDot={{ r: 8 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>

                    {/* Component Comparison Table */}
                    {componentComparison.length > 0 && (
                        <Row className="mb-4">
                            <Col md={12}>
                                <Card className="shadow-sm border-0">
                                    <Card.Header className="bg-white fw-bold">
                                        <i className="bi bi-table me-2"></i>
                                        Comparación de Componentes
                                    </Card.Header>
                                    <Card.Body>
                                        <Table hover responsive size="sm" className="align-middle">
                                            <thead>
                                                <tr>
                                                    <th>Componente</th>
                                                    <th className="text-end">Presupuesto (S/)</th>
                                                    <th className="text-end">Avance Actual</th>
                                                    <th className="text-center">SPI</th>
                                                    <th className="text-center">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {componentComparison.map((comp) => (
                                                    <tr key={comp.id}>
                                                        <td className="fw-bold">{comp.nombre}</td>
                                                        <td className="text-end">
                                                            {comp.presupuesto.toLocaleString('es-PE', { style: 'currency', currency: 'PEN' })}
                                                        </td>
                                                        <td className="text-end">{comp.avance}</td>
                                                        <td className={`text-center fw-bold ${comp.spi === '--' ? 'text-muted' :
                                                            parseFloat(comp.spi) >= 1 ? 'text-success' :
                                                                parseFloat(comp.spi) >= 0.9 ? 'text-warning' : 'text-danger'
                                                            }`}>
                                                            {comp.spi}
                                                        </td>
                                                        <td className="text-center">
                                                            {comp.spi === '--' ? <Badge bg="secondary">Sin datos</Badge> :
                                                                parseFloat(comp.spi) >= 1 ? <Badge bg="success">Adelantado</Badge> :
                                                                    parseFloat(comp.spi) >= 0.9 ? <Badge bg="warning" text="dark">En Riesgo</Badge> :
                                                                        <Badge bg="danger">Retrasado</Badge>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                    </Card.Body>
                                </Card>
                            </Col>
                        </Row>
                    )}

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
