import React, { useEffect, useState } from 'react';
import { Button, Table, Modal, Form, Badge, Spinner, Tabs, Tab, Alert } from 'react-bootstrap';
import { supabase } from '../config/supabaseClient';
import { useAuth } from '../context/AuthContext';
import type { Obra, Actividad, AvanceDiario } from '../types';
import moment from 'moment';
import 'moment/locale/es';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

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

    const [showTelegramModal, setShowTelegramModal] = useState(false);
    const [botToken, setBotToken] = useState('');
    const [chatId, setChatId] = useState('');
    // WhatsApp State
    const [wppRecipients, setWppRecipients] = useState<any[]>([]); // {id, name, phone, apiKey}
    const [newRecipient, setNewRecipient] = useState({ name: '', phone: '', apiKey: '' });
    const [sendingReport, setSendingReport] = useState(false);

    // Import Modal State
    const [showImportModal, setShowImportModal] = useState(false);
    const [importDate, setImportDate] = useState(moment().format('YYYY-MM-DD'));
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);

    // Report Date State
    const [reportDate, setReportDate] = useState(moment().format('YYYY-MM-DD'));


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
            .select('id, nombre_partida, unidad_medida, precio_unitario, metrado_total_estimado, metrado_proyectado, tipo, created_at, duracion, dependencias, es_critica')
            .eq('obra_id', selectedObraId)
            .order('created_at', { ascending: true });
        if (!error && data) setActividades(data);
    };

    const fetchAvances = async () => {
        if (selectedObraId) {
            const { data: acts } = await supabase.from('actividades_obra').select('id').eq('obra_id', selectedObraId);
            if (acts && acts.length > 0) {
                const ids = acts.map(a => a.id);
                const { data: avs } = await supabase.from('avance_diario')
                    .select('id, actividad_id, fecha, cantidad, observaciones, created_at')
                    .in('actividad_id', ids);
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

    // --- Telegram/WhatsApp Logic ---
    const handleTelegramClick = async () => {
        const { getTelegramConfig } = await import('../services/telegramService');
        const { fetchWhatsAppRecipients } = await import('../services/whatsappService');

        const { token, chatId: cid } = getTelegramConfig();
        setBotToken(token || '');
        setChatId(cid || '');

        const recipients = await fetchWhatsAppRecipients(selectedParentId);
        setWppRecipients(recipients || []);

        setReportDate(moment().format('YYYY-MM-DD')); // Default to today/current system date when opening
        setShowTelegramModal(true);
    };

    const saveSettings = async () => {
        const { saveTelegramConfig } = await import('../services/telegramService');
        // WhatsApp is now saved per action (add/remove), not on "Save" button globally for the list.
        // But we still save Telegram config here.

        saveTelegramConfig(botToken, chatId);

        alert('Configuración de Telegram guardada.');
    };

    const addRecipient = async () => {
        if (!newRecipient.name || !newRecipient.phone || !newRecipient.apiKey) {
            alert('Por favor completa todos los campos del destinatario.');
            return;
        }

        if (!selectedParentId) {
            alert('Error: No se ha seleccionado una Obra Principal. Por favor selecciona una obra antes de agregar destinatarios.');
            return;
        }

        try {
            const { addWhatsAppRecipient } = await import('../services/whatsappService');
            // Assuming selectedParentId is the Obra ID we want to link. 
            // If selectedParentId is null, we might need to handle it or use a default.
            // For now, let's link to the current Parent Obra context.
            const saved = await addWhatsAppRecipient({
                ...newRecipient,
                obra_id: selectedParentId
            });

            setWppRecipients([...wppRecipients, saved]);
            setNewRecipient({ name: '', phone: '', apiKey: '' });
        } catch (error: any) {
            alert('Error guardando destinatario: ' + error.message);
        }
    };

    const removeRecipient = async (id: string) => {
        if (!confirm('¿Seguro de eliminar este destinatario?')) return;
        try {
            const { deleteWhatsAppRecipient } = await import('../services/whatsappService');
            await deleteWhatsAppRecipient(id);
            setWppRecipients(wppRecipients.filter(r => r.id !== id));
        } catch (error: any) {
            alert('Error eliminando: ' + error.message);
        }
    };

    const sendDailyReport = async () => {
        setSendingReport(true);
        try {
            const { sendTelegramMessage } = await import('../services/telegramService');
            const { sendWhatsAppMessage } = await import('../services/whatsappService');

            // 1. Calculate Progress Money for SELECTED Report Date
            const reportDateStr = reportDate; // User selected date
            const currentPeriod = moment(reportDateStr).format('YYYY-MM');

            // Fetch today's advances for this Obra
            const { data: acts } = await supabase.from('actividades_obra').select('id, precio_unitario, metrado_total_estimado').eq('obra_id', selectedObraId);

            let totalMoneyToday = 0;
            let totalProjectBudget = 0;
            let totalMonthlyGoal = 0;
            let totalMoneyAccumulated = 0;

            if (acts) {
                const ids = acts.map(a => a.id);

                // Calculate Total Budget
                totalProjectBudget = acts.reduce((acc, a) => acc + ((a.metrado_total_estimado || 0) * (a.precio_unitario || 0)), 0);

                // Fetch Advance for the Report Date (today/specific)
                const { data: todays } = await supabase.from('avance_diario')
                    .select('actividad_id, cantidad')
                    .in('actividad_id', ids)
                    .eq('fecha', reportDateStr);

                // Fetch Accumulated Advance (Up to Report Date)
                const { data: accumulated } = await supabase.from('avance_diario')
                    .select('actividad_id, cantidad')
                    .in('actividad_id', ids)
                    .lte('fecha', reportDateStr);

                // Debug Log
                console.log(`Report Date: ${reportDateStr}`, todays);

                // Calculate Daily Money (Avance Hoy)
                const activeIds = new Set<string>();
                if (todays) {
                    todays.forEach(t => {
                        const act = acts.find(a => a.id === t.actividad_id);
                        if (act) {
                            activeIds.add(t.actividad_id);
                            totalMoneyToday += (t.cantidad * (act.precio_unitario || 0));
                        }
                    });
                }

                // Calculate Accumulated Money (Avance Acumulado)

                if (accumulated) {
                    accumulated.forEach(acc => {
                        const act = acts.find(a => a.id === acc.actividad_id);
                        if (act) {
                            totalMoneyAccumulated += (acc.cantidad * (act.precio_unitario || 0));
                        }
                    });
                }

                // Fetch Monthly Projections for context
                const { data: projs } = await supabase.from('proyecciones_mensuales')
                    .select('actividad_id, metrado_proyectado')
                    .in('actividad_id', ids)
                    .eq('periodo', currentPeriod);

                if (projs) {
                    projs.forEach(p => {
                        // Only sum projection if activity was active today
                        if (activeIds.has(p.actividad_id)) {
                            const act = acts.find(a => a.id === p.actividad_id);
                            if (act) {
                                totalMonthlyGoal += (p.metrado_proyectado * (act.precio_unitario || 0));
                            }
                        }
                    });
                }
            }

            // 2. Fetch Incidents Today
            const { data: incidents, count: incidentCount } = await supabase
                .from('incidencias')
                .select('descripcion, prioridad', { count: 'exact' })
                .eq('obra_id', selectedObraId)
                .gte('fecha_reporte', reportDateStr + 'T00:00:00')
                .lte('fecha_reporte', reportDateStr + 'T23:59:59');

            let incidentText = "";
            if (incidents && incidents.length > 0) {
                // Format: • [ALTA] Description
                incidentText = "\n" + incidents.map(i => `   • [${i.prioridad?.toUpperCase()}] ${i.descripcion}`).join("\n");
            }

            // 3. Calculate Percentages
            // % of Total Project (Includes Accumulated)
            const pctTotal = totalProjectBudget > 0 ? ((totalMoneyAccumulated / totalProjectBudget) * 100) : 0;
            const pctTotalStr = pctTotal.toFixed(2);

            // % of Monthly Goal
            const pctMonthly = totalMonthlyGoal > 0 ? ((totalMoneyToday / totalMonthlyGoal) * 100).toFixed(2) : 'N/A';

            // Message for Telegram (Markdown)
            const msgTelegram = `📊 *REPORTE DIARIO - ${reportDateStr}*\n\n` +
                `*Obra:* ${obras.find(o => o.id === selectedParentId)?.nombre_obra || 'N/A'}\n` +
                `*Componente:* ${components.find(c => c.id === selectedObraId)?.nombre_obra || 'Principal'}\n\n` +
                `✅ *Avance Hoy:* S/ ${totalMoneyToday.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
                `📈 *% Avance Diario:* ${pctMonthly}%\n` +
                `🏗️ *% Avance de Obra:* ${pctTotalStr}%\n` +
                `⚠️ *Incidentes:* ${incidentCount || 0}${incidentText}`;

            // Message for WhatsApp
            const msgWhatsApp = `📊 *REPORTE DIARIO - ${reportDateStr}*\n\n` +
                `*Obra:* ${obras.find(o => o.id === selectedParentId)?.nombre_obra || 'N/A'}\n` +
                `*Componente:* ${components.find(c => c.id === selectedObraId)?.nombre_obra || 'Principal'}\n\n` +
                `✅ *Avance Hoy:* S/ ${totalMoneyToday.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
                `📈 *% Avance Diario:* ${pctMonthly}%\n` +
                `🏗️ *% Avance de Obra:* ${pctTotalStr}%\n` +
                `⚠️ *Incidentes:* ${incidentCount || 0}${incidentText}`;


            let sentCount = 0;

            // Send Telegram
            if (botToken && chatId) {
                const res = await sendTelegramMessage(botToken, chatId, msgTelegram);
                if (res.success) {
                    sentCount++;
                } else {
                    console.error('Telegram Error:', res);
                    alert(`Error enviando a Telegram. Verifica tu Token y Chat ID.\nDetalle: ${JSON.stringify(res.error || res.data)}`);
                }
            }

            // Send WhatsApp (Multiple)
            let wppSuccess = 0;
            let wppFail = 0;

            if (wppRecipients.length > 0) {
                // We run them in sequence or parallel? Sequence is safer for rate limits although TextMeBot is chill.
                for (const recipient of wppRecipients) {
                    try {
                        const res = await sendWhatsAppMessage(recipient.phone, recipient.apiKey, msgWhatsApp);
                        if (res.success) wppSuccess++;
                        else {
                            console.error(`Error sending to ${recipient.name}:`, res);
                            wppFail++;
                        }
                    } catch (e) {
                        console.error(`Error sending to ${recipient.name}:`, e);
                        wppFail++;
                    }
                }
                sentCount += wppSuccess;
            }

            let alertMsg = 'Reporte enviado.';
            if (sentCount > 0) {
                alertMsg = `Reporte enviado con éxito.\nTelegram: ${botToken && chatId ? 'OK' : 'No config'}\nWhatsApp: ${wppSuccess} enviados, ${wppFail} fallidos.`;
            } else {
                alertMsg = `No se envió nada.\nWhatsApp: ${wppSuccess} enviados, ${wppFail} fallidos.`;
            }

            alert(alertMsg);

            setShowTelegramModal(false);

        } catch (error: any) {
            alert('Error al enviar reporte: ' + error.message);
        } finally {
            setSendingReport(false);
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

    // --- Excel Import/Export Logic ---
    const handleDownloadTemplate = () => {
        if (!selectedObraId || actividades.length === 0) {
            alert('No hay actividades para generar plantilla.');
            return;
        }

        const data = actividades.map(act => ({
            "ID_SISTEMA": act.id, // Hidden ID for mapping
            "Partida": act.nombre_partida,
            "Unidad": act.unidad_medida || '',
            "Metrado Total": act.metrado_total_estimado || 0,
            "Avance Diario (Ingresar Cantidad)": '' // Empty for user input
        }));

        const ws = XLSX.utils.json_to_sheet(data);

        // Adjust column widths
        const wscols = [
            { wch: 40 }, // ID (can be hidden visually in Excel manually, but here we just leave it first or move it)
            { wch: 60 }, // Partida
            { wch: 10 }, // Unidad
            { wch: 15 }, // Metrado Total
            { wch: 20 }  // Avance Diario
        ];
        ws['!cols'] = wscols;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "AvanceDiario");
        XLSX.writeFile(wb, `Plantilla_Avance_${moment().format('YYYY-MM-DD')}.xlsx`);
    };

    const handleImportProgress = async () => {
        if (!importFile) {
            alert('Selecciona un archivo Excel.');
            return;
        }
        if (!importDate) {
            alert('Selecciona una fecha para el reporte.');
            return;
        }

        setImporting(true);
        try {
            const data = await importFile.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

            const updates: any[] = [];

            jsonData.forEach(row => {
                const actId = row["ID_SISTEMA"];
                const qty = row["Avance Diario (Ingresar Cantidad)"];

                // Validate if we have an ID and a valid number for quantity
                if (actId && qty !== undefined && qty !== '' && !isNaN(Number(qty))) {
                    const val = Number(qty);
                    // Only import if there is a value (0 or more). 
                    // Negative numbers technically allowed for corrections, but let's assume valid input.
                    updates.push({
                        actividad_id: actId,
                        fecha: importDate,
                        cantidad: val,
                        observaciones: 'Importación Masiva Excel'
                    });
                }
            });

            if (updates.length > 0) {
                const { error } = await supabase.from('avance_diario').insert(updates);
                if (error) throw error;
                alert(`${updates.length} registros importados correctamente.`);
                setShowImportModal(false);
                setImportFile(null);
                fetchAvances(); // Refresh data
            } else {
                alert('No se encontraron registros válidos para importar en el archivo.');
            }

        } catch (error: any) {
            console.error('Import Error:', error);
            alert('Error importando: ' + error.message);
        } finally {
            setImporting(false);
        }
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
                const { executedMonth, valorizado, totalExecuted } = getRowData(act);
                const projected = monthlyProjections[act.id] || 0;
                const saldo = (act.metrado_total_estimado || 0) - totalExecuted;
                const pctMes = projected ? ((executedMonth / projected) * 100).toFixed(1) : '0';

                return [
                    act.nombre_partida,
                    act.unidad_medida || '-',
                    'S/ ' + (act.precio_unitario?.toFixed(2) || '0.00'),
                    act.metrado_total_estimado?.toLocaleString() || '-',
                    saldo.toLocaleString(), // Metrado Saldo
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
        const totalValSaldo = actividades.reduce((acc, act) => {
            // Total Valued - Valued Executed So Far?
            // Or Valued Balance = Budget - Executed Total Valued
            // Let's calc Executed Total first
            const actAvances = avances.filter(a => a.actividad_id === act.id);
            const totalEx = actAvances.reduce((s, c) => s + Number(c.cantidad), 0);
            const valEx = totalEx * (act.precio_unitario || 0);
            const valBudget = (act.metrado_total_estimado || 0) * (act.precio_unitario || 0);
            return acc + (valBudget - valEx);
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
            ['COSTO DIRECTO (A)', '', fmt(totalBudget), '', fmt(totalValSaldo), fmt(totalProjected), '', '', fmt(totalExecuted)],
            ['GASTOS GENERALES (B)', `${financialParams.ggPct}%`, fmt(totalBudget * ggVal), '', fmt(totalValSaldo * ggVal), fmt(totalProjected * ggVal), '', '', fmt(totalExecuted * ggVal)],
            ['UTILIDAD (C)', `${financialParams.utilPct}%`, fmt(totalBudget * utilVal), '', fmt(totalValSaldo * utilVal), fmt(totalProjected * utilVal), '', '', fmt(totalExecuted * utilVal)],
            ['SUB TOTAL (A+B+C)', '', fmt(totalBudget * subTotalMult), '', fmt(totalValSaldo * subTotalMult), fmt(totalProjected * subTotalMult), '', '', fmt(totalExecuted * subTotalMult)],
            ['FACTOR RELACION', `${financialParams.fr}`, '', '', '', '', '', '', ''],
            ['REINTEGRO', '', '0.00', '', '0.00', '0.00', '', '', '0.00'],
            ['SUB TOTAL + REINTEGRO', '', fmt(totalBudget * subTotalFrMult), '', fmt(totalValSaldo * subTotalFrMult), fmt(totalProjected * subTotalFrMult), '', '', fmt(totalExecuted * subTotalFrMult)],
            ['IGV', `${financialParams.igvPct}%`, fmt(totalBudget * subTotalFrMult * igvVal), '', fmt(totalValSaldo * subTotalFrMult * igvVal), fmt(totalProjected * subTotalFrMult * igvVal), '', '', fmt(totalExecuted * subTotalFrMult * igvVal)],
            ['MONTO TOTAL (INCL. IGV)', '', fmt(totalBudget * totalMult), '', fmt(totalValSaldo * totalMult), fmt(totalProjected * totalMult), '', '', fmt(totalExecuted * totalMult)]
        ];

        autoTable(doc, {
            startY: 35,
            head: [['Actividad', 'Unidad', 'Precio Unit.', 'Metrado Total', 'Metrado Saldo', 'Proyectado', 'Avance Mes', '% Mes', 'Valorizado']],
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
                7: { halign: 'right' },
                8: { halign: 'right' }
            },
        });

        doc.save(`Seguimiento_${selectedMonth}.pdf`);
    };

    return (
        <div className="container-fluid p-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2>Seguimiento Diario y Valorización</h2>
                <div className="d-flex gap-2 align-items-start">
                    {/* Excel Tools */}
                    <div className="btn-group me-2">
                        <Button variant="outline-success" onClick={handleDownloadTemplate} title="Descargar Plantilla Excel" disabled={!selectedObraId}>
                            <i className="bi bi-file-earmark-excel me-2"></i>Plantilla
                        </Button>
                        <Button variant="outline-primary" onClick={() => setShowImportModal(true)} title="Importar Avance desde Excel" disabled={!selectedObraId}>
                            <i className="bi bi-upload me-2"></i>Importar
                        </Button>
                    </div>

                    {/* Export PDF */}
                    <Button variant="danger" onClick={handleExportPDF} title="Generar reporte PDF">
                        <i className="bi bi-file-earmark-pdf me-2"></i>Exportar PDF
                    </Button>

                    {/* Month Selector */}
                    <div className="d-flex flex-column">
                        <Button variant="info" className="text-white mb-2" onClick={handleTelegramClick} disabled={!selectedParentId} title={!selectedParentId ? "Selecciona una Obra primero" : "Configurar Alertas"}>
                            <i className="bi bi-telegram me-2"></i>Bot Alertas
                        </Button>
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
                        <th>Metrado Saldo</th>
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
                            const { executedMonth, valorizado, alertStatus, totalExecuted } = getRowData(act);
                            const projected = monthlyProjections[act.id] || 0;
                            const saldo = (act.metrado_total_estimado || 0) - totalExecuted;
                            const pctMes = projected ? ((executedMonth / projected) * 100).toFixed(1) : '0';
                            return (
                                <tr key={act.id}>
                                    <td>
                                        {act.nombre_partida}
                                        {act.tipo === 'adicional' && <Badge bg="warning" text="dark" className="ms-2">Adicional</Badge>}
                                    </td>
                                    <td>{act.unidad_medida || '-'}</td>
                                    <td>{act.precio_unitario ? `S/ ${act.precio_unitario}` : '-'}</td>
                                    <td>{act.metrado_total_estimado ? act.metrado_total_estimado.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                                    <td>{saldo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td>{monthlyProjections[act.id] ? monthlyProjections[act.id].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                                    <td>{executedMonth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td>{pctMes}%</td>
                                    <td>S/ {valorizado.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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

            {/* Import Modal */}
            <Modal show={showImportModal} onHide={() => setShowImportModal(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>Importar Avance Diario</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form.Group className="mb-3">
                        <Form.Label>Fecha del Reporte</Form.Label>
                        <Form.Control
                            type="date"
                            value={importDate}
                            onChange={(e) => setImportDate(e.target.value)}
                        />
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Archivo Excel (Plantilla)</Form.Label>
                        <Form.Control
                            type="file"
                            accept=".xlsx, .xls"
                            onChange={(e: any) => setImportFile(e.target.files ? e.target.files[0] : null)}
                        />
                        <Form.Text className="text-muted">
                            Asegúrese de usar la plantilla generada y no modificar la columna ID_SISTEMA.
                        </Form.Text>
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowImportModal(false)}>
                        Cancelar
                    </Button>
                    <Button variant="primary" onClick={handleImportProgress} disabled={importing || !importFile}>
                        {importing ? <Spinner size="sm" animation="border" /> : 'Importar Datos'}
                    </Button>
                </Modal.Footer>
            </Modal>

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
            {/* Configuration Modal */}
            <Modal show={showTelegramModal} onHide={() => setShowTelegramModal(false)}>
                <Modal.Header closeButton>
                    <Modal.Title><i className="bi bi-bell text-primary me-2"></i>Configurar Alertas</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className="mb-3 bg-light p-3 rounded border">
                        <Form.Label className="fw-bold">📅 Fecha del Reporte</Form.Label>
                        <Form.Control
                            type="date"
                            value={reportDate}
                            onChange={(e) => setReportDate(e.target.value)}
                        />
                        <Form.Text className="text-muted small">
                            Se enviarán los avances acumulados hasta esta fecha.
                        </Form.Text>
                    </div>

                    <Tabs defaultActiveKey="telegram" className="mb-3">
                        <Tab eventKey="telegram" title="Telegram">
                            <Alert variant="info" className="py-2 px-3 small mb-3">
                                <strong>Paso 1:</strong> Crea tu bot con <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> y obtén el Token.<br />
                                <strong>Paso 2:</strong> Inicia el bot que creaste (dale a Start).<br />
                                <strong>Paso 3:</strong> Escribe al <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">@userinfobot</a> para obtener tu <strong>ID Numérico</strong> (ej. 12345678).
                            </Alert>
                            <Form.Group className="mb-3">
                                <Form.Label>Bot Token</Form.Label>
                                <Form.Control type="text" value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="123456:ABC-Def..." />
                            </Form.Group>
                            <Form.Group className="mb-3">
                                <Form.Label>Chat ID (Tu ID numérico)</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={chatId}
                                    onChange={e => setChatId(e.target.value)}
                                    placeholder="Ej: 987654321"
                                />
                                <Form.Text className="text-muted">No uses el nombre del bot, usa tu número personal.</Form.Text>
                            </Form.Group>
                        </Tab>
                        <Tab eventKey="whatsapp" title="WhatsApp">
                            <p className="text-muted small">
                                Usamos <strong>TextMeBot</strong> (Alternativa a CallMeBot). <br />
                                1. Ingresa a <a href="https://textmebot.com" target="_blank" rel="noreferrer">textmebot.com</a><br />
                                2. Haz clic en <strong>"Request ApiKey"</strong> o "Try it for Free".<br />
                                3. Sigue los pasos para conectar tu número y obtener tu API Key.
                            </p>
                            <div className="table-responsive mb-3">
                                <table className="table table-sm table-bordered">
                                    <thead className="table-light">
                                        <tr>
                                            <th>Nombre</th>
                                            <th>Teléfono</th>
                                            <th>Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {wppRecipients.map(r => (
                                            <tr key={r.id}>
                                                <td>{r.name}</td>
                                                <td>{r.phone}</td>
                                                <td className="text-center">
                                                    <Button variant="danger" size="sm" onClick={() => removeRecipient(r.id)}>
                                                        <i className="bi bi-trash"></i>
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                        {wppRecipients.length === 0 && (
                                            <tr>
                                                <td colSpan={3} className="text-center text-muted">No hay destinatarios guardados.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="card p-2 bg-light">
                                <h6>Agregar Nuevo Destinatario</h6>
                                <div className="row g-2">
                                    <div className="col-4">
                                        <Form.Control
                                            size="sm"
                                            placeholder="Nombre (ej. Juan)"
                                            value={newRecipient.name}
                                            onChange={e => setNewRecipient({ ...newRecipient, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="col-4">
                                        <Form.Control
                                            size="sm"
                                            placeholder="Teléfono (519...)"
                                            value={newRecipient.phone}
                                            onChange={e => setNewRecipient({ ...newRecipient, phone: e.target.value })}
                                        />
                                    </div>
                                    <div className="col-4">
                                        <Form.Control
                                            size="sm"
                                            placeholder="API Key"
                                            value={newRecipient.apiKey}
                                            onChange={e => setNewRecipient({ ...newRecipient, apiKey: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="mt-2 text-end">
                                    <Button size="sm" variant="success" onClick={addRecipient}>
                                        <i className="bi bi-plus-lg me-1"></i> Agregar
                                    </Button>
                                </div>
                            </div>
                        </Tab>
                    </Tabs>

                    <div className="d-flex justify-content-between mt-4">
                        <Button variant="outline-secondary" onClick={saveSettings}>Guardar Configuración</Button>
                        <Button variant="primary" disabled={sendingReport || (!botToken && wppRecipients.length === 0)} onClick={sendDailyReport}>
                            {sendingReport ? <Spinner size="sm" animation="border" /> : 'Enviar Reporte Ahora'}
                        </Button>
                    </div>
                </Modal.Body>
            </Modal>
        </div>
    );
};

export default SeguimientoDiario;
