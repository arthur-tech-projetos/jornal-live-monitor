const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');

const app = express();
app.use(cors());

// ==========================================
// CONFIGURAÇÕES
// ==========================================
// Coloque sua NOVA chave aqui para zerar o limite 429
const API_KEY = 'AIzaSyDOpCDRyn4knLVv5mfABC3Ih0ozRVCJNOw'; 
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8951777069:AAHbb5vc0uf104_ZJzSgFesHBqk_4lgaySQ';
const TELEGRAM_CHAT_ID = '-5294989968';

const PORT = process.env.PORT || 10000;

let currentLives = [];
let systemAlerts = [];
let lastKnownLiveIds = new Set();

// Envio para o Telegram
async function enviarTelegramComFoto(photoUrl, msg) {
    if (!TELEGRAM_TOKEN) return;
    try {
        if (photoUrl) {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
                chat_id: TELEGRAM_CHAT_ID,
                photo: photoUrl,
                caption: msg,
                parse_mode: 'HTML'
            });
        } else {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: msg,
                parse_mode: 'HTML'
            });
        }
    } catch (e) { 
        console.error("Erro ao enviar para o Telegram:", e.message); 
    }
}

// Log Unificado (Painel + Telegram)
async function registrarEventoGlobal(id, tipo, titulo, detalhe, enviarProTelegram = true) {
    systemAlerts.unshift({ 
        id: id, 
        type: tipo, 
        title: titulo, 
        detail: detalhe, 
        time: moment().tz("America/Fortaleza").format("HH:mm") 
    });

    if (systemAlerts.length > 50) systemAlerts.pop();

    if (enviarProTelegram) {
        let icone = "ℹ️";
        if (tipo === "warning") icone = "⚠️";
        if (tipo === "alert") icone = "🚨";
        if (tipo === "success" || tipo === "idle") icone = "🔄";

        const msgTelegram = `${icone} <b>${titulo}</b>\n\n${detalhe}`;
        await enviarTelegramComFoto(null, msgTelegram);
    }
}

// ==========================================
// O MOTOR INTELIGENTE (Economia de API)
// ==========================================
async function monitor() {
    try {
        // PASSO 1: MODO ECONÔMICO (Custa apenas 1 Ponto)
        // Se já sabemos que tem uma live rodando, apenas verificamos se ela continua aberta
        if (currentLives.length > 0) {
            for (let i = currentLives.length - 1; i >= 0; i--) {
                const videoId = currentLives[i].id;
                const urlVideos = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
                
                const res = await axios.get(urlVideos);
                const item = res.data.items[0];

                // Se o vídeo sumiu ou o status mudou de 'live' para 'none', a transmissão acabou
                if (!item || item.snippet.liveBroadcastContent !== 'live') {
                    console.log(`Live encerrada: ${currentLives[i].title}`);
                    currentLives.splice(i, 1);
                    registrarEventoGlobal(videoId + '-end', 'idle', 'Transmissão Encerrada', 'A rádio finalizou a live no YouTube.', false);
                }
            }
        }

        // PASSO 2: MODO RASTREADOR (Custa 100 Pontos)
        // Só fazemos a busca cara se NÃO houver nenhuma live ativa na nossa memória no momento
        if (currentLives.length === 0) {
            const urlSearch = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
            const res = await axios.get(urlSearch);
            const lives = res.data.items || [];
            
            for (const item of lives) {
                const videoId = item.id.videoId;
                const title = item.snippet.title;
                const thumbnailUrl = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '';

                if (!lastKnownLiveIds.has(videoId)) {
                    console.log(`Nova Live detectada: ${title}`);
                    
                    const mensagem = `🚨 <b>RÁDIO JORNAL AO VIVO</b>\n\n` +
                                     `📺 <b>${title}</b>\n\n` +
                                     `🔗 <a href="https://youtube.com/watch?v=${videoId}">Clique aqui para assistir</a>`;
                    
                    await enviarTelegramComFoto(thumbnailUrl, mensagem);
                    registrarEventoGlobal(videoId, 'alert', 'Nova Live Iniciada', title, false);
                    lastKnownLiveIds.add(videoId);
                }
                
                currentLives.push({
                    id: videoId,
                    title: title,
                    isLive: true
                });
            }

            const currentIds = new Set(lives.map(l => l.id.videoId));
            lastKnownLiveIds = new Set([...lastKnownLiveIds].filter(id => currentIds.has(id)));
        }

    } catch (err) { 
        if (err.response && err.response.status === 429) {
            console.error("Erro 429: Cota diária do YouTube excedida.");
            registrarEventoGlobal('erro-429', 'warning', 'Aviso de Limite da API', 'O limite de consultas do YouTube foi atingido. O monitoramento retornará amanhã.', true);
        } else if (err.response && err.response.status === 403) {
            console.error("Erro 403: Chave bloqueada.");
            registrarEventoGlobal('erro-403', 'warning', 'Aviso de API Key', 'A chave do YouTube é inválida ou bloqueada.', true);
        } else {
            console.error("Erro na API do YouTube:", err.message); 
        }
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

// Intervalo de 15 minutos (900000ms). Com o modo inteligente, o limite de 10.000 nunca mais será estourado.
setInterval(monitor, 900000);

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    
    registrarEventoGlobal(
        'startup-' + Date.now(), 
        'idle', 
        'Monitoramento Online!', 
        'O sistema da Rádio Jornal foi iniciado/reiniciado com sucesso.\n\n📡 Status: Ativo e vigiando o YouTube com sistema de economia de dados!', 
        true
    );
    
    monitor();
});
