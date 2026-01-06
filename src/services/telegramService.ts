
export const sendTelegramMessage = async (token: string, chatId: string, message: string) => {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown', // Allows bolding like *text*
            }),
        });

        if (!response.ok) {
            throw new Error(`Telegram Error: ${response.statusText}`);
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        console.error('Error sending Telegram message:', error);
        return { success: false, error };
    }
};

export const getTelegramConfig = () => {
    const token = localStorage.getItem('telegram_bot_token');
    const chatId = localStorage.getItem('telegram_chat_id');
    return { token, chatId };
};

export const saveTelegramConfig = (token: string, chatId: string) => {
    localStorage.setItem('telegram_bot_token', token);
    localStorage.setItem('telegram_chat_id', chatId);
};
