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
// Este Set guarda os IDs das lives que já avisamos
let lastKnownLiveIds = new Set();

async function enviarTelegram(msg) {
    if (!TELEGRAM_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: msg,
            parse_mode: 'HTML'
        });
        console.log("Mensagem enviada ao Telegram com sucesso.");
    } catch (e) { 
        console.error("Erro ao enviar para o Telegram:", e.message); 
    }
}

async function monitor() {
    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
        const res = await axios.get(url);
        const lives = res.data.items || [];
        
        // Verifica cada live encontrada
        for (const item of lives) {
            const videoId = item.id.videoId;
            const title = item.snippet.title;

            // Se for uma live nova (que não está no nosso conjunto de conhecidos)
            if (!lastKnownLiveIds.has(videoId)) {
                console.log(`Nova Live detectada: ${title}`);
                
                const mensagem = `🚨 <b>RÁDIO JORNAL AO VIVO</b>\n\n` +
                                 `📺 <b>${title}</b>\n\n` +
                                 `🔗 <a href="https://youtube.com/watch?v=${videoId}">Clique aqui para assistir</a>`;
                
                await enviarTelegram(mensagem);
                
                // Adiciona ao sistema de alertas
                systemAlerts.unshift({ 
                    id: videoId, 
                    type: 'alert', 
                    title: 'Nova Live Iniciada', 
                    detail: title, 
                    time: moment().tz("America/Fortaleza").format("HH:mm") 
                });
                
                // Marca como conhecida para não disparar o alerta de novo
                lastKnownLiveIds.add(videoId);
            }
        }

        // Limpa IDs de lives que já encerraram (sincroniza o Set com a lista atual do YouTube)
        const currentIds = new Set(lives.map(l => l.id.videoId));
        lastKnownLiveIds = new Set([...lastKnownLiveIds].filter(id => currentIds.has(id)));

        currentLives = lives.map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            isLive: true
        }));

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

// Executa a cada 5 minutos
setInterval(monitor, 300000);
monitor();

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
           
