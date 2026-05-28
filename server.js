const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');
const mongoose = require('mongoose');

// --- IMPORTS DO PDF ---
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());

// ==========================================
// CONFIGURAÇÕES E CONEXÃO COM O BANCO
// ==========================================

// 🔥 SISTEMA DE ROTAÇÃO DE APIS DO YOUTUBE 🔥
const YOUTUBE_API_KEYS = [
    'AIzaSyCEiU6t8FRWuZX3IfQhmIlAGG2zUz2-cB8',               // Chave 1
    'AIzaSyB7eJVgy2RtV_5aHvVUTnIFGlu-LYlz7BM',               // Chave 2
    'AIzaSyCms0FE8cwGSWNPipXwoPdh1MTFwPDU4Dw',               // Chave 3
];
let currentApiKeyIndex = 0; 

const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8881818050:AAFZSOn231TQXWiuvyfJX_xq7LIjrbhStlA';

let TELEGRAM_CHAT_ID = '-1003937290720'; 

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://arthur:Arthur12%40XP@cluster0.nrt11po.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

const PORT = process.env.PORT || 10000;

let currentLives = [];
let lastKnownLiveIds = new Set();
let erro429Notificado = false; 
let telegramOffset = 0; 

mongoose.connect(MONGODB_URI)
    .then(() => console.log("Banco de dados permanente conectado com sucesso!"))
    .catch((err) => console.error("Erro ao conectar ao banco de dados:", err.message));

// ==========================================
// MODELOS DO BANCO DE DADOS (Persistência)
// ==========================================
const AlertaSchema = new mongoose.Schema({
    id: String,
    type: String,
    title: String,
    detail: String,
    time: String,
    createdAt: { type: Date, default: Date.now }
});
const Alerta = mongoose.model('Alerta', AlertaSchema);

const LivePassadaSchema = new mongoose.Schema({
    id: String,
    title: String,
    date: String,
    startTime: String,
    endTime: String,
    duration: String,
    createdAt: { type: Date, default: Date.now }
});
const LivePassada = mongoose.model('LivePassada', LivePassadaSchema);

// ==========================================
// FUNÇÕES DE TELEGRAM E LOGS
// ==========================================
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

