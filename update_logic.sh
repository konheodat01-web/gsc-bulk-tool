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
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// API để nhận cấu hình từ trình duyệt
app.post('/update-config', (req, res) => {
    const { telegramToken, chatId, sheetUrl } = req.body;
    const content = \`TELEGRAM_TOKEN=\${telegramToken}\nCHAT_ID=\${chatId}\nSHEET_URL=\${sheetUrl}\`;
    fs.writeFileSync(path.join(__dirname, '.env'), content);
    res.json({ success: true, message: 'Đã cập nhật cấu hình thành công!' });
    console.log('✅ Đã nhận cấu hình mới. Đang khởi động lại...');
    process.exit(0); // PM2 sẽ tự khởi động lại với cấu hình mới
});

app.get('/status', (req, res) => {
    res.json({ status: 'online', version: '2.0.0' });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(\`🚀 Server điều khiển đang chạy tại cổng \${PORT}\`);
});

// Logic Agent chính
async function main() {
    console.log('🤖 Agent đang trực chiến...');
    // ... Logic quét web sẽ nằm ở đây ...
}

setInterval(main, 3600000); // 1 tiếng check 1 lần
main();
EOT

# 3. Khởi động lại bằng PM2
pm2 restart seo-agent || pm2 start agent.js --name "seo-agent"
pm2 save

echo "✅ Đã xong! Con Agent hiện đã có 'đôi tai' tại cổng 3000."
echo "Bây giờ sếp hãy dùng Tool trên trình duyệt để điều khiển nó nhé!"

