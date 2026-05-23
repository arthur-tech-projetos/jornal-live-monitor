const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');

const app = express();
app.use(cors());

// ==========================================
// CONFIGURAÇÕES
// ==========================================
const API_KEY = 'AIzaSyDVva6AfqViuq5ZoFbM-WzEfdtjwEVLtwg';
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8951777069:AAHbb5vc0uf104_ZJzSgFesHBqk_4lgaySQ';
const TELEGRAM_CHAT_ID = '-5294989968';

const PORT = process.env.PORT || 10000;

let currentLives = [];
let systemAlerts = [];
let lastKnownLiveIds = new Set();

const schedule = [
    { show: "Notícias do Dia", start: "06:30", end: "08:30" },
    { show: "Crime e Castigo", start: "09:50", end: "11:00" },
    { show: "Banca do Sapateiro", start: "11:00", end: "13:00" },
    { show: "Jornal da Tarde", start: "15:25", end: "17:00" }
];

async function enviarTelegram(msg) {
    if (!TELEGRAM_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: msg,
            parse_mode: 'HTML'
        });
    } catch (e) { console.error("Erro ao enviar para o Telegram"); }
}

async function monitor() {
    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
        const res = await axios.get(url);
        const lives = res.data.items || [];
        
        currentLives = lives.map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            isLive: true
        }));

        if (systemAlerts.length === 0) {
            systemAlerts.unshift({ type: 'idle', message: '🔄 Monitoramento ativo e rodando!', time: moment().tz("America/Fortaleza").format("HH:mm") });
        }
    } catch (err) { 
        console.error("Erro na API do YouTube:", err.message); 
    }
}

app.get('/api/status', (req, res) => {
    res.json({ 
        lives: currentLives, 
        alerts: systemAlerts, 
        time: moment().tz("America/Fortaleza").format("HH:mm"),
        apiStatus: "ONLINE" 
    });
});

setInterval(monitor, 300000);
monitor();

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