async function registrarEventoGlobal(id, tipo, titulo, detalhe, enviarProTelegram = true) {
    try {
        await Alerta.create({
            id: id,
            type: tipo,
            title: titulo,
            detail: detalhe,
            time: moment().tz("America/Fortaleza").format("HH:mm")
        });

        const totalAlertas = await Alerta.countDocuments();
        if (totalAlertas > 100) {
            const maisAntigo = await Alerta.findOne().sort({ createdAt: 1 });
            if (maisAntigo) await Alerta.deleteOne({ _id: maisAntigo._id });
        }
    } catch (dbErr) {
        console.error("Falha ao salvar log no banco:", dbErr.message);
    }

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
// BOT INTERATIVO DO TELEGRAM (/status e /logs)
// ==========================================
async function processarComandosTelegram() {
    try {
        const urlUpdates = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=10`;
        const res = await axios.get(urlUpdates);
        const updates = res.data.result || [];

        for (const update of updates) {
            telegramOffset = update.update_id + 1; 

            if (!update.message || !update.message.text) continue;
            const chatId = update.message.chat.id.toString();
            const text = update.message.text.trim();

            if (TELEGRAM_CHAT_ID !== chatId) {
                TELEGRAM_CHAT_ID = chatId;
                console.log(`🚨 ID DO GRUPO ATUALIZADO PARA: ${TELEGRAM_CHAT_ID} 🚨`);
            }

            if (text === '/status') {
                let statusMsg = `📊 <b>CENTRAL DE COMANDO - ARTHUR TECH</b>\n\n`;
                statusMsg += `🖥️ <b>API Status:</b> ONLINE 🟢\n`;
                statusMsg += `🕒 <b>Horário Local:</b> ${moment().tz("America/Fortaleza").format("HH:mm:ss")}\n\n`;

                // 🔥 PAINEL DO MOTOR DE APIS 🔥
                statusMsg += `🔑 <b>Cota do YouTube (APIs):</b>\n`;
                if (erro429Notificado && currentApiKeyIndex >= YOUTUBE_API_KEYS.length - 1) {
                    statusMsg += `🔴 <b>ESGOTADO:</b> Todas as ${YOUTUBE_API_KEYS.length} chaves foram consumidas!\n\n`;
                } else {
                    const chavesRestantes = YOUTUBE_API_KEYS.length - (currentApiKeyIndex + 1);
                    statusMsg += `🟢 <b>Ativa:</b> Operando na Chave ${currentApiKeyIndex + 1}\n`;
                    statusMsg += `🔋 <b>Reservas:</b> ${chavesRestantes} chave(s) pronta(s)\n\n`;
                }

                const horaAtual = moment().tz("America/Fortaleza").hour();
                const emHorarioComercial = horaAtual >= 6 && horaAtual < 19;

                if (currentLives.length === 0) {
                    if (emHorarioComercial) {
                        statusMsg += `⚪ <b>Transmissão Atual:</b> Nenhuma live ativa no momento. Em modo de espera.\n\n📡 <b>Robô:</b> Procurando transmissões...`;
                    } else {
                        statusMsg += `🌙 <b>Transmissão Atual:</b> Nenhuma live ativa.\n\n💤 <b>Robô:</b> Em modo economia (API pausada). Retorna às 06:00.`;
                    }
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

            else if (text === '/logs') {
                const ultimosAlertas = await Alerta.find().sort({ createdAt: -1 }).limit(5);
                let logsMsg = `📋 <b>ÚLTIMOS 5 ALERTAS DO SISTEMA:</b>\n\n`;

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
        if (e.response && e.response.status === 409) {
            console.log("Aguardando instância antiga do Telegram encerrar...");
        } else {
            console.error("Erro ao processar comandos do Telegram:", e.message);
        }
    }
    setTimeout(processarComandosTelegram, 4000);
}

// ==========================================
// MOTOR INTELIGENTE DE BUSCA (Restauração e Rotação)
// ==========================================
async function monitor() {
    try {
        const API_KEY = YOUTUBE_API_KEYS[currentApiKeyIndex]; 
        const horaAtual = moment().tz("America/Fortaleza").hour();
        
        // Janela de operação restrita: 06:00 até 18:59
        const isHorarioMonitoramento = horaAtual >= 6 && horaAtual < 19; 

        // 1. CHECAGEM DE LIVE EXISTENTE
        if (currentLives.length > 0) {
            for (let i = currentLives.length - 1; i >= 0; i--) {
                const videoId = currentLives[i].id;
                const urlVideos = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
                
                const res = await axios.get(urlVideos);
                const item = res.data.items[0];

                const tempoNoAr = moment().tz("America/Fortaleza").diff(moment(currentLives[i].startTimeRaw), 'minutes');
                let limite = 120; 
                
                const tituloUpper = currentLives[i].title.toUpperCase();
                if (tituloUpper.includes("JORNAL DA TARDE")) limite = 95; 

                if (tempoNoAr > limite && !currentLives[i].overtimeNotified) {
                    currentLives[i].overtimeNotified = true; 
                    await registrarEventoGlobal(
                        videoId + '-overtime', 
                        'warning', 
                        'Atenção: Live Passou do Horário', 
                        `A transmissão "<b>${currentLives[i].title}</b>" já está no ar há ${tempoNoAr} minutos. Verifique se o operador esqueceu de cortar o sinal do estúdio para o YouTube!`, 
                        true
                    );
                }

                if (!item || item.snippet.liveBroadcastContent !== 'live') {
                    const liveTitle = currentLives[i].title;
                    const originalStartTime = currentLives[i].startTime; // 🔥 PUXA O HORÁRIO EXATO E TRAVADO DA TELA 🔥
                    const startTimeRaw = moment(currentLives[i].startTimeRaw);
                    const endTime = moment().tz("America/Fortaleza");
                    
                    const durationMinutes = endTime.diff(startTimeRaw, 'minutes');
                    
                    // 🔥 CONVERSOR DE HORAS (104 min = 1h 44min) 🔥
                    let formattedDuration = "Menos de 1 min";
                    if (durationMinutes > 0) {
                        const horas = Math.floor(durationMinutes / 60);
                        const minutos = durationMinutes % 60;
                        if (horas > 0) {
                            formattedDuration = `${horas}h ${minutos}min`;
                        } else {
                            formattedDuration = `${minutos}min`;
                        }
                    }

                    currentLives.splice(i, 1);
                    
                    await LivePassada.create({
                        id: videoId,
                        title: liveTitle,
                        date: endTime.format("DD/MM/YYYY"), // Puxa data de encerramento do fuso local
                        startTime: originalStartTime,       // Horário de Início Impecável
                        endTime: endTime.format("HH:mm"),   // Horário de Fim Impecável
                        duration: formattedDuration         // Formato bonito em horas e minutos
                    });

                    await registrarEventoGlobal(
                        videoId + '-end', 
                        'idle', 
                        'Transmissão Encerrada', 
                        `A rádio finalizou a live no YouTube:\n📺 <b>${liveTitle}</b>\n⏱️ <b>Duração total:</b> ${formattedDuration}`, 
                        true
                    );
                }
            }
        }

        // 2. BUSCA DE LIVES NOVAS (Custo 100 pontos)
        if (currentLives.length === 0) {
            if (isHorarioMonitoramento) {
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
                        await registrarEventoGlobal(videoId, 'alert', 'Nova Live Iniciada', title, false);
                        lastKnownLiveIds.add(videoId);
                    }
                    
                    currentLives.push({
                        id: videoId,
                        title: title,
                        isLive: true,
                        startTime: nowTime.format("HH:mm"),
                        startTimeRaw: nowTime.toISOString(),
                        overtimeNotified: false
                    });
                }

                const currentIds = new Set(lives.map(l => l.id.videoId));
                lastKnownLiveIds = new Set([...lastKnownLiveIds].filter(id => currentIds.has(id)));
            } else {
                erro429Notificado = false; 
            }
        }

        erro429Notificado = false; 

    } catch (err) { 
        if (err.response && (err.response.status === 429 || err.response.status === 403)) {
            if (currentApiKeyIndex < YOUTUBE_API_KEYS.length - 1) {
                currentApiKeyIndex++; 
                await registrarEventoGlobal(
                    'rota-api-' + Date.now(), 
                    'warning', 
                    'Rotação Automática de API 🔄', 
                    `A cota da Chave ${currentApiKeyIndex} esgotou. O sistema migrou instantaneamente para a Chave de Reserva ${currentApiKeyIndex + 1} para não perder a cobertura.`, 
                    true
                );
            } else {
                if (!erro429Notificado) {
                    await registrarEventoGlobal('erro-429', 'alert', 'Alerta Crítico: Limite Geral de APIs', 'O sistema consumiu todas as chaves de API. O monitoramento entrará em espera até a renovação da cota de madrugada.', true);
                    erro429Notificado = true; 
                }
            }
        } else {
            console.error("Erro na API do YouTube:", err.message); 
        }
    }
}

// ==========================================
// ROTAS DA API (Endpoints, CSV e PDF com Filtro)
// ==========================================
app.get('/api/status', async (req, res) => {
    try {
        const dbAlerts = await Alerta.find().sort({ createdAt: -1 }).limit(30);
        const dbPastLives = await LivePassada.find().sort({ createdAt: -1 }).limit(30);

        res.json({ 
            lives: currentLives, 
            pastLives: dbPastLives, 
            alerts: dbAlerts, 
            time: moment().tz("America/Fortaleza").format("HH:mm"),
            apiStatus: "ONLINE" 
        });
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar dados no banco" });
    }
});

// CSV com suporte ao filtro de data
app.get('/api/report/download', async (req, res) => {
    try {
        let filter = {};
        if (req.query.date) filter.date = req.query.date;

        const todasAsLives = await LivePassada.find(filter).sort({ createdAt: -1 });
        let csvContent = "\uFEFF"; 
        csvContent += "Data;Titulo do Programa;Horario de Inicio;Horario de Termino;Duracao Total\n";

        if (todasAsLives.length === 0) {
            csvContent += "---;Nenhuma transmissão encontrada para esta data;---;---;---\n";
        } else {
            todasAsLives.forEach(live => {
                const cleanTitle = live.title.replace(/;/g, ' ').replace(/\n/g, ' ');
                csvContent += `${live.date};${cleanTitle};${live.startTime};${live.endTime};${live.duration}\n`;
            });
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=relatorio_radio_jornal_${req.query.date ? req.query.date.replace(/\//g, '-') : 'completo'}.csv`);
        res.status(200).send(csvContent);
    } catch (err) {
        res.status(500).send("Erro ao gerar relatório.");
    }
});

