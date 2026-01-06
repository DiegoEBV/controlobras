
import { supabase } from '../config/supabaseClient';

export const sendWhatsAppMessage = async (phone: string, apiKey: string, message: string) => {
    // TextMeBot API: https://api.textmebot.com/send.php?recipient=[phone]&text=[text]&apikey=[apikey]

    try {
        const encodedMessage = encodeURIComponent(message);
        const url = `https://api.textmebot.com/send.php?recipient=${phone}&text=${encodedMessage}&apikey=${apiKey}`;

        // Use no-cors to allow the request to be sent from the browser.
        // Note: Response will be opaque (status 0, no body), so we assume success if no network error occurs.
        await fetch(url, { mode: 'no-cors' });

        return { success: true, response: 'Sent (Opaque)' };

    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        return { success: false, error };
    }
};

export const getWhatsAppConfig = () => {
    const phone = localStorage.getItem('whatsapp_phone');
    const apiKey = localStorage.getItem('whatsapp_apikey');
    return { phone, apiKey };
};

export const saveWhatsAppConfig = (phone: string, apiKey: string) => {
    localStorage.setItem('whatsapp_phone', phone);
    localStorage.setItem('whatsapp_apikey', apiKey);
};

export const fetchWhatsAppRecipients = async (obraId: string) => {
    if (!obraId) return [];
    const { data, error } = await supabase
        .from('destinatarios_whatsapp')
        .select('*')
        .eq('obra_id', obraId);

    if (error) {
        console.error('Error fetching WhatsApp recipients:', error);
        return [];
    }
    return data.map((d: any) => ({
        id: d.id,
        name: d.nombre,
        phone: d.telefono,
        apiKey: d.api_key,
        obra_id: d.obra_id
    }));
};

export const addWhatsAppRecipient = async (recipient: { name: string, phone: string, apiKey: string, obra_id: string }) => {
    const { data, error } = await supabase
        .from('destinatarios_whatsapp')
        .insert([{
            nombre: recipient.name,
            telefono: recipient.phone,
            api_key: recipient.apiKey,
            obra_id: recipient.obra_id
        }])
        .select()
        .single();

    if (error) throw error;
    // Map back to frontend structure if needed, or just return data
    // Frontend expects: {id, name, phone, apiKey} (based on usage setWppRecipients([...wppRecipients, saved]))
    // But DB likely has snake_case. I should probably map it. 
    // Let's check SeguimientoDiario usage. 
    // It uses `recipient.phone`, `recipient.apiKey`.

    return {
        id: data.id,
        name: data.nombre,
        phone: data.telefono,
        apiKey: data.api_key,
        obra_id: data.obra_id
    };
};

export const deleteWhatsAppRecipient = async (id: string) => {
    const { error } = await supabase
        .from('destinatarios_whatsapp')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return true;
};
