
import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Card, Table, Badge, Form, Spinner, ProgressBar } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../config/supabaseClient';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

interface ObraMetric {
    id: string;
    nombre: string;
    monto_contrato: number;
    avance_fisico: number; // %
    spi: number;
    incidencias_abiertas: number;
    estado_plazo: 'Al día' | 'Retrasado' | 'Adelantado';
    ultimo_periodo?: string;
}

const Home: React.FC = () => {
    const { role, user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [metrics, setMetrics] = useState<ObraMetric[]>([]);
    const [selectedObraIds, setSelectedObraIds] = useState<Set<string>>(new Set());
    const [allObras, setAllObras] = useState<{ id: string, name: string }[]>([]);

    useEffect(() => {
        fetchComparativeData();
    }, [role, user]);

    const fetchComparativeData = async () => {
        try {
            setLoading(true);

            // 1. Fetch Obras based on role
            let query = supabase.from('obras').select('id, nombre_obra, monto_contrato').is('parent_id', null);

            if (role === 'coordinador' && user) {
                const { data: assignments } = await supabase.from('obra_usuario').select('obra_id').eq('usuario_id', user.id);
                if (assignments && assignments.length > 0) {
                    query = query.in('id', assignments.map(a => a.obra_id));
                } else {
                    setLoading(false);
                    return;
                }
            }

            const { data: obras, error } = await query;
            if (error) throw error;
            if (!obras) return;

            const obraList = obras.map(o => ({ id: o.id, name: o.nombre_obra }));
            setAllObras(obraList);
            // Default select all
            setSelectedObraIds(new Set(obraList.map(o => o.id)));

            const metricsData: ObraMetric[] = [];

            // 2. Compute metrics for each obra using parallel requests
            await Promise.all(obras.map(async (obra) => {
                // Get latest curve point for SPI and Progress
                const { data: curve } = await supabase
                    .from('vista_curva_s')
                    .select('*')
                    .eq('obra_id', obra.id)
                    .order('periodo_reporte', { ascending: false })
                    .limit(1)
                    .single();

                // Get open incidents count
                const { count: incCount } = await supabase
                    .from('incidencias')
                    .select('id', { count: 'exact', head: true })
                    .eq('obra_id', obra.id)
                    .neq('estado_actual', 'Cerrada');

                let spi = 0;
                let avance = 0;
                let estado: 'Al día' | 'Retrasado' | 'Adelantado' = 'Al día';
                let periodo = '-';

                if (curve) {
                    periodo = curve.periodo_reporte;
                    if (curve.programado_acumulado > 0) {
                        spi = curve.ejecutado_acumulado / curve.programado_acumulado;
                        avance = (curve.ejecutado_acumulado / curve.programado_acumulado) * 100;
                    }

                    if (spi < 0.9) estado = 'Retrasado';
                    else if (spi > 1.1) estado = 'Adelantado';
                }

                metricsData.push({
                    id: obra.id,
                    nombre: obra.nombre_obra,
                    monto_contrato: obra.monto_contrato || 0,
                    avance_fisico: parseFloat(avance.toFixed(1)),
                    spi: parseFloat(spi.toFixed(2)),
                    incidencias_abiertas: incCount || 0,
                    estado_plazo: estado,
                    ultimo_periodo: periodo
                });
            }));

            setMetrics(metricsData);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const toggleObra = (id: string) => {
        const newSet = new Set(selectedObraIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedObraIds(newSet);
    };

    const toggleAll = (checked: boolean) => {
        if (checked) {
            setSelectedObraIds(new Set(allObras.map(o => o.id)));
        } else {
            setSelectedObraIds(new Set());
        }
    };

    const filteredMetrics = metrics.filter(m => selectedObraIds.has(m.id));

    // Prepare chart data
    const chartData = filteredMetrics.map(m => ({
        name: m.nombre.length > 20 ? m.nombre.substring(0, 20) + '...' : m.nombre,
        spi: m.spi,
        avance: m.avance_fisico,
        full_name: m.nombre
    }));

    if (loading) {
        return (
            <Container className="py-5 text-center">
                <Spinner animation="border" variant="primary" />
                <p className="mt-3 text-muted">Cargando comparativo de obras...</p>
            </Container>
        );
    }

    return (
        <Container fluid className="py-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h1 className="h3 fw-bold text-gray-800">Comparativo Global de Obras</h1>
                    <p className="text-muted mb-0">Monitorización y control de portafolio de proyectos</p>
                </div>
                <div className="text-end">
                    <small className="text-muted d-block">Obras Activas</small>
                    <span className="h4 fw-bold text-primary">{metrics.length}</span>
                </div>
            </div>

            <Row className="mb-4">
                <Col md={12}>
                    <Card className="shadow-sm border-0">
                        <Card.Header className="bg-white py-3">
                            <div className="d-flex justify-content-between align-items-center">
                                <h5 className="mb-0 fw-bold text-primary">
                                    <i className="bi bi-funnel me-2"></i>Filtros de Comparación
                                </h5>
                                <Form.Check
                                    type="switch"
                                    id="select-all-switch"
                                    label="Seleccionar Todas"
                                    checked={selectedObraIds.size === allObras.length}
                                    onChange={(e) => toggleAll(e.target.checked)}
                                />
                            </div>
                        </Card.Header>
                        <Card.Body>
                            <div className="d-flex flex-wrap gap-3">
                                {allObras.map(obra => (
                                    <Form.Check
                                        key={obra.id}
                                        type="checkbox"
                                        id={`check-${obra.id}`}
                                        label={obra.name}
                                        checked={selectedObraIds.has(obra.id)}
                                        onChange={() => toggleObra(obra.id)}
                                    />
                                ))}
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            <Row className="g-4 mb-4">
                {/* SPI Comparison Chart */}
                <Col lg={6}>
                    <Card className="h-100 shadow-sm border-0">
                        <Card.Header className="bg-white fw-bold py-3">
                            <i className="bi bi-bar-chart-fill me-2"></i>Comparativo SPI
                        </Card.Header>
                        <Card.Body>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                    <XAxis type="number" domain={[0, 1.5]} hide />
                                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                    <ReferenceLine x={1} stroke="red" strokeDasharray="3 3" />
                                    <Bar dataKey="spi" name="SPI" radius={[0, 4, 4, 0]}>
                                        {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.spi >= 1 ? '#198754' : '#dc3545'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                            <div className="text-center mt-2 small text-muted">
                                <span className="me-3"><i className="bi bi-square-fill text-success me-1"></i>Al día (SPI ≥ 1)</span>
                                <span><i className="bi bi-square-fill text-danger me-1"></i>Retrasado (SPI &lt; 1)</span>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                {/* Progress Comparison */}
                <Col lg={6}>
                    <Card className="h-100 shadow-sm border-0">
                        <Card.Header className="bg-white fw-bold py-3">
                            <i className="bi bi-graph-up-arrow me-2"></i>Avance Físico (%)
                        </Card.Header>
                        <Card.Body>
                            <div className="d-flex flex-column gap-3 justify-content-center h-100">
                                {filteredMetrics.map(m => (
                                    <div key={m.id}>
                                        <div className="d-flex justify-content-between mb-1">
                                            <small className="fw-bold">{m.nombre}</small>
                                            <small className="text-muted">{m.avance_fisico}%</small>
                                        </div>
                                        <ProgressBar
                                            now={m.avance_fisico}
                                            variant={m.spi >= 1 ? 'success' : 'warning'}
                                            style={{ height: '8px' }}
                                        />
                                    </div>
                                ))}
                                {filteredMetrics.length === 0 && <p className="text-muted text-center">No hay obras seleccionadas</p>}
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            <Row>
                <Col xs={12}>
                    <Card className="shadow-sm border-0 overflow-hidden">
                        <Card.Header className="bg-white fw-bold py-3">
                            <i className="bi bi-table me-2"></i>Detalle de Estado
                        </Card.Header>
                        <Table responsive hover className="mb-0 align-middle">
                            <thead className="bg-light">
                                <tr>
                                    <th className="border-0 ps-4">Obra</th>
                                    <th className="border-0 text-center">Último Reporte</th>
                                    <th className="border-0 text-center">SPI</th>
                                    <th className="border-0 text-center">Avance</th>
                                    <th className="border-0 text-center">Incidencias</th>
                                    <th className="border-0 text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredMetrics.map((m) => (
                                    <tr key={m.id}>
                                        <td className="ps-4 fw-medium">{m.nombre}</td>
                                        <td className="text-center text-muted small">{new Date(m.ultimo_periodo || Date.now()).toLocaleDateString()}</td>
                                        <td className="text-center">
                                            <Badge bg={m.spi >= 1 ? 'success' : 'danger'} pill className="px-3">
                                                {m.spi}
                                            </Badge>
                                        </td>
                                        <td className="text-center">{m.avance_fisico}%</td>
                                        <td className="text-center">
                                            {m.incidencias_abiertas > 0 ? (
                                                <Badge bg="warning" text="dark" pill>{m.incidencias_abiertas}</Badge>
                                            ) : (
                                                <span className="text-muted">-</span>
                                            )}
                                        </td>
                                        <td className="text-center">
                                            {m.estado_plazo === 'Retrasado' && <span className="text-danger fw-bold"><i className="bi bi-exclamation-circle me-1"></i>Retrasado</span>}
                                            {m.estado_plazo === 'Al día' && <span className="text-success fw-bold"><i className="bi bi-check-circle me-1"></i>Al día</span>}
                                            {m.estado_plazo === 'Adelantado' && <span className="text-primary fw-bold"><i className="bi bi-lightning-fill me-1"></i>Adelantado</span>}
                                        </td>
                                    </tr>
                                ))}
                                {filteredMetrics.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="text-center py-4 text-muted">
                                            Seleccione al menos una obra para ver los detalles.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </Table>
                    </Card>
                </Col>
            </Row>
        </Container>
    );
};

export default Home;
