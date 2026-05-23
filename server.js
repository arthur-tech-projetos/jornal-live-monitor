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

// PROGRAMAÇÃO
const schedule = [
    { show: "Notícias do Dia", start: "06:30", end: "08:30" },
    { show: "Crime e Castigo", start: "09:50", end: "11:00" },
    { show: "Banca do Sapateiro", start: "11:00", end: "13:00" },
    { show: "Jornal da Tarde", start: "15:25", end: "17:00" },
    { show: "Teste", start: "00:00", end: "23:59" } // Mudei para pegar o dia todo hoje!
];

async function enviarTelegram(msg) {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'SEU_TOKEN_TELEGRAM') return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: msg,
            parse_mode: 'HTML'
        });
    } catch (e) { console.error("Erro ao enviar para o Telegram"); }
}

function checkSchedule() {
    const now = moment().tz("America/Fortaleza");
    const currentTime = now.format("HH:mm");

    // REMOVI A TRAVA DE SÁBADO/DOMINGO PARA O TESTE FUNCIONAR
    const program = schedule.find(p => currentTime >= p.start && currentTime <= p.end);
    return program ? { scheduled: true, show: program.show } : { scheduled: false, show: null };
}

async function monitor() {
    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
        const res = await axios.get(url);
        const lives = res.data.items || [];
        
        currentLives = lives.map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.high.url,
            link: `https://www.youtube.com/watch?v=${item.id.videoId}`
        }));

        const status = checkSchedule();
        const shortTime = moment().tz("America/Fortaleza").format("HH:mm");

        // Alerta de Nova Live
        for (const live of currentLives) {
            if (!lastKnownLiveIds.has(live.id)) {
                lastKnownLiveIds.add(live.id);
                const msg = `🟢 <b>NOVA LIVE:</b> ${live.title}\n⏰ Início: ${shortTime}\n🔗 ${live.link}`;
                systemAlerts.unshift({ type: 'new', message: msg, time: shortTime });
                await enviarTelegram(msg);
            }
        }

        // Adiciona log de rotina
        if (systemAlerts.length === 0) {
            systemAlerts.unshift({ type: 'idle', message: '🔄 Monitoramento ativo e rodando!', time: shortTime });
        }

        if (systemAlerts.length > 15) systemAlerts.length = 15;
    } catch (err) { 
        console.error("Erro na API do YouTube:", err.message); 
    }
}

app.get('/api/status', (req, res) => {
    res.json({ 
        lives: currentLives, 
        alerts: systemAlerts, 
        time: moment().tz("America/Fortaleza").format("HH:mm"),
        apiStatus: "ONLINE" // O servidor está rodando, logo ele está online
    });

setInterval(monitor, 30000); // Reduzi para 30 segundos para você ver o teste mais rápido
monitor();

async function enviarAlertaInicializacao() {
    if (!TELEGRAM_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: `🔄 <b>Monitoramento Online!</b>\nO sistema foi reiniciado e está ignorando a trava de fim de semana para testes.`,
            parse_mode: 'HTML'
        });
    } catch (error) { console.error('Erro ao enviar alerta inicial'); }
}

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    enviarAlertaInicializacao();
});
