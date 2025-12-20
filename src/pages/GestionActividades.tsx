import React, { useEffect, useState } from 'react';
import { Button, Form, Card, Table, Modal } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Chart } from "react-google-charts";
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';

interface Obra {
    id: string;
    nombre_obra: string;
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

interface Actividad {
    id: string;
    nombre_partida: string;
    duracion: number;
    dependencias: string[]; // Format: "UUID:TYPE:LAG" e.g. "uuid1:FC:0", "uuid2:CC:5"
    es_critica: boolean;
    start_date?: Date;
    end_date?: Date;
    created_at?: string;
}

interface DependencyParsed {
    targetId: string;
    type: 'FC' | 'CC' | 'FF' | 'CF';
    lag: number;
}

const GestionActividades: React.FC = () => {
    const { user, role } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    // State for Selector
    const [obras, setObras] = useState<Obra[]>([]);
    const [selectedObraId, setSelectedObraId] = useState<string>(searchParams.get('obra_id') || '');
    const [selectedObra, setSelectedObra] = useState<Obra | null>(null);

    const [actividades, setActividades] = useState<Actividad[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);

    // Form State
    const [desc, setDesc] = useState('');
    const [duracion, setDuracion] = useState(1);
    const [predsString, setPredsString] = useState(''); // Text input for dependencies

    // Obra Config State
    const [configData, setConfigData] = useState<Partial<Obra>>({});

    // Fetch Obras on mount
    useEffect(() => {
        if (user) fetchObras();
    }, [user]);

    // Fetch Actividades when Obra changes
    useEffect(() => {
        if (selectedObraId) {
            const found = obras.find(o => o.id === selectedObraId) || null;
            if (found) {
                fetchObraDetails(selectedObraId);
            }
            setSearchParams({ obra_id: selectedObraId });
        } else {
            setActividades([]);
            setSelectedObra(null);
        }
    }, [selectedObraId, obras]);

    useEffect(() => {
        if (selectedObra) {
            fetchActividades();
            setConfigData(selectedObra);
        }
    }, [selectedObra]);

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

            if (data && data.length === 1 && !selectedObraId) {
                setSelectedObraId(data[0].id);
            }
        } catch (err) {
            console.error('Error fetching obras', err);
        }
    };

    const fetchObraDetails = async (id: string) => {
        const { data, error } = await supabase.from('obras').select('*').eq('id', id).single();
        if (!error && data) {
            setSelectedObra(data);
        }
    };

    const fetchActividades = async () => {
        if (!selectedObraId) return;
        try {
            const { data, error } = await supabase
                .from('actividades_obra')
                .select('*')
                .eq('obra_id', selectedObraId)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true }); // Secondary sort for stability

            if (error) throw error;

            const mapped: Actividad[] = (data || []).map(d => ({
                id: d.id,
                nombre_partida: d.nombre_partida,
                duracion: d.duracion || 1,
                dependencias: d.dependencias || [],
                es_critica: d.es_critica || false,
                created_at: d.created_at
            }));

            const calculated = calculateCPM(mapped);
            setActividades(calculated);
        } catch (err) {
            console.error(err);
        }
    };

    // --- DEPENDENCY PARSING UTILS ---

    // Parses internal string "UUID:TYPE:LAG"
    const parseInternalDependency = (depStr: string): DependencyParsed | null => {
        const parts = depStr.split(':');
        // Legacy support: if only UUID (no colons), assume FC+0
        if (parts.length === 1 && parts[0].length > 10) {
            return { targetId: parts[0], type: 'FC', lag: 0 };
        }
        if (parts.length >= 3) {
            return { targetId: parts[0], type: parts[1] as any, lag: parseInt(parts[2]) || 0 };
        }
        return null; // Invalid
    };

    // Parses user input string "1FC+2" or "1" to internal struct (using row numbers first, resolved later)
    // Returns { rowNum: number, type: string, lag: number }
    const parseUserDependency = (input: string) => {
        const regex = /^(\d+)(FC|CC|FF|CF)?([+-]\d+)?(\s*días)?$/i;
        const match = input.trim().match(regex);
        if (match) {
            return {
                rowNum: parseInt(match[1]),
                type: (match[2] || 'FC').toUpperCase() as any,
                lag: match[3] ? parseInt(match[3]) : 0
            };
        }
        return null;
    };

    // Helper to get 1-based index
    const getRowNumber = (id: string, list: Actividad[] = actividades) => {
        const index = list.findIndex(a => a.id === id);
        return index !== -1 ? index + 1 : '?';
    };

    // Helper to format dependencies for display (Internal -> User Friendly)
    // "uuid:CC:5" -> "1CC+5"
    const formatDependencies = (depIds: string[]) => {
        if (!depIds || depIds.length === 0) return '-';
        return depIds.map(depStr => {
            const parsed = parseInternalDependency(depStr);
            if (!parsed) return '?';
            const rowNum = getRowNumber(parsed.targetId);
            const lagStr = parsed.lag !== 0 ? (parsed.lag > 0 ? `+${parsed.lag}` : `${parsed.lag}`) : '';
            const typeStr = parsed.type === 'FC' && parsed.lag === 0 ? '' : parsed.type; // Simple '1' if FC+0
            return `${rowNum}${typeStr}${lagStr}`;
        }).join(', ');
    };

    // Helper to extract just UUIDs for the Gantt Chart (Visuals only)
    const extractDependencyIds = (depStrings: string[]) => {
        if (!depStrings || depStrings.length === 0) return null;
        // Filter out IDs that might not exist in the current list to prevent crashes
        const validIds = actividades.map(a => a.id);
        return depStrings
            .map(ds => {
                const parts = ds.split(':');
                return parts[0];
            })
            .filter(id => validIds.includes(id))
            .join(',');
    };

    // --- CPM LOGIC ---
    const calculateCPM = (tasks: Actividad[]): Actividad[] => {
        const taskMap = new Map<string, Actividad>();
        tasks.forEach(t => {
            t.start_date = undefined;
            t.end_date = undefined;
            taskMap.set(t.id, t);
        });

        // Loop until stable (simple logic, warning: cycles can cause infinite loop)
        let changed = true;
        let passes = 0;

        while (changed && passes < 100) {
            changed = false;
            passes++;

            tasks.forEach(t => {
                let projectStart = new Date().getTime();
                if (selectedObra?.fecha_inicio_plazo) {
                    const parts = selectedObra.fecha_inicio_plazo.split('-');
                    projectStart = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();
                }

                // Default Start is Project Start
                let calculatedStart = projectStart;

                // If the task has no dependencies, it starts at project start
                // But we must respect calculated start if another pass increased it.
                // Actually start is MAX(ProjectStart, MaxDependencyEnd)

                // Check dependencies
                if (t.dependencias && t.dependencias.length > 0) {
                    t.dependencias.forEach(depStr => {
                        const parsed = parseInternalDependency(depStr);
                        if (!parsed) return;

                        const pred = taskMap.get(parsed.targetId);
                        if (pred && pred.start_date && pred.end_date) {
                            const predStart = pred.start_date.getTime();
                            const predEnd = pred.end_date.getTime();
                            const lagMs = parsed.lag * 24 * 60 * 60 * 1000;

                            let constraintDate = projectStart;

                            const durationMs = t.duracion * 24 * 60 * 60 * 1000;

                            switch (parsed.type) {
                                case 'FC':
                                    constraintDate = predEnd + lagMs;
                                    break;
                                case 'CC':
                                    constraintDate = predStart + lagMs;
                                    break;
                                case 'FF':
                                    // End >= Pred.End + Lag -> Start >= Pred.End + Lag - MyDuration
                                    constraintDate = predEnd + lagMs - durationMs;
                                    break;
                                case 'CF':
                                    // End >= Pred.Start + Lag -> Start >= Pred.Start + Lag - MyDuration
                                    constraintDate = predStart + lagMs - durationMs;
                                    break;
                            }

                            if (constraintDate > calculatedStart) {
                                calculatedStart = constraintDate;
                            }
                        }
                    });
                }

                // Ensure we don't regress start date in loop if not needed, but here we recalculate fresh each pass? 
                // No, we should base on dependencies. A task's start depends ONLY on preds. 
                // So calculatedStart IS correct.

                // However, current start_date might be undefined initially.
                const currentStart = t.start_date?.getTime();

                if (currentStart !== calculatedStart) {
                    const newStart = new Date(calculatedStart);
                    const newEnd = new Date(calculatedStart + (t.duracion * 24 * 60 * 60 * 1000));

                    t.start_date = newStart;
                    t.end_date = newEnd;
                    changed = true;
                }
            });
        }

        // Final pass for tasks with no date (orphans/first tasks)
        tasks.forEach(t => {
            if (!t.start_date) {
                let projectStart = new Date().getTime();
                if (selectedObra?.fecha_inicio_plazo) {
                    const parts = selectedObra.fecha_inicio_plazo.split('-');
                    projectStart = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();
                }
                t.start_date = new Date(projectStart);
                t.end_date = new Date(projectStart + (t.duracion * 24 * 60 * 60 * 1000));
            }
        });

        return tasks;
    }

    const handleDownloadTemplate = () => {
        const ws = XLSX.utils.json_to_sheet([
            {
                nombre_partida: "Excavación Zanjas",
                duracion: 5,
                dependencias: "",
                nota_ayuda: "Dejar vacío si no tiene dependencias"
            },
            {
                nombre_partida: "Cimientos",
                duracion: 3,
                dependencias: "1FC+2",
                nota_ayuda: "Depende de Fila 1 (Fin-Comienzo + 2 días)"
            },
            {
                nombre_partida: "Muros",
                duracion: 4,
                dependencias: "2CC",
                nota_ayuda: "Comienza junto con la Fila 2"
            }
        ]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
        XLSX.writeFile(wb, "plantilla_actividades.xlsx");
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedObraId) return;

        setImporting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

            // 1. Insert empty first to get IDs
            // FORCE ORDER: Generate explicit timestamps incrementing by 10ms
            const baseTime = new Date().getTime();

            const payload = jsonData.map((row, index) => ({
                obra_id: selectedObraId,
                nombre_partida: row.nombre_partida || row['Nombre Partida'] || 'Sin Nombre',
                duracion: row.duracion || row['Duracion'] || 1,
                dependencias: [],
                created_at: new Date(baseTime + (index * 10)).toISOString() // Force strict chronological order
            }));

            if (payload.length > 0) {
                const { data: insertedData, error } = await supabase
                    .from('actividades_obra')
                    .insert(payload)
                    .select()
                    .order('created_at', { ascending: true }); // Important: Assume inserted order matches array order

                if (error) throw error;
                if (!insertedData) throw new Error("No se devolvieron datos insertados");

                // 2. Resolve dependencies
                const updates = [];

                for (let i = 0; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    const rawDeps = row.dependencias || row['Dependencias'];

                    if (rawDeps) {
                        const depString = rawDeps.toString();
                        const depParts = depString.split(/[;,]/).map((s: string) => s.trim()); // Split by ; or ,

                        const resolvedInternalDeps: string[] = [];

                        depParts.forEach((part: string) => {
                            const parsed = parseUserDependency(part);
                            if (parsed) {
                                // Find target ID from row number
                                if (parsed.rowNum > 0 && parsed.rowNum <= insertedData.length) {
                                    const targetId = insertedData[parsed.rowNum - 1].id;
                                    // Create internal string
                                    resolvedInternalDeps.push(`${targetId}:${parsed.type}:${parsed.lag}`);
                                }
                            }
                        });

                        if (resolvedInternalDeps.length > 0) {
                            updates.push({
                                id: insertedData[i].id,
                                dependencias: resolvedInternalDeps
                            });
                        }
                    }
                }

                if (updates.length > 0) {
                    for (const update of updates) {
                        await supabase
                            .from('actividades_obra')
                            .update({ dependencias: update.dependencias })
                            .eq('id', update.id);
                    }
                }

                alert('Importado correctamente ' + insertedData.length + ' actividades.');
                fetchActividades();
            }
        } catch (err: any) {
            console.error(err);
            alert('Error al importar: ' + err.message);
        } finally {
            setImporting(false);
            e.target.value = '';
        }
    };


    const handleSave = async () => {
        if (!selectedObraId) return;
        try {
            // Parse predsString into internal format
            // predsString example: "1, 2CC+5"
            const finalHashDeps: string[] = [];

            if (predsString.trim().length > 0) {
                const parts = predsString.split(',').map(s => s.trim());
                for (const part of parts) {
                    const parsed = parseUserDependency(part);
                    if (!parsed) {
                        alert(`Error de formato en dependencia: "${part}". Use formato "1", "1FC+5", "1CC", etc.`);
                        return;
                    }
                    // Resolve Row ID to UUID
                    // Note: actividades is sorted 1..N. So index = rowNum - 1.
                    const targetIdx = parsed.rowNum - 1;
                    if (targetIdx < 0 || targetIdx >= actividades.length) {
                        alert(`La fila ${parsed.rowNum} no existe.`);
                        return;
                    }
                    const targetId = actividades[targetIdx].id;
                    if (targetId === editingId) {
                        alert('Una actividad no puede depender de sí misma.');
                        return;
                    }

                    finalHashDeps.push(`${targetId}:${parsed.type}:${parsed.lag}`);
                }
            }

            const payload = {
                obra_id: selectedObraId,
                nombre_partida: desc,
                duracion: duracion,
                dependencias: finalHashDeps
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

    const handleSaveConfig = async () => {
        if (!selectedObraId || !configData) return;
        try {
            const { id, ...cleanData } = configData as any;

            if (cleanData.monto_contrato && isNaN(cleanData.monto_contrato)) cleanData.monto_contrato = null;
            if (cleanData.plazo_ejecucion_dias && isNaN(cleanData.plazo_ejecucion_dias)) cleanData.plazo_ejecucion_dias = null;

            const { error } = await supabase.from('obras').update(cleanData).eq('id', selectedObraId);

            if (error) throw error;

            alert('Datos de obra actualizados correctamente');
            setShowConfigModal(false);
            fetchObraDetails(selectedObraId);
        } catch (err: any) {
            console.error(err);
            alert('Error al actualizar obra: ' + (err.message || err.toString()));
        }
    };

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
                    {selectedObraId && (
                        <Button variant="outline-dark" onClick={() => setShowConfigModal(true)}>
                            <i className="bi bi-gear-fill me-2"></i>Configurar Obra
                        </Button>
                    )}
                </Card.Body>
            </Card>

            {selectedObraId ? (
                <>
                    <Card className="mb-4">
                        <Card.Header className="d-flex justify-content-between align-items-center">
                            <h5 className="mb-0">Lista de Actividades</h5>
                            <div className="d-flex gap-2">
                                <Button variant="success" size="sm" onClick={handleDownloadTemplate}>
                                    <i className="bi bi-file-earmark-spreadsheet me-2"></i>Plantilla
                                </Button>
                                <label className="btn btn-outline-success btn-sm">
                                    <i className="bi bi-upload me-2"></i>Importar Excel
                                    <input type="file" hidden accept=".xlsx, .xls" onChange={handleFileUpload} disabled={importing} />
                                </label>
                                <Button onClick={() => {
                                    setEditingId(null);
                                    setDesc('');
                                    setDuracion(1);
                                    setPredsString('');
                                    setShowModal(true);
                                }}>Nueva Actividad</Button>
                            </div>
                        </Card.Header>
                        <Card.Body>
                            <Table striped hover responsive>
                                <thead>
                                    <tr>
                                        <th style={{ width: '50px' }}>#</th>
                                        <th>Descripción</th>
                                        <th>Duración (días)</th>
                                        <th>Predecesoras</th>
                                        <th>Inicio (Est.)</th>
                                        <th>Fin (Est.)</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {actividades.map((a, index) => (
                                        <tr key={a.id} className={a.es_critica ? 'table-danger' : ''}>
                                            <td className="fw-bold">{index + 1}</td>
                                            <td>{a.nombre_partida} {a.es_critica && <span className="badge bg-danger">Crítica</span>}</td>
                                            <td>{a.duracion}</td>
                                            <td>
                                                {formatDependencies(a.dependencias)}
                                            </td>
                                            <td>{a.start_date?.toLocaleDateString()}</td>
                                            <td>{a.end_date?.toLocaleDateString()}</td>
                                            <td>
                                                <Button size="sm" variant="outline-primary" className="me-1" onClick={() => {
                                                    setEditingId(a.id);
                                                    setDesc(a.nombre_partida);
                                                    setDuracion(a.duracion);
                                                    setPredsString(formatDependencies(a.dependencias));
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
                                    data={[
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
                                            `[${getRowNumber(t.id)}] ${t.nombre_partida}`,
                                            t.es_critica ? "critical" : null,
                                            t.start_date,
                                            t.end_date,
                                            null,
                                            0,
                                            extractDependencyIds(t.dependencias)
                                        ])
                                    ]}
                                    options={{
                                        height: 400,
                                        gantt: {
                                            trackHeight: 30,
                                            criticalPathEnabled: false,
                                            arrow: {
                                                angle: 45,
                                                width: 2,
                                                color: '#e64a19',
                                                radius: 0
                                            },
                                            labelStyle: {
                                                fontName: 'Arial',
                                                fontSize: 12,
                                                color: '#757575',
                                            },
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
                                    <Form.Label>Predecesoras (Códigos MS Project)</Form.Label>
                                    <Form.Control
                                        type="text"
                                        placeholder="Ej: 1, 3FC+5, 4CC-2"
                                        value={predsString}
                                        onChange={e => setPredsString(e.target.value)}
                                    />
                                    <Form.Text className="text-muted">
                                        Use números de fila. Tipos: FC (Fin-Inicio), CC (Inicio-Inicio), etc. +/- días.
                                    </Form.Text>
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

            {/* Modal Configurar Obra */}
            <Modal show={showConfigModal} onHide={() => setShowConfigModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>Datos de la Obra</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <div className="row">
                            <div className="col-md-6 mb-3">
                                <Form.Label>Ubicación</Form.Label>
                                <Form.Control value={configData.ubicacion || ''} onChange={e => setConfigData({ ...configData, ubicacion: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Entidad Contratante</Form.Label>
                                <Form.Control value={configData.entidad_contratante || ''} onChange={e => setConfigData({ ...configData, entidad_contratante: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Contratista</Form.Label>
                                <Form.Control value={configData.contratista || ''} onChange={e => setConfigData({ ...configData, contratista: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Residente de Obra</Form.Label>
                                <Form.Control value={configData.residente_obra || ''} onChange={e => setConfigData({ ...configData, residente_obra: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Supervisión</Form.Label>
                                <Form.Control value={configData.supervision || ''} onChange={e => setConfigData({ ...configData, supervision: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Monto Contrato</Form.Label>
                                <Form.Control
                                    type="number"
                                    value={configData.monto_contrato || ''}
                                    onChange={e => setConfigData({ ...configData, monto_contrato: e.target.value ? parseFloat(e.target.value) : undefined })}
                                />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Plazo Ejecución (Días)</Form.Label>
                                <Form.Control
                                    type="number"
                                    value={configData.plazo_ejecucion_dias || ''}
                                    onChange={e => setConfigData({ ...configData, plazo_ejecucion_dias: e.target.value ? parseInt(e.target.value) : undefined })}
                                />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Fecha Entrega Terreno</Form.Label>
                                <Form.Control type="date" value={configData.fecha_entrega_terreno || ''} onChange={e => setConfigData({ ...configData, fecha_entrega_terreno: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label className="fw-bold text-primary">Fecha Inicio Plazo (Inicio Gantt)</Form.Label>
                                <Form.Control type="date" value={configData.fecha_inicio_plazo || ''} onChange={e => setConfigData({ ...configData, fecha_inicio_plazo: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Fecha Fin Plazo</Form.Label>
                                <Form.Control type="date" value={configData.fecha_fin_plazo || ''} onChange={e => setConfigData({ ...configData, fecha_fin_plazo: e.target.value })} />
                            </div>
                        </div>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowConfigModal(false)}>Cancelar</Button>
                    <Button variant="primary" onClick={handleSaveConfig}>Guardar Cambios</Button>
                </Modal.Footer>
            </Modal>

        </div>
    );
};

export default GestionActividades;
