const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Thư mục gốc chứa các Profile Google
const PROFILES_ROOT = './google_profiles';
if (!fs.existsSync(PROFILES_ROOT)) fs.mkdirSync(PROFILES_ROOT);

function getProfilePath(id) {
    const profileId = id || 'default';
    return PROFILES_ROOT + '/' + profileId;
}

// =====================================================================
// 1. API: /check-wp-admin
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
// 2. API KHỞI TẠO PROFILE GOOGLE
// =====================================================================
app.get('/init-profile', async (req, res) => {
    const { id } = req.query;
    const userDataDir = getProfilePath(id);
    try {
        console.log('Đang mở trình duyệt cho Profile: ' + (id || 'default'));
        const browser = await puppeteer.launch({
            headless: false,
            userDataDir: userDataDir,
            args: ['--no-sandbox']
        });
        const page = await browser.newPage();
        await page.goto('https://accounts.google.com/', { waitUntil: 'networkidle2' });
        res.json({ status: 'success', message: 'Đã mở trình duyệt cho ID: ' + (id || 'default') + '. Hãy đăng nhập và đóng cửa sổ.' });
    } catch (error) { res.status(500).json({ error: true, message: error.message }); }
});

// =====================================================================
// 3. API LẤY MÃ XÁC MINH GSC
// =====================================================================
app.post('/gsc-get-tag', async (req, res) => {
    const { url, id } = req.body;
    const userDataDir = getProfilePath(id);
    let browser = null;
    try {
        browser = await puppeteer.launch({ headless: 'new', userDataDir: userDataDir, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.goto('https://search.google.com/search-console/welcome', { waitUntil: 'networkidle2' });
        if (page.url().includes('accounts.google.com')) {
            await browser.close();
            return res.status(401).json({ status: 'fail', message: 'Hết phiên đăng nhập.' });
        }
        await page.waitForSelector('input[type="url"]', { timeout: 10000 });
        await page.type('input[type="url"]', url);
        await page.keyboard.press('Enter');
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
app.post('/gsc-click-verify', async (req, res) => {
    const { url, id } = req.body;
    const userDataDir = getProfilePath(id);
    let browser = null;
    try {
        browser = await puppeteer.launch({ headless: 'new', userDataDir: userDataDir, args: ['--no-sandbox'] });
        const page = await browser.newPage();
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

const PORT = 3000;
app.listen(PORT, () => console.log('VPS API đang chạy tại http://localhost:' + PORT));
