
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://byisskuwecmkulbtnyda.supabase.co';
const supabaseKey = 'sb_publishable_yxfMW2N3JRYAxkEKD-TEDg_24G29Ze2'; // Found in .env
const supabase = createClient(supabaseUrl, supabaseKey);

import * as fs from 'fs';

async function inspectSchema() {
    const results: any = {};

    // Actividades
    try {
        const { data, error } = await supabase.from('actividades_obra').select('*').limit(1);
        results.actividades_obra = { data, error, columns: data && data.length > 0 ? Object.keys(data[0]) : [] };
    } catch (e) { results.actividades_obra_exception = e; }

    // Vista Curva S
    try {
        const { data, error } = await supabase.from('vista_curva_s').select('*').limit(1);
        results.vista_curva_s = { data, error, columns: data && data.length > 0 ? Object.keys(data[0]) : [] };
    } catch (e) { results.vista_curva_s_exception = e; }

    fs.writeFileSync('debug_schema.json', JSON.stringify(results, null, 2));
    console.log("Done writing debug_schema.json");
}

inspectSchema();
