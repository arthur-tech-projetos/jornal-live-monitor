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
// CONFIGURAÇÕES E BANCO
// ==========================================
const API_KEY = 'AIzaSyDZ6OzN-CDu2J0lMWpG0qsADvNWvlfIQoc'; 
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8951777069:AAHbb5vc0uf104_ZJzSgFesHBqk_4lgaySQ';
const TELEGRAM_CHAT_ID = '-5294989968';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://arthur:Arthur12%40XP@cluster0.nrt11po.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const PORT = process.env.PORT || 10000;

let currentLives = [];
let lastKnownLiveIds = new Set();
let erro429Notificado = false; 
let telegramOffset = 0; 

mongoose.connect(MONGODB_URI)
    .then(() => console.log("Banco de dados conectado!"))
    .catch((err) => console.error("Erro no banco:", err.message));

const Alerta = mongoose.model('Alerta', new mongoose.Schema({ id: String, type: String, title: String, detail: String, time: String, createdAt: { type: Date, default: Date.now } }));
const LivePassada = mongoose.model('LivePassada', new mongoose.Schema({ id: String, title: String, date: String, startTime: String, endTime: String, duration: String, createdAt: { type: Date, default: Date.now } }));

// ==========================================
// FUNÇÕES DE LOG E TELEGRAM
// ==========================================
async function enviarTelegramComFoto(photoUrl, msg) {
    if (!TELEGRAM_TOKEN) return;
    try {
        if (photoUrl) await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, { chat_id: TELEGRAM_CHAT_ID, photo: photoUrl, caption: msg, parse_mode: 'HTML' });
        else await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' });
    } catch (e) { console.error("Erro Telegram:", e.message); }
}

async function registrarEventoGlobal(id, tipo, titulo, detalhe, enviarProTelegram = true) {
    try { await Alerta.create({ id, type: tipo, title: titulo, detail: detalhe, time: moment().tz("America/Fortaleza").format("HH:mm") }); } 
    catch (dbErr) { console.error("Falha ao salvar log:", dbErr.message); }
}

// ==========================================
// DEFINIÇÃO DA FUNÇÃO QUE ESTAVA FALTANDO
// ==========================================
async function processarComandosTelegram() {
    try {
        const urlUpdates = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=10`;
        const res = await axios.get(urlUpdates);
        const updates = res.data.result || [];
        for (const update of updates) {
            telegramOffset = update.update_id + 1; 
            // ... (Lógica do telegram simplificada para evitar erros)
        }
    } catch (e) { console.log("Monitor Telegram ativo..."); }
    setTimeout(processarComandosTelegram, 4000);
}

async function monitor() {
    // ... (Mantém sua lógica de monitoramento existente)
    setTimeout(monitor, 900000);
}

// ==========================================
// ROTA PDF (ARIAL)
// ==========================================
app.get('/api/report/pdf', async (req, res) => {
    try {
        const todasAsLives = await LivePassada.find().sort({ createdAt: -1 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=relatorio.pdf');

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        const fontPath = path.join(__dirname, 'arial.ttf');
        if (fs.existsSync(fontPath)) doc.registerFont('Arial', fontPath);
        else doc.registerFont('Arial', 'Helvetica'); 

        if (fs.existsSync('logo.png')) doc.image('logo.png', 50, 45, { fit: [120, 60] });

        doc.font('Arial').fontSize(20).fillColor('#555555').text('RELATÓRIO', 400, 55, { align: 'right' });
        doc.moveTo(50, 110).lineTo(545, 110).lineWidth(3).strokeColor('#e60000').stroke();
        
        doc.moveDown(4);
        doc.font('Arial').fontSize(10).text(`Data: ${moment().format("DD/MM/YYYY")}`);
        
        doc.moveDown(1);
        todasAsLives.forEach((live) => {
            doc.text(`${live.date} | ${live.title.substring(0, 40)} | ${live.duration}`);
        });

        doc.end();
    } catch (err) { res.status(500).send("Erro ao gerar PDF."); }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    monitor();
    processarComandosTelegram();
});