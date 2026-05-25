const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');

const app = express();
app.use(cors());

// ==========================================
// CONFIGURAÇÕES
// ==========================================
const API_KEY = 'AIzaSyCyYYBf49IcWmyWmjO0ONgc3lv24u9AaxA';
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8951777069:AAHbb5vc0uf104_ZJzSgFesHBqk_4lgaySQ';
const TELEGRAM_CHAT_ID = '-5294989968';

const PORT = process.env.PORT || 10000;

let currentLives = [];
let systemAlerts = [];
let lastKnownLiveIds = new Set();

// Função adaptada para enviar foto com legenda formatada
async function enviarTelegramComFoto(photoUrl, msg) {
    if (!TELEGRAM_TOKEN) return;
    try {
        if (photoUrl) {
            // Se houver uma thumbnail, envia usando o método sendPhoto
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
                chat_id: TELEGRAM_CHAT_ID,
                photo: photoUrl,
                caption: msg,
                parse_mode: 'HTML'
            });
        } else {
            // Caso falte a imagem por algum motivo, envia apenas o texto como segurança
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: msg,
                parse_mode: 'HTML'
            });
        }
        console.log("Notificação com thumbnail enviada ao Telegram.");
    } catch (e) { 
        console.error("Erro ao enviar para o Telegram:", e.message); 
    }
}

async function monitor() {
    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
        const res = await axios.get(url);
        const lives = res.data.items || [];
        
        for (const item of lives) {
            const videoId = item.id.videoId;
            const title = item.snippet.title;
            
            // Captura a URL da capa em alta resolução (se não houver, pega a padrão)
            const thumbnailUrl = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '';

            if (!lastKnownLiveIds.has(videoId)) {
                console.log(`Nova Live detectada: ${title}`);
                
                // Texto que vai aparecer como legenda da imagem
                const mensagem = `🚨 <b>RÁDIO JORNAL AO VIVO</b>\n\n` +
                                 `📺 <b>${title}</b>\n\n` +
                                 `🔗 <a href="https://youtube.com/watch?v=${videoId}">Clique aqui para assistir</a>`;
                
                // Dispara o envio passando a imagem e a legenda
                await enviarTelegramComFoto(thumbnailUrl, mensagem);
                
                systemAlerts.unshift({ 
                    id: videoId, 
                    type: 'alert', 
                    title: 'Nova Live Iniciada', 
                    detail: title, 
                    time: moment().tz("America/Fortaleza").format("HH:mm") 
                });
                
                lastKnownLiveIds.add(videoId);
            }
        }

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

setInterval(monitor, 300000);
monitor();

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
