#!/bin/bash
# =====================================================
# INSTALL WEB STATUS CHECKER - VPS Ubuntu
# Chạy lệnh: bash install-web-checker.sh
# =====================================================

set -e

INSTALL_DIR="/root/web-checker"
SERVICE_NAME="web-checker"
PORT=4001

echo "======================================"
echo " Cài đặt Web Status Checker trên VPS"
echo "======================================"

# 1. Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo "[1/5] Cài đặt Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[1/5] Node.js đã có: $(node -v)"
fi

# 2. Kiểm tra PM2
if ! command -v pm2 &> /dev/null; then
    echo "[2/5] Cài đặt PM2..."
    npm install -g pm2
else
    echo "[2/5] PM2 đã có: $(pm2 -v)"
fi

# 3. Tạo thư mục và cài thư viện
echo "[3/5] Tạo thư mục $INSTALL_DIR và cài dependencies..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Cài https-proxy-agent để dùng proxy HTTP
npm init -y > /dev/null 2>&1
npm install https-proxy-agent node-fetch@2 > /dev/null 2>&1
echo "      OK: https-proxy-agent, node-fetch"

# 4. Tạo file server.js
echo "[4/5] Tạo file server.js..."
cat > "$INSTALL_DIR/server.js" << 'EOF'
const http = require('http');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');

const PORT = process.env.WC_PORT || 4001;
const TOKEN = process.env.WC_TOKEN || '';

// Theo dõi redirect, trả về status cuối + URL đích
async function fetchWithRedirect(url, agent) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const opts = {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*',
                'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
            }
        };
        if (agent) opts.agent = agent;
        const res = await fetch(url, opts);
        return { status: String(res.status), finalUrl: res.url || url };
    } catch (e) {
        if (e.name === 'AbortError') return { status: 'TIMEOUT', finalUrl: url };
        return { status: 'ERROR: ' + e.message.substring(0, 50), finalUrl: url };
    } finally {
        clearTimeout(timeout);
    }
}

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vps-token');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Auth
    const reqToken = req.headers['x-vps-token'] || '';
    if (TOKEN && reqToken !== TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    // Endpoint: /check-web-status
    if (req.method === 'POST' && req.url === '/check-web-status') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { url, proxy } = JSON.parse(body);
                if (!url) throw new Error('Missing url');

                // Build proxy agent cho fetch qua proxy VN
                let proxyAgent = null;
                if (proxy && proxy.host && proxy.port) {
                    const auth = (proxy.user && proxy.pass) ? `${proxy.user}:${proxy.pass}@` : '';
                    proxyAgent = new HttpsProxyAgent(`http://${auth}${proxy.host}:${proxy.port}`);
                }

                // Chạy song song: direct (VPS IP ngoại) và proxy (VN)
                const [direct, proxyResult] = await Promise.all([
                    fetchWithRedirect(url, null),        // Direct = IP VPS = giả lập CLF/VPN
                    proxyAgent ? fetchWithRedirect(url, proxyAgent) : { status: 'NO_PROXY', finalUrl: url }
                ]);

                console.log(`[check] ${url} | direct=${direct.status} | proxy=${proxyResult.status}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ direct, proxy: proxyResult }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Endpoint: /ping (health check)
    if (req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Web Checker is running' }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log(`[Web Checker] Running on port ${PORT}`);
});
EOF
echo "      OK: server.js đã được tạo"

# 5. Khởi động với PM2
echo "[5/5] Khởi động service với PM2..."
pm2 stop "$SERVICE_NAME" 2>/dev/null || true
pm2 delete "$SERVICE_NAME" 2>/dev/null || true
pm2 start "$INSTALL_DIR/server.js" --name "$SERVICE_NAME" --env production
pm2 save

echo ""
echo "======================================"
echo " HOÀN TẤT! Thông tin cấu hình:"
echo "======================================"
echo " Port     : $PORT"
echo " PM2 name : $SERVICE_NAME"
echo " Endpoint : http://IP_VPS:$PORT/check-web-status"
echo ""
echo " => Trong tool: Cài đặt chung > VPS Automation"
echo "    VPS URL  = http://IP_VPS:4001"
echo "    VPS Token = (để trống hoặc đặt WC_TOKEN khi chạy PM2)"
echo "======================================"
EOF
