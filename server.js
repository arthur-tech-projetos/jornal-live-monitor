const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());

// ==========================================
// CONFIGURAÇÕES E CONEXÃO COM O BANCO
// ==========================================
const API_KEY = 'AIzaSyDZ6OzN-CDu2J0lMWpG0qsADvNWvlfIQoc'; 
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8881818050:AAFZSOn231TQXWiuvyfJX_xq7LIjrbhStlA'; 
const TELEGRAM_CHAT_ID = '-5294989968';

const MONGODB_URI = (process.env.MONGODB_URI && process.env.MONGODB_URI.length > 10) 
    ? process.env.MONGODB_URI 
    : 'mongodb+srv://arthur:Arthur12%40XP@cluster0.nrt11po.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

const PORT = process.env.PORT || 10000;

let currentLives = [];
let lastKnownLiveIds = new Set();
let erro429Notificado = false; 
let telegramOffset = 0; 

mongoose.connect(MONGODB_URI)
    .then(() => console.log("Banco de dados conectado!"))
    .catch((err) => console.error("Erro banco:", err.message));

// ==========================================
// FUNÇÃO INTELIGENTE DE HORAS
// ==========================================
function formatarDuracao(duracaoString) {
    if (!duracaoString) return "Desconhecida";
    if (duracaoString.includes("Menos")) return duracaoString;
    const totalMinutes = parseInt(duracaoString.replace(/\D/g, ''), 10);
    if (isNaN(totalMinutes)) return duracaoString;
    if (totalMinutes < 60) return `${totalMinutes} minuto${totalMinutes > 1 ? 's' : ''}`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    let result = `${hours} hora${hours > 1 ? 's' : ''}`;
    if (mins > 0) result += ` e ${mins} minuto${mins > 1 ? 's' : ''}`;
    return result;
}

const Alerta = mongoose.model('Alerta', new mongoose.Schema({ id: String, type: String, title: String, detail: String, time: String, createdAt: { type: Date, default: Date.now } }));
const LivePassada = mongoose.model('LivePassada', new mongoose.Schema({ id: String, title: String, date: String, startTime: String, endTime: String, duration: String, createdAt: { type: Date, default: Date.now } }));

async function enviarTelegramComFoto(photoUrl, msg) {
    if (!TELEGRAM_TOKEN) return;
    try {
        if (photoUrl) await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, { chat_id: TELEGRAM_CHAT_ID, photo: photoUrl, caption: msg, parse_mode: 'HTML' });
        else await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' });
    } catch (e) { console.error("Erro Telegram:", e.message); }
}

async function registrarEventoGlobal(id, tipo, titulo, detalhe, enviarProTelegram = true) {
    try {
        await Alerta.create({ id, type: tipo, title: titulo, detail: detalhe, time: moment().tz("America/Fortaleza").format("HH:mm") });
    } catch (dbErr) { console.error("Falha DB:", dbErr.message); }

    if (enviarProTelegram) {
        let icone = "ℹ️";
        if (tipo === "warning") icone = "⚠️";
        if (tipo === "alert") icone = "🚨";
        if (tipo === "success" || tipo === "idle") icone = "🔄";
        if (titulo === "Transmissão Encerrada") icone = "🛑";
        await enviarTelegramComFoto(null, `${icone} <b>${titulo}</b>\n\n${detalhe}`);
    }
}

