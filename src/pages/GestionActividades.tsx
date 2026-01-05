import React, { useEffect, useState } from 'react';
import { Button, Form, Card, Table, Modal } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Chart } from "react-google-charts";
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
// @ts-ignore
import 'moment/locale/es'; // Spanish locale for calendar

// Setup the localizer by providing the moment (or globalize, or Luxon) Object
// to the correct localizer.
moment.locale('es');
const localizer = momentLocalizer(moment);

interface Obra {
    id: string;
    nombre_obra: string;
    ubicacion?: string;
    entidad_contratante?: string;
    supervision?: string;
    supervisor?: string; // Added
    contratista?: string;
    residente_obra?: string;
    contrato_obra?: string; // Added
    monto_contrato?: number;
    plazo_ejecucion_dias?: number;
    fecha_entrega_terreno?: string;
    fecha_inicio_plazo?: string;
    fecha_fin_plazo?: string;
    type?: string;
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
    porcentaje_avance?: number; // Added 0-100
    late_start?: Date;
    late_end?: Date;
    holgura?: number;
    tipo?: 'entregable' | 'adicional'; // Added
    unidad_medida?: string;
    precio_unitario?: number;
    metrado_total_estimado?: number;
    metrado_proyectado?: number;
}

interface DependencyParsed {
    targetId: string;
    type: 'FC' | 'CC' | 'FF' | 'CF';
    lag: number;
}

interface Ampliacion {
    id: string;
    resolucion: string;
    fecha_inicio_causal: string;
    fecha_fin_causal: string;
    dias_aprobados: number;
    fecha_fin_anterior?: string;
    fecha_fin_nueva?: string;
    observaciones?: string;
}

