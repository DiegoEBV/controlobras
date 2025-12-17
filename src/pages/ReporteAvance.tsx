import React, { useEffect, useState } from 'react';
import { Form, Button, Card, Alert, Spinner, Tabs, Tab, Table } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx';

interface Obra {
    id: string;
    nombre_obra: string;
    type?: string;
    parent_id?: string;
}

interface ScheduleRow {
    date: string;
    amount: number;
}

interface Hito {
    id: string;
    fecha: string;
    descripcion: string;
    cumplido: boolean;
}

const FormularioReporte: React.FC = () => {
    const { user } = useAuth();
    const [obras, setObras] = useState<Obra[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'danger', text: string } | null>(null);

    // Context State
    const [activeTab, setActiveTab] = useState('reporte');
    const [selectedObra, setSelectedObra] = useState('');
    const [components, setComponents] = useState<Obra[]>([]);
    const [selectedComponent, setSelectedComponent] = useState('');

    // Tab 1: Reporte Avance State
    const [periodoId, setPeriodoId] = useState(''); // ID of the selected valorizacion record
    const [existingPeriods, setExistingPeriods] = useState<any[]>([]); // Data from DB
    const [montoProgramado, setMontoProgramado] = useState('');
    const [montoEjecutado, setMontoEjecutado] = useState('');

    // Tab 2: Cronograma State
    const [startDate, setStartDate] = useState('');
    const [durationMonths, setDurationMonths] = useState(1);
    const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
    const [totalScheduled, setTotalScheduled] = useState(0);

    // Tab 3: Hitos State
    const [hitos, setHitos] = useState<Hito[]>([]);
    const [newHitoDesc, setNewHitoDesc] = useState('');
    const [newHitoDate, setNewHitoDate] = useState('');

    useEffect(() => {
        fetchObras();
    }, [user]);

    useEffect(() => {
        if (selectedComponent) {
            fetchHitos(selectedComponent);
        } else {
            setHitos([]);
        }
    }, [selectedComponent]);

    const fetchHitos = async (obraId: string) => {
        try {
            const { data, error } = await supabase
                .from('hitos')
                .select('*')
                .eq('obra_id', obraId)
                .order('fecha', { ascending: true });
            if (error) throw error;
            setHitos(data || []);
        } catch (err) {
            console.error('Error fetching hitos', err);
        }
    };

    const handleAddHito = async () => {
        if (!selectedComponent || !newHitoDesc || !newHitoDate) return;
        try {
            setSubmitting(true);
            const { error } = await supabase.from('hitos').insert({
                obra_id: selectedComponent,
                nombre: newHitoDesc,
                descripcion: newHitoDesc,
                fecha: newHitoDate
            });
            if (error) throw error;
            setTitleHito();
            fetchHitos(selectedComponent);
            setMessage({ type: 'success', text: 'Hito agregado correctamente' });
        } catch (err: any) {
            setMessage({ type: 'danger', text: err.message });
        } finally {
            setSubmitting(false);
        }
    };

    const setTitleHito = () => {
        setNewHitoDesc('');
        setNewHitoDate('');
    };

    const handleDeleteHito = async (id: string) => {
        try {
            const { error } = await supabase.from('hitos').delete().eq('id', id);
            if (error) throw error;
            setHitos(prev => prev.filter(h => h.id !== id));
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleToggleHito = async (hito: Hito) => {
        try {
            const { error } = await supabase
                .from('hitos')
                .update({ cumplido: !hito.cumplido })
                .eq('id', hito.id);
            if (error) throw error;
            setHitos(prev => prev.map(h => h.id === hito.id ? { ...h, cumplido: !h.cumplido } : h));
        } catch (err: any) {
            alert(err.message);
        }
    };

    // Fetch components and periods when Obra changes
    useEffect(() => {
        if (selectedObra) {
            fetchComponents(selectedObra);
            setSelectedComponent(selectedObra); // Default to main work
        } else {
            setComponents([]);
            setSelectedComponent('');
            setExistingPeriods([]);
        }
    }, [selectedObra]);

    // Fetch periods when component changes
    useEffect(() => {
        if (selectedComponent) {
            fetchPeriods(selectedComponent);
        } else {
            setExistingPeriods([]);
        }
    }, [selectedComponent]);

    // Recalc total when rows change
    useEffect(() => {
        const total = scheduleRows.reduce((acc, row) => acc + (row.amount || 0), 0);
        setTotalScheduled(total);
    }, [scheduleRows]);

    const fetchObras = async () => {
        if (!user) return;
        try {
            // Only fetch main works (parent_id IS NULL)
            let query = supabase
                .from('obras')
                .select('id, nombre_obra, type, parent_id')
                .is('parent_id', null);

            const { data: userData } = await supabase.from('usuarios').select('rol').eq('id', user.id).single();
            const userRole = userData?.rol;

            if (userRole === 'coordinador') {
                const { data: relations, error: relError } = await supabase
                    .from('obra_usuario')
                    .select('obra_id')
                    .eq('usuario_id', user.id);

                if (relError) throw relError;
                const obraIds = relations?.map(r => r.obra_id) || [];
                if (obraIds.length > 0) {
                    query = query.in('id', obraIds);
                } else {
                    setObras([]);
                    setLoading(false);
                    return;
                }
            }

            const { data, error } = await query;
            if (error) throw error;
            setObras(data || []);
        } catch (err: any) {
            console.error('Error fetching works:', err);
            setMessage({ type: 'danger', text: 'Error al cargar las obras asignadas' });
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

    const fetchPeriods = async (obraId: string) => {
        try {
            const { data, error } = await supabase
                .from('valorizaciones')
                .select('*')
                .eq('obra_id', obraId)
                .order('periodo_reporte', { ascending: true });

            if (error) throw error;
            setExistingPeriods(data || []);

            // Auto-load schedule rows if they exist
            if (data && data.length > 0) {
                const loadedRows: ScheduleRow[] = data.map(d => ({
                    date: d.periodo_reporte,
                    amount: Number(d.monto_programado_periodo) || 0
                }));
                setScheduleRows(loadedRows);

                // Sync inputs
                if (loadedRows.length > 0) {
                    setStartDate(loadedRows[0].date);
                    setDurationMonths(loadedRows.length);
                }
            } else {
                setScheduleRows([]);
            }
        } catch (err) {
            console.error("Error loading periods:", err);
        }
    };

    // --- Tab 1 Handler ---
    const handlePeriodChange = (id: string) => {
        setPeriodoId(id);
        const selected = existingPeriods.find(p => p.id === id);
        if (selected) {
            // Auto-fill data
            setMontoProgramado(selected.monto_programado_periodo?.toString() || '');
            setMontoEjecutado(selected.monto_ejecutado_periodo?.toString() || '');
        } else {
            setMontoProgramado('');
            setMontoEjecutado('');
        }
    };

    const handleSubmitReport = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedComponent) return setMessage({ type: 'danger', text: 'Seleccione una obra o componente' });
        if (!periodoId) return setMessage({ type: 'danger', text: 'Seleccione un periodo' });

        setSubmitting(true);
        setMessage(null);

        try {
            // Update the existing record instead of inserting
            const { error } = await supabase
                .from('valorizaciones')
                .update({
                    monto_ejecutado_periodo: parseFloat(montoEjecutado) || 0,
                    // We don't necessarily update programmed here unless user changed it, 
                    // but usually this form is for executed. We'll keep programmed as is or update it too if we want to allow corrections.
                    // Let's allow updating both just in case.
                    monto_programado_periodo: parseFloat(montoProgramado) || 0
                })
                .eq('id', periodoId);

            if (error) throw error;

            setMessage({ type: 'success', text: 'Avance registrado correctamente' });
            // Refresh periods data to show updated values if needed
            fetchPeriods(selectedComponent);
        } catch (err: any) {
            console.error(err);
            setMessage({ type: 'danger', text: err.message || 'Error al guardar el reporte' });
        } finally {
            setSubmitting(false);
        }
    };

    // --- Tab 2 Handlers ---
    const handleGenerateTable = () => {
        if (!startDate || durationMonths < 1) return;

        const rows: ScheduleRow[] = [];
        let currentDate = new Date(startDate);
        // Set to first day of month to avoid issues
        currentDate.setDate(1);

        for (let i = 0; i < durationMonths; i++) {
            const dateStr = currentDate.toISOString().split('T')[0];
            rows.push({ date: dateStr, amount: 0 });
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
        setScheduleRows(rows);
    };

    const handleAddRow = () => {
        const newRows = [...scheduleRows];
        let nextDate = new Date();

        if (newRows.length > 0) {
            const lastDate = new Date(newRows[newRows.length - 1].date);
            // safe check
            if (!isNaN(lastDate.getTime())) {
                nextDate = new Date(lastDate);
                nextDate.setMonth(nextDate.getMonth() + 1);
            }
        } else if (startDate) {
            nextDate = new Date(startDate);
        }

        newRows.push({ date: nextDate.toISOString().split('T')[0], amount: 0 });
        setScheduleRows(newRows);
    };

    const handleDeleteRow = async (index: number) => {
        const rowToDelete = scheduleRows[index];

        if (!selectedComponent) return;

        try {
            // Delete from database if it exists
            const { error } = await supabase
                .from('valorizaciones')
                .delete()
                .eq('obra_id', selectedComponent)
                .eq('periodo_reporte', rowToDelete.date);

            if (error) {
                console.error('Error deleting from database:', error);
                alert('Error al eliminar el período: ' + error.message);
                return;
            }

            // Remove from local state
            const newRows = [...scheduleRows];
            newRows.splice(index, 1);
            setScheduleRows(newRows);

            // Refresh periods to update the dropdown
            fetchPeriods(selectedComponent);

            setMessage({ type: 'success', text: 'Período eliminado correctamente' });
        } catch (err: any) {
            console.error('Error:', err);
            alert('Error al eliminar: ' + err.message);
        }
    };

    const handleScheduleChange = (index: number, field: 'date' | 'amount', val: string) => {
        const newRows = [...scheduleRows];
        if (field === 'amount') {
            newRows[index].amount = parseFloat(val) || 0;
        } else {
            newRows[index].date = val;
        }
        setScheduleRows(newRows);
    };

    const handleSaveSchedule = async () => {
        if (!selectedComponent) return setMessage({ type: 'danger', text: 'Seleccione una obra o componente primero' });
        setSubmitting(true);
        setMessage(null);

        try {
            for (const row of scheduleRows) {
                const { data: existing } = await supabase
                    .from('valorizaciones')
                    .select('id')
                    .eq('obra_id', selectedComponent)
                    .eq('periodo_reporte', row.date)
                    .maybeSingle();

                if (existing) {
                    await supabase
                        .from('valorizaciones')
                        .update({ monto_programado_periodo: row.amount })
                        .eq('id', existing.id);
                } else {
                    await supabase
                        .from('valorizaciones')
                        .insert({
                            obra_id: selectedComponent,
                            periodo_reporte: row.date,
                            monto_programado_periodo: row.amount,
                            monto_ejecutado_periodo: 0
                        });
                }
            }

            setMessage({ type: 'success', text: 'Cronograma guardado correctamente' });
            fetchPeriods(selectedComponent);
        } catch (err: any) {
            console.error(err);
            setMessage({ type: 'danger', text: err.message || 'Error al guardar cronograma' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];

                // Read as array of arrays
                const data = XLSX.utils.sheet_to_json<any>(ws, { header: 1 });

                // Expecting Header: [Fecha, Monto] or similar
                // We'll look for first row that looks like data
                const parsedRows: ScheduleRow[] = [];

                // Skip header row (index 0)
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    if (!row || row.length < 2) continue;

                    // Parse Date (Column 0)
                    let dateVal = row[0];
                    let dateStr = '';

                    if (typeof dateVal === 'number') {
                        // Excel serial date
                        const d = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
                        // Adjustment for timezone if needed, usually simple parsing is enough
                        dateStr = d.toISOString().split('T')[0];
                    } else if (typeof dateVal === 'string') {
                        // Try parsing string
                        const d = new Date(dateVal);
                        if (!isNaN(d.getTime())) {
                            dateStr = d.toISOString().split('T')[0];
                        }
                    }

                    // Parse Amount (Column 1)
                    const amount = parseFloat(row[1]) || 0;

                    if (dateStr && amount >= 0) {
                        parsedRows.push({ date: dateStr, amount });
                    }
                }

                if (parsedRows.length > 0) {
                    setScheduleRows(parsedRows);
                    setMessage({ type: 'success', text: `Se cargaron ${parsedRows.length} registros desde el Excel` });
                } else {
                    setMessage({ type: 'danger', text: 'No se encontraron datos válidos en el archivo. Use columnas: Fecha, Monto' });
                }

            } catch (err) {
                console.error("Error reading file", err);
                setMessage({ type: 'danger', text: 'Error al procesar el archivo Excel' });
            }
        };
        reader.readAsBinaryString(file);
    };


    // Calculations for Table Display
    let accumulated = 0;

    if (loading) return <Spinner animation="border" />;

    return (
        <div className="container py-5">
            <div className="row justify-content-center">
                <div className="col-lg-12">
                    <Card className="shadow-lg border-0">
                        <Card.Body className="p-5">
                            <div className="text-center mb-4">
                                <h3 className="fw-bold text-primary mb-2">Gestión de Avance</h3>
                                <p className="text-muted">Reporte mensual y carga de cronograma</p>
                            </div>

                            {message && <Alert variant={message.type} className="mb-4 border-0 shadow-sm" onClose={() => setMessage(null)} dismissible>{message.text}</Alert>}

                            {/* Global Obra Selector */}
                            <Form.Group className="mb-4">
                                <Form.Label className="fw-bold">Seleccionar Obra</Form.Label>
                                <Form.Select
                                    size="lg"
                                    className="bg-light border-0 shadow-sm"
                                    value={selectedObra}
                                    onChange={(e) => setSelectedObra(e.target.value)}
                                >
                                    <option value="">-- Seleccionar --</option>
                                    {obras.map(obra => (
                                        <option key={obra.id} value={obra.id}>{obra.nombre_obra}</option>
                                    ))}
                                </Form.Select>
                            </Form.Group>

                            {/* Component Selector */}
                            {components.length > 0 && (
                                <Form.Group className="mb-4">
                                    <Form.Label className="fw-bold">Componente / Adicional</Form.Label>
                                    <Form.Select
                                        size="lg"
                                        className="bg-light border-0 shadow-sm"
                                        value={selectedComponent}
                                        onChange={(e) => setSelectedComponent(e.target.value)}
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

                            <Tabs
                                activeKey={activeTab}
                                onSelect={(k) => setActiveTab(k || 'reporte')}
                                className="mb-4 nav-pills nav-fill"
                            >
                                <Tab eventKey="reporte" title="Reportar Avance (Mes)">
                                    <div className="pt-3" style={{ maxWidth: '800px', margin: '0 auto' }}>
                                        <Alert variant="light" className="text-center small text-muted">
                                            Seleccione el periodo del cronograma cargado y registre el avance ejecutado.
                                        </Alert>
                                        <Form onSubmit={handleSubmitReport}>
                                            <Form.Group className="mb-4">
                                                <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Periodo (Mes)</Form.Label>
                                                <Form.Select
                                                    size="lg"
                                                    value={periodoId}
                                                    onChange={(e) => handlePeriodChange(e.target.value)}
                                                    required
                                                    className="bg-light border-0"
                                                >
                                                    <option value="">-- Seleccionar Periodo --</option>
                                                    {existingPeriods.map(p => {
                                                        const date = new Date(p.periodo_reporte);
                                                        // Format Month Year (e.g., "Noviembre 2025")
                                                        // Use UTC to avoid timezone shifts on simple dates
                                                        const label = date.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', timeZone: 'UTC' });
                                                        return (
                                                            <option key={p.id} value={p.id}>
                                                                {label} (Prog: S/ {p.monto_programado_periodo})
                                                            </option>
                                                        );
                                                    })}
                                                </Form.Select>
                                                {existingPeriods.length === 0 && selectedObra && (
                                                    <Form.Text className="text-danger">
                                                        No hay periodos cargados. Vaya a "Carga de Cronograma" primero.
                                                    </Form.Text>
                                                )}
                                            </Form.Group>

                                            <div className="row g-3">
                                                <div className="col-md-6">
                                                    <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Monto Programado (S/)</Form.Label>
                                                    <Form.Control
                                                        type="number" step="0.01"
                                                        size="lg"
                                                        value={montoProgramado}
                                                        onChange={(e) => setMontoProgramado(e.target.value)}
                                                        className="bg-light border-0"
                                                        readOnly // Suggest making it readonly if we want to enforce the schedule, but user might need to adjust.
                                                    // Request said "solo se agregaria el monto ejecutao", implying programmed is fixed/loaded.
                                                    // Let's leave it editable but style it as 'filled'.
                                                    />
                                                </div>
                                                <div className="col-md-6">
                                                    <Form.Label className="fw-semibold text-secondary small text-uppercase ls-1">Monto Ejecutado (S/)</Form.Label>
                                                    <Form.Control
                                                        type="number" step="0.01"
                                                        size="lg"
                                                        value={montoEjecutado}
                                                        onChange={(e) => setMontoEjecutado(e.target.value)}
                                                        className="bg-light border-0"
                                                        required
                                                        placeholder="Ingrese el monto real"
                                                        autoFocus
                                                    />
                                                </div>
                                            </div>

                                            <div className="d-grid mt-4">
                                                <Button variant="primary" type="submit" disabled={submitting || !selectedComponent || !periodoId}>
                                                    {submitting ? <Spinner size="sm" animation="border" /> : 'Registrar Avance'}
                                                </Button>
                                            </div>
                                        </Form>
                                    </div>
                                </Tab>

                                <Tab eventKey="cronograma" title="Carga de Cronograma (Base)">
                                    <div className="pt-3">
                                        <Alert variant="info" className="text-center small border-0 bg-light mb-4">
                                            <i className="bi bi-info-circle me-2"></i>
                                            Genere la estructura del cronograma o agregue filas manualmente. Los cálculos se actualizan automáticamente.
                                        </Alert>

                                        <div className="row g-3 align-items-end mb-4 bg-light p-3 rounded-3 border">
                                            <div className="col-md-3">
                                                <Form.Label className="small text-uppercase fw-bold text-secondary">Fecha Inicio</Form.Label>
                                                <Form.Control type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                                            </div>
                                            <div className="col-md-2">
                                                <Form.Label className="small text-uppercase fw-bold text-secondary">Duración (Meses)</Form.Label>
                                                <Form.Control type="number" min="1" value={durationMonths} onChange={(e) => setDurationMonths(parseInt(e.target.value))} />
                                            </div>
                                            <div className="col-md-3">
                                                <Button variant="secondary" onClick={handleGenerateTable} className="w-100">
                                                    <i className="bi bi-table me-2"></i>Generar Estructura
                                                </Button>
                                            </div>
                                            <div className="col-md-4">
                                                <Form.Label className="small text-uppercase fw-bold text-success">
                                                    <i className="bi bi-file-earmark-spreadsheet me-1"></i>
                                                    Cargar desde Excel
                                                </Form.Label>
                                                <Form.Control
                                                    type="file"
                                                    accept=".xlsx, .xls"
                                                    onChange={handleFileUpload}
                                                    size="sm"
                                                />
                                                <Form.Text muted style={{ fontSize: '0.7rem' }}>
                                                    Columnas requeridas: Fecha, Monto
                                                </Form.Text>
                                            </div>
                                        </div>

                                        {scheduleRows.length > 0 && (
                                            <>
                                                <div className="table-responsive mb-3">
                                                    <Table bordered hover className="align-middle">
                                                        <thead className="bg-primary text-white text-center">
                                                            <tr>
                                                                <th style={{ width: '180px' }}>Periodo</th>
                                                                <th>Monto Programado (S/)</th>
                                                                <th className="bg-light text-secondary">% Mes</th>
                                                                <th className="bg-light text-secondary">Acumulado (S/)</th>
                                                                <th className="bg-light text-secondary">% Acum</th>
                                                                <th style={{ width: '80px' }}>Acción</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {scheduleRows.map((row, idx) => {
                                                                accumulated += row.amount;
                                                                const percentMonth = totalScheduled > 0 ? (row.amount / totalScheduled) * 100 : 0;
                                                                const percentAccum = totalScheduled > 0 ? (accumulated / totalScheduled) * 100 : 0;

                                                                return (
                                                                    <tr key={idx}>
                                                                        <td>
                                                                            <Form.Control
                                                                                type="date"
                                                                                size="sm"
                                                                                value={row.date}
                                                                                onChange={(e) => handleScheduleChange(idx, 'date', e.target.value)}
                                                                            />
                                                                        </td>
                                                                        <td>
                                                                            <Form.Control
                                                                                type="number"
                                                                                step="0.01"
                                                                                className="fw-bold text-end"
                                                                                value={row.amount}
                                                                                onChange={(e) => handleScheduleChange(idx, 'amount', e.target.value)}
                                                                            />
                                                                        </td>
                                                                        <td className="text-end text-muted">{percentMonth.toFixed(2)}%</td>
                                                                        <td className="text-end text-muted">S/ {accumulated.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                                                                        <td className="text-end fw-bold text-primary">{percentAccum.toFixed(2)}%</td>
                                                                        <td className="text-center">
                                                                            <Button
                                                                                variant="outline-danger"
                                                                                size="sm"
                                                                                onClick={() => handleDeleteRow(idx)}
                                                                                title="Eliminar mes"
                                                                            >
                                                                                <i className="bi bi-trash-fill"></i>
                                                                            </Button>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                        <tfoot>
                                                            <tr className="fw-bold table-active">
                                                                <td className="text-end">TOTAL PRESUPUESTO:</td>
                                                                <td className="text-end fs-5">S/ {totalScheduled.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                                                                <td></td>
                                                                <td></td>
                                                                <td className="text-end">100.00%</td>
                                                                <td></td>
                                                            </tr>
                                                        </tfoot>
                                                    </Table>
                                                </div>

                                                <div className="d-flex justify-content-end gap-2">
                                                    <Button variant="outline-secondary" onClick={handleAddRow}>
                                                        <i className="bi bi-plus-lg me-2"></i>Agregar Mes
                                                    </Button>
                                                    <Button variant="success" onClick={handleSaveSchedule} disabled={submitting}>
                                                        {submitting ? <Spinner size="sm" animation="border" /> : <><i className="bi bi-save me-2"></i>Guardar Cronograma Base</>}
                                                    </Button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </Tab>

                                <Tab eventKey="hitos" title="Hitos Importantes">
                                    <div className="pt-3" style={{ maxWidth: '800px', margin: '0 auto' }}>
                                        <div className="bg-light p-4 rounded-3 border mb-4">
                                            <h6 className="fw-bold mb-3">Nuevo Hito</h6>
                                            <div className="row g-2 align-items-end">
                                                <div className="col-md-3">
                                                    <Form.Label className="small">Fecha</Form.Label>
                                                    <Form.Control
                                                        type="date"
                                                        value={newHitoDate}
                                                        onChange={(e) => setNewHitoDate(e.target.value)}
                                                    />
                                                </div>
                                                <div className="col-md-7">
                                                    <Form.Label className="small">Descripción</Form.Label>
                                                    <Form.Control
                                                        type="text"
                                                        placeholder="Ej: Inicio de Cimentación"
                                                        value={newHitoDesc}
                                                        onChange={(e) => setNewHitoDesc(e.target.value)}
                                                    />
                                                </div>
                                                <div className="col-md-2">
                                                    <Button
                                                        variant="primary"
                                                        className="w-100"
                                                        onClick={handleAddHito}
                                                        disabled={submitting || !newHitoDesc || !newHitoDate}
                                                    >
                                                        Agregar
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        <h6 className="fw-bold mb-3">Lista de Hitos</h6>
                                        {hitos.length === 0 ? (
                                            <p className="text-muted text-center py-4 bg-light rounded border border-dashed">No hay hitos registrados.</p>
                                        ) : (
                                            <div className="list-group shadow-sm">
                                                {hitos.map(hito => (
                                                    <div key={hito.id} className={`list-group-item d-flex justify-content-between align-items-center ${hito.cumplido ? 'bg-success-subtle' : ''}`}>
                                                        <div className="d-flex align-items-center gap-3">
                                                            <Form.Check
                                                                type="checkbox"
                                                                checked={hito.cumplido}
                                                                onChange={() => handleToggleHito(hito)}
                                                                style={{ transform: 'scale(1.2)' }}
                                                            />
                                                            <div>
                                                                <div className={`fw-bold ${hito.cumplido ? 'text-decoration-line-through text-muted' : ''}`}>
                                                                    {hito.descripcion}
                                                                </div>
                                                                <div className="small text-muted">
                                                                    {new Date(hito.fecha).toLocaleDateString()}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <Button
                                                            variant="outline-danger"
                                                            size="sm"
                                                            onClick={() => handleDeleteHito(hito.id)}
                                                        >
                                                            <i className="bi bi-trash"></i>
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </Tab>
                            </Tabs>
                        </Card.Body>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default FormularioReporte;
