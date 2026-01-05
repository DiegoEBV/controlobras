export interface Obra {
    id: string;
    nombre_obra: string;
    ubicacion?: string;
    entidad_contratante?: string;
    supervision?: string;
    supervisor?: string;
    contratista?: string;
    residente_obra?: string;
    contrato_obra?: string;
    monto_contrato?: number;
    plazo_ejecucion_dias?: number;
    fecha_entrega_terreno?: string;
    fecha_inicio_plazo?: string;
    fecha_fin_plazo?: string;
    parent_id?: string;
    type?: string;
    gastos_generales_porcentaje?: number;
    utilidad_porcentaje?: number;
    factor_relacion?: number;
    igv_porcentaje?: number;
}

export interface Actividad {
    id: string;
    obra_id?: string;
    nombre_partida: string;
    duracion: number;
    dependencias: string[];
    es_critica: boolean;
    start_date?: Date;
    end_date?: Date;
    created_at?: string;
    porcentaje_avance?: number;
    late_start?: Date;
    late_end?: Date;
    holgura?: number;

    // New fields for Daily Tracking
    unidad_medida?: string;
    precio_unitario?: number;
    metrado_total_estimado?: number;
    metrado_proyectado?: number;
    tipo?: 'entregable' | 'adicional'; // Entregable or Adicional
}

export interface AvanceDiario {
    id: string;
    actividad_id: string;
    fecha: string; // ISO Date string YYYY-MM-DD
    cantidad: number;
    observaciones?: string;
    created_at?: string;
}
