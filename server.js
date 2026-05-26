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

// Força o fuso horário para Teresina
moment.tz.setDefault("America/Fortaleza");

// ==========================================
// CONFIGURAÇÕES E CONEXÃO COM O BANCO
// ==========================================
const API_KEY = 'AIzaSyDZ6OzN-CDu2J0lMWpG0qsADvNWvlfIQoc'; 
const CHANNEL_ID = 'UCEXZddw6rp2Nu76ibj9e8SQ';
const TELEGRAM_TOKEN = '8881818050:AAFZSOn231TQXWiuvyfJX_xq7LIjrbhStlA'; // Token limpo confirmado!
const TELEGRAM_CHAT_ID = '-1003937290720';

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
    id: String, type: String, title: String, detail: String, time: String, createdAt: { type: Date, default: Date.now }
});
const Alerta = mongoose.model('Alerta', AlertaSchema);

const LivePassadaSchema = new mongoose.Schema({
    id: String, title: String, date: String, startTime: String, endTime: String, duration: String, createdAt: { type: Date, default: Date.now }
});
const LivePassada = mongoose.model('LivePassada', LivePassadaSchema);

// ==========================================
// FUNÇÕES DE TELEGRAM E LOGS
// ==========================================
async function enviarTelegramComFoto(photoUrl, msg) {
    if (!TELEGRAM_TOKEN) return;
    try {
        if (photoUrl) {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, { chat_id: TELEGRAM_CHAT_ID, photo: photoUrl, caption: msg, parse_mode: 'HTML' });
        } else {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' });
        }
    } catch (e) { 
        console.error("Erro ao enviar para o Telegram:", e.message); 
    }
}

async function registrarEventoGlobal(id, tipo, titulo, detalhe, enviarProTelegram = true) {
    try {
        await Alerta.create({ id, type: tipo, title: titulo, detail: detalhe, time: moment().format("HH:mm") });
        const totalAlertas = await Alerta.countDocuments();
        if (totalAlertas > 100) {
            const maisAntigo = await Alerta.findOne().sort({ createdAt: 1 });
            if (maisAntigo) await Alerta.deleteOne({ _id: maisAntigo._id });
        }
    } catch (dbErr) { console.error("Falha ao salvar log no banco:", dbErr.message); }

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
                let statusMsg = `📊 <b>CENTRAL DE COMANDO - ARTHUR TECH</b>\n\n🖥️ <b>API Status:</b> ONLINE 🟢\n🕒 <b>Horário Local:</b> ${moment().format("HH:mm:ss")}\n\n`;
                if (currentLives.length === 0) {
                    statusMsg += `⚪ <b>Transmissão Atual:</b> Nenhuma live ativa no momento. Em modo de espera.`;
                } else {
                    statusMsg += `🚨 <b>TRANSMISSÃO AO VIVO DETECTADA:</b>\n`;
                    currentLives.forEach(l => {
                        statusMsg += `📺 <b>Título:</b> ${l.title}\n⏱️ <b>Iniciada às:</b> ${l.startTime}\n🔗 <a href="https://youtube.com/watch?v=${l.id}">Assistir no YouTube</a>\n`;
                    });
                }
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: statusMsg, parse_mode: 'HTML' });
            }
            else if (text === '/logs') {
                const ultimosAlertas = await Alerta.find().sort({ createdAt: -1 }).limit(5);
                let logsMsg = `📋 <b>ÚLTIMOS 5 ALERTAS DO SISTEMA:</b>\n\n`;
                if (ultimosAlertas.length === 0) logsMsg += `ℹ️ Nenhum log registrado até o momento.`;
                else {
                    ultimosAlertas.forEach((a, index) => {
                        let iconeLog = a.type === "warning" ? "⚠️" : (a.type === "alert" ? "🚨" : "🔄");
                        logsMsg += `${index + 1}. ${iconeLog} [${a.time}] <b>${a.title}</b>\n└ <i>${a.detail}</i>\n\n`;
                    });
                }
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: logsMsg, parse_mode: 'HTML' });
            }
        }
    } catch (e) {
        if (e.response && e.response.status === 409) console.log("Aguardando instância antiga do Telegram encerrar...");
        else console.error("Erro ao processar comandos do Telegram:", e.message);
    }
    setTimeout(processarComandosTelegram, 4000);
}

