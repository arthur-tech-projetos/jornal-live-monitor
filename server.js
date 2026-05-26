const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

moment.tz.setDefault("America/Fortaleza");

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÕES ---
const API_KEY = 'AIzaSyDZ6OzN-CDu2J0lMWpG0qsADvNWvlfIQoc'; 
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8881818050:AAFZSOn231TQXWiuvyfJX_xq7LIjrbhStlA'; // <--- TROQUE ISTO PELO TOKEN DO BOT LIMPO!
const TELEGRAM_CHAT_ID = '-5294989968';
const MONGODB_URI = 'mongodb+srv://arthur:Arthur12%40XP@cluster0.nrt11po.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const PORT = process.env.PORT || 10000;

// --- CONEXÃO BANCO ---
mongoose.connect(MONGODB_URI)
    .then(() => console.log(">>> Banco Conectado!"))
    .catch(err => console.error(">>> Erro Banco:", err));

const Alerta = mongoose.model('Alerta', new mongoose.Schema({ title: String, detail: String, type: String, time: String, createdAt: { type: Date, default: Date.now } }));
const LivePassada = mongoose.model('LivePassada', new mongoose.Schema({ title: String, date: String, startTime: String, duration: String, createdAt: { type: Date, default: Date.now } }));

// --- FUNÇÕES DE SUPORTE ---
async function registrarEvento(title, detail, type = 'idle') {
    await Alerta.create({ title, detail, type, time: moment().format("HH:mm") });
}

// --- TELEGRAM ---
let telegramOffset = 0;
async function processarComandosTelegram() {
    try {
        const res = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=10`);
        for (const update of res.data.result || []) {
            telegramOffset = update.update_id + 1;
            if (update.message?.text === '/status') {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: `✅ Sistema Monitor Jornal Online!` });
            }
        }
    } catch (e) { console.log("Telegram rodando..."); }
    setTimeout(processarComandosTelegram, 4000);
}

// --- MONITORAMENTO ---
async function monitor() {
    try {
        const res = await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`);
        // Sua lógica de monitoramento entra aqui...
    } catch (err) { console.log("Monitorando..."); }
    setTimeout(monitor, 300000);
}

// --- ROTAS ---
app.get('/api/status', async (req, res) => {
    const alerts = await Alerta.find().sort({ createdAt: -1 }).limit(10);
    res.json({ status: "online", time: moment().format("HH:mm"), alerts });
});

// Rota PDF - BINDADA (Se não encontrar arial.ttf, usa Helvetica e não trava)
app.get('/api/report/pdf', async (req, res) => {
    try {
        const lives = await LivePassada.find().sort({ createdAt: -1 });
        res.setHeader('Content-Type', 'application/pdf');
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        const fontPath = path.join(__dirname, 'arial.ttf');
        if (fs.existsSync(fontPath)) doc.registerFont('Arial', fontPath);
        else doc.registerFont('Arial', 'Helvetica');

        if (fs.existsSync('logo.png')) doc.image('logo.png', 50, 45, { fit: [120, 60] });

        doc.font('Arial').fontSize(20).text('RELATÓRIO', 400, 55, { align: 'right' });
        doc.moveTo(50, 110).lineTo(545, 110).lineWidth(3).strokeColor('#e60000').stroke();
        
        doc.moveDown(4);
        doc.font('Arial').fontSize(10).text(`Data: ${moment().format("DD/MM/YYYY")}`);
        doc.moveDown(1);
        
        lives.forEach(l => doc.text(`${l.date} | ${l.title} | ${l.duration}`));
        doc.end();
    } catch (err) { res.status(500).send("Erro PDF"); }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando porta ${PORT}`);
    monitor();
    processarComandosTelegram();
});