import * as XLSX from 'xlsx';

interface ExportData {
    curveData: any[];
    incidents: any[];
    criticalActivities: any[];
    obraName: string;
    spi: string;
}

export const exportToExcel = (data: ExportData) => {
    try {
        // Create a new workbook
        const wb = XLSX.utils.book_new();

        // Sheet 1: Curva S
        const curveSheet = XLSX.utils.json_to_sheet(
            data.curveData.map(item => ({
                'Periodo': new Date(item.periodo).toLocaleDateString('es-ES'),
                'Programado Acumulado': item.programado_acumulado,
                'Ejecutado Acumulado': item.ejecutado_acumulado
            }))
        );
        XLSX.utils.book_append_sheet(wb, curveSheet, 'Curva S');

        // Sheet 2: Incidencias
        const incidentsSheet = XLSX.utils.json_to_sheet(
            data.incidents.map(inc => ({
                'Descripción': inc.descripcion,
                'Estado': inc.estado_actual,
                'Impacto': inc.impacto_estimado,
                'Resolución %': inc.porcentaje_resolucion
            }))
        );
        XLSX.utils.book_append_sheet(wb, incidentsSheet, 'Incidencias');

        // Sheet 3: Actividades Críticas
        const activitiesSheet = XLSX.utils.json_to_sheet(
            data.criticalActivities.map(act => ({
                'Partida': act.nombre_partida,
                'Es Crítica': act.es_critica ? 'Sí' : 'No'
            }))
        );
        XLSX.utils.book_append_sheet(wb, activitiesSheet, 'Actividades Críticas');

        // Sheet 4: Resumen
        const summaryData = [
            { 'Indicador': 'Obra', 'Valor': data.obraName },
            { 'Indicador': 'SPI', 'Valor': data.spi },
            { 'Indicador': 'Incidencias Abiertas', 'Valor': data.incidents.length },
            { 'Indicador': 'Actividades Críticas', 'Valor': data.criticalActivities.length }
        ];
        const summarySheet = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumen');

        // Generate filename with date
        const fileName = `Dashboard_${data.obraName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

        // Write file
        XLSX.writeFile(wb, fileName);

        return { success: true, fileName };
    } catch (error: any) {
        console.error('Error exporting to Excel:', error);
        return { success: false, error: error.message };
    }
};
