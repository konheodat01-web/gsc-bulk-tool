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

        // Thay vì vào trang /welcome (hay bị redirect nếu acc đã có web), ta nhảy thẳng vào trang Xác minh của chính domain đó luôn!
        await page.goto('https://search.google.com/search-console/ownership?resource_id=' + encodeURIComponent(url), { waitUntil: 'networkidle2' });
        
        if (page.url().includes('accounts.google.com')) {
            await browser.close();
            return res.status(401).json({ status: 'fail', message: `Hết phiên đăng nhập. (Path: ${userDataDir})` });
        }

        // Đợi thẻ HTML xuất hiện (vì vào link ownership là nó tự bung bảng xác minh)
        await page.waitForXPath("//div[contains(text(), 'HTML tag') or contains(text(), 'Thẻ HTML')]", { timeout: 15000 });
        const htmlTagTabs = await page.$x("//div[contains(text(), 'HTML tag') or contains(text(), 'Thẻ HTML')]");
        if (htmlTagTabs.length > 0) await htmlTagTabs[0].click();
        
        await page.waitForSelector('meta[name="google-site-verification"]', { timeout: 5000 });
        const metaTag = await page.evaluate(() => document.querySelector('meta[name="google-site-verification"]')?.outerHTML);
        await browser.close();
        return res.json({ status: 'success', metaTag });
    } catch (error) {
        if (browser) await browser.close(); return res.status(500).json({ error: true, message: error.message });
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
        const btnVerify = await page.$x("//span[contains(text(), 'Verify') or contains(text(), 'Xác minh')]");
        if (btnVerify.length > 0) await btnVerify[btnVerify.length - 1].click();
        await page.waitForTimeout(5000);
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
                const btnSubmit = await page.$x("//span[contains(text(), 'Gửi') or contains(text(), 'Submit')]");
                if (btnSubmit.length > 0) {
                    await btnSubmit[btnSubmit.length - 1].click();
                    await page.waitForTimeout(3000); // Đợi popup báo gửi thành công
                    // Đóng popup nếu có (Got it / OK)
                    const btnClose = await page.$x("//span[contains(text(), 'OK') or contains(text(), 'Got it')]");
                    if (btnClose.length > 0) await btnClose[btnClose.length - 1].click();
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
