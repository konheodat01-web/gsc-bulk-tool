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

// Proxy đa năng qua VPS (Thay thế allorigins và codetabs)
app.get('/proxy', async (req, res) => {
    const { url, raw } = req.query;
    if (!url) return res.status(400).send('Missing url');
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: () => true // Không ném lỗi để bắt được 404/500
        });
        
        if (raw === 'true') {
            if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
            return res.send(response.data);
        }

        // Trả về JSON giống allorigins
        res.json({
            contents: (typeof response.data === 'string' || Buffer.isBuffer(response.data)) ? response.data.toString('utf8') : '',
            status: {
                http_code: response.status,
                url: response.request?.res?.responseUrl || url
            }
        });
    } catch (e) {
        if (raw === 'true') return res.status(500).send(e.message);
        res.json({
            contents: e.message,
            status: { http_code: 500, url: url }
        });
    }
});

// API kiểm tra Login lẻ (Bypass CORS bằng VPS)
app.get('/check-login', async (req, res) => {
    const { url, adminPath, user, pass } = req.query;
    if (!url || !user || !pass) return res.json({ success: false, message: 'Thiếu thông tin' });
    try {
        const result = await verifyLogin(url, adminPath, user, pass);
        res.json({ success: true, result });
    } catch (e) {
        res.json({ success: false, result: '❓ Lỗi' });
    }
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

async function verifyLogin(url, adminPath, user, pass) {
    const baseUrl = url.replace(/\/$/, '');
    
    // 1. Thử qua XML-RPC trước (nhanh nhất)
    const xmlrpcUrl = baseUrl + '/xmlrpc.php';
    const xmlBody = \`<?xml version="1.0"?><methodCall><methodName>wp.getUsersBlogs</methodName><params><param><value><string>\${user}</string></value></param><param><value><string>\${pass}</string></value></param></params></methodCall>\`;
    
    try {
        const res = await axios.post(xmlrpcUrl, xmlBody, { timeout: 7000, headers: {'Content-Type': 'text/xml'} });
        if (res.data.includes('<struct>')) return '🔑 OK';
        if (res.data.includes('Incorrect')) return '🚫 Sai Pass';
    } catch (e) { /* Bỏ qua lỗi, chạy tiếp cách 2 */ }

    // 2. Thử Login trực tiếp qua Form POST (Dành cho web chặn XML-RPC)
    try {
        const p = adminPath || 'wp-admin';
        const loginUrl = baseUrl + '/' + (p === 'wp-admin' ? 'wp-login.php' : p);
        
        const params = new URLSearchParams();
        params.append('log', user);
        params.append('pwd', pass);
        params.append('wp-submit', 'Log In');

        const formRes = await axios.post(loginUrl, params.toString(), {
            timeout: 10000,
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            maxRedirects: 0,
            validateStatus: () => true
        });

        const setCookies = formRes.headers['set-cookie'] || [];
        const cookiesStr = setCookies.join(' ');
        
        if (cookiesStr.includes('wordpress_logged_in_')) return '🔑 OK';
        
        const html = typeof formRes.data === 'string' ? formRes.data : '';
        if (html.includes('login_error') || html.includes('Incorrect') || html.includes('Sai mật khẩu')) {
            return '🚫 Sai Pass';
        }
        
        if (formRes.status >= 300 && formRes.status < 400 && formRes.headers.location && formRes.headers.location.includes('wp-admin')) {
            return '🔑 OK';
        }
        
        return '🔒 Chặn Form';
    } catch(err) {
        return '❓ Lỗi Kết Nối';
    }
}

setInterval(runFullAudit, 6 * 60 * 60 * 1000);
EOT

# 3. Khởi chạy lại
pm2 restart seo-agent || pm2 start agent.js --name "seo-agent"
pm2 save

echo "✅ ĐÃ XONG! Đã fix lỗi Server Crash."