const GestionActividades: React.FC = () => {
    const { user, role } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();


    const [obras, setObras] = useState<Obra[]>([]); // Added missing state
    const [selectedParentId, setSelectedParentId] = useState<string>(''); // Parent Selection
    const [components, setComponents] = useState<Obra[]>([]); // Sub-projects (Adicionales)
    const [selectedObraId, setSelectedObraId] = useState<string>(''); // Actual ID used
    const [selectedObra, setSelectedObra] = useState<Obra | null>(null);

    const [actividades, setActividades] = useState<Actividad[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'gantt' | 'calendar'>('list'); // View Toggle
    const [filterType, setFilterType] = useState<'todos' | 'entregable' | 'adicional'>('todos'); // Filter State

    // Form State
    const [desc, setDesc] = useState('');
    const [tipo, setTipo] = useState<'entregable' | 'adicional'>('entregable'); // Form Type
    const [duracion, setDuracion] = useState(1);
    const [avance, setAvance] = useState(0); // Progress State
    const [predsString, setPredsString] = useState(''); // Text input for dependencies

    // Obra Config State
    const [configData, setConfigData] = useState<Partial<Obra>>({});

    // Ampliaciones State
    const [showAmpliacionModal, setShowAmpliacionModal] = useState(false);
    const [ampliaciones, setAmpliaciones] = useState<Ampliacion[]>([]);
    const [newAmp, setNewAmp] = useState<Partial<Ampliacion>>({});

    // Fetch Obras on mount
    useEffect(() => {
        if (user) fetchObras();
    }, [user]);

    // Fetch Components when Parent changes
    useEffect(() => {
        if (selectedParentId) {
            fetchComponents(selectedParentId);
            fetchObraDetails(selectedParentId); // Get details of parent for config (optional?)
            // Default selectedObraId to the parent itself (Contrato Principal)
            if (!selectedObraId || selectedObraId !== selectedParentId) {
                setSelectedObraId(selectedParentId);
            }
        } else {
            setComponents([]);
            setSelectedObraId('');
            setActividades([]);
        }
    }, [selectedParentId]);

    // Fetch Actividades when Specific Component (selectedObraId) changes
    useEffect(() => {
        if (selectedObraId) {
            const found = obras.find(o => o.id === selectedObraId) || components.find(c => c.id === selectedObraId);
            if (found || selectedObraId) {
                fetchObraDetails(selectedObraId);
            }
            setSearchParams({ obra_id: selectedObraId });
        } else {
            setActividades([]);
            setSelectedObra(null);
        }
    }, [selectedObraId]); // removed obras/components dependency to avoid loops

    useEffect(() => {
        if (selectedObra) {
            fetchActividades();
            setConfigData(selectedObra);
        }
    }, [selectedObra]);

    const fetchObras = async () => {
        try {
            // Fetch ONLY Parents
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

            // Auto-select if passed in URL or only one option? 
            // Better to let user select to avoid confusion with new 2-step process
            const urlObraId = searchParams.get('obra_id');
            if (urlObraId) {
                // Determine if it's a parent or child. 
                // Creating a simplified check:
                const { data: check } = await supabase.from('obras').select('parent_id').eq('id', urlObraId).single();
                if (check) {
                    if (check.parent_id) setSelectedParentId(check.parent_id); // Valid logic would require waiting for fetchComponents
                    else setSelectedParentId(urlObraId);
                }
            }

        } catch (err) {
            console.error('Error fetching obras', err);
        }
    };

    const fetchComponents = async (parentId: string) => {
        try {
            const { data, error } = await supabase
                .from('obras')
                .select('id, nombre_obra, type')
                .eq('parent_id', parentId);

            if (error) throw error;
            setComponents(data || []);
        } catch (err) { console.error(err); }
    };

    const fetchObraDetails = async (id: string) => {
        const { data, error } = await supabase.from('obras').select('*').eq('id', id).single();
        if (!error && data) {
            setSelectedObra(data);
            fetchAmpliaciones(id);
        }
    };

    const fetchAmpliaciones = async (obraId: string) => {
        const { data } = await supabase.from('ampliaciones_plazo').select('*').eq('obra_id', obraId).order('fecha_inicio_causal', { ascending: true });
        setAmpliaciones(data || []);
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
                created_at: d.created_at,
                start_date: d.start_date ? new Date(d.start_date) : undefined,
                end_date: d.end_date ? new Date(d.end_date) : undefined,
                porcentaje_avance: d.porcentaje_avance || 0,
                tipo: d.tipo || 'entregable'
            }));

            const calculated = calculateCPM(mapped); // CPM needs ALL activities to calculate correctly
            setActividades(calculated);

            // Sync Critical Activity status to DB if changed
            const updates = calculated.filter(c => {
                const original = mapped.find(m => m.id === c.id);
                return original && original.es_critica !== c.es_critica;
            }).map(c => ({
                id: c.id,
                es_critica: c.es_critica
            }));

            if (updates.length > 0) {
                // Batch update using upsert or individual updates
                // Supabase upsert requires all unique keys or primary key. 
                // It's safer to iterate for now if not massive, or use upsert with a partial payload if supported cleanly.
                // For safety and simplicity in this context (usually < 1000 items):
                for (const u of updates) {
                    await supabase.from('actividades_obra').update({ es_critica: u.es_critica }).eq('id', u.id);
                }
                console.log(`Synced ${updates.length} critical activities to DB.`);
            }

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

    // --- CYCLE DETECTION ---
    const detectCycle = (startId: string, visited: Set<string>, recursionStack: Set<string>, allTasks: Map<string, Actividad>): boolean => {
        visited.add(startId);
        recursionStack.add(startId);

        const task = allTasks.get(startId);
        if (task && task.dependencias) {
            for (const depStr of task.dependencias) {
                const parsed = parseInternalDependency(depStr);
                if (parsed) {
                    if (!visited.has(parsed.targetId)) {
                        if (detectCycle(parsed.targetId, visited, recursionStack, allTasks)) return true;
                    } else if (recursionStack.has(parsed.targetId)) {
                        return true;
                    }
                }
            }
        }
        recursionStack.delete(startId);
        return false;
    };


    // To properly fix 'Cycle Detected', we should sanitize the data BEFORE passing to Chart.
    // However, existing function 'extractDependencyIds' is used within the map. 
    // Let's just create a "Safe List" of dependencies during render.

    const validateDependenciesSafe = (taskId: string, rawDeps: string[]) => {
        if (!rawDeps || rawDeps.length === 0) return null;
        const safeDeps: string[] = [];

        // Simple BFS/DFS to check if 'targetId' leads back to 'taskId'
        // If 'targetId' path contains 'taskId', then 'taskId' -> 'targetId' is a CYCLE.

        rawDeps.forEach(depStr => {
            const parts = depStr.split(':');
            const targetId = parts[0];

            // Check if targetId is valid
            const targetNode = actividades.find(a => a.id === targetId);
            if (!targetNode) return;

            // CHECK CYCLE: Does targetId lead back to taskId?
            // DFS
            const stack = [targetId];
            const visited = new Set<string>();
            let foundCycle = false;

            while (stack.length > 0) {
                const curr = stack.pop()!;
                if (visited.has(curr)) continue;
                visited.add(curr);

                if (curr === taskId) {
                    foundCycle = true;
                    break;
                }

                const node = actividades.find(a => a.id === curr);
                if (node && node.dependencias) {
                    node.dependencias.forEach(d => {
                        const p = d.split(':');
                        stack.push(p[0]);
                    });
                }
            }

            if (!foundCycle) {
                safeDeps.push(targetId);
            } else {
                console.warn(`Cycle detected: Ignoring dependency ${taskId} -> ${targetId}`);
            }
        });

        return safeDeps.length > 0 ? safeDeps.join(',') : null;
    };

    // --- CPM LOGIC ---
    const calculateCPM = (tasks: Actividad[]): Actividad[] => {
        const taskMap = new Map<string, Actividad>();
        tasks.forEach(t => {
            // Do NOT clear existing dates immediately, as we may want to use them as constraints
            // t.start_date = undefined; 
            // t.end_date = undefined;
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
                } else {
                    // No dependencies: Use existing start_date (imported) if valid, ELSE use projectStart
                    // We only use the imported start_date as a "Start No Earlier Than" constraint effectively
                    // But if it's explicitly imported, we treat it as the preferred start.
                    // However, we must ensure it's not BEFORE project start? 
                    // Let's trust the import.
                    if (t.start_date) {
                        const importedStart = new Date(t.start_date).getTime();
                        // Only override if we are in the first pass or if it's larger?
                        // Actually, if we imported it, we want it to stick unless a dependency pushes it.
                        // Since there are no dependencies here, we just use it.
                        calculatedStart = importedStart;
                    }
                }

                // Ensure we don't regress start date... (Standard logic)
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


        // --- BACKWARD PASS ---
        const projectEnd = tasks.reduce((max, t) => {
            return t.end_date && t.end_date.getTime() > max ? t.end_date.getTime() : max;
        }, 0);

        // Initialize Late Dates to Project End
        tasks.forEach(t => {
            t.late_end = new Date(projectEnd);
            t.late_start = new Date(projectEnd - (t.duracion * 24 * 60 * 60 * 1000));
        });

        // Iterative Backward Pass
        changed = true;
        passes = 0;
        while (changed && passes < 100) {
            changed = false;
            passes++;
            tasks.forEach(t => {
                const currentLateStart = t.late_start!.getTime();
                const currentLateEnd = t.late_end!.getTime();

                // If I am a predecessor to others, those others constrain my Late Finish.
                // It is inefficient to search for successors every time. 
                // Instead, we iterate relationships in reverse: 
                // For a dependency A -> B, B restricts A.
                // So if we iterate all tasks "u" (as B), and look at their deps "v" (as A),
                // we can update "v".

                if (t.dependencias) {
                    t.dependencias.forEach(depStr => {
                        const parsed = parseInternalDependency(depStr);
                        if (!parsed) return;

                        // t is the Successor (Target). pred is the Predecessor (Source).
                        // Relationship: pred -> t
                        // Constraint: t constrains pred.
                        const pred = taskMap.get(parsed.targetId);
                        if (!pred || !pred.late_end || !pred.late_start) return;

                        let newPredLateEnd = pred.late_end.getTime();
                        let newPredLateStart = pred.late_start.getTime();

                        const lagMs = parsed.lag * 24 * 60 * 60 * 1000;
                        const predDurationMs = pred.duracion * 24 * 60 * 60 * 1000;

                        // Calculate constrains imposed by 't' on 'pred'
                        // Original Forward:
                        // FC: t.Start >= pred.End + Lag
                        // CC: t.Start >= pred.Start + Lag
                        // FF: t.End >= pred.End + Lag
                        // CF: t.End >= pred.Start + Lag

                        // Backward (Reversed):
                        // FC: pred.End <= t.Start - Lag   => pred.LateEnd <= t.LateStart - Lag
                        // CC: pred.Start <= t.Start - Lag => pred.LateStart <= t.LateStart - Lag
                        // FF: pred.End <= t.End - Lag     => pred.LateEnd <= t.LateEnd - Lag
                        // CF: pred.Start <= t.End - Lag   => pred.LateStart <= t.LateEnd - Lag

                        switch (parsed.type) {
                            case 'FC':
                                {
                                    const limit = currentLateStart - lagMs;
                                    if (limit < newPredLateEnd) newPredLateEnd = limit;
                                }
                                break;
                            case 'CC':
                                {
                                    const limit = currentLateStart - lagMs;
                                    if (limit < newPredLateStart) {
                                        newPredLateStart = limit;
                                        // Force LateEnd consistency
                                        newPredLateEnd = newPredLateStart + predDurationMs;
                                    }
                                }
                                break;
                            case 'FF':
                                {
                                    const limit = currentLateEnd - lagMs;
                                    if (limit < newPredLateEnd) newPredLateEnd = limit;
                                }
                                break;
                            case 'CF':
                                {
                                    const limit = currentLateEnd - lagMs;
                                    if (limit < newPredLateStart) {
                                        newPredLateStart = limit;
                                        newPredLateEnd = newPredLateStart + predDurationMs;
                                    }
                                }
                                break;
                        }

                        // Consistency Check for Pred
                        // Always maintain LateStart = LateEnd - Duration
                        // If we updated LateEnd, update LateStart
                        // If we updated LateStart directly (CC/CF), ensure LateEnd matches? 
                        // Actually better to just track LateEnd as the primary constraints, but CC/CF constrain Start.
                        // Simplest: Always ensure pred.LateStart = pred.LateEnd - Duration.
                        // So if we lowered LateEnd, calculate new LateStart.
                        // If we lowered LateStart, calculate new LateEnd.

                        // Re-normalize to the tightest constraint
                        const impliedLateStart = newPredLateEnd - predDurationMs;
                        // Use the minimum of (explicit LateStart limit) and (implied LateStart from LateEnd)
                        if (impliedLateStart < newPredLateStart) {
                            newPredLateStart = impliedLateStart;
                        } else {
                            // If calculated Date is tighter, sync End
                            newPredLateEnd = newPredLateStart + predDurationMs;
                        }

                        if (pred.late_end.getTime() !== newPredLateEnd) {
                            pred.late_end = new Date(newPredLateEnd);
                            pred.late_start = new Date(newPredLateStart);
                            changed = true;
                        }
                    });
                }
            });
        }

        // Calculate Attributes
        tasks.forEach(t => {
            if (t.start_date && t.late_start) {
                // Slack = LateStart - Start
                const slackMs = t.late_start.getTime() - t.start_date.getTime();
                const slackDays = Math.round(slackMs / (24 * 60 * 60 * 1000));

                t.holgura = slackDays;
                t.es_critica = slackDays <= 0; // Float <= 0 means critical
            }
        });

        return tasks;
    }

    const handleDownloadTemplate = () => {
        const ws = XLSX.utils.json_to_sheet([
            {
                "Nombre de tarea": "Excavación Zanjas",
                "Duración": "5 días",
                "Comienzo": "Lun 01/01/24",
                "Fin": "Vie 05/01/24",
                "Unidad": "m3",
                "Precio Unitario": 50.00,
                "Metrado Total": 100,
                "Tipo": "Entregable",
                "Predecesoras": "",
                "Notas": "Dejar vacío si no tiene dependencias"
            },
            {
                "Nombre de tarea": "Cimientos",
                "Duración": "3 días",
                "Comienzo": "Lun 08/01/24",
                "Fin": "Mié 10/01/24",
                "Predecesoras": "1FC+2",
                "Notas": "Depende de Fila 1 (Fin-Comienzo + 2 días)"
            },
            {
                "Nombre de tarea": "Muros",
                "Duración": "4 días",
                "Comienzo": "Jue 11/01/24",
                "Fin": "Dom 14/01/24",
                "Predecesoras": "2CC",
                "Notas": "Comienza junto con la Fila 2"
            }
        ]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
        XLSX.writeFile(wb, "plantilla_actividades_project.xlsx");
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

            // Helper to parse dates
            const parseDate = (val: any) => {
                if (!val) return null;
                try {
                    if (val instanceof Date) return val.toISOString();
                    if (typeof val === 'number') {
                        // Excel serial
                        const d = new Date(Math.round((val - 25569) * 86400 * 1000));
                        return d.toISOString();
                    }
                    if (typeof val === 'string') {
                        // Clean typical Spanish prefixes "mar ", "sáb ", etc.
                        const clean = val.replace(/^[a-zñáéíóú]{3}\s+/i, '').trim();
                        // If DD/MM/YY
                        const parts = clean.split('/');
                        if (parts.length === 3) {
                            let year = parseInt(parts[2]);
                            if (year < 100) year += 2000; // Assume 20xx
                            const month = parseInt(parts[1]) - 1;
                            const day = parseInt(parts[0]);
                            return new Date(year, month, day).toISOString();
                        }
                        // Fallback to standard parse
                        const d = new Date(clean);
                        if (!isNaN(d.getTime())) return d.toISOString();
                    }
                } catch (e) { return null; }
                return null;
            };

            const payload = jsonData.map((row, index) => {
                // Map Columns: Support user's format (MS Project Spanish) and standard keys
                const name = row['Nombre de tarea'] || row['nombre_partida'] || row['Nombre Partida'] || 'Sin Nombre';

                // Parse Duration: "754 días" -> 754
                let rawDur = row['Duración'] || row['Duracion'] || row['duracion'] || 1;
                if (typeof rawDur === 'string') {
                    rawDur = rawDur.toLowerCase().replace('días', '').replace('dias', '').replace('days', '').trim();
                    rawDur = parseInt(rawDur) || 1;
                }

                // Parse New Fields
                const unidad = row['Unidad'] || row['unidad_medida'] || row['Unidad Medida'] || null;
                const precio = parseFloat(row['Precio Unitario'] || row['Precio'] || row['precio_unitario']) || 0;
                const metrado = parseFloat(row['Metrado Total'] || row['Metrado'] || row['metrado_total_estimado']) || 0;

                /*
                let tipoParsed: 'entregable' | 'adicional' = 'entregable';
                const rawTipo = row['Tipo'] || row['tipo'];
                if (rawTipo && rawTipo.toString().toLowerCase().includes('adicional')) {
                    tipoParsed = 'adicional';
                }
                */

                return {
                    obra_id: selectedObraId,
                    nombre_partida: name,
                    duracion: Number(rawDur) || 1,
                    dependencias: [],
                    start_date: parseDate(row['Comienzo'] || row['Start']),
                    end_date: parseDate(row['Fin'] || row['Finish']),
                    created_at: new Date(baseTime + (index * 10)).toISOString(), // Force strict chronological order
                    porcentaje_avance: 0,
                    unidad_medida: unidad,
                    precio_unitario: precio,
                    metrado_total_estimado: metrado,
                    metrado_proyectado: 0, // Default
                    // tipo: tipoParsed // TODO: Uncomment when 'tipo' column is added to DB
                };
            });

            if (payload.length > 0) {
                // Bulk Insert
                const { data: insertedData, error } = await supabase
                    .from('actividades_obra')
                    .insert(payload)
                    .select()
                    .order('created_at', { ascending: true });

                if (error) throw error;
                if (!insertedData) throw new Error("No se devolvieron datos insertados");

                // 2. Resolve dependencies
                const updates = [];

                for (let i = 0; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    // Map Dependency Column
                    const rawDeps = row['Predecesoras'] || row['dependencias'] || row['Dependencias'];

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
                dependencias: finalHashDeps,
                porcentaje_avance: avance,
                // tipo: tipo // TODO: Uncomment when 'tipo' column is added to DB
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
        if (!selectedObraId || !configData) {
            console.error("Missing selectedObraId or configData", { selectedObraId, configData });
            return;
        }
        try {
            console.log("Attempting to save config for obra:", selectedObraId);

            // Explicitly map only the fields that are editable and exist in the table schema
            // to avoid sending readonly fields (like created_at) or extra data.
            const updatePayload: any = {
                nombre_obra: configData.nombre_obra, // Added
                ubicacion: configData.ubicacion,
                entidad_contratante: configData.entidad_contratante,
                contratista: configData.contratista,
                residente_obra: configData.residente_obra,
                supervision: configData.supervision,
                supervisor: configData.supervisor, // Added
                contrato_obra: configData.contrato_obra, // Added
                monto_contrato: configData.monto_contrato,
                plazo_ejecucion_dias: configData.plazo_ejecucion_dias,
                fecha_entrega_terreno: configData.fecha_entrega_terreno,
                fecha_inicio_plazo: configData.fecha_inicio_plazo,
                fecha_fin_plazo: configData.fecha_fin_plazo
            };

            // Sanitize numeric fields
            if (updatePayload.monto_contrato && isNaN(updatePayload.monto_contrato)) updatePayload.monto_contrato = null;
            if (updatePayload.plazo_ejecucion_dias && isNaN(updatePayload.plazo_ejecucion_dias)) updatePayload.plazo_ejecucion_dias = null;

            // Remove keys with undefined values
            Object.keys(updatePayload).forEach(key => {
                if (updatePayload[key] === undefined) {
                    delete updatePayload[key];
                }
            });

            console.log("Update Payload:", updatePayload);

            const { data, error, status, statusText } = await supabase
                .from('obras')
                .update(updatePayload)
                .eq('id', selectedObraId)
                .select(); // Add select() to return the updated record

            console.log("Supabase Response:", { data, error, status, statusText });

            if (error) throw error;

            if (data && data.length === 0) {
                console.warn("Update succeeded but no rows were returned. RLS might be blocking the read or update.");
                alert("Advertencia: No se pudo verificar la actualización. Verifique permisos.");
            } else {
                alert('Datos de obra actualizados correctamente');
            }

            setShowConfigModal(false);
            fetchObraDetails(selectedObraId);
        } catch (err: any) {
            console.error("Error in handleSaveConfig:", err);
            alert('Error al actualizar obra: ' + (err.message || err.toString()));
        }
    };

    const handleSaveAmpliacion = async () => {
        if (!selectedObraId || !newAmp.fecha_inicio_causal || !newAmp.fecha_fin_causal) return;
        if (!selectedObra) return;

        try {
            const start = new Date(newAmp.fecha_inicio_causal);
            const end = new Date(newAmp.fecha_fin_causal);
            const diffTime = Math.abs(end.getTime() - start.getTime());
            const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Days Difference

            if (days <= 0) { alert('Fecha fin debe ser mayor a inicio'); return; }

            // Calculate new end date
            // User Request: "la fecha de termino es la fecha del fin del causal"
            // We set the new project end date directly to the end of the causal event.
            // Parse 'YYYY-MM-DD' securely to local/UTC midnight
            const [y, m, d] = newAmp.fecha_fin_causal.split('-').map(Number);
            const newEndDate = new Date(y, m - 1, d);

            const payload = {
                obra_id: selectedObraId,
                resolucion: newAmp.resolucion,
                fecha_inicio_causal: newAmp.fecha_inicio_causal,
                fecha_fin_causal: newAmp.fecha_fin_causal,
                dias_aprobados: days,
                fecha_fin_anterior: selectedObra.fecha_fin_plazo,
                fecha_fin_nueva: newEndDate.toISOString().split('T')[0],
                observaciones: newAmp.observaciones
            };

            // 1. Insert Ampliacion
            const { error } = await supabase.from('ampliaciones_plazo').insert(payload);
            if (error) throw error;

            // 2. Update Obra
            const newDuration = (selectedObra.plazo_ejecucion_dias || 0) + days;
            await supabase.from('obras').update({
                fecha_fin_plazo: payload.fecha_fin_nueva,
                plazo_ejecucion_dias: newDuration
            }).eq('id', selectedObraId);

            alert('Ampliación registrada y fecha de fin actualizada.');
            setNewAmp({});
            fetchObraDetails(selectedObraId);
            fetchAmpliaciones(selectedObraId);

        } catch (err: any) {
            alert('Error: ' + err.message);
        }
    };

    return (
        <div className="container py-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h3>Gestión de Actividades y Gantt</h3>
                <Link to="/reporte-avance" className="btn btn-outline-secondary">Volver</Link>
            </div>

            <Card className="mb-4 shadow-sm bg-light">
                <Card.Body className="d-flex align-items-center gap-3 p-3 flex-wrap">
                    <Form.Group className="mb-0">
                        <Form.Label className="fw-bold mb-0 text-nowrap d-block small">Seleccionar Obra:</Form.Label>
                        <Form.Select
                            value={selectedParentId}
                            onChange={(e) => setSelectedParentId(e.target.value)}
                            style={{ minWidth: '300px', maxWidth: '400px' }}
                        >
                            <option value="">-- Seleccione una obra --</option>
                            {obras.map(o => (
                                <option key={o.id} value={o.id}>{o.nombre_obra}</option>
                            ))}
                        </Form.Select>
                    </Form.Group>

                    {selectedParentId && (
                        <Form.Group className="mb-0">
                            <Form.Label className="fw-bold mb-0 text-nowrap d-block small">Componente / Adicional:</Form.Label>
                            <Form.Select
                                value={selectedObraId}
                                onChange={(e) => setSelectedObraId(e.target.value)}
                                style={{ minWidth: '300px', maxWidth: '400px' }}
                            >
                                <option value={selectedParentId}>Contrato Principal</option>
                                {components.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.type === 'adicional' ? 'Adicional: ' : ''}{c.nombre_obra}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>
                    )}

                    {selectedObraId && (
                        <div className="d-flex gap-2 ms-auto">
                            <Button variant="outline-dark" onClick={() => setShowConfigModal(true)}>
                                <i className="bi bi-gear-fill me-2"></i>Configurar Obra
                            </Button>
                            <Button variant="outline-primary" onClick={() => setShowAmpliacionModal(true)}>
                                <i className="bi bi-calendar-plus me-2"></i>Ampliaciones
                            </Button>
                        </div>
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
                                    setDesc('');
                                    setTipo('entregable');
                                    setDuracion(1);
                                    setAvance(0);
                                    setPredsString('');
                                    setShowModal(true);
                                }}>Nueva Actividad</Button>
                            </div>
                        </Card.Header>
                        <Card.Body>
                            <div className="d-flex justify-content-center mb-3">
                                <div className="btn-group" role="group">
                                    <input type="radio" className="btn-check" name="viewmode" id="v_list" autoComplete="off" checked={viewMode === 'list'} onChange={() => setViewMode('list')} />
                                    <label className="btn btn-outline-primary" htmlFor="v_list"><i className="bi bi-list-task me-1"></i>Lista</label>

                                    <input type="radio" className="btn-check" name="viewmode" id="v_gantt" autoComplete="off" checked={viewMode === 'gantt'} onChange={() => setViewMode('gantt')} />
                                    <label className="btn btn-outline-primary" htmlFor="v_gantt"><i className="bi bi-bar-chart-steps me-1"></i>Gantt</label>

                                    <input type="radio" className="btn-check" name="viewmode" id="v_calendar" autoComplete="off" checked={viewMode === 'calendar'} onChange={() => setViewMode('calendar')} />
                                    <label className="btn btn-outline-primary" htmlFor="v_calendar"><i className="bi bi-calendar3 me-1"></i>Calendario</label>
                                </div>
                                <div className="ms-3 d-flex align-items-center">
                                    <span className="me-2 fw-bold small">Filtrar:</span>
                                    <Form.Select size="sm" style={{ width: '150px' }} value={filterType} onChange={e => setFilterType(e.target.value as any)}>
                                        <option value="todos">Todos</option>
                                        <option value="entregable">Entregables</option>
                                        <option value="adicional">Adicionales</option>
                                    </Form.Select>
                                </div>
                            </div>

                            {viewMode === 'list' && (
                                <Table striped hover responsive>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '50px' }}>#</th>
                                            <th>Descripción</th>
                                            <th>Duración (días)</th>
                                            <th>% Avance</th>
                                            <th>Predecesoras</th>
                                            <th>Inicio (Est.)</th>
                                            <th>Fin (Est.)</th>
                                            <th>Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {actividades
                                            .filter(a => filterType === 'todos' || a.tipo === filterType)
                                            .map((a, index) => (
                                                <tr key={a.id} className={a.es_critica ? 'table-danger' : ''}>
                                                    <td className="fw-bold">{index + 1}</td>
                                                    <td>
                                                        {a.nombre_partida}
                                                        {a.es_critica && <span className="badge bg-danger ms-1">Crítica</span>}
                                                        {a.tipo === 'adicional' && <span className="badge bg-warning text-dark ms-1">Adicional</span>}
                                                    </td>
                                                    <td>{a.duracion}</td>
                                                    <td>
                                                        <div className="d-flex align-items-center">
                                                            <div className="progress flex-grow-1" style={{ height: '10px' }}>
                                                                <div className="progress-bar" role="progressbar" style={{ width: `${a.porcentaje_avance}%` }} aria-valuenow={a.porcentaje_avance} aria-valuemin={0} aria-valuemax={100}></div>
                                                            </div>
                                                            <span className="ms-2 small">{a.porcentaje_avance}%</span>
                                                        </div>
                                                    </td>
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
                                                            setAvance(a.porcentaje_avance || 0);
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
                            )}

                            {viewMode === 'gantt' && (
                                <div className="mt-3">
                                    {actividades.length > 0 ? (
                                        <Chart
                                            chartType="Gantt"
                                            width="100%"
                                            height="600px" // Taller
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
                                                ...actividades
                                                    .filter(a => filterType === 'todos' || a.tipo === filterType)
                                                    .map(t => [
                                                        t.id,
                                                        `[${getRowNumber(t.id)}] ${t.nombre_partida} (${t.porcentaje_avance || 0}%)`,
                                                        t.es_critica ? "critical" : null,
                                                        t.start_date,
                                                        t.end_date,
                                                        null,
                                                        t.porcentaje_avance || 0,
                                                        validateDependenciesSafe(t.id, t.dependencias)
                                                    ])
                                            ]}
                                            options={{
                                                height: 600,
                                                gantt: {
                                                    trackHeight: 30,
                                                    criticalPathEnabled: true, // Enable Critical Path Visuals
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
                                </div>
                            )}

                            {viewMode === 'calendar' && (
                                <div style={{ height: '600px' }} className="mt-3">
                                    <Calendar
                                        localizer={localizer}
                                        events={actividades
                                            .filter(a => filterType === 'todos' || a.tipo === filterType)
                                            .map(a => ({
                                                id: a.id,
                                                title: `[${a.porcentaje_avance}%] ${a.nombre_partida}`,
                                                start: a.start_date || new Date(),
                                                end: a.end_date || new Date(),
                                                allDay: true,
                                                resource: a
                                            }))}
                                        startAccessor="start"
                                        endAccessor="end"
                                        style={{ height: '100%' }}
                                        views={['month', 'week', 'agenda']}
                                        messages={{
                                            next: "Siguiente",
                                            previous: "Anterior",
                                            today: "Hoy",
                                            month: "Mes",
                                            week: "Semana",
                                            day: "Día",
                                            agenda: "Agenda",
                                            date: "Fecha",
                                            time: "Hora",
                                            event: "Evento"
                                        }}
                                        eventPropGetter={(event) => {
                                            const isCritical = (event.resource as Actividad).es_critica;
                                            return {
                                                style: {
                                                    backgroundColor: isCritical ? '#dc3545' : '#0d6efd',
                                                    borderRadius: '4px',
                                                    fontSize: '0.85em'
                                                }
                                            };
                                        }}
                                        onSelectEvent={(event) => {
                                            const a = event.resource as Actividad;
                                            setEditingId(a.id);
                                            setDesc(a.nombre_partida);
                                            setTipo(a.tipo || 'entregable');
                                            setDuracion(a.duracion);
                                            setAvance(a.porcentaje_avance || 0);
                                            setPredsString(formatDependencies(a.dependencias));
                                            setShowModal(true);
                                        }}
                                    />
                                </div>
                            )}

                        </Card.Body>
                    </Card>

                    {/* Eliminated the separate Gantt Card, it's now integrated in the viewMode */}


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
                                    <Form.Label>Tipo de Actividad</Form.Label>
                                    <Form.Select value={tipo} onChange={e => setTipo(e.target.value as any)}>
                                        <option value="entregable">Entregable (Contractual)</option>
                                        <option value="adicional">Adicional</option>
                                    </Form.Select>
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label>Duración (Días)</Form.Label>
                                    <Form.Control type="number" min="1" value={duracion} onChange={e => setDuracion(parseInt(e.target.value))} />
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label>Porcentaje Avance: {avance}%</Form.Label>
                                    <Form.Range
                                        min={0} max={100}
                                        value={avance}
                                        onChange={e => setAvance(parseInt(e.target.value))}
                                    />
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
                            <div className="col-12 mb-3">
                                <Form.Label>Nombre de la Obra</Form.Label>
                                <Form.Control value={configData.nombre_obra || ''} onChange={e => setConfigData({ ...configData, nombre_obra: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Ubicación</Form.Label>
                                <Form.Control value={configData.ubicacion || ''} onChange={e => setConfigData({ ...configData, ubicacion: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Entidad Contratante</Form.Label>
                                <Form.Control value={configData.entidad_contratante || ''} onChange={e => setConfigData({ ...configData, entidad_contratante: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Contrato de Obra (N°)</Form.Label>
                                <Form.Control value={configData.contrato_obra || ''} onChange={e => setConfigData({ ...configData, contrato_obra: e.target.value })} />
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
                                <Form.Label>Supervisión (Empresa)</Form.Label>
                                <Form.Control value={configData.supervision || ''} onChange={e => setConfigData({ ...configData, supervision: e.target.value })} />
                            </div>
                            <div className="col-md-6 mb-3">
                                <Form.Label>Supervisor (Persona)</Form.Label>
                                <Form.Control value={configData.supervisor || ''} onChange={e => setConfigData({ ...configData, supervisor: e.target.value })} />
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

            {/* Modal Ampliaciones */}
            <Modal show={showAmpliacionModal} onHide={() => setShowAmpliacionModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>Registro de Ampliaciones de Plazo</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className="alert alert-info small mb-3">
                        <i className="bi bi-info-circle me-2"></i>
                        Al registrar una ampliación, la fecha de fin de obra y el plazo se actualizarán automáticamente.
                        <br />
                        <strong>Fecha Fin Actual:</strong> {selectedObra?.fecha_fin_plazo || '-'}
                    </div>

                    <div className="row g-3 mb-4 border p-3 rounded bg-light">
                        <div className="col-md-3">
                            <Form.Label>Resolución / Doc</Form.Label>
                            <Form.Control
                                size="sm"
                                value={newAmp.resolucion || ''}
                                onChange={e => setNewAmp({ ...newAmp, resolucion: e.target.value })}
                            />
                        </div>
                        <div className="col-md-3">
                            <Form.Label>Inicio Causal</Form.Label>
                            <Form.Control
                                type="date" size="sm"
                                value={newAmp.fecha_inicio_causal || ''}
                                onChange={e => setNewAmp({ ...newAmp, fecha_inicio_causal: e.target.value })}
                            />
                        </div>
                        <div className="col-md-3">
                            <Form.Label>Fin Causal</Form.Label>
                            <Form.Control
                                type="date" size="sm"
                                value={newAmp.fecha_fin_causal || ''}
                                onChange={e => setNewAmp({ ...newAmp, fecha_fin_causal: e.target.value })}
                            />
                        </div>
                        <div className="col-md-3 d-flex align-items-end">
                            <Button size="sm" variant="success" className="w-100" onClick={handleSaveAmpliacion}>
                                + Registrar
                            </Button>
                        </div>
                        <div className="col-12 mt-2">
                            {(newAmp.fecha_inicio_causal && newAmp.fecha_fin_causal) && (
                                <div className="text-success small fw-bold">
                                    Días Calculados: {
                                        Math.ceil(Math.abs(new Date(newAmp.fecha_fin_causal).getTime() - new Date(newAmp.fecha_inicio_causal).getTime()) / (1000 * 60 * 60 * 24))
                                    } días
                                </div>
                            )}
                        </div>
                    </div>

                    <h6 className="fw-bold">Historial de Ampliaciones</h6>
                    <Table striped hover size="sm" responsive className="small">
                        <thead className="table-dark">
                            <tr>
                                <th>Resolución</th>
                                <th>Inicio Causal</th>
                                <th>Fin Causal</th>
                                <th>Días</th>
                                <th>Nueva Fecha Fin Obra</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ampliaciones.length === 0 ? (
                                <tr><td colSpan={5} className="text-center">No hay ampliaciones registradas</td></tr>
                            ) : (
                                ampliaciones.map(amp => (
                                    <tr key={amp.id}>
                                        <td>{amp.resolucion}</td>
                                        <td>{amp.fecha_inicio_causal}</td>
                                        <td>{amp.fecha_fin_causal}</td>
                                        <td className="fw-bold text-primary">{amp.dias_aprobados}</td>
                                        <td className="fw-bold text-success">{amp.fecha_fin_nueva}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </Table>
                </Modal.Body>
            </Modal>

        </div>
    );
};

export default GestionActividades;
