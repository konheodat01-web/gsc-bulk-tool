const express = require('express');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const http = require('http');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Kích hoạt plugin ngụy trang
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const path = require('path');
const PROFILES_ROOT = path.join(__dirname, 'google_profiles');
if (!fs.existsSync(PROFILES_ROOT)) fs.mkdirSync(PROFILES_ROOT);

function getProfilePath(id) {
    const profileId = id || 'default';
    return PROFILES_ROOT + '/' + profileId;
}

const os = require('os');
function getChromeExecutablePath() {
    if (os.platform() === 'win32') {
        const paths = [
            'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
            'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
            (process.env.LOCALAPPDATA || '') + '\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe'
        ];
        for (let i = 0; i < paths.length; i++) {
            if (fs.existsSync(paths[i])) return paths[i];
        }
    }
    // Dành cho Ubuntu VPS nếu sau này cài Chrome thật
    if (os.platform() === 'linux') {
        const paths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
        for (let i = 0; i < paths.length; i++) {
            if (fs.existsSync(paths[i])) return paths[i];
        }
    }
    return undefined;
}

// Cấu hình Chrome ngụy trang
const LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--ignore-certificate-errors'
];

// =====================================================================
// 1. API: /check-wp-admin
// =====================================================================
app.all('/check-wp-admin', async (req, res) => {
    const { url, username, password, basicUser, basicPass } = { ...req.query, ...(req.body || {}) };
    let browser = null;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
        const page = await browser.newPage();
        if (basicUser && basicPass) await page.authenticate({ username: basicUser, password: basicPass });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#user_login', { timeout: 5000 });
        await page.type('#user_login', username);
        await page.type('#user_pass', password);
        await Promise.all([page.click('#wp-submit'), page.waitForNavigation({ waitUntil: 'domcontentloaded' })]);
        const currentUrl = page.url(), content = await page.content();
        if (currentUrl.includes('wp-admin') || content.includes('wp-admin-bar')) {
            await browser.close(); return res.json({ status: 'success', message: 'Đúng MK' });
        } else {
            await browser.close(); return res.json({ status: 'fail', message: 'Sai MK' });
        }
    } catch (error) {
        if (browser) await browser.close(); return res.status(500).json({ error: true, message: error.message });
    }
});

// =====================================================================
// 2. API KHỞI TẠO PROFILE GOOGLE (Đã có Stealth)
// =====================================================================
app.get('/init-profile', async (req, res) => {
    const { id } = req.query;
    const userDataDir = getProfilePath(id);
    try {
        console.log('Đang mở trình duyệt ngụy trang cho ID: ' + (id || 'default'));
        const browser = await puppeteer.launch({
            executablePath: getChromeExecutablePath(),
            headless: false, // Bật giao diện để đăng nhập
            userDataDir: userDataDir,
            ignoreDefaultArgs: ['--enable-automation'],
            args: LAUNCH_ARGS
        });
        const page = await browser.newPage();
        // Xóa cờ hiệu Robot
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        await page.goto('https://accounts.google.com/', { waitUntil: 'networkidle2' });
        res.json({ status: 'success', message: 'Mở cửa sổ Chrome mới, đăng nhập và đóng lại.' });
    } catch (error) { res.status(500).json({ error: true, message: error.message }); }
});

