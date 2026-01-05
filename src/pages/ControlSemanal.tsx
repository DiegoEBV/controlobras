import React, { useEffect, useState } from 'react';
import { Card, Form, Button, Table, Badge, Alert, Tabs, Tab } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Chart } from "react-google-charts";
import { Link } from 'react-router-dom';

interface Obra {
    id: string;
    nombre_obra: string;
    fecha_inicio_plazo?: string;
}

interface Actividad {
    id: string;
    nombre_partida: string;
    start_date?: string; // We'll compute this from Gantt logic or use saved dates if we persist them
    end_date?: string;
}

interface PlanSemanal {
    id: string;
    actividad_id: string;
    semana_inicio: string;
    estado: 'pendiente' | 'cumplido' | 'no_cumplido';
    causa_fallo?: string;
    actividades_obra?: Actividad; // Join
}

const CAUSAS_FALLO = [
    "Lluvia / Clima",
    "Falta de Personal",
    "Falta de Materiales",
    "Falta de Equipos",
    "Interferencias",
    "Cambios de Ingeniería",
    "Restricciones no liberadas",
    "Otros"
];

const ControlSemanal: React.FC = () => {
    const { user, role } = useAuth();
    const [obras, setObras] = useState<Obra[]>([]);
    const [selectedParentId, setSelectedParentId] = useState<string>(''); // Parent
    const [components, setComponents] = useState<Obra[]>([]); // Adicionales
    const [selectedObraId, setSelectedObraId] = useState<string>(''); // Component/Final ID

    // Week Selection: Format "YYYY-Www"
    const getCurrentWeek = () => {
        const now = new Date();
        const onejan = new Date(now.getFullYear(), 0, 1);
        const week = Math.ceil((((now.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
        return `${now.getFullYear()}-W${week.toString().padStart(2, '0')}`;
    };
    const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek());

    // Data
    const [actividades, setActividades] = useState<Actividad[]>([]);
    const [planSemanal, setPlanSemanal] = useState<PlanSemanal[]>([]);
    const [ppcStats, setPpcStats] = useState<{ ppc: number, cumplidos: number, total: number }>({ ppc: 0, cumplidos: 0, total: 0 });
    const [causasStats, setCausasStats] = useState<any[]>([]);



    useEffect(() => {
        if (user) fetchObras();
    }, [user]);

    useEffect(() => {
        if (selectedObraId && selectedWeek) {
            fetchData();
        }
    }, [selectedObraId, selectedWeek]);

    const fetchObras = async () => {
        try {
            let query = supabase.from('obras').select('id, nombre_obra, parent_id').is('parent_id', null);
            if (role === 'coordinador' && user) {
                const { data: rels } = await supabase.from('obra_usuario').select('obra_id').eq('usuario_id', user.id);
                const ids = rels?.map(r => r.obra_id) || [];
                if (ids.length > 0) query = query.in('id', ids);
                else { setObras([]); return; }
            }
            const { data, error } = await query;
            if (!error && data) {
                setObras(data);
            }
        } catch (err) { console.error(err); }
    };

    // Fetch Components when Parent changes
    useEffect(() => {
        if (selectedParentId) {
            fetchComponents(selectedParentId);
            // Default select parent
            if (!selectedObraId || selectedObraId !== selectedParentId) setSelectedObraId(selectedParentId);
        } else {
            setComponents([]);
            setSelectedObraId('');
            setActividades([]);
            setPlanSemanal([]);
        }
    }, [selectedParentId]);

    const fetchComponents = async (parentId: string) => {
        try {
            const { data, error } = await supabase.from('obras').select('id, nombre_obra, type').eq('parent_id', parentId);
            if (!error) setComponents(data || []);
        } catch (e) { console.error(e); }
    };

    const fetchData = async () => {
        try {
            // 1. Fetch ALL activities for the Gantt Context (Simplified: Just fetch raw activities)
            // Ideally we should use the same logic as GestionActividades to calculate dates, 
            // but for now let's assume we show ALL activities and let user pick, 
            // OR we rely on a stored start_date if we had one. 
            // Since GestionActividades calculates CPU-side, we might just list all 'en curso' or simple list.
            const { data: acts } = await supabase
                .from('actividades_obra')
                .select('id, nombre_partida')
                .eq('obra_id', selectedObraId)
                .order('created_at');

            setActividades(acts || []);

            // 2. Fetch Plan for this week
            const dateOfMonday = getDateOfISOWeek(selectedWeek);
            const { data: plan } = await supabase
                .from('plan_semanal')
                .select('*, actividades_obra(nombre_partida)')
                .eq('obra_id', selectedObraId)
                .eq('semana_inicio', dateOfMonday.toISOString().split('T')[0]);

            setPlanSemanal(plan || []);

            // 3. Calc Stats for Dashboard (All time or trailing 4 weeks? Let's do All Time for this Obra)
            fetchStats();

        } catch (err) {
            console.error(err);
        } finally {
            // setLoading(false);
        }
    };

    const fetchStats = async () => {
        const { data } = await supabase
            .from('plan_semanal')
            .select('estado, causa_fallo')
            .eq('obra_id', selectedObraId);

        if (!data) return;

        const total = data.length;
        const cumplidos = data.filter(r => r.estado === 'cumplido').length;
        const ppc = total > 0 ? (cumplidos / total) * 100 : 0;
        setPpcStats({ ppc, cumplidos, total });

        // Causas Chart
        const causasMap: Record<string, number> = {};
        data.filter(r => r.estado === 'no_cumplido' && r.causa_fallo).forEach(r => {
            const c = r.causa_fallo!;
            causasMap[c] = (causasMap[c] || 0) + 1;
        });

        const chartData = [["Causa", "Frecuencia"], ...Object.entries(causasMap)];
        setCausasStats(chartData.length > 1 ? chartData : []);
    };

    // Helper: "2025-W01" -> Date Object (Monday)
    const getDateOfISOWeek = (w: string) => {
        const [y, week] = w.split('-W');
        const simple = new Date(parseInt(y), 0, 1 + (parseInt(week) - 1) * 7);
        const dow = simple.getDay();
        const ISOweekStart = simple;
        if (dow <= 4)
            ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
        else
            ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
        return ISOweekStart;
    };

    const addToPlan = async (actId: string) => {
        try {
            const dateOfMonday = getDateOfISOWeek(selectedWeek);
            await supabase.from('plan_semanal').insert({
                obra_id: selectedObraId,
                actividad_id: actId,
                semana_inicio: dateOfMonday.toISOString().split('T')[0],
                estado: 'pendiente'
            });
            fetchData();
        } catch (err: any) { alert(err.message); }
    };

    const removeFromPlan = async (id: string) => {
        await supabase.from('plan_semanal').delete().eq('id', id);
        fetchData();
    };

    const updateStatus = async (id: string, estado: string, causa?: string) => {
        await supabase.from('plan_semanal').update({ estado, causa_fallo: causa }).eq('id', id);
        fetchData();
    };

    // Derived filtered list of activities NOT in plan
    const availableActivities = actividades.filter(a => !planSemanal.find(p => p.actividad_id === a.id));

    return (
        <div className="container py-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h3>Control Semanal (Last Planner)</h3>
                <Link to="/gestion-actividades" className="btn btn-outline-secondary">Ver Gantt Maestro</Link>
            </div>

            <Card className="mb-4 shadow-sm">
                <Card.Body className="d-flex gap-3 align-items-end flex-wrap">
                    <Form.Group>
                        <Form.Label className="fw-bold">Obra</Form.Label>
                        <div className="d-flex flex-column gap-2">
                            <Form.Select
                                value={selectedParentId}
                                onChange={e => setSelectedParentId(e.target.value)}
                                style={{ width: '300px' }}
                            >
                                <option value="">Seleccione Obra...</option>
                                {obras.map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
                            </Form.Select>
                            {selectedParentId && (
                                <Form.Select
                                    style={{ width: '300px' }}
                                    value={selectedObraId}
                                    onChange={(e) => setSelectedObraId(e.target.value)}
                                >
                                    <option value={selectedParentId}>Contrato Principal</option>
                                    {components.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {(c as any).type === 'adicional' ? 'Adicional: ' : ''}{c.nombre_obra}
                                        </option>
                                    ))}
                                </Form.Select>
                            )}
                        </div>
                    </Form.Group>
                    <Form.Group>
                        <Form.Label className="fw-bold">Semana de Trabajo</Form.Label>
                        <Form.Control type="week" value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)} />
                    </Form.Group>
                    <div className="ms-auto text-end">
                        <small className="text-muted d-block">PPC Histórico</small>
                        <h2 className={`mb-0 ${ppcStats.ppc >= 80 ? 'text-success' : ppcStats.ppc >= 60 ? 'text-warning' : 'text-danger'}`}>
                            {ppcStats.ppc.toFixed(1)}%
                        </h2>
                    </div>
                </Card.Body>
            </Card>

            <Tabs defaultActiveKey="planificacion" className="mb-3">
                <Tab eventKey="planificacion" title="1. Planificación Semanal">
                    <div className="row">
                        <div className="col-md-5">
                            <Card>
                                <Card.Header className="bg-light fw-bold">Actividades Disponibles</Card.Header>
                                <Card.Body style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                    {availableActivities.length === 0 ? <p className="text-muted">No hay actividades.</p> : (
                                        <Table hover size="sm">
                                            <tbody>
                                                {availableActivities.map(a => (
                                                    <tr key={a.id}>
                                                        <td>{a.nombre_partida}</td>
                                                        <td className="text-end">
                                                            <Button size="sm" variant="outline-primary" onClick={() => addToPlan(a.id)}>
                                                                <i className="bi bi-plus-lg"></i>
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                    )}
                                </Card.Body>
                            </Card>
                        </div>
                        <div className="col-md-7">
                            <Card className="border-primary h-100">
                                <Card.Header className="bg-primary text-white fw-bold">Plan Semanal (Compromisos)</Card.Header>
                                <Card.Body>
                                    {planSemanal.length === 0 ? <div className="text-center py-5 text-muted">Añada actividades desde la izquierda</div> : (
                                        <Table striped hover>
                                            <thead>
                                                <tr>
                                                    <th>Actividad</th>
                                                    <th>Estado</th>
                                                    <th>Acción</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {planSemanal.map(p => (
                                                    <tr key={p.id}>
                                                        <td>{p.actividades_obra?.nombre_partida}</td>
                                                        <td><Badge bg="secondary">Pendiente</Badge></td>
                                                        <td>
                                                            <Button variant="outline-danger" size="sm" onClick={() => removeFromPlan(p.id)}>
                                                                <i className="bi bi-trash"></i>
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                    )}
                                </Card.Body>
                            </Card>
                        </div>
                    </div>
                </Tab>

                <Tab eventKey="evaluacion" title="2. Evaluación de Cumplimiento">
                    <Card>
                        <Card.Body>
                            <Alert variant="info">
                                Al finalizar la semana, evalúe si se cumplieron los compromisos. Si no, indique la causa.
                            </Alert>
                            <Table responsive>
                                <thead>
                                    <tr>
                                        <th>Actividad</th>
                                        <th>Estado Actual</th>
                                        <th>Evaluación</th>
                                        <th>Causa de No Cumplimiento</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {planSemanal.map(p => (
                                        <tr key={p.id}>
                                            <td className="fw-bold">{p.actividades_obra?.nombre_partida}</td>
                                            <td>
                                                {p.estado === 'pendiente' && <Badge bg="secondary">Pendiente</Badge>}
                                                {p.estado === 'cumplido' && <Badge bg="success">Cumplido</Badge>}
                                                {p.estado === 'no_cumplido' && <Badge bg="danger">No Cumplido</Badge>}
                                            </td>
                                            <td>
                                                <div className="btn-group">
                                                    <Button
                                                        variant={p.estado === 'cumplido' ? 'success' : 'outline-success'}
                                                        size="sm"
                                                        onClick={() => updateStatus(p.id, 'cumplido')}
                                                    >
                                                        <i className="bi bi-check-lg"></i> Sí
                                                    </Button>
                                                    <Button
                                                        variant={p.estado === 'no_cumplido' ? 'danger' : 'outline-danger'}
                                                        size="sm"
                                                        onClick={() => updateStatus(p.id, 'no_cumplido', p.causa_fallo || CAUSAS_FALLO[0])}
                                                    >
                                                        <i className="bi bi-x-lg"></i> No
                                                    </Button>
                                                </div>
                                            </td>
                                            <td>
                                                {p.estado === 'no_cumplido' && (
                                                    <Form.Select
                                                        size="sm"
                                                        value={p.causa_fallo || ''}
                                                        onChange={(e) => updateStatus(p.id, 'no_cumplido', e.target.value)}
                                                    >
                                                        {CAUSAS_FALLO.map(c => <option key={c} value={c}>{c}</option>)}
                                                    </Form.Select>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </Card.Body>
                    </Card>
                </Tab>

                <Tab eventKey="dashboard" title="3. Dashboard Confiabilidad">
                    <div className="row pt-3">
                        <div className="col-md-6 mb-4">
                            <Card className="h-100">
                                <Card.Header>PPC (Porcentaje de Plan Cumplido)</Card.Header>
                                <Card.Body className="d-flex flex-column justify-content-center align-items-center">
                                    <div style={{ width: 200, height: 200 }}>
                                        <Chart
                                            chartType="PieChart"
                                            width="100%"
                                            height="100%"
                                            data={[
                                                ["Estado", "Cantidad"],
                                                ["Cumplido", ppcStats.cumplidos],
                                                ["No Cumplido", ppcStats.total - ppcStats.cumplidos]
                                            ]}
                                            options={{
                                                pieHole: 0.4,
                                                colors: ['#198754', '#dc3545'],
                                                legend: 'bottom'
                                            }}
                                        />
                                    </div>
                                    <h3 className="mt-3">{ppcStats.ppc.toFixed(1)}%</h3>
                                    <span className="text-muted">Confiabilidad Promedio</span>
                                </Card.Body>
                            </Card>
                        </div>
                        <div className="col-md-6 mb-4">
                            <Card className="h-100">
                                <Card.Header>Causas de No Cumplimiento (CNC)</Card.Header>
                                <Card.Body>
                                    {causasStats.length > 0 ? (
                                        <Chart
                                            chartType="BarChart"
                                            width="100%"
                                            height="300px"
                                            data={causasStats}
                                            options={{
                                                legend: { position: "none" },
                                                colors: ['#fd7e14']
                                            }}
                                        />
                                    ) : <p className="text-center py-5">No hay fallos registrados</p>}
                                </Card.Body>
                            </Card>
                        </div>
                    </div>
                </Tab>
            </Tabs>
        </div>
    );
};

export default ControlSemanal;
