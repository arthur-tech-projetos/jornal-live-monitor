const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());

// ==========================================
// CONFIGURAÇÕES
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

// ==========================================
// MODELOS
// ==========================================
const Alerta = mongoose.model('Alerta', new mongoose.Schema({ id: String, type: String, title: String, detail: String, time: String, createdAt: { type: Date, default: Date.now } }));
const LivePassada = mongoose.model('LivePassada', new mongoose.Schema({ id: String, title: String, date: String, startTime: String, endTime: String, duration: String, createdAt: { type: Date, default: Date.now } }));

// ==========================================
// ROTA PDF (ARIAL)
// ==========================================
app.get('/api/report/pdf', async (req, res) => {
    try {
        const todasAsLives = await LivePassada.find().sort({ createdAt: -1 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=relatorio_radio_jornal.pdf');

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        // Registro da fonte Arial
        doc.registerFont('Arial', 'arial.ttf'); 

        // Logo
        if (fs.existsSync('logo.png')) {
            doc.image('logo.png', 50, 45, { fit: [120, 60] });
        }

        // Cabeçalho
        doc.font('Arial').fontSize(20).fillColor('#555555').text('RELATÓRIO', 400, 55, { align: 'right' });
        doc.moveTo(50, 110).lineTo(545, 110).lineWidth(3).strokeColor('#e60000').stroke();

        // Informações
        doc.moveDown(4);
        doc.font('Arial').fontSize(10).fillColor('#000000').text(`Documento: Relatório Oficial de Monitoramento`);
        doc.text(`Data de Emissão: ${moment().tz("America/Fortaleza").format("DD/MM/YYYY [às] HH:mm")}`);
        doc.moveDown(1);

        // Tabela
        doc.font('Arial').fontSize(9).fillColor('#333333');
        doc.text('DATA', 50, 200);
        doc.text('TÍTULO DA TRANSMISSÃO', 120, 200);
        doc.text('INÍCIO', 380, 200);
        doc.text('DURAÇÃO', 480, 200);
        doc.moveTo(50, 215).lineTo(545, 215).lineWidth(1).stroke('#000');

        let y = 230;
        todasAsLives.forEach((live) => {
            if (y > 700) { doc.addPage(); y = 50; }
            doc.text(live.date, 50, y);
            doc.text(live.title.length > 40 ? live.title.substring(0, 38) + "..." : live.title, 120, y);
            doc.text(live.startTime, 380, y);
            doc.text(live.duration, 480, y);
            y += 20;
        });

        doc.end();
    } catch (err) {
        res.status(500).send("Erro ao gerar PDF.");
    }
});

// ... (Aqui você mantém as funções monitor(), processarComandosTelegram() e as rotas app.get('/api/status')...)
// O restante do código permanece igual ao que já estava funcionando.

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    processarComandosTelegram();
});