// =====================================================================
// 3. API LẤY MÃ XÁC MINH GSC
// =====================================================================
app.all('/gsc-get-tag', async (req, res) => {
    const { url, id } = { ...req.query, ...(req.body || {}) };
    const userDataDir = getProfilePath(id);
    let browser = null;
    try {
        browser = await puppeteer.launch({ executablePath: getChromeExecutablePath(), headless: 'new', userDataDir: userDataDir, args: LAUNCH_ARGS });
        const page = await browser.newPage();
        
        // Bơm cứng cookie từ file cookies.json (nếu có) để chống Chrome Linux tự xóa cookie
        const cookiesPath = path.join(userDataDir, 'cookies.json');
        if (fs.existsSync(cookiesPath)) {
            try {
                const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
                for (let cookie of cookies) {
                    if (!cookie.url) cookie.url = (cookie.secure ? "https://" : "http://") + cookie.domain.replace(/^\./, '');
                    await page.setCookie(cookie);
                }
                console.log(`Đã bơm cứng ${cookies.length} cookie từ cookies.json vào phiên chạy.`);
            } catch (e) { console.error("Lỗi bơm cookie cứng:", e.message); }
        }

        // Ép kích thước màn hình to như PC để GSC không bị ẩn thanh Sidebar thành Menu Hamburger
        await page.setViewport({ width: 1920, height: 1080 });

        // Vào trang chủ GSC
        await page.goto('https://search.google.com/search-console', { waitUntil: 'networkidle2' });

        // Nếu bị đá ra trang login, nghĩa là Cookie đã chết!
        if (page.url().includes('accounts.google.com')) {
            await browser.close();
            return res.status(401).json({ status: 'fail', message: `Cookie đã hết hạn hoặc bị Google chặn. Vui lòng lấy Cookie mới! (Path: ${userDataDir})` });
        }

        // Xử lý trường hợp tài khoản mới toanh chưa từng dùng GSC (sẽ bị chuyển sang trang /about)
        if (page.url().includes('search-console/about')) {
            console.log("Phát hiện tài khoản mới, đang bấm nút Start Now...");
            await page.evaluate(() => {
                const iter = document.evaluate("//*[contains(text(), 'Start now') or contains(text(), 'Bắt đầu')]", document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                let node = iter.iterateNext();
                let lastNode = null;
                while (node) { lastNode = node; node = iter.iterateNext(); }
                if (lastNode) lastNode.click();
            });
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        }

        // Cố gắng tìm ô nhập URL. Nếu chưa có, ta phải click mở Dropdown chọn "Thêm tài sản"
        let inputExists = await page.$('input[type="url"]');
        if (!inputExists) {
            console.log("Đang ở Dashboard, đợi GSC load giao diện...");
            // GSC tải rất chậm, cần đợi 4s để các nút bấm được render đầy đủ
            await new Promise(r => setTimeout(r, 4000));
            
            console.log("Click mở Dropdown chọn Property...");
            await page.evaluate(() => {
                const nav = document.querySelector('nav');
                if (nav) {
                    const dropdowns = Array.from(nav.querySelectorAll('div[role="button"]'));
                    if (dropdowns.length > 0) dropdowns[0].click();
                } else {
                    const dropdowns = Array.from(document.querySelectorAll('div[role="button"][aria-haspopup="listbox"]'));
                    if (dropdowns.length > 0) dropdowns[0].click();
                }
            });
            
            // Đợi menu trượt xuống
            await new Promise(r => setTimeout(r, 2000));
            
            console.log("Click Thêm tài sản...");
            await page.evaluate(() => {
                const menuItems = document.querySelectorAll('[role="menuitem"]');
                for (let item of menuItems) {
                    if (item.textContent && (item.textContent.includes('Add property') || item.textContent.includes('Thêm tài sản'))) {
                        item.click();
                        return;
                    }
                }
            });
            
            // Đợi form Add Property bật lên
            await new Promise(r => setTimeout(r, 2000));
        }

        // Đợi ô nhập URL xuất hiện và điền domain
        await page.waitForSelector('input[type="url"]', { timeout: 10000 });
        
        // Clear input trước khi điền để tránh dính chữ cũ
        await page.click('input[type="url"]', { clickCount: 3 });
        await page.type('input[type="url"]', url);
        
        // Bấm nút Tiếp tục (Continue) thay vì chỉ ấn Enter
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('div[role="button"]');
            for (let btn of buttons) {
                if (btn.textContent && (btn.textContent.trim() === 'Continue' || btn.textContent.trim() === 'Tiếp tục')) {
                    btn.click();
                    return;
                }
            }
        });

        // Đợi thẻ HTML xuất hiện và click chọn
        // NẾU BỊ TIMEOUT Ở ĐÂY (15000ms exceeded) CÓ THỂ DO:
        // 1. Domain đã được xác minh từ trước -> Không hiện bảng mã nữa
        // 2. Mạng quá chậm
        await page.waitForFunction(() => {
            const el = document.evaluate("//div[contains(text(), 'HTML tag') or contains(text(), 'Thẻ HTML')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (el) { el.click(); return true; }
            return false;
        }, { timeout: 15000 });
        
        await page.waitForSelector('meta[name="google-site-verification"]', { timeout: 5000 });
        const metaTag = await page.evaluate(() => document.querySelector('meta[name="google-site-verification"]')?.outerHTML);
        
        await browser.close();
        if (metaTag) return res.json({ status: 'success', metaTag });
        return res.json({ status: 'fail', message: 'Không tìm thấy thẻ meta xác minh.' });
    } catch (error) {
        if (browser) {
            try {
                const pages = await browser.pages();
                if (pages.length > 0) {
                    const fs = require('fs');
                    const path = require('path');
                    // Lưu HTML để chắc cú
                    try {
                        const html = await pages[0].content();
                        fs.writeFileSync(path.join(__dirname, 'error.html'), html);
                    } catch(e) { console.error("Lỗi lấy HTML:", e.message); }
                    
                    // Chụp ảnh
                    try {
                        await pages[0].screenshot({ path: path.join(__dirname, 'error.png'), fullPage: true });
                    } catch(e) { console.error("Lỗi chụp ảnh:", e.message); }
                }
            } catch(ex) {}
            await browser.close();
        }
        return res.status(500).json({ error: true, message: error.message });
    }
});