// ==========================================
// MOTOR INTELIGENTE DE BUSCA YOUTUBE
// ==========================================
async function monitor() {
    try {
        if (currentLives.length > 0) {
            for (let i = currentLives.length - 1; i >= 0; i--) {
                const videoId = currentLives[i].id;
                const res = await axios.get(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`);
                const item = res.data.items[0];

                if (!item || item.snippet.liveBroadcastContent !== 'live') {
                    const liveTitle = currentLives[i].title;
                    const startTimeRaw = moment(currentLives[i].startTimeRaw);
                    const endTime = moment();
                    const durationMinutes = endTime.diff(startTimeRaw, 'minutes');
                    const formattedDuration = durationMinutes > 0 ? `${durationMinutes} minutos` : "Menos de 1 minuto";

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
            const res = await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`);
            const lives = res.data.items || [];
            
            for (const item of lives) {
                const videoId = item.id.videoId;
                const title = item.snippet.title;
                const thumbnailUrl = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '';
                const nowTime = moment();

                if (!lastKnownLiveIds.has(videoId)) {
                    console.log(`Nova Live detectada: ${title}`);
                    const mensagem = `🚨 <b>RÁDIO JORNAL AO VIVO</b>\n\n📺 <b>${title}</b>\n\n🔗 <a href="https://youtube.com/watch?v=${videoId}">Clique aqui para assistir</a>`;
                    await enviarTelegramComFoto(thumbnailUrl, mensagem);
                    await registrarEventoGlobal(videoId, 'alert', 'Nova Live Iniciada', title, false);
                    lastKnownLiveIds.add(videoId);
                }
                
                currentLives.push({ id: videoId, title: title, isLive: true, startTime: nowTime.format("HH:mm"), startTimeRaw: nowTime.toISOString() });
            }

            const currentIds = new Set(lives.map(l => l.id.videoId));
            lastKnownLiveIds = new Set([...lastKnownLiveIds].filter(id => currentIds.has(id)));
        }
        erro429Notificado = false;

    } catch (err) { 
        if (err.response && err.response.status === 429) {
            if (!erro429Notificado) {
                await registrarEventoGlobal('erro-429', 'warning', 'Aviso de Limite da API', 'Limite do YouTube atingido.', true);
                erro429Notificado = true; 
            }
        } else console.error("Erro na API do YouTube:", err.message); 
    }
}

// ==========================================
// ROTAS DA API
// ==========================================
app.get('/api/status', async (req, res) => {
    try {
        const dbAlerts = await Alerta.find().sort({ createdAt: -1 }).limit(30);
        const dbPastLives = await LivePassada.find().sort({ createdAt: -1 }).limit(30);
        res.json({ lives: currentLives, pastLives: dbPastLives, alerts: dbAlerts, time: moment().format("HH:mm"), apiStatus: "ONLINE" });
    } catch (err) { res.status(500).json({ error: "Erro banco" }); }
});

app.get('/api/report/download', async (req, res) => {
    // Mantida a sua rota CSV inalterada
    try {
        const todasAsLives = await LivePassada.find().sort({ createdAt: -1 });
        let csvContent = "\uFEFFData;Titulo do Programa;Horario de Inicio;Horario de Termino;Duracao Total\n";
        if (todasAsLives.length === 0) csvContent += "---;Nenhuma transmissão;---;---;---\n";
        else {
            todasAsLives.forEach(live => {
                const cleanTitle = live.title.replace(/;/g, ' ').replace(/\n/g, ' ');
                csvContent += `${live.date};${cleanTitle};${live.startTime};${live.endTime};${live.duration}\n`;
            });
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=relatorio.csv');
        res.status(200).send(csvContent);
    } catch (err) { res.status(500).send("Erro CSV."); }
});

// ==========================================
// ROTA PDF (DESENHADA EXATAMENTE COMO O SEU MODELO)
// ==========================================
app.get('/api/report/pdf', async (req, res) => {
    try {
        const todasAsLives = await LivePassada.find().sort({ createdAt: -1 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=relatorio_radio_jornal.pdf');

        // bufferPages permite criar o rodapé depois que todas as páginas estão prontas
        const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
        doc.pipe(res);

        // 1. CARREGA A FONTE ARIAL
        const fontPath = path.join(__dirname, 'arial.ttf');
        if (fs.existsSync(fontPath)) {
            doc.registerFont('Arial', fontPath);
            doc.registerFont('Arial-Bold', fontPath); 
        } else {
            doc.registerFont('Arial', 'Helvetica');
            doc.registerFont('Arial-Bold', 'Helvetica-Bold');
        }

        // 2. LOGO E CABEÇALHO
        if (fs.existsSync('logo.png')) doc.image('logo.png', 50, 40, { width: 120 });
        
        doc.font('Arial-Bold').fontSize(18).fillColor('#555555').text('RELATÓRIO', 400, 55, { align: 'right' });
        
        // A linha vermelha
        doc.moveTo(50, 95).lineTo(545, 95).lineWidth(2).strokeColor('#e60000').stroke();

        // 3. SEÇÃO DE INFORMAÇÕES
        const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        const hoje = moment();
        const dataFormatada = `${hoje.format('DD')} de ${meses[hoje.month()]} de ${hoje.format('YYYY')} às ${hoje.format('HH:mm')}`;

        doc.moveDown(3);
        doc.font('Arial-Bold').fontSize(10).fillColor('#000000').text('Documento: ', { continued: true }).font('Arial').text('Relatório Oficial de Monitoramento de Grade (YouTube)');
        doc.font('Arial-Bold').text('Gerado em: ', { continued: true }).font('Arial').text(dataFormatada);
        doc.font('Arial-Bold').text('Emissora: ', { continued: true }).font('Arial').text('Rádio Jornal Meio Norte - Teresina, Piauí');
        doc.moveDown(2);

        // 4. CABEÇALHO DA TABELA (COM INÍCIO E TÉRMINO)
        let y = doc.y;
        doc.rect(50, y - 5, 495, 20).fill('#f2f2f2');
        doc.font('Arial-Bold').fontSize(9).fillColor('#000000');
        doc.text('DATA', 55, y);
        doc.text('TÍTULO DA TRANSMISSÃO', 120, y);
        doc.text('INÍCIO', 350, y);
        doc.text('TÉRMINO', 410, y);
        doc.text('DURAÇÃO', 480, y);
        doc.moveTo(50, y + 15).lineTo(545, y + 15).lineWidth(1).strokeColor('#cccccc').stroke();

        y += 25;
        doc.font('Arial').fontSize(9).fillColor('#333333');

        // 5. PREENCHENDO A TABELA
        todasAsLives.forEach((live, i) => {
            if (y > 720) { doc.addPage(); y = 50; }
            if (i % 2 !== 0) doc.rect(50, y - 5, 495, 20).fill('#fafafa'); // Efeito zebrado sutil

            doc.fillColor('#333333');
            doc.text(live.date, 55, y);
            // Corta o título se for muito longo para não quebrar a tabela
            const tituloCurto = live.title.length > 40 ? live.title.substring(0, 38) + "..." : live.title;
            doc.text(tituloCurto, 120, y);
            doc.text(live.startTime, 350, y);
            doc.text(live.endTime, 410, y); // Agora com a coluna de término que você queria
            doc.text(live.duration, 480, y);
            
            doc.moveTo(50, y + 15).lineTo(545, y + 15).lineWidth(0.5).strokeColor('#eeeeee').stroke();
            y += 25;
        });

        // 6. RODAPÉ (Adiciona em todas as páginas)
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            doc.font('Arial').fontSize(8).fillColor('#888888');
            doc.text('Gerado pelo Sistema Arthur Tech', 50, 780);
            doc.text(`Página ${i + 1} de ${pages.count}`, 450, 780, { align: 'right' });
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
    registrarEventoGlobal('startup-' + Date.now(), 'idle', 'Monitoramento Online!', 'O sistema da Rádio Jornal foi iniciado com sucesso.', true);
    monitor();
    processarComandosTelegram(); 
});