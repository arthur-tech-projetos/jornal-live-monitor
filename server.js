const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');

const app = express();
app.use(cors());

// ==========================================
// CONFIGURAÇÕES (Preencha com seus dados)
// ==========================================
const API_KEY = 'AIzaSyDVva6AfqViuq5ZoFbM-WzEfdtjwEVLtwg';
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ'; // Lembre-se, começa com UC
const TELEGRAM_TOKEN = '8951777069:AAHbb5vc0uf104_ZJzSgFesHBqk_4lgaySQ'; // Se não for usar agora, deixe vazio ''
const TELEGRAM_CHAT_ID = '-5294989968'; // Se não for usar agora, deixe vazio ''

const PORT = process.env.PORT || 3001;

let currentLives = [];
let systemAlerts = [];
let lastKnownLiveIds = new Set();

// PROGRAMAÇÃO DA RÁDIO JORNAL (Segunda a Sexta)
const schedule = [
    { show: "Notícias do Dia", start: "06:30", end: "08:30" },
    { show: "Crime e Castigo", start: "09:50", end: "11:00" },
    { show: "Banca do Sapateiro", start: "11:00", end: "13:00" },
    { show: "Jornal da Tarde", start: "15:25", end: "17:00" }, // <--- VÍRGULA ADICIONADA AQUI!
    { show: "Teste", start: "18:10", end: "18:15" }
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
    const day = now.day(); // 0 = Dom, 6 = Sab
    const currentTime = now.format("HH:mm");

    if (day === 0 || day === 6) return { scheduled: false, show: "Fim de Semana" };

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
        const nowStr = moment().tz("America/Fortaleza").format("HH:mm:ss");

        // Alerta de Nova Live
        for (const live of currentLives) {
            if (!lastKnownLiveIds.has(live.id)) {
                lastKnownLiveIds.add(live.id);
                const msg = `🟢 <b>NOVA LIVE:</b> ${live.title}\n⏰ Início: ${nowStr}\n🔗 ${live.link}`;
                systemAlerts.unshift({ type: 'new', message: msg, time: nowStr });
                await enviarTelegram(msg);
            }
        }

        // Alerta de Live Fora do Horário (Overtime)
        if (currentLives.length > 0 && !status.scheduled) {
            const msg = `⚠️ <b>ALERTA DE VAZAMENTO:</b> Live ativa fora da grade!\n⏰ Agora: ${nowStr}\n📌 Nenhuma programação prevista para este horário.`;
            systemAlerts.unshift({ type: 'warning', message: msg, time: nowStr });
            await enviarTelegram(msg);
        }

        if (systemAlerts.length > 15) systemAlerts.length = 15;
    } catch (err) { 
        console.error("Erro na API do YouTube:", err.message); 
    }
}

app.get('/api/status', (req, res) => {
    res.json({ lives: currentLives, alerts: systemAlerts, time: moment().tz("America/Fortaleza").format("HH:mm") });
});

setInterval(monitor, 300000); // Roda a cada 5 minutos
monitor(); // Primeira checagem ao ligar

// =======================================================
// FUNÇÃO PARA AVISAR NO TELEGRAM QUE O SISTEMA FOI LIGADO
// =======================================================
async function enviarAlertaInicializacao() {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'SEU_TOKEN_TELEGRAM') return;
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: `🔄 *Monitoramento Online!*\n\nO sistema da Rádio Jornal foi iniciado/reiniciado com sucesso.\n\n📡 *Status:* Ativo e vigiando o YouTube!`,
            parse_mode: 'Markdown'
        });
        console.log('Alerta de inicialização enviado para o Telegram com sucesso.');
    } catch (error) {
        console.error('Erro ao enviar alerta de inicialização:', error.message);
    }
}

// Inicialização do Servidor
app.listen(10000, () => {
    console.log("Servidor rodando na porta 10000");
    
    // Dispara o aviso no grupo assim que o servidor termina de ligar
    enviarAlertaInicializacao(); 
});
