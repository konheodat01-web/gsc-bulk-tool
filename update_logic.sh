#!/bash

echo "🧠 Đang nâng cấp Siêu Agent với tính năng Điều khiển từ xa..."

# 1. Cài đặt các thư viện cần thiết
cd ~/seo-agent
npm install axios cheerio p-limit express body-parser dotenv

# 2. Tạo file agent.js với tính năng "nghe lệnh" từ xa
cat <<EOT > agent.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const pLimit = require('p-limit');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// API tự động nâng cấp Agent từ xa
app.get('/update-agent', (req, res) => {
    res.json({ success: true, message: 'Agent đang tự động nâng cấp... Đợi 5 giây rồi F5 lại nhé sếp!' });
    const { exec } = require('child_process');
    exec('curl -sL https://raw.githubusercontent.com/konheodat01-web/gsc-bulk-tool/main/update_logic.sh | bash', (err) => {
        if (err) console.error('Lỗi nâng cấp:', err);
    });
});

// API nhận cấu hình và tự động chạy audit ngay lập tức
app.get('/update-config', async (req, res) => {
    const { telegramToken, chatId, sheetUrl } = req.query;
    const content = \`TELEGRAM_TOKEN=\${telegramToken}\nCHAT_ID=\${chatId}\nSHEET_URL=\${sheetUrl}\`;
    fs.writeFileSync(path.join(__dirname, '.env'), content);
    
    // Reload env
    process.env.TELEGRAM_TOKEN = telegramToken;
    process.env.CHAT_ID = chatId;
    process.env.SHEET_URL = sheetUrl;

    res.json({ success: true, message: 'Cấu hình đã được nạp. Agent đang bắt đầu quét thử ngay!' });
    
    console.log('✅ Đã nhận cấu hình. Đang chạy quét thử...');
    runFullAudit(); // Chạy luôn khi nhận cấu hình mới
});

app.get('/status', (req, res) => { res.json({ status: 'online', version: '3.0.0' }); });

app.listen(3000, () => { console.log('🚀 Control Server on port 3000'); });

// --- LOGIC AUDIT ---
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
        console.log('📡 Đang lấy dữ liệu từ Sheet...');
        const sheetId = sheetUrl.match(/\\/d\\/([^/]+)/)?.[1];
        const csvUrl = \`https://docs.google.com/spreadsheets/d/\${sheetId}/gviz/tq?tqx=out:csv\`;
        const res = await axios.get(csvUrl);
        
        // Parse CSV đơn giản (bỏ qua header)
        const rows = res.data.split('\\n').slice(1).map(row => {
            return row.split(',').map(cell => cell.replace(/^"|"$/g, '').trim());
        }).filter(r => r[0]); // Lấy những dòng có URL gốc

        await sendTelegram(\`🚀 <b>Super Agent</b> bắt đầu quét <b>\${rows.length}</b> website...\`);

        const limit = pLimit(5); // Chạy 5 site cùng lúc
        const results = await Promise.all(rows.map(row => limit(() => auditSite(row))));

        const summary = results.join('\\n');
        await sendTelegram(\`🏁 <b>KẾT QUẢ QUÉT ĐỊNH KỲ:</b>\\n\\n\${summary || 'Không có dữ liệu'}\`);
        console.log('✅ Đã gửi báo cáo lên Telegram.');
    } catch (e) {
        console.error('Lỗi Audit:', e.message);
        await sendTelegram(\`❌ <b>Lỗi Agent:</b> \${e.message}\`);
    }
}

async function auditSite(row) {
    const [src, dst, adminPath, user, pass] = row;
    let status = \`🌐 <code>\${src.substring(0, 30)}</code>: \`;

    try {
        const response = await axios.get(src, { timeout: 10000, validateStatus: false });
        if (response.status === 200) {
            status += '✅ Live';
            // Kiểm tra Login nếu có đủ thông tin
            if (user && pass) {
                const loginResult = await verifyLogin(dst || src, user, pass);
                status += \` | Admin: \${loginResult}\`;
            }
        } else {
            status += \`⚠️ Lỗi \${response.status}\`;
        }
    } catch (e) { status += '❌ Chết/Timeout'; }
    
    return status;
}

async function verifyLogin(url, user, pass) {
    const xmlrpcUrl = url.replace(/\\/$/, '') + '/xmlrpc.php';
    const body = \`<?xml version="1.0"?><methodCall><methodName>wp.getUsersBlogs</methodName><params><param><value><string>\${user}</string></value></param><param><value><string>\${pass}</string></value></param></params></methodCall>\`;
    
    try {
        const res = await axios.post(xmlrpcUrl, body, { timeout: 7000, headers: {'Content-Type': 'text/xml'} });
        if (res.data.includes('<struct>')) return '🔑 OK';
        if (res.data.includes('Incorrect')) return '🚫 Sai Pass';
        return '🔒 Bị chặn';
    } catch (e) { return '❓ Ko check đc'; }
}

// Chạy định kỳ mỗi 6 tiếng
setInterval(runFullAudit, 6 * 60 * 60 * 1000);
EOT

# 3. Khởi động lại bằng PM2
pm2 restart seo-agent || pm2 start agent.js --name "seo-agent"
pm2 save

echo "✅ Đã xong! Con Agent hiện đã có 'đôi tai' tại cổng 3000."
echo "Bây giờ sếp hãy dùng Tool trên trình duyệt để điều khiển nó nhé!"

