
import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Form, Badge, Table, Alert, Spinner } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { createComponent, fetchObraComponents } from '../services/adminService';
import CurvaSChart, { type CurveDataPoint } from '../components/charts/CurvaSChart';
import { Modal, Button } from 'react-bootstrap';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine } from 'recharts';
import { exportToExcel } from '../services/excelExportService';

// Types
interface Obra {
    id: string;
    nombre_obra: string;
    type?: string;
    parent_id?: string;
    ubicacion?: string;
    entidad_contratante?: string;
    supervision?: string;
    contratista?: string;
    residente_obra?: string;
    monto_contrato?: number;
    plazo_ejecucion_dias?: number;
    fecha_entrega_terreno?: string;

    fecha_inicio_plazo?: string;
    fecha_fin_plazo?: string;
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

    // Component Modal State
    const [creating, setCreating] = useState(false);

    // Component Modal State
    const [showComponentModal, setShowComponentModal] = useState(false);
    const [newComponentName, setNewComponentName] = useState('');
    const [newComponentType, setNewComponentType] = useState<'adicional' | 'entregable'>('adicional');

    useEffect(() => {
        fetchObras();
    }, [role]);

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
            let query = supabase
                .from('obras')
                .select('*')
                .is('parent_id', null);

            if (role === 'coordinador' && user) {
                // First get assigned IDs
                const { data: assignments, error: assignError } = await supabase
                    .from('obra_usuario')
                    .select('obra_id')
                    .eq('usuario_id', user.id);

                if (assignError) throw assignError;

                if (!assignments || assignments.length === 0) {
                    setObras([]);
                    setLoading(false);
                    return;
                }

                const assignedIds = assignments.map(a => a.obra_id);
                query = query.in('id', assignedIds);
            }

            const { data, error } = await query;

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

    // Helper to draw S-Curve vectorially in PDF
    const drawSCurveOnPDF = (doc: jsPDF, data: CurveDataPoint[], title: string, x: number, y: number, w: number, h: number) => {
        if (!data || data.length === 0) return;

        // 1. Setup Box and Title
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text(title, x, y - 5);

        // Draw background/border
        doc.setDrawColor(200);
        doc.rect(x, y, w, h);

        // 2. Calculate Scales
        const maxVal = Math.max(
            ...data.map(d => Math.max(d.programado_acumulado || 0, d.ejecutado_acumulado || 0))
        ) * 1.1; // +10% padding

        if (maxVal === 0) return; // Empty chart

        const xStep = w / (data.length > 1 ? data.length - 1 : 1);

        // Helper to map values
        const getContentY = (val: number) => y + h - ((val / maxVal) * h);
        const getContentX = (idx: number) => x + (idx * xStep);

        // 3. Draw Grid & Axis Labels
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.setDrawColor(230);

        // Y-Axis Grid (5 lines)
        for (let i = 0; i <= 5; i++) {
            const val = (maxVal / 5) * i;
            const ly = getContentY(val);
            doc.line(x, ly, x + w, ly);
            doc.text(`S/ ${val >= 1000000 ? (val / 1000000).toFixed(1) + 'M' : (val / 1000).toFixed(0) + 'k'}`, x - 2, ly + 1, { align: 'right' });
        }

        // X-Axis Labels (Skip to fit ~10 labels max)
        const skip = Math.ceil(data.length / 10);
        data.forEach((d, i) => {
            if (i % skip === 0 || i === data.length - 1) {
                const lx = getContentX(i);
                const dateStr = new Date(d.periodo).toLocaleDateString('es-PE', { month: 'short', year: '2-digit' });
                doc.text(dateStr, lx + 2, y + h + 4, { align: 'left', angle: 45 });
                doc.line(lx, y, lx, y + h);
            }
        });

        // 4. Draw Lines
        // Programado (Blue)
        doc.setDrawColor(13, 110, 253); // Bootstrap Primary
        doc.setLineWidth(0.5);
        for (let i = 0; i < data.length - 1; i++) {
            const p1 = data[i];
            const p2 = data[i + 1];
            doc.line(
                getContentX(i), getContentY(p1.programado_acumulado),
                getContentX(i + 1), getContentY(p2.programado_acumulado)
            );
            // Dot
            doc.setFillColor(13, 110, 253);
            doc.circle(getContentX(i), getContentY(p1.programado_acumulado), 0.8, 'F');
        }
        // Last dot
        doc.circle(getContentX(data.length - 1), getContentY(data[data.length - 1].programado_acumulado), 0.8, 'F');


        // Ejecutado (Green)
        doc.setDrawColor(25, 135, 84); // Bootstrap Success
        doc.setLineWidth(0.5);
        for (let i = 0; i < data.length - 1; i++) {
            const p1 = data[i];
            const p2 = data[i + 1];
            // Only draw if we have executed values (assuming 0 might be valid, but typically trailing zeros mean future)
            // A simple heuristic: if it's 0 and previous was >0, maybe it stopped? 
            // For now, draw all points, but typically S-curves stop executed line at current date.
            // Let's draw all present data.

            doc.line(
                getContentX(i), getContentY(p1.ejecutado_acumulado),
                getContentX(i + 1), getContentY(p2.ejecutado_acumulado)
            );
            // Dot
            doc.setFillColor(25, 135, 84);
            doc.circle(getContentX(i), getContentY(p1.ejecutado_acumulado), 0.8, 'F');
        }
        doc.circle(getContentX(data.length - 1), getContentY(data[data.length - 1].ejecutado_acumulado), 0.8, 'F');

        // 5. Legend
        const legX = x + 10;
        const legY = y + 5;

        doc.setFillColor(13, 110, 253);
        doc.rect(legX, legY, 3, 3, 'F');
        doc.setTextColor(0);
        doc.text("Programado", legX + 5, legY + 2.5);

        doc.setFillColor(25, 135, 84);
        doc.rect(legX + 30, legY, 3, 3, 'F');
        doc.text("Ejecutado", legX + 35, legY + 2.5);
    };