// =====================================================================
// 4. API BẤM XÁC MINH GSC
// =====================================================================
app.all('/gsc-click-verify', async (req, res) => {
    const { url, id } = { ...req.query, ...(req.body || {}) };
    const userDataDir = getProfilePath(id);
    let browser = null;
    try {
        browser = await puppeteer.launch({ executablePath: getChromeExecutablePath(), headless: 'new', userDataDir: userDataDir, args: LAUNCH_ARGS });
        const page = await browser.newPage();
        
        const cookiesPath = path.join(userDataDir, 'cookies.json');
        if (fs.existsSync(cookiesPath)) {
            try {
                const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
                for (let cookie of cookies) {
                    if (!cookie.url) cookie.url = (cookie.secure ? "https://" : "http://") + cookie.domain.replace(/^\./, '');
                    await page.setCookie(cookie);
                }
            } catch (e) {}
        }
        
        await page.goto('https://search.google.com/search-console/ownership?resource_id=' + encodeURIComponent(url), { waitUntil: 'networkidle2' });
        await page.evaluate(() => {
            const iter = document.evaluate("//span[contains(text(), 'Verify') or contains(text(), 'Xác minh')]", document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
            let node = iter.iterateNext();
            let lastNode = null;
            while (node) { lastNode = node; node = iter.iterateNext(); }
            if (lastNode) lastNode.click();
        });
        await new Promise(r => setTimeout(r, 5000));
        const content = await page.content();
        await browser.close();
        if (content.includes('Ownership verified') || content.includes('Đã xác minh')) {
            return res.json({ status: 'success', message: 'Xác minh thành công!' });
        }
        return res.json({ status: 'fail', message: 'Lỗi xác minh.' });
    } catch (error) {
        if (browser) await browser.close(); return res.status(500).json({ error: true, message: error.message });
    }
});


// =====================================================================
// 5. API ĐĂNG NHẬP WP & CHÈN MÃ WPCODE
// =====================================================================
app.all('/wp-inject-tag', async (req, res) => {
    const { wpUrl, adminPath, user, pass, metaTag } = { ...req.query, ...(req.body || {}) };
    let browser = null;
    try {
        browser = await puppeteer.launch({ executablePath: getChromeExecutablePath(), headless: 'new', args: LAUNCH_ARGS });
        const page = await browser.newPage();
        
        // 1. Đăng nhập
        const loginUrl = wpUrl.replace(/\/$/, '') + '/' + adminPath.replace(/^\//, '');
        console.log('WP Inject - Logging into:', loginUrl);
        await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const userField = await page.$('#user_login');
        if (!userField) throw new Error('Không tìm thấy form đăng nhập WP');
        
        await page.type('#user_login', user);
        await page.type('#user_pass', pass);
        await Promise.all([
            page.click('#wp-submit'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
        ]);
        
        if (page.url().includes('wp-login.php')) {
            throw new Error('Đăng nhập WP thất bại, sai user/pass');
        }

        // 2. Tìm hoặc Cài đặt WPCode
        const installUrl = wpUrl.replace(/\/$/, '') + '/wp-admin/plugin-install.php?s=wpcode&tab=search&type=term';
        await page.goto(installUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const wpcodeCard = await page.$('.plugin-card-insert-headers-and-footers');
        if (wpcodeCard) {
            const installBtn = await wpcodeCard.$('.install-now');
            if (installBtn) {
                console.log('WP Inject - Installing WPCode...');
                await installBtn.click();
                try {
                    await page.waitForFunction(() => {
                        const btn = document.querySelector('.plugin-card-insert-headers-and-footers .activate-now');
                        return btn && btn.style.display !== 'none' && !btn.classList.contains('button-disabled');
                    }, { timeout: 60000 });
                } catch(e) {
                    throw new Error('Cài đặt WPCode quá lâu hoặc bị chặn.');
                }
            }
            
            const activateBtn = await wpcodeCard.$('.activate-now');
            if (activateBtn) {
                console.log('WP Inject - Activating WPCode...');
                await Promise.all([
                    activateBtn.click(),
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
                ]);
            }
        }
        
        // 3. Chèn Mã vào Header
        console.log('WP Inject - Inserting Meta Tag...');
        const wpcodeSettingsUrl = wpUrl.replace(/\/$/, '') + '/wp-admin/admin.php?page=wpcode-headers-footers';
        await page.goto(wpcodeSettingsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // WPCode sử dụng CodeMirror. Ta cần nhét mã vào qua JS.
        await page.evaluate((tag) => {
            const cm = document.querySelector('.CodeMirror');
            if (cm && cm.CodeMirror) {
                const currentVal = cm.CodeMirror.getValue();
                if (!currentVal.includes(tag)) {
                    cm.CodeMirror.setValue(currentVal + '\n' + tag);
                }
            } else {
                const ta = document.querySelector('textarea[name*="header"]');
                if (ta && !ta.value.includes(tag)) {
                    ta.value = ta.value + '\n' + tag;
                }
            }
            const submitBtn = document.getElementById('submit');
            if(submitBtn) submitBtn.click();
        }, metaTag);
        
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        
        await browser.close();
        return res.json({ status: 'success', message: 'Đã chèn mã xác minh vào WPCode' });
    } catch (e) {
        if (browser) await browser.close();
        return res.status(500).json({ error: true, message: e.message });
    }
});


// =====================================================================
// 6. API NẠP SITEMAP GSC
// =====================================================================
app.all('/gsc-submit-sitemap', async (req, res) => {
    const { url, id } = { ...req.query, ...(req.body || {}) };
    let { sitemaps } = { ...req.query, ...(req.body || {}) };
    if (typeof sitemaps === 'string') sitemaps = sitemaps.split(',').map(s=>s.trim()).filter(Boolean);
    const userDataDir = getProfilePath(id);
    let browser = null;
    try {
        browser = await puppeteer.launch({ executablePath: getChromeExecutablePath(), headless: 'new', userDataDir: userDataDir, args: LAUNCH_ARGS });
        const page = await browser.newPage();
        
        await page.goto('https://search.google.com/search-console/sitemaps?resource_id=' + encodeURIComponent(url), { waitUntil: 'networkidle2' });
        
        let results = [];
        for (const sitemap of sitemaps) {
            try {
                const inputSelector = 'input[type="text"][aria-label="Thêm sơ đồ trang web mới"], input[type="text"][aria-label="Add a new sitemap"]';
                await page.waitForSelector(inputSelector, { timeout: 10000 });
                
                await page.click(inputSelector, { clickCount: 3 });
                await page.type(inputSelector, sitemap);
                
                // Submit button
                const clickedSubmit = await page.evaluate(() => {
                    const iter = document.evaluate("//span[contains(text(), 'Gửi') or contains(text(), 'Submit')]", document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                    let node = iter.iterateNext();
                    let lastNode = null;
                    while (node) { lastNode = node; node = iter.iterateNext(); }
                    if (lastNode) { lastNode.click(); return true; }
                    return false;
                });
                
                if (clickedSubmit) {
                    await new Promise(r => setTimeout(r, 3000)); // Đợi popup báo gửi thành công
                    // Đóng popup nếu có (Got it / OK)
                    await page.evaluate(() => {
                        const iter = document.evaluate("//span[contains(text(), 'OK') or contains(text(), 'Got it')]", document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                        let node = iter.iterateNext();
                        let lastNode = null;
                        while (node) { lastNode = node; node = iter.iterateNext(); }
                        if (lastNode) lastNode.click();
                    });
                    results.push({ sitemap, status: 'success' });
                } else {
                    results.push({ sitemap, status: 'fail_btn' });
                }
            } catch(err) {
                results.push({ sitemap, status: 'fail_timeout' });
            }
        }
        
        await browser.close();
        return res.json({ status: 'success', results });
    } catch (e) {
        if (browser) await browser.close();
        return res.status(500).json({ error: true, message: e.message });
    }
});

const HTTP_PORT = 3002;
const HTTPS_PORT = 3001;

// API ĐỂ DEBUG: XEM ẢNH LỖI CUỐI CÙNG
app.all('/debug', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const errorImagePath = path.join(__dirname, 'error.png');
    
    if (fs.existsSync(errorImagePath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(fs.readFileSync(errorImagePath));
    } else {
        res.status(404).send('Chưa có ảnh lỗi nào được chụp lại!');
    }
});

// API ĐỂ DEBUG: XEM HTML LỖI CUỐI CÙNG
app.all('/debug-html', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const errorHtmlPath = path.join(__dirname, 'error.html');
    
    if (fs.existsSync(errorHtmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(errorHtmlPath));
    } else {
        res.status(404).send('Chưa có mã HTML lỗi nào được lưu lại!');
    }
});


// Khởi động HTTP server (port 3002)
http.createServer(app).listen(HTTP_PORT, () => console.log('VPS API chạy HTTP tại port ' + HTTP_PORT));

// Khởi động HTTPS server (port 3000) với self-signed cert
try {
    const certPath = __dirname + '/ssl/cert.pem';
    const keyPath  = __dirname + '/ssl/key.pem';
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        const httpsOptions = {
            key:  fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => console.log('VPS API chạy HTTPS tại port ' + HTTPS_PORT));
    } else {
        console.log('Chưa có SSL cert. Chạy: npm run gen-ssl để tạo cert tự ký.');
    }
} catch(e) {
    console.error('Không thể khởi động HTTPS server:', e.message);
}
