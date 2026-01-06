
export const sendWhatsAppMessage = async (phone: string, apiKey: string, message: string) => {
    // TextMeBot API: https://api.textmebot.com/send.php?recipient=[phone]&text=[text]&apikey=[apikey]

    try {
        const encodedMessage = encodeURIComponent(message);
        const url = `https://api.textmebot.com/send.php?recipient=${phone}&text=${encodedMessage}&apikey=${apiKey}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`TextMeBot API Error: ${response.statusText}`);
        }

        const text = await response.text();
        return { success: true, response: text };

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