    const handleExportPDF = async () => {
        if (!selectedObraId) return;
        const btn = document.getElementById('btn-export-pdf');
        if (btn) btn.innerText = 'Generando Reporte Completo...';

        try {
            // Need users for mapping responsible names
            const { data: users } = await supabase.from('usuarios').select('id, nombre, email');
            const userMap = new Map(users?.map(u => [u.id, u.nombre || u.email]) || []);

            // Fetch detailed Valorizaciones for Table
            const { data: vals } = await supabase.from('valorizaciones').select('*').eq('obra_id', selectedObraId).order('periodo_reporte');

            const doc = new jsPDF();
            const mainObraName = obras.find(o => o.id === selectedObraId)?.nombre_obra || 'Obra';

            // Title - Wrapper
            doc.setFontSize(18);
            doc.setTextColor(44, 62, 80);

            // Use splitTextToSize to handle long names
            const titleLines = doc.splitTextToSize(`Reporte de Control: ${mainObraName}`, 180);
            doc.text(titleLines, 14, 20);

            // Adjust Y based on title lines
            let yPos = 20 + (titleLines.length * 8);

            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.text(`Fecha de Emisión: ${new Date().toLocaleDateString()}`, 14, yPos);
            yPos += 5;
            doc.text(`Generado por: Jefe de Obra`, 14, yPos);
            yPos += 5;

            doc.setDrawColor(13, 110, 253);
            doc.setLineWidth(1);
            doc.line(14, yPos, 196, yPos);
            yPos += 10;

            // --- 1. INFO GENERAL DE LA OBRA PRINCIPAL ---
            const obraInfo = obras.find(o => o.id === selectedObraId);
            if (obraInfo) {
                doc.setFontSize(12);
                doc.setTextColor(0);
                doc.text("Información General", 14, yPos);
                yPos += 8;

                doc.setFontSize(10);
                const left = 14;
                const right = 110;

                doc.text(`Ubicación: ${obraInfo.ubicacion || '-'}`, left, yPos);
                doc.text(`Contratista: ${obraInfo.contratista || '-'}`, right, yPos);
                yPos += 6;
                doc.text(`Entidad: ${obraInfo.entidad_contratante || '-'}`, left, yPos);
                doc.text(`Supervisión: ${obraInfo.supervision || '-'}`, right, yPos);
                yPos += 6;
                doc.text(`Residente: ${obraInfo.residente_obra || '-'}`, left, yPos);
                doc.text(`Plazo: ${obraInfo.plazo_ejecucion_dias || 0} días`, right, yPos);
                yPos += 6;
                doc.text(`Monto: S/ ${(obraInfo.monto_contrato || 0).toLocaleString('es-PE')}`, left, yPos);
                if (obraInfo.fecha_inicio_plazo) {
                    doc.text(`Inicio Plazo: ${obraInfo.fecha_inicio_plazo}`, right, yPos);
                }

                yPos += 10;
                doc.line(14, yPos - 5, 196, yPos - 5);
            }

            // --- 2. CURVAS S (ITERAR SOBRE TODOS LOS COMPONENTES) ---
            // Get all 'adicionales' + Main specific component (if separate logic needed, but 'vista_curva_s' works by obra_id)
            // We want: Main Obra, then all Additional Components

            // Fetch children (Adicionales)
            const children = await fetchObraComponents(selectedObraId);
            const allComps = [{ id: selectedObraId, nombre_obra: 'Contrato Principal', type: 'principal' }, ...children];

            doc.setFontSize(14);
            doc.text("1. Avance - Curva S (Detallado)", 14, yPos);
            yPos += 10;

            for (const comp of allComps) {
                // Check space
                if (yPos > 200) { doc.addPage(); yPos = 20; }

                // Fetch specific curve data
                const { data: curve } = await supabase
                    .from('vista_curva_s')
                    .select('*')
                    .eq('obra_id', comp.id)
                    .order('periodo_reporte', { ascending: true });

                if (curve && curve.length > 0) {
                    const formattedCurve = curve.map(item => ({
                        periodo: item.periodo_reporte,
                        programado_acumulado: item.programado_acumulado,
                        ejecutado_acumulado: item.ejecutado_acumulado
                    }));

                    const chartTitle = `${comp.type === 'principal' ? 'Contrato Principal' : comp.nombre_obra}`;
                    // Wrap title if needed
                    const chartTitleLines = doc.splitTextToSize(chartTitle, 160);

                    // Draw Chart
                    // Height 80, Width reduced to 160
                    drawSCurveOnPDF(doc, formattedCurve, chartTitleLines[0], 30, yPos, 160, 80);

                    yPos += 100; // 80 chart + margins
                } else {
                    doc.setFontSize(10);
                    doc.setTextColor(150);
                    doc.text(`${comp.nombre_obra}: Sin datos de curva registrados.`, 14, yPos);
                    yPos += 15;
                }
            }


            // --- 3. DETALLE FINANCIERO (RESTORED) ---
            if (yPos > 240) { doc.addPage(); yPos = 20; }
            doc.setFontSize(14);
            doc.setTextColor(0);
            doc.text("2. Detalle Financiero (Contrato Principal)", 14, yPos);
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


            // --- 4. TABLA COMPARATIVA ---
            // Re-use logic from before or just skip/simplify since we have detail now
            if (componentComparison.length > 0) {
                if (yPos > 240) { doc.addPage(); yPos = 20; }
                doc.setFontSize(14);
                doc.setTextColor(0);
                doc.text("3. Resumen de Componentes", 14, yPos);
                yPos += 7;

                const compBody = componentComparison.map(c => [
                    c.nombre,
                    c.spi,
                    `S/ ${(c.presupuesto || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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

            // --- 5. INCIDENCIAS ---
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
                columnStyles: { 0: { cellWidth: 60 } }
            });

            yPos = (doc as any).lastAutoTable.finalY + 15;

            // --- 5. FOTOS ---
            const incidentsWithPhotos = incidents.filter(i => i.fotos && i.fotos.length > 0);

            if (incidentsWithPhotos.length > 0) {
                if (btn) btn.innerText = 'Procesando Fotos...';
                doc.addPage();
                yPos = 20;
                doc.setFontSize(14);
                doc.text("4. Evidencia Fotográfica", 14, yPos);
                yPos += 10;

                for (const inc of incidentsWithPhotos) {
                    if (yPos > 240) { doc.addPage(); yPos = 20; }

                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'bold');
                    // Text Wrap
                    const descLines = doc.splitTextToSize(`Incidencia: ${inc.descripcion}`, 180);
                    doc.text(descLines, 14, yPos);
                    yPos += (descLines.length * 6) + 2;

                    doc.setFont('helvetica', 'normal');

                    const photosToShow = inc.fotos!.slice(0, 2);
                    let xOffset = 14;
                    for (const photoUrl of photosToShow) {
                        try {
                            const base64 = await getDataUrl(photoUrl);
                            doc.addImage(base64, 'JPEG', xOffset, yPos, 80, 60);
                            xOffset += 90;
                        } catch (e) {
                            console.error('Error loading image', e);
                            doc.text('[Error Img]', xOffset, yPos + 30);
                        }
                    }
                    yPos += 70;
                }
            }

            doc.save(`Reporte_Completo_${mainObraName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);

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
