import { supabase } from '../config/supabaseClient';

export interface Coordinator {
    id: string;
    email?: string;
}

export const fetchCoordinators = async () => {
    try {
        const { data, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('rol', 'coordinador');

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error("Error fetching coordinators:", err);
        return [];
    }
};

export const createObra = async (nombre: string, coordinadorId: string) => {
    try {
        // 1. Create the Obra
        const { data: obraData, error: obraError } = await supabase
            .from('obras')
            .insert([{ nombre_obra: nombre }])
            .select()
            .single();

        if (obraError) throw obraError;
        if (!obraData) throw new Error("No data returned from create obra");

        // 2. Create the relationship in obra_usuario
        const { error: relationError } = await supabase
            .from('obra_usuario')
            .insert([
                {
                    obra_id: obraData.id,
                    usuario_id: coordinadorId
                }
            ]);

        if (relationError) {
            console.error("Error linking coordinator:", relationError);
            // In a real app we might attempt to rollback the obra creation here
            throw relationError;
        }

        return { data: obraData, error: null };
    } catch (err: any) {
        console.error("Error creating obra:", err);
        return { data: null, error: err };
    }
};

export const createComponent = async (parentId: string, nombre: string, type: 'adicional' | 'entregable', coordinadorId: string) => {
    try {
        // Call the database function instead of direct INSERT
        const { data, error } = await supabase
            .rpc('create_component', {
                p_parent_id: parentId,
                p_nombre: nombre,
                p_type: type,
                p_coordinador_id: coordinadorId
            });

        if (error) throw error;

        // The function returns an array, get the first element
        const obraData = Array.isArray(data) ? data[0] : data;

        return { data: obraData, error: null };
    } catch (err: any) {
        console.error("Error creating component:", err);
        return { data: null, error: err };
    }
};

export const fetchObraComponents = async (parentId: string) => {
    try {
        const { data, error } = await supabase
            .from('obras')
            .select('*')
            .eq('parent_id', parentId);

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error("Error fetching components:", err);
        return [];
    }
};
