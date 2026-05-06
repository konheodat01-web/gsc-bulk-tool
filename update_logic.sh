#!/bash

echo "🧠 Đang nâng cấp Siêu Agent (Fix lỗi Crash do thư viện)..."

# 1. Cài đặt các thư viện cần thiết
cd ~/seo-agent
npm install axios cheerio express body-parser dotenv google-auth-library

# 2. Tạo file agent.js HOÀN CHỈNH
cat <<EOT > agent.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

// API nhận file JSON Service Account
app.get('/update-credentials', (req, res) => {
    const { jsonContent } = req.query;
    try {
        JSON.parse(jsonContent); // Kiểm tra JSON hợp lệ
        fs.writeFileSync(path.join(__dirname, 'service-account.json'), jsonContent);
        res.json({ success: true, message: 'Đã nhận chìa khóa Google thành công!' });
    } catch (e) {
        res.json({ success: false, message: 'JSON không hợp lệ sếp ơi!' });
    }
});

// API tự động nâng cấp Agent từ xa
app.get('/update-agent', (req, res) => {
    res.json({ success: true, message: 'Agent đang tự động nâng cấp... Sếp đợi 5 giây nhé!' });
    const { exec } = require('child_process');
    exec('curl -sL https://raw.githubusercontent.com/konheodat01-web/gsc-bulk-tool/main/update_logic.sh | bash', (err) => {
        if (err) console.error('Lỗi nâng cấp:', err);
    });
});

// API nhận cấu hình và chạy audit ngay
app.get('/update-config', async (req, res) => {
    const { telegramToken, chatId, sheetUrl } = req.query;
    const content = \`TELEGRAM_TOKEN=\${telegramToken}\nCHAT_ID=\${chatId}\nSHEET_URL=\${sheetUrl}\`;
    fs.writeFileSync(path.join(__dirname, '.env'), content);
    
    process.env.TELEGRAM_TOKEN = telegramToken;
    process.env.CHAT_ID = chatId;
    process.env.SHEET_URL = sheetUrl;

    res.json({ success: true, message: 'Cấu hình OK. Agent đang xuất kích!' });
    runFullAudit();
});

app.get('/status', (req, res) => { res.json({ status: 'online', version: '4.2.0' }); });

app.listen(3000, '0.0.0.0', () => { console.log('🚀 Server listening on port 3000 (0.0.0.0)'); });

// --- LOGIC QUÉT WEB ---
async function sendTelegram(msg) {
    const token = process.env.TELEGRAM_TOKEN;
    const cid = process.env.CHAT_ID;
    if (!token || !cid) return;
    try {
        await axios.post(\`https://api.telegram.org/bot\${token}/sendMessage\`, {
            chat_id: cid, text: msg, parse_mode: 'HTML', disable_web_page_preview: true
        });
    } catch (e) { console.error('Lỗi Telegram:', e.message); }
}

async function runFullAudit() {
    const sheetUrl = process.env.SHEET_URL;
    if (!sheetUrl) return;
    try {
        const sheetId = sheetUrl.match(/\\/d\\/([^/]+)/)?.[1];
        const csvUrl = \`https://docs.google.com/spreadsheets/d/\${sheetId}/gviz/tq?tqx=out:csv\`;
        
        let headers = {};
        const credPath = path.join(__dirname, 'service-account.json');
        if (fs.existsSync(credPath)) {
            const auth = new GoogleAuth({
                keyFile: credPath,
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            });
            const client = await auth.getClient();
            const token = await client.getAccessToken();
            headers['Authorization'] = \`Bearer \${token.token}\`;
        }

        const res = await axios.get(csvUrl, { headers });
        const rows = res.data.split('\\n').slice(1).map(row => {
            return row.split(',').map(cell => cell.replace(/^"|"$/g, '').trim());
        }).filter(r => r[0]);

        await sendTelegram(\`🚀 <b>Super Agent</b> đang quét <b>\${rows.length}</b> website...\`);
        
        const results = [];
        const chunkSize = 5;
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const chunkRes = await Promise.all(chunk.map(row => auditSite(row)));
            results.push(...chunkRes);
        }
        
        await sendTelegram(\`🏁 <b>KẾT QUẢ:</b>\\n\\n\${results.join('\\n')}\`);
    } catch (e) { await sendTelegram(\`❌ <b>Lỗi:</b> \${e.message}\`); }
}

async function auditSite(row) {
    const [src, dst, adminPath, user, pass] = row;
    let status = \`🌐 <code>\${src.substring(0, 25)}</code>: \`;
    try {
        const res = await axios.get(src, { timeout: 10000, validateStatus: false });
        if (res.status === 200) {
            status += '✅ Live';
            if (user && pass) {
                const login = await verifyLogin(dst || src, user, pass);
                status += \` | Login: \${login}\`;
            }
        } else status += \`⚠️ Lỗi \${res.status}\`;
    } catch (e) { status += '❌ Chết'; }
    return status;
}

async function verifyLogin(url, user, pass) {
    const xmlrpcUrl = url.replace(/\\/$/, '') + '/xmlrpc.php';
    const body = \`<?xml version="1.0"?><methodCall><methodName>wp.getUsersBlogs</methodName><params><param><value><string>\${user}</string></value></param><param><value><string>\${pass}</string></value></param></params></methodCall>\`;
    try {
        const res = await axios.post(xmlrpcUrl, body, { timeout: 7000, headers: {'Content-Type': 'text/xml'} });
        if (res.data.includes('<struct>')) return '🔑 OK';
        if (res.data.includes('Incorrect')) return '🚫 Sai Pass';
        return '🔒 Chặn';
    } catch (e) { return '❓ Lỗi'; }
}

setInterval(runFullAudit, 6 * 60 * 60 * 1000);
EOT

# 3. Khởi chạy lại
pm2 restart seo-agent || pm2 start agent.js --name "seo-agent"
pm2 save

echo "✅ ĐÃ XONG! Đã fix lỗi Server Crash."

