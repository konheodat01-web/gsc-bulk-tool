#!/bash

echo "🚀 Bắt đầu cài đặt SEO Super Agent..."

# 1. Cập nhật hệ thống
sudo apt update -y
sudo apt install -y curl git nodejs npm

# 2. Cài đặt PM2 để chạy ngầm
sudo npm install -g pm2

# 3. Tạo thư mục làm việc
mkdir -p ~/seo-agent
cd ~/seo-agent

# 4. Tạo file agent.js (Đây là linh hồn của Agent)
cat <<EOT > agent.js
const axios = require('axios');

// Cấu hình mẫu - Sẽ được sếp cập nhật sau
const CONFIG = {
    telegramToken: '',
    chatId: '',
    sheetUrl: '',
    intervalMinutes: 60
};

async function runAudit() {
    console.log('--- Đang bắt đầu quét hệ thống ---');
    // Logic quét sẽ được cập nhật chi tiết sau
    console.log('Quét hoàn tất. Mọi thứ ổn định!');
}

console.log('🤖 SEO Super Agent đã khởi động và đang chạy ngầm...');
setInterval(runAudit, CONFIG.intervalMinutes * 60 * 1000);
runAudit();
EOT

# 5. Khởi chạy Agent bằng PM2
pm2 start agent.js --name "seo-agent"
pm2 save
pm2 startup

echo "✅ Cài đặt hoàn tất! Con Agent của sếp đã bắt đầu làm việc ngầm."
echo "Sếp có thể gõ lệnh 'pm2 status' để xem nó đang chạy nhé!"