// PDF limpo (Retirada a inversão falsa de horários que escondia o bug)
app.get('/api/report/pdf', async (req, res) => {
    try {
        let filter = {};
        if (req.query.date) filter.date = req.query.date;

        const todasAsLives = await LivePassada.find(filter).sort({ createdAt: -1 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=relatorio_radio_jornal.pdf');

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        const fontPath = path.join(__dirname, 'arial.ttf');
        if (fs.existsSync(fontPath)) doc.registerFont('Arial', fontPath);
        else doc.registerFont('Arial', 'Helvetica');

        const fontBoldPath = path.join(__dirname, 'arial-bold.ttf');
        if (fs.existsSync(fontBoldPath)) doc.registerFont('Arial-Bold', fontBoldPath);
        else doc.registerFont('Arial-Bold', 'Helvetica-Bold');

        if (fs.existsSync('logo.png')) doc.image('logo.png', 50, 45, { fit: [120, 60] });
        
        doc.font('Arial-Bold').fontSize(20).fillColor('#555555').text('RELATÓRIO', 400, 55, { align: 'right' });
        doc.moveTo(50, 110).lineTo(545, 110).lineWidth(3).strokeColor('#e60000').stroke();

        doc.font('Arial').fontSize(10).fillColor('#000000');
        doc.text(`Documento: Relatório Oficial de Monitoramento de Grade (YouTube)`, 50, 130);
        doc.text(`Gerado em: ${moment().tz("America/Fortaleza").format("DD/MM/YYYY [às] HH:mm")}`, 50, 145);
        
        if (req.query.date) {
            doc.font('Arial-Bold').text(`Referente a: ${req.query.date}`, 50, 160);
            doc.font('Arial').text(`Emissora: Rádio Jornal Meio Norte - Teresina, Piauí`, 50, 175);
        } else {
            doc.text(`Emissora: Rádio Jornal Meio Norte - Teresina, Piauí`, 50, 160);
        }

        const yHeader = req.query.date ? 215 : 200;
        const yLine = req.query.date ? 230 : 215;

        doc.font('Arial-Bold').fontSize(9).fillColor('#000000');
        doc.text('DATA', 50, yHeader);
        doc.text('TÍTULO DA TRANSMISSÃO', 110, yHeader); 
        doc.text('INÍCIO', 350, yHeader);
        doc.text('TÉRMINO', 410, yHeader);
        doc.text('DURAÇÃO', 470, yHeader);
        
        doc.moveTo(50, yLine).lineTo(545, yLine).lineWidth(1).strokeColor('#cccccc').stroke();

        let y = yLine + 20; 
        doc.font('Arial').fontSize(9).fillColor('#333333');
        
        if (todasAsLives.length === 0) {
            doc.text("Nenhuma transmissão encontrada para os critérios selecionados.", 50, y);
        } else {
            todasAsLives.forEach((live) => {
                if (y > 750) { 
                    doc.addPage(); 
                    y = 50; 
                }

                const titulo = live.title ? live.title.substring(0, 42) : "Sem título";
                
                // Sem a necessidade de gambiarras e strings falsas!
                doc.text(live.date, 50, y, { lineBreak: false });
                doc.text(titulo, 110, y, { lineBreak: false });
                doc.text(live.startTime || "--:--", 350, y, { lineBreak: false });
                doc.text(live.endTime || "--:--", 410, y, { lineBreak: false });
                doc.text(live.duration || "--", 470, y, { lineBreak: false });
                
                y += 25; 
            });
        }

        doc.end();
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao gerar PDF.");
    }
});

setInterval(monitor, 300000); 

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    registrarEventoGlobal(
        'startup-' + Date.now(), 
        'idle', 
        'Monitoramento Online!', 
        'O sistema da Rádio Jornal foi iniciado/reiniciado com sucesso.\n\n📡 Status: Conectado ao Banco de Dados Permanente!', 
        true
    );
    monitor();
    processarComandosTelegram(); 
});
