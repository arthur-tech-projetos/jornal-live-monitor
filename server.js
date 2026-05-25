const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');

const app = express();
app.use(cors());

// ==========================================
// CONFIGURAÇÕES
// ==========================================
const API_KEY = 'AIzaSyDZ6OzN-CDu2J0lMWpG0qsADvNWvlfIQoc'; 
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8951777069:AAHbb5vc0uf104_ZJzSgFesHBqk_4lgaySQ';
const TELEGRAM_CHAT_ID = '-5294989968';

const PORT = process.env.PORT || 10000;

let currentLives = [];
let systemAlerts = [];
let pastLives = []; // Armazena o histórico das últimas transmissões encerradas
let lastKnownLiveIds = new Set();
let erro429Notificado = false; 
let telegramOffset = 0; // Controla as mensagens lidas no Telegram

// Envio padrão para o Telegram
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
        if (titulo === "Transmissão Encerrada") icone = "🛑";

        const msgTelegram = `${icone} <b>${titulo}</b>\n\n${detalhe}`;
        await enviarTelegramComFoto(null, msgTelegram);
    }
}

// ==========================================
// BOT INTERATIVO: PROCESSADOR DE COMANDOS
// ==========================================
async function processarComandosTelegram() {
    try {
        const urlUpdates = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=10`;
        const res = await axios.get(urlUpdates);
        const updates = res.data.result || [];

        for (const update of updates) {
            telegramOffset = update.update_id + 1; // Marca como lida

            if (!update.message || !update.message.text) continue;
            const chatId = update.message.chat.id;
            const text = update.message.text.trim();

            // COMANDO 1: /status
            if (text === '/status') {
                let statusMsg = `📊 <b>CENTRAL DE COMANDO - ARTHUR TECH</b>\n\n`;
                statusMsg += `🖥️ <b>API Status:</b> ONLINE 🟢\n`;
                statusMsg += `🕒 <b>Horário Local:</b> ${moment().tz("America/Fortaleza").format("HH:mm:ss")}\n`;
                statusMsg += `📈 <b>Total Monitorado Hoje:</b> ${currentLives.length + pastLives.length}\n\n`;

                if (currentLives.length === 0) {
                    statusMsg += `⚪ <b>Transmissão Atual:</b> Nenhuma live ativa no momento. Em modo de espera com economia de dados ativa.`;
                } else {
                    statusMsg += `🚨 <b>TRANSMISSÃO AO VIVO DETECTADA:</b>\n`;
                    currentLives.forEach(l => {
                        statusMsg += `📺 <b>Título:</b> ${l.title}\n`;
                        statusMsg += `⏱️ <b>Iniciada às:</b> ${l.startTime}\n`;
                        statusMsg += `🔗 <a href="https://youtube.com/watch?v=${l.id}">Assistir no YouTube</a>\n`;
                    });
                }
                
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: statusMsg,
                    parse_mode: 'HTML'
                });
            }

            // COMANDO 2: /logs
            else if (text === '/logs') {
                let logsMsg = `📋 <b>ÚLTIMOS 5 ALERTAS DO SISTEMA:</b>\n\n`;
                const ultimosAlertas = systemAlerts.slice(0, 5);

                if (ultimosAlertas.length === 0) {
                    logsMsg += `ℹ️ Nenhum log registrado até o momento.`;
                } else {
                    ultimosAlertas.forEach((a, index) => {
                        let iconeLog = "ℹ️";
                        if (a.type === "warning") iconeLog = "⚠️";
                        if (a.type === "alert") iconeLog = "🚨";
                        if (a.type === "idle") iconeLog = "🔄";
                        logsMsg += `${index + 1}. ${iconeLog} [${a.time}] <b>${a.title}</b>\n└ <i>${a.detail}</i>\n\n`;
                    });
                }

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: logsMsg,
                    parse_mode: 'HTML'
                });
            }
        }
    } catch (e) {
        console.error("Erro ao processar comandos do Telegram:", e.message);
    }
    // Mantém a escuta ativa infinitamente
    setTimeout(processarComandosTelegram, 4000);
}

// ==========================================
// O MOTOR INTELIGENTE (Economia de API)
// ==========================================
async function monitor() {
    try {
        // PASSO 1: MODO ECONÔMICO (Custa apenas 1 Ponto)
        if (currentLives.length > 0) {
            for (let i = currentLives.length - 1; i >= 0; i--) {
                const videoId = currentLives[i].id;
                const urlVideos = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
                
                const res = await axios.get(urlVideos);
                const item = res.data.items[0];

                if (!item || item.snippet.liveBroadcastContent !== 'live') {
                    const liveTitle = currentLives[i].title;
                    const startTimeRaw = currentLives[i].startTimeRaw;
                    const endTime = moment().tz("America/Fortaleza");
                    
                    // Cálculo inteligente da duração do programa
                    const durationMinutes = endTime.diff(startTimeRaw, 'minutes');
                    const formattedDuration = durationMinutes > 0 ? `${durationMinutes} minutos` : "Menos de 1 minuto";

                    currentLives.splice(i, 1);
                    
                    // Alimenta a lista de Histórico para o Recurso 5
                    pastLives.unshift({
                        id: videoId,
                        title: liveTitle,
                        date: startTimeRaw.format("DD/MM/YYYY"),
                        startTime: startTimeRaw.format("HH:mm"),
                        endTime: endTime.format("HH:mm"),
                        duration: formattedDuration
                    });

                    if (pastLives.length > 30) pastLives.pop(); // Mantém os últimos 30 programas para não estourar memória

                    registrarEventoGlobal(
                        videoId + '-end', 
                        'idle', 
                        'Transmissão Encerrada', 
                        `A rádio finalizou a live no YouTube:\n📺 <b>${liveTitle}</b>\n⏱️ <b>Duração total:</b> ${formattedDuration}`, 
                        true
                    );
                }
            }
        }

        // PASSO 2: MODO RASTREADOR (Custa 100 Pontos)
        if (currentLives.length === 0) {
            const urlSearch = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
            const res = await axios.get(urlSearch);
            const lives = res.data.items || [];
            
            for (const item of lives) {
                const videoId = item.id.videoId;
                const title = item.snippet.title;
                const thumbnailUrl = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '';
                const nowTime = moment().tz("America/Fortaleza");

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
                    isLive: true,
                    startTime: nowTime.format("HH:mm"),
                    startTimeRaw: nowTime // Guardado puro para calcular a duração exata depois
                });
            }

            const currentIds = new Set(lives.map(l => l.id.videoId));
            lastKnownLiveIds = new Set([...lastKnownLiveIds].filter(id => currentIds.has(id)));
        }

        erro429Notificado = false;

    } catch (err) { 
        if (err.response && err.response.status === 429) {
            if (!erro429Notificado) {
                registrarEventoGlobal('erro-429', 'warning', 'Aviso de Limite da API', 'O limite de consultas do YouTube foi atingido. O monitoramento entrará em modo silencioso.', true);
                erro429Notificado = true; 
            } else {
                registrarEventoGlobal('erro-429-wait', 'warning', 'Aguardando Cota', 'Aguardando o YouTube liberar o limite diário...', false);
            }
        } else {
            console.error("Erro na API do YouTube:", err.message); 
        }
    }
}

// ==========================================
// ROTAS DA API (Endpoints)
// ==========================================

// Retorna dados para o painel (Inclui agora a lista do histórico recente para o Recurso 5)
app.get('/api/status', (req, res) => {
    res.json({ 
        lives: currentLives, 
        pastLives: pastLives, // Adicionado aqui! Agora o seu front-end pode ler essa lista e criar a aba secundária
        alerts: systemAlerts, 
        time: moment().tz("America/Fortaleza").format("HH:mm"),
        apiStatus: "ONLINE" 
    });
});

// RECURSO 4: ROTA DE DOWNLOAD DE RELATÓRIO COMERCIAL (Gera .CSV puro aceito pelo Excel)
app.get('/api/report/download', (req, res) => {
    // Cabeçalho estruturado do Excel
    let csvContent = "\uFEFF"; // Garante os acentos corretos no Excel (UTF-8 BOM)
    csvContent += "Data;Titulo do Programa;Horario de Inicio;Horario de Termino;Duracao Total\n";

    if (pastLives.length === 0) {
        csvContent += "---;Nenhuma transmissão salva no histórico ainda;---;---;---\n";
    } else {
        pastLives.forEach(live => {
            // Remove pontos e vírgulas do título para não quebrar as colunas do Excel
            const cleanTitle = live.title.replace(/;/g, ' ').replace(/\n/g, ' ');
            csvContent += `${live.date};${cleanTitle};${live.startTime};${live.endTime};${live.duration}\n`;
        });
    }

    // Configura o navegador do cliente para receber o arquivo como download oficial
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=relatorio_monitoramento_radio.csv');
    res.status(200).send(csvContent);
});

// Execução inicial
setInterval(monitor, 900000);

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    registrarEventoGlobal(
        'startup-' + Date.now(), 
        'idle', 
        'Monitoramento Online!', 
        'O sistema da Rádio Jornal foi iniciado/reiniciado com sucesso.\n\n📡 Status: Ativo e automatizado com Inteligência de Comandos e Relatórios!', 
        true
    );
    monitor();
    processarComandosTelegram(); // Inicializa a escuta de comandos do Telegram
});
