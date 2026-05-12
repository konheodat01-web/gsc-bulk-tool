const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
// const proxyChain = require('proxy-chain');

const app = express();
app.use(cors());
app.use(express.json());

// Thư mục lưu Profile Google trên VPS
const USER_DATA_DIR = './google_profile';

// =====================================================================
// 1. API: /check-wp-admin (Cũ)
// =====================================================================
app.post('/check-wp-admin', async (req, res) => {
    const { url, username, password, basicUser, basicPass } = req.body;
    if (!url || !username || !password) return res.status(400).json({ error: 'Thiếu đầu vào' });
    let browser = null;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
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
// 2. API KHỞI TẠO PROFILE GOOGLE (Chỉ chạy 1 lần)
// =====================================================================
app.get('/init-profile', async (req, res) => {
    try {
        console.log("Đang mở trình duyệt để bạn đăng nhập Google...");
        const browser = await puppeteer.launch({
            headless: false, // Hiện giao diện
            userDataDir: USER_DATA_DIR,
            args: ['--no-sandbox']
        });
        const page = await browser.newPage();
        await page.goto('https://accounts.google.com/', { waitUntil: 'networkidle2' });
        res.json({ status: 'success', message: 'Mở VPS và đăng nhập trên Chrome. Sau đó đóng cửa sổ.' });
    } catch (error) { res.status(500).json({ error: true, message: error.message }); }
});

// =====================================================================
// 3. API LẤY MÃ XÁC MINH GSC
// =====================================================================
app.post('/gsc-get-tag', async (req, res) => {
    const { url } = req.body;
    let browser = null;
    try {
        browser = await puppeteer.launch({ headless: 'new', userDataDir: USER_DATA_DIR, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.goto('https://search.google.com/search-console/welcome', { waitUntil: 'networkidle2' });
        await page.waitForSelector('input[type="url"]', { timeout: 10000 });
        await page.type('input[type="url"]', url);
        await page.keyboard.press('Enter');
        await page.waitForXPath("//div[contains(text(), 'HTML tag') or contains(text(), 'Thẻ HTML')]", { timeout: 15000 });
        const htmlTagTabs = await page.$x("//div[contains(text(), 'HTML tag') or contains(text(), 'Thẻ HTML')]");
        if (htmlTagTabs.length > 0) await htmlTagTabs[0].click();
        await page.waitForSelector('meta[name="google-site-verification"]', { timeout: 5000 });
        const metaTag = await page.evaluate(() => document.querySelector('meta[name="google-site-verification"]')?.outerHTML);
        await browser.close();
        if (metaTag) return res.json({ status: 'success', metaTag });
        return res.status(400).json({ status: 'fail', message: 'Không lấy được Meta Tag' });
    } catch (error) {
        if (browser) await browser.close(); return res.status(500).json({ error: true, message: error.message });
    }
});

// =====================================================================
// 4. API BẤM XÁC MINH GSC
// =====================================================================
app.post('/gsc-click-verify', async (req, res) => {
    const { url } = req.body;
    let browser = null;
    try {
        browser = await puppeteer.launch({ headless: 'new', userDataDir: USER_DATA_DIR, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.goto(\`https://search.google.com/search-console/ownership?resource_id=\${encodeURIComponent(url)}\`, { waitUntil: 'networkidle2' });
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

const PORT = 3000;
app.listen(PORT, () => console.log(\`VPS API đang chạy tại http://localhost:\${PORT}\`));
