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
const API_KEY = 'AIzaSyBGoaNHJY1_4wY2kKpIKlFn37gwv-PfMW4'; 
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8881818050:AAFZSOn231TQXWiuvyfJX_xq7LIjrbhStlA';

// MÁGICA AQUI: O ID novo do seu Supergrupo!
const TELEGRAM_CHAT_ID = '-3937290720';

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
            const chatId = update.message.chat.id;
            const text = update.message.text.trim();

            if (text === '/status') {
                let statusMsg = `📊 <b>CENTRAL DE COMANDO - ARTHUR TECH</b>\n\n`;
                statusMsg += `🖥️ <b>API Status:</b> ONLINE 🟢\n`;
                statusMsg += `🕒 <b>Horário Local:</b> ${moment().tz("America/Fortaleza").format("HH:mm:ss")}\n\n`;

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
// MOTOR INTELIGENTE DE BUSCA (Multi-Marchas)
// ==========================================
async function monitor() {
    try {
        if (currentLives.length > 0) {
            for (let i = currentLives.length - 1; i >= 0; i--) {
                const videoId = currentLives[i].id;
                const urlVideos = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
                
                const res = await axios.get(urlVideos);
                const item = res.data.items[0];

                // === NOVA LÓGICA DE OVERTIME (TEMPO EXCEDIDO) ===
                const tempoNoAr = moment().tz("America/Fortaleza").diff(moment(currentLives[i].startTimeRaw), 'minutes');
                let limite = 120; // 2 horas por padrão
                
                const tituloUpper = currentLives[i].title.toUpperCase();
                if (tituloUpper.includes("JORNAL DA TARDE")) limite = 95; // 90 min + 5 de folga
                if (tituloUpper.includes("VOZ DO BRASIL")) limite = 25; // 25 min exatos

                if (tempoNoAr > limite && !currentLives[i].overtimeNotified) {
                    currentLives[i].overtimeNotified = true; // Marca para não enviar repetido
                    await registrarEventoGlobal(
                        videoId + '-overtime', 
                        'warning', 
                        'Atenção: Live Passou do Horário', 
                        `A transmissão "<b>${currentLives[i].title}</b>" já está no ar há ${tempoNoAr} minutos. Verifique se o operador esqueceu de cortar o sinal do estúdio para o YouTube!`, 
                        true
                    );
                }
                // ================================================

                if (!item || item.snippet.liveBroadcastContent !== 'live') {
                    const liveTitle = currentLives[i].title;
                    const startTimeRaw = moment(currentLives[i].startTimeRaw);
                    const endTime = moment().tz("America/Fortaleza");
                    
                    const durationMinutes = endTime.diff(startTimeRaw, 'minutes');
                    const formattedDuration = durationMinutes > 0 ? `${durationMinutes} minutos` : "Menos de 1 minuto";

                    currentLives.splice(i, 1);
                    
                    await LivePassada.create({
                        id: videoId,
                        title: liveTitle,
                        date: startTimeRaw.format("DD/MM/YYYY"),
                        startTime: startTimeRaw.format("HH:mm"),
                        endTime: endTime.format("HH:mm"),
                        duration: formattedDuration
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
                    await registrarEventoGlobal(videoId, 'alert', 'Nova Live Iniciada', title, false);
                    lastKnownLiveIds.add(videoId);
                }
                
                currentLives.push({
                    id: videoId,
                    title: title,
                    isLive: true,
                    startTime: nowTime.format("HH:mm"),
                    startTimeRaw: nowTime.toISOString(),
                    overtimeNotified: false // Garante que começa sem alerta acionado
                });
            }

            const currentIds = new Set(lives.map(l => l.id.videoId));
            lastKnownLiveIds = new Set([...lastKnownLiveIds].filter(id => currentIds.has(id)));
        }

        erro429Notificado = false;

    } catch (err) { 
        if (err.response && err.response.status === 429) {
            if (!erro429Notificado) {
                await registrarEventoGlobal('erro-429', 'warning', 'Aviso de Limite da API', 'O limite de consultas do YouTube foi atingido. O monitoramento entrará em modo silencioso.', true);
                erro429Notificado = true; 
            } else {
                await registrarEventoGlobal('erro-429-wait', 'warning', 'Aguardando Cota', 'Aguardando o YouTube liberar o limite diário...', false);
            }
        } else {
            console.error("Erro na API do YouTube:", err.message); 
        }
    }
}

// ==========================================
// ROTAS DA API (Endpoints)
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

app.get('/api/report/download', async (req, res) => {
    try {
        const todasAsLives = await LivePassada.find().sort({ createdAt: -1 });
        let csvContent = "\uFEFF"; 
        csvContent += "Data;Titulo do Programa;Horario de Inicio;Horario de Termino;Duracao Total\n";

        if (todasAsLives.length === 0) {
            csvContent += "---;Nenhuma transmissão salva no histórico do banco ainda;---;---;---\n";
        } else {
            todasAsLives.forEach(live => {
                const cleanTitle = live.title.replace(/;/g, ' ').replace(/\n/g, ' ');
                csvContent += `${live.date};${cleanTitle};${live.startTime};${live.endTime};${live.duration}\n`;
            });
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=relatorio_monitoramento_radio.csv');
        res.status(200).send(csvContent);
    } catch (err) {
        res.status(500).send("Erro ao gerar relatório.");
    }
});

app.get('/api/report/pdf', async (req, res) => {
    try {
        const todasAsLives = await LivePassada.find().sort({ createdAt: -1 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=relatorio_radio_jornal.pdf');

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        const fontPath = path.join(__dirname, 'arial.ttf');
        if (fs.existsSync(fontPath)) doc.registerFont('Arial', fontPath);
        else doc.registerFont('Arial', 'Helvetica');

        if (fs.existsSync('logo.png')) doc.image('logo.png', 50, 45, { fit: [120, 60] });

        doc.font('Arial').fontSize(20).fillColor('#555555').text('RELATÓRIO', 400, 55, { align: 'right' });
        doc.moveTo(50, 110).lineTo(545, 110).lineWidth(3).strokeColor('#e60000').stroke();

        doc.moveDown(4);
        doc.font('Arial').fontSize(10).fillColor('#000000').text(`Documento: Relatório Oficial de Monitoramento de Grade (YouTube)`);
        doc.text(`Gerado em: ${moment().tz("America/Fortaleza").format("DD/MM/YYYY [às] HH:mm")}`);
        doc.text(`Emissora: Rádio Jornal Meio Norte - Teresina, Piauí`);
        doc.moveDown(1);

        doc.font('Arial').fontSize(10).fillColor('#000000');
        doc.text('DATA', 50, 200);
        doc.text('TÍTULO DA TRANSMISSÃO', 120, 200);
        doc.text('INÍCIO', 380, 200);
        doc.text('TÉRMINO', 430, 200);
        doc.text('DURAÇÃO', 485, 200);
        doc.moveTo(50, 215).lineTo(545, 215).lineWidth(1).stroke('#000');

        let y = 230;
        doc.font('Arial').fontSize(9).fillColor('#333333');
        todasAsLives.forEach((live) => {
            if (y > 750) { doc.addPage(); y = 50; }
            doc.text(live.date, 50, y);
            doc.text(live.title.substring(0, 40), 120, y);
            doc.text(live.startTime, 380, y);
            doc.text(live.endTime, 430, y);
            doc.text(live.duration, 485, y);
            y += 20;
        });

        doc.end();
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao gerar PDF.");
    }
});

setInterval(monitor, 900000);

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
