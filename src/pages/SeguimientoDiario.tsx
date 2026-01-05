import React, { useEffect, useState } from 'react';
import { Button, Table, Modal, Form, Badge } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import type { Obra, Actividad, AvanceDiario } from '../types';
import moment from 'moment';
import 'moment/locale/es';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

moment.locale('es');

const SeguimientoDiario: React.FC = () => {
    const { user, role } = useAuth();

    // State
    const [obras, setObras] = useState<Obra[]>([]);
    const [selectedParentId, setSelectedParentId] = useState<string>(''); // Parent
    const [components, setComponents] = useState<Obra[]>([]); // Adicionales
    const [selectedObraId, setSelectedObraId] = useState<string>(''); // Component/Final ID
    const [actividades, setActividades] = useState<Actividad[]>([]);
    const [monthlyProjections, setMonthlyProjections] = useState<Record<string, number>>({});
    const [avances, setAvances] = useState<AvanceDiario[]>([]);

    const [selectedMonth, setSelectedMonth] = useState<string>(moment().format('YYYY-MM')); // Default Current Month


    // Modals
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingActivity, setEditingActivity] = useState<Actividad | null>(null);
    const [editForm, setEditForm] = useState<Partial<Actividad>>({});

    const [showTrackModal, setShowTrackModal] = useState(false);
    const [trackingActivity, setTrackingActivity] = useState<Actividad | null>(null);
    const [trackDate, setTrackDate] = useState(moment().format('YYYY-MM-DD'));
    const [trackQty, setTrackQty] = useState<number>(0);
    const [trackObs, setTrackObs] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    // Financial Params State
    const [financialParams, setFinancialParams] = useState({
        ggPct: 12.00,
        utilPct: 9.00,
        fr: 1.000000,
        igvPct: 18.00
    });

    // --- Fetch Functions ---

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
            if (error) throw error;
            setObras(data || []);
        } catch (err) { console.error(err); }
    };

    const fetchComponents = async (parentId: string) => {
        try {
            const { data, error } = await supabase.from('obras').select('id, nombre_obra, type').eq('parent_id', parentId);
            if (!error) setComponents(data || []);
        } catch (e) { console.error(e); }
    };

    const fetchObraParams = async () => {
        if (!selectedObraId) return;
        try {
            const { data, error } = await supabase.from('parametros_obra')
                .select('gastos_generales_porcentaje, utilidad_porcentaje, factor_relacion, igv_porcentaje')
                .eq('obra_id', selectedObraId)
                .single();

            if (!error && data) {
                setFinancialParams({
                    ggPct: data.gastos_generales_porcentaje ?? 12.00,
                    utilPct: data.utilidad_porcentaje ?? 9.00,
                    fr: data.factor_relacion ?? 1.000000,
                    igvPct: data.igv_porcentaje ?? 18.00
                });
            } else {
                setFinancialParams({ ggPct: 12.00, utilPct: 9.00, fr: 1.000000, igvPct: 18.00 });
            }
        } catch (e) { console.error(e); }
    };

    const fetchActividades = async () => {
        const { data, error } = await supabase
            .from('actividades_obra')
            .select('*')
            .eq('obra_id', selectedObraId)
            .order('created_at', { ascending: true });
        if (!error && data) setActividades(data);
    };

    const fetchAvances = async () => {
        if (selectedObraId) {
            const { data: acts } = await supabase.from('actividades_obra').select('id').eq('obra_id', selectedObraId);
            if (acts && acts.length > 0) {
                const ids = acts.map(a => a.id);
                const { data: avs } = await supabase.from('avance_diario').select('*').in('actividad_id', ids);
                setAvances(avs || []);
            } else {
                setAvances([]);
            }
        }
    };

    const fetchProjections = async () => {
        try {
            if (actividades.length === 0) {
                setMonthlyProjections({});
                return;
            }
            const { data, error } = await supabase
                .from('proyecciones_mensuales')
                .select('actividad_id, metrado_proyectado')
                .in('actividad_id', actividades.map(a => a.id))
                .eq('periodo', selectedMonth);

            if (error) throw error;

            const mapping: Record<string, number> = {};
            data?.forEach(p => {
                mapping[p.actividad_id] = p.metrado_proyectado;
            });
            setMonthlyProjections(mapping);
        } catch (e) { console.error('Error fetching projections', e); }
    };

    const saveFinancialParams = async () => {
        if (!selectedObraId) return;
        try {
            const { error } = await supabase.from('parametros_obra').upsert({
                obra_id: selectedObraId,
                gastos_generales_porcentaje: financialParams.ggPct,
                utilidad_porcentaje: financialParams.utilPct,
                factor_relacion: financialParams.fr,
                igv_porcentaje: financialParams.igvPct,
                updated_at: new Date()
            }, { onConflict: 'obra_id' });

            if (error) throw error;
        } catch (e) {
            console.error("Error saving params:", e);
        }
    };

    // --- Effects ---

    useEffect(() => {
        if (user) fetchObras();
    }, [user]);

    // Fetch Components when Parent changes
    useEffect(() => {
        if (selectedParentId) {
            fetchComponents(selectedParentId);
            if (!selectedObraId || selectedObraId !== selectedParentId) setSelectedObraId(selectedParentId);
        } else {
            setComponents([]);
            setSelectedObraId('');
            setActividades([]);
            setAvances([]);
            setMonthlyProjections({});
        }
    }, [selectedParentId]);

    // Fetch Data when Obra changes
    useEffect(() => {
        if (selectedObraId) {
            fetchActividades();
            fetchAvances();
            fetchObraParams();
        } else {
            setActividades([]);
            setAvances([]);
            setMonthlyProjections({});
        }
    }, [selectedObraId]);

    // Fetch Projections when Month or Activities change
    useEffect(() => {
        if (selectedObraId && actividades.length > 0) {
            fetchProjections();
        } else if (actividades.length === 0) {
            setMonthlyProjections({});
        }
    }, [selectedObraId, selectedMonth, actividades]);

    // Calculations & Alert Logic
    const getRowData = (act: Actividad) => {
        const actAvances = avances.filter(a => a.actividad_id === act.id);
        const totalExecutedInfo = actAvances.reduce((acc, curr) => acc + Number(curr.cantidad), 0);

        // Filter by SELECTED month for Projection Alert
        const targetDate = moment(selectedMonth, 'YYYY-MM');
        const targetMonth = targetDate.month(); // 0-11
        const targetYear = targetDate.year();

        const monthlyAvances = actAvances.filter(a => {
            const d = moment(a.fecha);
            return d.month() === targetMonth && d.year() === targetYear;
        });
        const executedMonth = monthlyAvances.reduce((acc, curr) => acc + Number(curr.cantidad), 0);

        // USE MONTHLY PROJECTION
        const projected = monthlyProjections[act.id] || 0;
        const price = act.precio_unitario || 0;
        const valorizado = totalExecutedInfo * price;

        // Alert Logic (Only applies if selected month is CURRENT month)
        // "si al dia 15 del mes no se tiene el 50% de lo proyectado o antes de quincena no este cerca a este 50% me de alertas"
        const isCurrentMonth = moment().format('YYYY-MM') === selectedMonth;
        const dayOfMonth = isCurrentMonth ? moment().date() : 30; // If past month, assume full month check

        let alertStatus: 'ok' | 'warning' | 'danger' = 'ok';

        if (projected > 0) {
            const targetRatio = 0.5; // 50%
            const targetTotal = projected * targetRatio; // The absolute amount that is 50%

            if (dayOfMonth >= 15) {
                if (executedMonth < targetTotal) alertStatus = 'danger';
            } else {
                // Before 15th
                // Linear expectation: At day 15 we want 50%.
                // So at Day X, we expect (50% / 15) * X
                const expectedPctAtDay = (targetRatio / 15) * dayOfMonth;
                const expectedAmountAtDay = projected * expectedPctAtDay;

                // Define "not close" as being below 80% of the expected trajectory? 
                // User said "no este cerca". Let's say if < 70% of expected linear path.
                if (executedMonth < expectedAmountAtDay * 0.7) {
                    alertStatus = 'warning';
                }
            }
        }

        return {
            totalExecuted: totalExecutedInfo,
            executedMonth,
            valorizado,
            alertStatus
        };
    };

    // Actions
    const handleEditClick = (act: Actividad) => {
        setEditingActivity(act);
        setEditForm({
            unidad_medida: act.unidad_medida,
            precio_unitario: act.precio_unitario,
            metrado_total_estimado: act.metrado_total_estimado,
            metrado_proyectado: monthlyProjections[act.id] || 0, // Load current month projection
            tipo: act.tipo || 'entregable'
        });
        setShowEditModal(true);
    };

    const saveEdit = async () => {
        if (!editingActivity) return;
        try {
            // 1. Update Activity Basics (excluding type for now)
            const { tipo, metrado_proyectado, ...payload } = editForm; // Exclude projected from activity update
            const { error: actError } = await supabase.from('actividades_obra').update(payload).eq('id', editingActivity.id);
            if (actError) throw actError;

            // 2. Update Monthly Projection
            if (editForm.metrado_proyectado !== undefined) {
                const { error: projError } = await supabase.from('proyecciones_mensuales').upsert({
                    actividad_id: editingActivity.id,
                    periodo: selectedMonth,
                    metrado_proyectado: editForm.metrado_proyectado,
                    updated_at: new Date()
                }, { onConflict: 'actividad_id, periodo' });
                if (projError) throw projError;
            }

            setShowEditModal(false);
            fetchActividades(); // This triggers fetchProjections via useEffect
        } catch (e) { alert('Error updating'); console.error(e); }
    };

    const handleTrackClick = (act: Actividad) => {
        setTrackingActivity(act);
        setTrackQty(0);
        setTrackObs('');
        setTrackDate(moment().format('YYYY-MM-DD'));
        setShowTrackModal(true);
    };

    const saveTrack = async () => {
        if (!trackingActivity) return;
        try {
            const { error } = await supabase.from('avance_diario').insert({
                actividad_id: trackingActivity.id,
                fecha: trackDate,
                cantidad: trackQty,
                observaciones: trackObs
            });
            if (error) throw error;
            setShowTrackModal(false);
            fetchAvances();
        } catch (e) { alert('Error saving progress'); }
    };

    const handleExportPDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        const workName = obras.find(o => o.id === selectedParentId)?.nombre_obra || 'Obra';
        const componentName = components.find(c => c.id === selectedObraId)?.nombre_obra
            || (selectedObraId === selectedParentId ? 'Contrato Principal' : '');

        doc.setFontSize(14);
        doc.text('Seguimiento Diario y Valorización', 14, 15);
        doc.setFontSize(10);
        doc.text(`${workName} - ${componentName}`, 14, 22);
        doc.text(`Periodo: ${selectedMonth}`, 14, 27);

        // Filtered data
        // Filtered data
        const tableData = actividades
            .filter(act => !searchTerm || act.nombre_partida.toLowerCase().includes(searchTerm.toLowerCase()))
            .map(act => {
                const { executedMonth, valorizado } = getRowData(act);
                const projected = monthlyProjections[act.id] || 0;
                const pctMes = projected ? ((executedMonth / projected) * 100).toFixed(1) : '0';
                return [
                    act.nombre_partida,
                    act.unidad_medida || '-',
                    'S/ ' + (act.precio_unitario?.toFixed(2) || '0.00'), // Swapped: Price first
                    act.metrado_total_estimado?.toLocaleString() || '-', // Swapped: Metrado second
                    projected.toLocaleString(),
                    (executedMonth).toLocaleString(),
                    pctMes + '%',
                    'S/ ' + valorizado.toLocaleString(undefined, { minimumFractionDigits: 2 })
                ];
            });

        // Calculations for Footer
        const totalBudget = actividades.reduce((acc, act) => acc + ((act.metrado_total_estimado || 0) * (act.precio_unitario || 0)), 0);
        const totalProjected = actividades.reduce((acc, act) => acc + ((monthlyProjections[act.id] || 0) * (act.precio_unitario || 0)), 0);
        const totalExecuted = actividades.reduce((acc, act) => {
            const { executedMonth } = getRowData(act);
            return acc + (executedMonth * (act.precio_unitario || 0));
        }, 0);

        const ggVal = financialParams.ggPct / 100;
        const utilVal = financialParams.utilPct / 100;
        const subTotalMult = 1 + ggVal + utilVal;
        const frVal = financialParams.fr;
        const subTotalFrMult = subTotalMult * frVal;
        const igvVal = financialParams.igvPct / 100;
        const totalMult = subTotalFrMult * (1 + igvVal);

        const fmt = (n: number) => 'S/ ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const footerMap = [
            ['COSTO DIRECTO (A)', '', fmt(totalBudget), '', fmt(totalProjected), '', '', fmt(totalExecuted)],
            ['GASTOS GENERALES (B)', `${financialParams.ggPct}%`, fmt(totalBudget * ggVal), '', fmt(totalProjected * ggVal), '', '', fmt(totalExecuted * ggVal)],
            ['UTILIDAD (C)', `${financialParams.utilPct}%`, fmt(totalBudget * utilVal), '', fmt(totalProjected * utilVal), '', '', fmt(totalExecuted * utilVal)],
            ['SUB TOTAL (A+B+C)', '', fmt(totalBudget * subTotalMult), '', fmt(totalProjected * subTotalMult), '', '', fmt(totalExecuted * subTotalMult)],
            ['FACTOR RELACION', `${financialParams.fr}`, '', '', '', '', '', ''],
            ['REINTEGRO', '', '0.00', '', '0.00', '', '', '0.00'],
            ['SUB TOTAL + REINTEGRO', '', fmt(totalBudget * subTotalFrMult), '', fmt(totalProjected * subTotalFrMult), '', '', fmt(totalExecuted * subTotalFrMult)],
            ['IGV', `${financialParams.igvPct}%`, fmt(totalBudget * subTotalFrMult * igvVal), '', fmt(totalProjected * subTotalFrMult * igvVal), '', '', fmt(totalExecuted * subTotalFrMult * igvVal)],
            ['MONTO TOTAL (INCL. IGV)', '', fmt(totalBudget * totalMult), '', fmt(totalProjected * totalMult), '', '', fmt(totalExecuted * totalMult)]
        ];

        autoTable(doc, {
            startY: 35,
            head: [['Actividad', 'Unidad', 'Precio Unit.', 'Metrado Total', 'Proyectado', 'Avance Mes', '% Mes', 'Valorizado']],
            body: tableData,
            foot: selectedObraId ? (footerMap as any[]) : undefined,
            showFoot: 'lastPage',
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], textColor: 255 },
            footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', halign: 'right' },
            columnStyles: {
                0: { halign: 'left' }, // Actividad
                1: { halign: 'center' }, // Unidad
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right' },
                5: { halign: 'right' },
                6: { halign: 'right' },
                7: { halign: 'right' }
            },
        });

        doc.save(`Seguimiento_${selectedMonth}.pdf`);
    };

    return (
        <div className="container-fluid p-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2>Seguimiento Diario y Valorización</h2>
                <div className="d-flex gap-2 align-items-start">
                    {/* Export PDF */}
                    <Button variant="danger" onClick={handleExportPDF} title="Generar reporte PDF">
                        <i className="bi bi-file-earmark-pdf me-2"></i>Exportar PDF
                    </Button>

                    {/* Month Selector */}
                    <div className="d-flex flex-column">
                        <Form.Control
                            type="month"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            title="Seleccionar Mes de Valorización"
                            style={{ width: '160px' }}
                        />
                    </div>


                    <div className="d-flex flex-column gap-2">
                        <Form.Select
                            style={{ minWidth: '200px' }}
                            value={selectedParentId}
                            onChange={(e) => setSelectedParentId(e.target.value)}
                        >
                            <option value="">Seleccione Obra...</option>
                            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
                        </Form.Select>
                        {selectedParentId && (
                            <Form.Select
                                style={{ minWidth: '250px' }}
                                value={selectedObraId}
                                onChange={(e) => setSelectedObraId(e.target.value)}
                            >
                                <option value={selectedParentId}>Contrato Principal</option>
                                {components.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.type === 'adicional' ? 'Adicional: ' : ''}{c.nombre_obra}
                                    </option>
                                ))}
                            </Form.Select>
                        )}
                    </div>


                </div>
            </div>

            <div className="mb-3">
                <Form.Control
                    type="text"
                    placeholder="Buscar actividad..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <Table striped bordered hover responsive>
                <thead className="bg-dark text-white">
                    <tr>
                        <th>Actividad</th>
                        <th>Unidad</th>
                        <th>Precio Unit.</th>
                        <th>Metrado Total</th>
                        <th>Proyectado ({moment(selectedMonth).format('MM/YY')})</th>
                        <th>Avance ({moment(selectedMonth).format('MM/YY')})</th>
                        <th>% Mes</th>
                        <th>Valorizado Total</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    {actividades
                        .filter(act => {
                            if (!searchTerm) return true;
                            return act.nombre_partida.toLowerCase().includes(searchTerm.toLowerCase());
                        })
                        .map(act => {
                            const { executedMonth, valorizado, alertStatus } = getRowData(act);
                            const projected = monthlyProjections[act.id] || 0;
                            const pctMes = projected ? ((executedMonth / projected) * 100).toFixed(1) : '0';
                            return (
                                <tr key={act.id}>
                                    <td>
                                        {act.nombre_partida}
                                        {act.tipo === 'adicional' && <Badge bg="warning" text="dark" className="ms-2">Adicional</Badge>}
                                    </td>
                                    <td>{act.unidad_medida || '-'}</td>
                                    <td>{act.precio_unitario ? `S/ ${act.precio_unitario}` : '-'}</td>
                                    <td>{act.metrado_total_estimado || '-'}</td>
                                    <td>{monthlyProjections[act.id] || '-'}</td>
                                    <td>{executedMonth}</td>
                                    <td>{pctMes}%</td>
                                    <td>S/ {valorizado.toFixed(2)}</td>
                                    <td className="text-center">
                                        {alertStatus === 'danger' && <Badge bg="danger">Alerta</Badge>}
                                        {alertStatus === 'warning' && <Badge bg="warning" text="dark">Riesgo</Badge>}
                                        {alertStatus === 'ok' && <Badge bg="success">OK</Badge>}
                                    </td>
                                    <td>
                                        <Button size="sm" variant="outline-primary" className="me-2" onClick={() => handleEditClick(act)} title="Editar Detalles">
                                            <i className="bi bi-pencil"></i> Detalles
                                        </Button>
                                        <Button size="sm" variant="success" onClick={() => handleTrackClick(act)} title="Registrar Avance">
                                            <i className="bi bi-plus-circle"></i> Avance
                                        </Button>
                                    </td>
                                </tr>
                            );
                        })}
                </tbody>
                {selectedObraId && (
                    <tfoot>
                        {(() => {
                            const totalBudget = actividades.reduce((acc, act) => acc + ((act.metrado_total_estimado || 0) * (act.precio_unitario || 0)), 0);
                            const totalProjected = actividades.reduce((acc, act) => acc + ((monthlyProjections[act.id] || 0) * (act.precio_unitario || 0)), 0);
                            const totalExecuted = actividades.reduce((acc, act) => {
                                const { executedMonth } = getRowData(act);
                                return acc + (executedMonth * (act.precio_unitario || 0));
                            }, 0);

                            const renderRow = (label: string, pctInput: React.ReactNode, multiplier: number, isCurrency: boolean = true, isBold: boolean = false, isBg: boolean = false) => (
                                <tr className={`${isBold ? 'fw-bold' : ''} ${isBg ? 'bg-light' : ''}`}>
                                    <td colSpan={2} className="text-end align-middle">
                                        <div className="d-flex justify-content-end align-items-center gap-2">
                                            <span>{label}</span>
                                            {pctInput && <div style={{ width: '20%' }}>{pctInput}</div>}
                                        </div>
                                    </td>
                                    <td className="text-end align-middle">{isCurrency ? 'S/ ' : ''}{(totalBudget * multiplier).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td></td>
                                    <td className="text-end align-middle">{isCurrency ? 'S/ ' : ''}{(totalProjected * multiplier).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="text-end align-middle">{isCurrency ? 'S/ ' : ''}{(totalExecuted * multiplier).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td colSpan={4}></td>
                                </tr>
                            );

                            const ggVal = financialParams.ggPct / 100;
                            const utilVal = financialParams.utilPct / 100;
                            const subTotalMult = 1 + ggVal + utilVal;
                            const frVal = financialParams.fr;
                            const subTotalFrMult = subTotalMult * frVal;
                            const igvVal = financialParams.igvPct / 100;
                            const totalMult = subTotalFrMult * (1 + igvVal);

                            return (
                                <>
                                    {/* Spacer Row */}
                                    <tr style={{ borderTop: '2px solid #dee2e6' }}><td colSpan={10}></td></tr>

                                    {renderRow("COSTO DIRECTO (A)", null, 1)}

                                    {renderRow(
                                        "GASTOS GENERALES (B)",
                                        <div className="input-group input-group-sm">
                                            <Form.Control
                                                type="number"
                                                value={financialParams.ggPct}
                                                onChange={e => setFinancialParams({ ...financialParams, ggPct: Number(e.target.value) })}
                                                onBlur={saveFinancialParams}
                                                className="text-end px-1"
                                            />
                                            <span className="input-group-text">%</span>
                                        </div>,
                                        ggVal
                                    )}

                                    {renderRow(
                                        "UTILIDAD (C)",
                                        <div className="input-group input-group-sm">
                                            <Form.Control
                                                type="number"
                                                value={financialParams.utilPct}
                                                onChange={e => setFinancialParams({ ...financialParams, utilPct: Number(e.target.value) })}
                                                onBlur={saveFinancialParams}
                                                className="text-end px-1"
                                            />
                                            <span className="input-group-text">%</span>
                                        </div>,
                                        utilVal
                                    )}

                                    {renderRow("SUB TOTAL (A+B+C)", null, subTotalMult, true, true, true)}

                                    <tr>
                                        <td colSpan={2} className="text-end align-middle">
                                            <div className="d-flex justify-content-end align-items-center gap-2">
                                                <span>FACTOR RELACION</span>
                                                <div style={{ width: '20%' }}>
                                                    <Form.Control
                                                        size="sm"
                                                        type="number"
                                                        value={financialParams.fr}
                                                        onChange={e => setFinancialParams({ ...financialParams, fr: Number(e.target.value) })}
                                                        onBlur={saveFinancialParams}
                                                        className="text-end px-1"
                                                        step="0.000001"
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                        <td colSpan={8}></td>
                                    </tr>

                                    {renderRow("REINTEGRO POR FACTOR RELACION", null, 0, false)}

                                    {renderRow("SUB TOTAL + REINTEGRO", null, subTotalFrMult, true, true)}

                                    {renderRow(`IGV ${financialParams.igvPct}%`, null, subTotalFrMult * igvVal)}

                                    {renderRow("MONTO TOTAL DE OBRA (INCL. IGV)", null, totalMult, true, true, true)}
                                </>
                            );
                        })()}
                    </tfoot>
                )}
            </Table>

            {/* Edit Modal */}
            <Modal show={showEditModal} onHide={() => setShowEditModal(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>Editar Detalles: {editingActivity?.nombre_partida}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Unidad de Medida</Form.Label>
                            <Form.Control type="text" value={editForm.unidad_medida || ''} onChange={e => setEditForm({ ...editForm, unidad_medida: e.target.value })} />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Precio Unitario (S/)</Form.Label>
                            <Form.Control type="number" value={editForm.precio_unitario || ''} onChange={e => setEditForm({ ...editForm, precio_unitario: Number(e.target.value) })} />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Metrado Total Estimado</Form.Label>
                            <Form.Control type="number" value={editForm.metrado_total_estimado || ''} onChange={e => setEditForm({ ...editForm, metrado_total_estimado: Number(e.target.value) })} />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Proyectado para {moment(selectedMonth).format('MMMM YYYY')}</Form.Label>
                            <Form.Control type="number" value={editForm.metrado_proyectado || ''} onChange={e => setEditForm({ ...editForm, metrado_proyectado: Number(e.target.value) })} />
                            <Form.Text className="text-muted">Meta a alcanzar en el mes seleccionado.</Form.Text>
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Tipo de Actividad</Form.Label>
                            <Form.Select value={editForm.tipo || 'entregable'} onChange={e => setEditForm({ ...editForm, tipo: e.target.value as any })}>
                                <option value="entregable">Entregable</option>
                                <option value="adicional">Adicional</option>
                            </Form.Select>
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowEditModal(false)}>Cancelar</Button>
                    <Button variant="primary" onClick={saveEdit}>Guardar</Button>
                </Modal.Footer>
            </Modal>

            {/* Track Modal */}
            <Modal show={showTrackModal} onHide={() => setShowTrackModal(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>Registrar Avance: {trackingActivity?.nombre_partida}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Fecha</Form.Label>
                            <Form.Control type="date" value={trackDate} onChange={e => setTrackDate(e.target.value)} />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Cantidad de Avance ({trackingActivity?.unidad_medida})</Form.Label>
                            <Form.Control type="number" value={trackQty} onChange={e => setTrackQty(Number(e.target.value))} />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Observaciones</Form.Label>
                            <Form.Control as="textarea" rows={2} value={trackObs} onChange={e => setTrackObs(e.target.value)} />
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowTrackModal(false)}>Cancelar</Button>
                    <Button variant="primary" onClick={saveTrack}>Registrar</Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
};

export default SeguimientoDiario;
