
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pfweewgvtlwnsshzthcf.supabase.co';
const supabaseKey = 'sb_publishable_IIQxTPMDT9TvGIdPCmRpgA_IpFAx3h8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log("Fetching one obra...");
    const { data: obras, error: obError } = await supabase.from('obras').select('*').limit(1);
    if (obError) {
        console.error("Error obras:", JSON.stringify(obError, null, 2));
    } else {
        console.log("Obras columns:", obras && obras.length > 0 ? Object.keys(obras[0]).join(', ') : "No rows found (or table empty)");
    }

    console.log("Fetching one usuario...");
    const { data: users, error: userError } = await supabase.from('usuarios').select('*').limit(1);
    if (userError) {
        console.error("Error users:", JSON.stringify(userError, null, 2));
    } else {
        console.log("Users columns:", users && users.length > 0 ? Object.keys(users[0]).join(', ') : "No rows found");
    }
}

inspectSchema();