async function processarComandosTelegram() {
    try {
        const res = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=10`);
        const updates = res.data.result || [];
        for (const update of updates) {
            telegramOffset = update.update_id + 1; 
            if (!update.message || !update.message.text) continue;
            const chatId = update.message.chat.id;
            const text = update.message.text.trim();
            if (text === '/status') {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: `✅ Sistema Online!`, parse_mode: 'HTML' });
            }
        }
    } catch (e) { }
    setTimeout(processarComandosTelegram, 4000);
}

async function monitor() {
    try {
        if (currentLives.length > 0) {
            for (let i = currentLives.length - 1; i >= 0; i--) {
                const videoId = currentLives[i].id;
                const urlVideos = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
                const res = await axios.get(urlVideos);
                const item = res.data.items[0];

                if (!item || item.snippet.liveBroadcastContent !== 'live') {
                    const liveTitle = currentLives[i].title;
                    const startTimeRaw = moment(currentLives[i].startTimeRaw);
                    const endTime = moment().tz("America/Fortaleza");
                    const durationMinutes = endTime.diff(startTimeRaw, 'minutes');
                    const formattedDuration = durationMinutes > 0 ? formatarDuracao(`${durationMinutes} minutos`) : "Menos de 1 minuto";

                    currentLives.splice(i, 1);
                    await LivePassada.create({
                        id: videoId, title: liveTitle, date: startTimeRaw.format("DD/MM/YYYY"),
                        startTime: startTimeRaw.format("HH:mm"), endTime: endTime.format("HH:mm"), duration: formattedDuration
                    });
                    await registrarEventoGlobal(videoId + '-end', 'idle', 'Transmissão Encerrada', `A rádio finalizou a live no YouTube:\n📺 <b>${liveTitle}</b>\n⏱️ <b>Duração total:</b> ${formattedDuration}`, true);
                }
            }
        }

        if (currentLives.length === 0) {
            const urlSearch = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
            const res = await axios.get(urlSearch);
            for (const item of res.data.items || []) {
                const videoId = item.id.videoId;
                const title = item.snippet.title;
                const thumbnailUrl = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '';
                const nowTime = moment().tz("America/Fortaleza");

                if (!lastKnownLiveIds.has(videoId)) {
                    await enviarTelegramComFoto(thumbnailUrl, `🚨 <b>RÁDIO JORNAL AO VIVO</b>\n\n📺 <b>${title}</b>`);
                    await registrarEventoGlobal(videoId, 'alert', 'Nova Live Iniciada', title, false);
                    lastKnownLiveIds.add(videoId);
                }
                currentLives.push({ id: videoId, title: title, isLive: true, startTime: nowTime.format("HH:mm"), startTimeRaw: nowTime.toISOString() });
            }
            const currentIds = new Set((res.data.items || []).map(l => l.id.videoId));
            lastKnownLiveIds = new Set([...lastKnownLiveIds].filter(id => currentIds.has(id)));
        }
    } catch (err) { }
}

// ==========================================
// ROTAS DA API
// ==========================================
app.get('/api/status', async (req, res) => {
    try {
        const dbAlerts = await Alerta.find().sort({ createdAt: -1 }).limit(30);
        const dbPastLives = await LivePassada.find().sort({ createdAt: -1 }).limit(30);
        res.json({ lives: currentLives, pastLives: dbPastLives, alerts: dbAlerts, time: moment().tz("America/Fortaleza").format("HH:mm"), apiStatus: "ONLINE" });
    } catch (err) { res.status(500).json({ error: "Erro" }); }
});

// NOVA ROTA PDF - COM FILTRO DE DATA E ARIAL BOLD
app.get('/api/report/pdf', async (req, res) => {
    try {
        // 1. Lógica do Filtro de Data
        const filtroData = req.query.date; // Ex: "26/05/2026"
        const queryDB = filtroData ? { date: filtroData } : {}; 
        
        const todasAsLives = await LivePassada.find(queryDB).sort({ createdAt: -1 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=relatorio_${filtroData ? filtroData.replace(/\//g, '-') : 'completo'}.pdf`);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        // 2. Registro de Fontes (Normal e Negrito)
        const fontPath = path.join(__dirname, 'arial.ttf');
        const fontBoldPath = path.join(__dirname, 'arial-bold.ttf');
        
        if (fs.existsSync(fontPath)) doc.registerFont('Arial', fontPath);
        else doc.registerFont('Arial', 'Helvetica');

        if (fs.existsSync(fontBoldPath)) doc.registerFont('Arial-Bold', fontBoldPath);
        else doc.registerFont('Arial-Bold', 'Helvetica-Bold');

        if (fs.existsSync('logo.png')) doc.image('logo.png', 50, 45, { fit: [120, 60] });

        // 3. Uso da Fonte Arial-Bold!
        doc.font('Arial-Bold').fontSize(20).fillColor('#555555').text('RELATÓRIO', 400, 55, { align: 'right' });
        doc.moveTo(50, 110).lineTo(545, 110).lineWidth(3).strokeColor('#e60000').stroke();

        doc.font('Arial-Bold').fontSize(10).fillColor('#000000').text(`Documento: Relatório Oficial de Monitoramento de Grade (YouTube)`, 50, 130);
        doc.font('Arial').text(`Gerado em: ${moment().tz("America/Fortaleza").format("DD/MM/YYYY [às] HH:mm")}`);
        doc.text(`Emissora: Rádio Jornal Meio Norte - Teresina, Piauí`);
        
        if (filtroData) {
            doc.moveDown(0.5);
            doc.font('Arial-Bold').fillColor('#e60000').text(`Filtro Aplicado: Apenas transmissões do dia ${filtroData}`);
        }
        
        doc.moveDown(1);

        // Cabeçalho da tabela em negrito também!
        doc.font('Arial-Bold').fontSize(10).fillColor('#000000');
        doc.text('DATA', 50, 200);
        doc.text('TÍTULO DA TRANSMISSÃO', 120, 200);
        doc.text('INÍCIO', 380, 200);
        doc.text('TÉRMINO', 430, 200);
        doc.text('DURAÇÃO', 485, 200);
        doc.moveTo(50, 215).lineTo(545, 215).lineWidth(1).stroke('#000');

        let y = 230;
        doc.font('Arial').fontSize(9).fillColor('#333333');
        
        if (todasAsLives.length === 0) {
            doc.text("Nenhuma transmissão encontrada para esta data.", 50, y);
        } else {
            todasAsLives.forEach((live) => {
                if (y > 750) { doc.addPage(); y = 50; }
                doc.text(live.date, 50, y);
                const shortTitle = live.title.length > 40 ? live.title.substring(0, 38) + "..." : live.title;
                doc.text(shortTitle, 120, y);
                doc.text(live.startTime, 380, y);
                doc.text(live.endTime, 430, y);
                doc.text(formatarDuracao(live.duration), 485, y);
                y += 20;
            });
        }

        doc.end();
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao gerar PDF.");
    }
});

setInterval(monitor, 900000);

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    monitor();
    processarComandosTelegram(); 
});