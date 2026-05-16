const express = require('express');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const http = require('http');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { connect } = require('puppeteer-real-browser');

// Kích hoạt plugin ngụy trang
puppeteer.use(StealthPlugin());

async function launchRealBrowser(proxy) {
    const options = {
        headless: false,
        turnstile: true,
        executablePath: getChromeExecutablePath(),
        customConfig: {
            executablePath: getChromeExecutablePath()
        },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    };
    if (proxy && proxy.host && proxy.port) {
        options.proxy = {
            host: proxy.host,
            port: parseInt(proxy.port),
            username: proxy.user || '',
            password: proxy.pass || ''
        };
    }
    return await connect(options);
}

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
function getLaunchArgs(proxy) {
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--ignore-certificate-errors'
    ];
    if (proxy && proxy.host && proxy.port) {
        args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
    }
    return args;
}

// =====================================================================
// 1. API: /check-wp-admin
// =====================================================================
app.all('/check-wp-admin', async (req, res) => {
    const { url, username, password, basicUser, basicPass, proxy } = { ...req.query, ...(req.body || {}) };
    let browser = null;
    let page = null;
    try {
        const rb = await launchRealBrowser(proxy);
        browser = rb.browser;
        page = rb.page;
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
        await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });
        res.json({ status: 'success', message: 'Mở cửa sổ Chrome mới, đăng nhập và đóng lại.' });
    } catch (error) { res.status(500).json({ error: true, message: error.message }); }
});

// =====================================================================
// 2.5 API CẬP NHẬT COOKIE TỪ WEB UI
// =====================================================================
app.post('/update-cookie', (req, res) => {
    const { id, cookieData } = req.body;
    if (!id || !cookieData) return res.status(400).json({ status: 'fail', message: 'Thiếu tham số id hoặc cookieData' });
    
    try {
        let parsedCookie;
        try {
            parsedCookie = JSON.parse(cookieData);
            if (!Array.isArray(parsedCookie)) throw new Error("Cookie phải là một Array JSON");
        } catch (err) {
            return res.status(400).json({ status: 'fail', message: 'Dữ liệu Cookie không hợp lệ (phải là chuẩn JSON Array)' });
        }
        
        const userDataDir = getProfilePath(id);
        const cookiesPath = path.join(userDataDir, 'cookies.json');
        
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        
        fs.writeFileSync(cookiesPath, JSON.stringify(parsedCookie, null, 2));
        
        res.json({ status: 'success', message: `Đã cập nhật ${parsedCookie.length} cookie cho tài khoản ${id} thành công!` });
    } catch (err) {
        res.status(500).json({ status: 'fail', message: 'Lỗi ghi file cookie: ' + err.message });
    }
});

// =====================================================================
// 3. API LẤY MÃ XÁC MINH GSC
// =====================================================================
app.all('/gsc-get-tag', async (req, res) => {
    const { url, id, proxy } = { ...req.query, ...(req.body || {}) };
    const logPath = path.join(__dirname, 'debug_status.txt');
    const logStep = (msg) => { try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`); } catch(e){} };
    
    const userDataDir = getProfilePath(id);
    let browser = null;
    try {
        logStep(`=== Bắt đầu: ${url} ===`);
        browser = await puppeteer.launch({ executablePath: getChromeExecutablePath(), headless: false, userDataDir: userDataDir, args: getLaunchArgs() });
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
        await page.goto('https://search.google.com/search-console', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 4000)); // Nghỉ thêm 4s cho React render xong

        logStep(`Kiểm tra auth... URL hiện tại: ${page.url()}`);
        if (page.url().includes('accounts.google.com')) {
            logStep(`Bị đá ra login. Đứng chờ sếp đăng nhập tay 5 phút...`);
            console.log("Đang chờ bạn đăng nhập thủ công trên trình duyệt (Tối đa 5 phút)...");
            await page.waitForFunction(() => !window.location.href.includes('accounts.google.com'), { timeout: 300000 }).catch(() => {});
            if (page.url().includes('accounts.google.com')) {
                await browser.close();
                return res.status(401).json({ status: 'fail', message: `Quá thời gian đăng nhập. Vui lòng chạy lại!` });
            }
        }

        // Xử lý trường hợp tài khoản mới toanh chưa từng dùng GSC (sẽ bị chuyển sang trang /about)
        if (page.url().includes('search-console/about')) {
            logStep(`Phát hiện tài khoản mới ở trang /about, tìm nút Start Now...`);
            console.log("Phát hiện tài khoản mới, đang bấm nút Start Now...");
            await page.evaluate(() => {
                const iter = document.evaluate("//*[contains(text(), 'Start now') or contains(text(), 'Bắt đầu')]", document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                let node = iter.iterateNext();
                let lastNode = null;
                while (node) { lastNode = node; node = iter.iterateNext(); }
                if (lastNode) {
                    lastNode.removeAttribute('target');
                    lastNode.click();
                }
            });
            logStep(`Đã bấm Start Now, đợi chuyển trang...`);
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            
            if (page.url().includes('accounts.google.com')) {
                logStep(`Bị đá ra login sau khi bấm Start Now. Đứng chờ sếp đăng nhập...`);
                console.log("Đang chờ bạn đăng nhập thủ công trên trình duyệt (Tối đa 5 phút)...");
                await page.waitForFunction(() => !window.location.href.includes('accounts.google.com'), { timeout: 300000 }).catch(() => {});
                if (page.url().includes('accounts.google.com')) {
                    await browser.close();
                    return res.status(401).json({ status: 'fail', message: `Quá thời gian đăng nhập. Vui lòng chạy lại!` });
                }
            }
        }

        logStep(`Kiểm tra ô nhập URL...`);
        // Kiểm tra xem bảng "Thêm tài sản" đã mở sẵn chưa (có chữ URL prefix / Tiền tố URL không)
        let modalOpen = await page.evaluate(() => {
            const iter = document.evaluate("//*[contains(text(), 'URL prefix') or contains(text(), 'Tiền tố URL')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return iter.singleNodeValue != null;
        });
        
        if (!modalOpen) {
            logStep(`Bảng Thêm tài sản chưa mở, đợi GSC load 4s...`);
            console.log("Đang ở Dashboard, đợi GSC load giao diện...");
            await new Promise(r => setTimeout(r, 4000));
            
            logStep(`Mở Dropdown (Tự động thử lại nếu React chưa load)...`);
            console.log("Click mở Dropdown chọn Property...");
            await page.evaluate(async () => {
                const visualClick = (el) => {
                    try {
                        const rect = el.getBoundingClientRect();
                        const bubble = document.createElement('div');
                        bubble.style.position = 'fixed';
                        bubble.style.left = (rect.left + rect.width/2 - 15) + 'px';
                        bubble.style.top = (rect.top + rect.height/2 - 15) + 'px';
                        bubble.style.width = '30px';
                        bubble.style.height = '30px';
                        bubble.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
                        bubble.style.border = '2px solid red';
                        bubble.style.borderRadius = '50%';
                        bubble.style.zIndex = '999999';
                        bubble.style.pointerEvents = 'none';
                        bubble.style.transition = 'all 0.5s ease-out';
                        document.body.appendChild(bubble);
                        setTimeout(() => { bubble.style.transform = 'scale(3)'; bubble.style.opacity = '0'; }, 50);
                        setTimeout(() => { bubble.remove(); }, 600);
                        el.click();
                    } catch(e) { el.click(); }
                };

                const delay = ms => new Promise(res => setTimeout(res, ms));
                for (let i = 0; i < 5; i++) {
                    // Cố gắng tìm dropdown (Tìm tất cả các div/button có role button)
                    const dropdowns = Array.from(document.querySelectorAll('div[role="button"], button'));
                    let targetD = null;
                    for (let d of dropdowns) {
                        const txt = (d.textContent || '').trim().toLowerCase();
                        // Nút Dropdown tài sản thường có chứa http, dấu chấm, hoặc chữ "tài sản", "property"
                        if (txt.includes('http') || txt.includes('.') || txt.includes('property') || txt.includes('tài sản') || txt.includes('sản phẩm')) {
                            // BỎ QUA thanh tìm kiếm (Search bar)
                            if (txt.includes('kiểm tra mọi') || txt.includes('inspect any')) continue;
                            
                            // Tránh bấm nhầm vào Nút "Thêm tài sản" ở trong dropdown khác nếu có
                            if (!txt.includes('add') && !txt.includes('thêm')) {
                                targetD = d; break;
                            }
                        }
                    }
                    if (!targetD) {
                        // Fallback: Tìm aria-haspopup
                        const popupBtns = Array.from(document.querySelectorAll('div[role="button"][aria-haspopup="listbox"]'));
                        if (popupBtns.length > 0) targetD = popupBtns[0];
                    }
                    
                    if (targetD) visualClick(targetD);
                    
                    // Chờ 1.5s
                    await delay(1500);
                    
                    // Kiểm tra xem menu "Thêm tài sản" đã mở chưa
                    const spans = document.querySelectorAll('span, div');
                    let foundMenu = false;
                    for (let el of spans) {
                        if (el.children.length === 0) {
                            const txt = el.textContent ? el.textContent.trim().toLowerCase() : '';
                            if (txt === 'add property' || txt === 'thêm tài sản') {
                                foundMenu = true;
                                let clickable = el.closest('[role="option"]') || el.closest('[role="menuitem"]') || el.closest('div[jsaction]') || el.closest('div[role="button"]') || el;
                                visualClick(clickable);
                                break;
                            }
                        }
                    }
                    if (foundMenu) return; // Đã tìm thấy và click Thêm tài sản, thoát loop
                }
            });
            
            logStep(`Đợi 2s form Add property hiện`);
            await new Promise(r => setTimeout(r, 2000));
        }

        logStep(`Đợi input[type=url] hoặc ô nhập text 10s`);
        // Đợi ô nhập URL xuất hiện và điền domain
        await page.waitForFunction(() => {
            const node = document.evaluate("//*[contains(text(), 'URL prefix') or contains(text(), 'Tiền tố URL')]/following::input[1]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (node) return true;
            // Fallback: nếu có nhiều hơn 1 ô input URL thì lấy ô cuối
            if (document.querySelectorAll('input[type="url"]').length > 1) return true;
            return false;
        }, { timeout: 10000 });
        
        logStep(`Chuyển sang tab URL Prefix`);
        await page.evaluate(() => {
            // Tìm tab Tiền tố URL (URL Prefix) và click nó để kích hoạt
            const iter = document.evaluate("//div[@role='tab']//span[contains(text(), 'URL prefix') or contains(text(), 'Tiền tố URL')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const tabNode = iter.singleNodeValue;
            if (tabNode) {
                const clickableTab = tabNode.closest('div[role="tab"]');
                if (clickableTab) clickableTab.click();
            }
        });
        await new Promise(r => setTimeout(r, 500)); // Đợi tab chuyển
        
        logStep(`Clear input`);
        // Tìm selector chính xác của ô nhập
        const inputSelector = await page.evaluate(() => {
            const node = document.evaluate("//*[contains(text(), 'URL prefix') or contains(text(), 'Tiền tố URL')]/following::input[1]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (node) { 
                node.id = 'puppeteer-target-input'; 
                node.value = ''; // Xóa sạch dữ liệu cũ
                return '#puppeteer-target-input'; 
            }
            // Fallback
            const urlInputs = document.querySelectorAll('input[type="url"]');
            if (urlInputs.length > 0) {
                const target = urlInputs[urlInputs.length - 1]; // Lấy cái cuối cùng (thường là trong modal)
                target.id = 'puppeteer-target-input';
                target.value = '';
                return '#puppeteer-target-input';
            }
            return 'input[type="url"]';
        });

        await new Promise(r => setTimeout(r, 500));
        
        logStep(`Click & Gõ URL: ${url}`);
        await page.click(inputSelector, { clickCount: 3 }).catch(()=>{});
        await page.type(inputSelector, url);
        
        logStep(`Ấn Enter để Tiếp tục`);
        // Ấn Enter trực tiếp từ ô input thay vì cố tìm nút Continue (vì có 2 nút Continue trên màn hình)
        await page.keyboard.press('Enter');

        logStep(`Đợi Thẻ HTML hoặc Auto-verified 15s`);
        // Đợi thẻ HTML xuất hiện HOẶC thông báo đã xác minh tự động
        await page.waitForFunction(() => {
            // Kiểm tra xem có Thẻ HTML không
            const el = document.evaluate("//*[text()='HTML tag' or text()='Thẻ HTML']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (el) { 
                const clickable = el.closest('[role="button"]') || el.closest('[jsaction]') || el.closest('div.F93BIf') || el;
                clickable.click(); 
                return true; 
            }
            
            // Kiểm tra xem đã xác minh tự động chưa
            const elements = Array.from(document.querySelectorAll('*'));
            for (let e of elements) {
                if (e.textContent) {
                    const txt = e.textContent.toLowerCase();
                    if (txt.includes('tự động xác minh') || txt.includes('auto verified') || txt.includes('đã được xác minh') || txt.includes('đã tự động xác minh')) {
                        return true;
                    }
                }
            }
            return false;
        }, { timeout: 15000 });
        
        // Kiểm tra trạng thái hiện tại
        const isAutoVerified = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let e of elements) {
                if (e.textContent) {
                    const txt = e.textContent.toLowerCase();
                    if (txt.includes('tự động xác minh') || txt.includes('auto verified') || txt.includes('đã được xác minh') || txt.includes('đã tự động xác minh')) {
                        return true;
                    }
                }
            }
            return false;
        });

        if (isAutoVerified) {
            logStep(`Trạng thái: Đã tự động xác minh`);
            await browser.close();
            return res.json({ status: 'success', metaTag: 'AUTO_VERIFIED', message: 'Domain này đã được xác minh trước đó.' });
        }

        logStep(`Đợi nội dung mã HTML 5s`);
        await page.waitForFunction(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                if ((el.value || '').includes('<meta name="google-site-verification"')) return true;
                if ((el.textContent || '').includes('<meta name="google-site-verification"')) return true;
            }
            return false;
        }, { timeout: 5000 });
        
        logStep(`Extract HTML`);
        const metaTag = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                if (el.value && el.value.includes('<meta name="google-site-verification"')) {
                    const match = el.value.match(/<meta name="google-site-verification"[^>]*>/);
                    if (match) return match[0];
                }
            }
            for (let el of elements) {
                if (el.textContent && el.textContent.includes('<meta name="google-site-verification"')) {
                    const match = el.textContent.match(/<meta name="google-site-verification"[^>]*>/);
                    if (match) return match[0];
                }
            }
            return null;
        });
        
        logStep(`Đóng trình duyệt, OK`);
        await browser.close();
        if (metaTag) return res.json({ status: 'success', metaTag });
        return res.json({ status: 'fail', message: 'Không tìm thấy thẻ meta xác minh.' });
    } catch (error) {
        logStep(`EXCEPTION BẮT ĐƯỢC: ${error.message}`);
        if (browser) {
            try {
                const pages = await browser.pages();
                if (pages.length > 0) {
                    const fs = require('fs');
                    const path = require('path');
                    // Lưu HTML để chắc cú
                    try {
                        const activePage = pages[pages.length - 1];
                        const html = await activePage.content();
                        fs.writeFileSync(path.join(__dirname, 'error.html'), html);
                    } catch(e) { console.error("Lỗi lấy HTML:", e.message); }
                    
                    // Chụp ảnh
                    try {
                        const activePage = pages[pages.length - 1];
                        await activePage.screenshot({ path: path.join(__dirname, 'error.png'), fullPage: true });
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
    const { url, id, proxy } = { ...req.query, ...(req.body || {}) };
    const userDataDir = getProfilePath(id);
    let browser = null;
    try {
        browser = await puppeteer.launch({ executablePath: getChromeExecutablePath(), headless: false, userDataDir: userDataDir, args: getLaunchArgs() });
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
        
        await page.goto('https://search.google.com/search-console', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 4000));
        
        if (page.url().includes('accounts.google.com')) {
            console.log("Đang chờ bạn đăng nhập thủ công trên trình duyệt (Tối đa 5 phút)...");
            await page.waitForFunction(() => !window.location.href.includes('accounts.google.com'), { timeout: 300000 }).catch(() => {});
            if (page.url().includes('accounts.google.com')) {
                await browser.close();
                return res.status(401).json({ status: 'fail', message: `Quá thời gian đăng nhập. Vui lòng chạy lại!` });
            }
        }
        
        await new Promise(r => setTimeout(r, 4000));
        
        // Bấm nút Start Now / Bắt đầu (nếu là tài khoản mới tinh)
        await page.evaluate(() => {
            const startBtns = document.querySelectorAll('button, a, div[role="button"]');
            for (let b of startBtns) {
                const t = (b.textContent || '').trim().toLowerCase();
                if (t === 'start now' || t === 'bắt đầu') {
                    b.click(); return;
                }
            }
        });
        await new Promise(r => setTimeout(r, 2000));

        // Bấm Mở Dropdown và tìm property
        await page.evaluate(async (domainToFind) => {
            const visualClick = (el) => {
                try {
                    const rect = el.getBoundingClientRect();
                    const bubble = document.createElement('div');
                    bubble.style.position = 'fixed';
                    bubble.style.left = (rect.left + rect.width/2 - 15) + 'px';
                    bubble.style.top = (rect.top + rect.height/2 - 15) + 'px';
                    bubble.style.width = '30px';
                    bubble.style.height = '30px';
                    bubble.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
                    bubble.style.border = '2px solid red';
                    bubble.style.borderRadius = '50%';
                    bubble.style.zIndex = '999999';
                    bubble.style.pointerEvents = 'none';
                    bubble.style.transition = 'all 0.5s ease-out';
                    document.body.appendChild(bubble);
                    setTimeout(() => { bubble.style.transform = 'scale(3)'; bubble.style.opacity = '0'; }, 50);
                    setTimeout(() => { bubble.remove(); }, 600);
                    el.click();
                } catch(e) { el.click(); }
            };

            const delay = ms => new Promise(res => setTimeout(res, ms));
            for (let i = 0; i < 5; i++) {
                const dropdowns = Array.from(document.querySelectorAll('div[role="button"], button'));
                let targetD = null;
                for (let d of dropdowns) {
                    const txt = (d.textContent || '').trim().toLowerCase();
                    if (txt.includes('http') || txt.includes('.') || txt.includes('property') || txt.includes('tài sản') || txt.includes('sản phẩm')) {
                        if (txt.includes('kiểm tra mọi') || txt.includes('inspect any')) continue;
                        if (!txt.includes('add') && !txt.includes('thêm')) {
                            targetD = d; break;
                        }
                    }
                }
                if (!targetD) {
                    const popupBtns = Array.from(document.querySelectorAll('div[role="button"][aria-haspopup="listbox"]'));
                    if (popupBtns.length > 0) targetD = popupBtns[0];
                }
                
                if (targetD) visualClick(targetD);
                
                await delay(1500);
                
                const spans = document.querySelectorAll('span, div');
                let foundProperty = false;
                // Thử click vào property trong menu
                for (let el of spans) {
                    if (el.children.length === 0) {
                        const txt = (el.textContent || '').trim().toLowerCase();
                        if (txt.includes(domainToFind)) {
                            let clickable = el.closest('[role="option"]') || el.closest('[role="menuitem"]') || el.closest('div[jsaction]') || el.closest('div[role="button"]') || el;
                            visualClick(clickable);
                            foundProperty = true;
                            break;
                        }
                    }
                }
                if (foundProperty) return;
                
                // Nếu không tìm thấy property trong menu, có thể cần ấn thêm tài sản
                let foundAdd = false;
                for (let el of spans) {
                    if (el.children.length === 0) {
                        const txt = (el.textContent || '').trim().toLowerCase();
                        if (txt === 'add property' || txt === 'thêm tài sản') {
                            foundAdd = true;
                            break;
                        }
                    }
                }
                if (foundAdd) return; // Đã ra được menu, thoát loop
            }
        }, url.replace(/https?:\/\//, '').replace(/\/$/, '').toLowerCase());
        
        await new Promise(r => setTimeout(r, 2000));
        
        // Bấm tab URL Prefix
        await page.evaluate(() => {
            const iter = document.evaluate("//div[@role='tab']//span[contains(text(), 'URL prefix') or contains(text(), 'Tiền tố URL')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const tabNode = iter.singleNodeValue;
            if (tabNode) {
                const clickableTab = tabNode.closest('div[role="tab"]');
                if (clickableTab) clickableTab.click();
            }
        });
        await new Promise(r => setTimeout(r, 500));
        
        // Tìm ô nhập URL chính xác trong bảng
        const inputSelector = await page.evaluate(() => {
            const node = document.evaluate("//*[contains(text(), 'URL prefix') or contains(text(), 'Tiền tố URL')]/following::input[1]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (node) { 
                node.id = 'puppeteer-target-input-verify'; 
                node.value = '';
                return '#puppeteer-target-input-verify'; 
            }
            const urlInputs = document.querySelectorAll('input[type="url"]');
            if (urlInputs.length > 0) {
                const target = urlInputs[urlInputs.length - 1];
                target.id = 'puppeteer-target-input-verify';
                target.value = '';
                return '#puppeteer-target-input-verify';
            }
            return 'input[type="url"]';
        });

        // Click & Gõ URL
        await page.click(inputSelector, { clickCount: 3 }).catch(()=>{});
        await page.type(inputSelector, url);
        await new Promise(r => setTimeout(r, 500));
        
        // Bấm Enter để mở bảng Verify
        await page.keyboard.press('Enter');
        
        // Đợi 4s cho bảng Verify hiện ra
        await new Promise(r => setTimeout(r, 4000));

        await page.evaluate(async () => {
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            
            // 1. Tìm và click mở tab 'Thẻ HTML' (HTML tag)
            const tagLabel = document.evaluate("//*[text()='HTML tag' or text()='Thẻ HTML']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (tagLabel) {
                const clickableLabel = tagLabel.closest('[role="button"]') || tagLabel.closest('[jsaction]') || tagLabel.closest('div.F93BIf') || tagLabel;
                clickableLabel.click();
                await wait(1000); // Đợi tab mở ra
            }
            
            // 2. Tìm tất cả các nút Xác minh (Verify)
            const iter = document.evaluate("//*[text()='Verify' or text()='Xác minh' or text()='VERIFY' or text()='XÁC MINH']", document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
            let node = iter.iterateNext();
            let buttons = [];
            while (node) { 
                const btn = node.closest('[role="button"]') || node.closest('button') || node;
                buttons.push(btn);
                node = iter.iterateNext(); 
            }
            
            // 3. Click nút Xác minh CUỐI CÙNG (thường là nút của Thẻ HTML sau khi mở)
            if (buttons.length > 0) {
                buttons[buttons.length - 1].click();
            }
        });
        
        await new Promise(r => setTimeout(r, 5000));
        const content = await page.content();
        
        if (content.includes('Ownership verified') || content.includes('Đã xác minh') || content.includes('Auto-verified') || content.includes('Tự động xác minh')) {
            await browser.close();
            return res.json({ status: 'success', message: 'Xác minh thành công!' });
        }
        
        try {
            await page.screenshot({ path: path.join(__dirname, 'error_verify.png') });
            fs.writeFileSync(path.join(__dirname, 'error_verify.html'), content);
        } catch(e){}
        await browser.close();
        return res.json({ status: 'fail', message: 'Lỗi xác minh.' });
    } catch (error) {
        if (browser) await browser.close(); 
        return res.status(500).json({ error: true, message: error.message });
    }
});


// =====================================================================
// 5. API ĐĂNG NHẬP WP & CHÈN MÃ WPCODE
// =====================================================================
app.all('/wp-inject-tag', async (req, res) => {
    const { wpUrl, adminPath, user, pass, metaTag, proxy } = { ...req.query, ...(req.body || {}) };
    let browser = null;
    let page = null;
    try {
        const rb = await launchRealBrowser(proxy);
        browser = rb.browser;
        page = rb.page;
        
        // 1. Đăng nhập
        const loginUrl = wpUrl.replace(/\/$/, '') + '/' + adminPath.replace(/^\//, '');
        console.log('WP Inject - Logging into:', loginUrl);
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        const userField = await page.$('#user_login');
        if (!userField) throw new Error('Không tìm thấy form đăng nhập WP');
        
        await page.type('#user_login', user);
        await page.type('#user_pass', pass);
        await Promise.all([
            page.click('#wp-submit'),
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
        ]);
        
        if (page.url().includes('wp-login.php')) {
            throw new Error('Đăng nhập WP thất bại, sai user/pass');
        }

        // 1.5 Cố gắng dán qua Flatsome Theme trước
        console.log('WP Inject - Thử dán qua Flatsome...');
        const flatsomeUrl = wpUrl.replace(/\/$/, '') + '/wp-admin/admin.php?page=optionsframework&tab=of-option-globalsettings';
        await page.goto(flatsomeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        await new Promise(r => setTimeout(r, 2000));
        
        const flatsomeSuccess = await page.evaluate((tag) => {
            // Flatsome textarea name is usually flatsome_html_scripts_header
            const ta = document.querySelector('textarea[name="flatsome_html_scripts_header"]') || document.querySelector('textarea#flatsome_html_scripts_header') || document.querySelector('textarea[name*="html_scripts_header"]');
            if (ta) {
                if (!ta.value.includes(tag)) {
                    ta.value = ta.value + '\\n' + tag;
                }
                // Save button
                const saveBtn = document.querySelector('button[name="update"]') || document.querySelector('input[name="update"]') || document.querySelector('.button-primary');
                if (saveBtn) {
                    saveBtn.click();
                    return true;
                }
            }
            return false;
        }, metaTag);

        if (flatsomeSuccess) {
            console.log('WP Inject - Đã dán thành công qua Flatsome!');
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            
            // Xóa Cache nếu có
            const clearCacheHref = await page.evaluate(() => {
                const purgeLink = document.querySelector('a[href*="litespeed-purge-all"]');
                return purgeLink ? purgeLink.href : null;
            });
            if (clearCacheHref) {
                await page.goto(clearCacheHref, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            }
            
            await browser.close();
            return res.json({ status: 'success', message: 'Dán mã thành công qua Flatsome' });
        }

        // 2. Tìm hoặc Cài đặt WPCode
        const installUrl = wpUrl.replace(/\/$/, '') + '/wp-admin/plugin-install.php?s=wpcode&tab=search&type=term';
        await page.goto(installUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        await new Promise(r => setTimeout(r, 2000)); // Đợi kết quả search AJAX nếu có
        
        let wpcodeCard = null;
        try {
            wpcodeCard = await page.waitForSelector('.plugin-card-insert-headers-and-footers', { timeout: 10000 });
        } catch(e) {
            throw new Error('Không tìm thấy plugin WPCode trong kho Plugin. Trang load chậm hoặc bị chặn.');
        }

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
            
            await new Promise(r => setTimeout(r, 1000));
            
            const activateBtn = await wpcodeCard.$('.activate-now');
            if (activateBtn) {
                console.log('WP Inject - Activating WPCode...');
                await Promise.all([
                    activateBtn.click(),
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
                ]);
            }
        }
        
        // 3. Chèn Mã vào Header
        console.log('WP Inject - Inserting Meta Tag...');
        const wpcodeSettingsUrl = wpUrl.replace(/\/$/, '') + '/wp-admin/admin.php?page=wpcode-headers-footers';
        await page.goto(wpcodeSettingsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // WPCode sử dụng CodeMirror. Ta cần nhét mã vào qua JS.
        const injected = await page.evaluate((tag) => {
            let foundTa = false;
            const cm = document.querySelector('.CodeMirror');
            if (cm && cm.CodeMirror) {
                const currentVal = cm.CodeMirror.getValue();
                if (!currentVal.includes(tag)) {
                    cm.CodeMirror.setValue(currentVal + '\n' + tag);
                }
                foundTa = true;
            } else {
                const ta = document.querySelector('textarea[name*="header"]');
                if (ta) {
                    if (!ta.value.includes(tag)) ta.value = ta.value + '\n' + tag;
                    foundTa = true;
                }
            }
            
            if (!foundTa) return 'Không tìm thấy khung nhập mã WPCode';

            const submitBtn = document.getElementById('submit') || document.querySelector('input[type="submit"]') || document.querySelector('button[type="submit"]') || document.querySelector('.wpcode-button-save');
            if (submitBtn) {
                submitBtn.click();
                return 'OK';
            }
            return 'Không tìm thấy nút Lưu';
        }, metaTag);
        
        if (injected !== 'OK') {
            throw new Error('WP Inject lỗi: ' + injected);
        }
        
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        
        // TỰ ĐỘNG CLEAR CACHE ĐỂ GSC BOT NHÌN THẤY MÃ NGAY
        const clearCacheHref = await page.evaluate(() => {
            const cacheLinks = document.querySelectorAll('#wpadminbar a');
            for (let link of cacheLinks) {
                const text = link.innerText.toLowerCase();
                const id = (link.closest('li') || link).id.toLowerCase();
                if ((id.includes('purge') || id.includes('cache') || id.includes('flush') || 
                     text.includes('purge') || text.includes('cache') || text.includes('xóa bộ nhớ đệm') || text.includes('flush')) 
                    && link.href && !link.href.includes('#')) {
                    
                    // Ưu tiên các link "Purge All" hoặc "Clear All" nằm trong menu con
                    const parent = link.closest('li');
                    if (parent) {
                        const subLinks = parent.querySelectorAll('ul li a');
                        for (let subLink of subLinks) {
                            const subText = subLink.innerText.toLowerCase();
                            if ((subText.includes('purge all') || subText.includes('clear all') || subText.includes('xóa tất cả')) && subLink.href && !subLink.href.includes('#')) {
                                return subLink.href;
                            }
                        }
                    }
                    return link.href;
                }
            }
            return null;
        });

        if (clearCacheHref) {
            console.log('WP Inject - Auto Clearing Cache:', clearCacheHref);
            await page.goto(clearCacheHref, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        } else {
            console.log('WP Inject - No Cache Plugin detected');
        }

        // Thêm thời gian chờ 2s để chắc chắn đã lưu và cache clear
        await new Promise(r => setTimeout(r, 2000));
        
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
    const { url, id, proxy } = { ...req.query, ...(req.body || {}) };
    let { sitemaps } = { ...req.query, ...(req.body || {}) };
    if (typeof sitemaps === 'string') sitemaps = sitemaps.split(',').map(s=>s.trim()).filter(Boolean);
    const userDataDir = getProfilePath(id);
    let browser = null;
    try {
        browser = await puppeteer.launch({ executablePath: getChromeExecutablePath(), headless: false, userDataDir: userDataDir, args: getLaunchArgs() });
        const page = await browser.newPage();
        
        // Bơm cookie
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
        
        await page.goto('https://search.google.com/search-console/sitemaps?resource_id=' + encodeURIComponent(url), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 4000));
        
        if (page.url().includes('accounts.google.com')) {
            console.log("Đang chờ bạn đăng nhập thủ công trên trình duyệt (Tối đa 5 phút)...");
            await page.waitForFunction(() => !window.location.href.includes('accounts.google.com'), { timeout: 300000 }).catch(() => {});
            if (page.url().includes('accounts.google.com')) {
                await browser.close();
                return res.status(401).json({ status: 'fail', message: `Quá thời gian đăng nhập. Vui lòng chạy lại!` });
            }
        }
        
        let results = [];
        for (const sitemap of sitemaps) {
            try {
                // KIỂM TRA XEM SITEMAP ĐÃ TỒN TẠI TRONG BẢNG CHƯA
                const alreadyExists = await page.evaluate((sm) => {
                    const cells = document.querySelectorAll('div[role="cell"], td');
                    for (let cell of cells) {
                        const txt = (cell.textContent || '').trim().toLowerCase();
                        if (txt === sm.toLowerCase() || txt === '/' + sm.toLowerCase()) return true;
                    }
                    return false;
                }, sitemap);

                if (alreadyExists) {
                    console.log(`Sitemap ${sitemap} đã tồn tại! Bỏ qua...`);
                    results.push({ sitemap, status: 'success' });
                    continue;
                }

                // TÌM Ô NHẬP SITEMAP
                const inputSelector = await page.evaluate(() => {
                    const inputs = document.querySelectorAll('input[type="text"]');
                    for (let i of inputs) {
                        const p = (i.placeholder || '').toLowerCase();
                        if (p.includes('url') || p.includes('sitemap') || p.includes('sơ đồ')) {
                            i.id = 'sitemap-target-input';
                            return '#sitemap-target-input';
                        }
                    }
                    return 'input[type="text"]';
                });
                
                await page.waitForSelector(inputSelector, { timeout: 10000 }).catch(()=>{});
                
                await page.click(inputSelector, { clickCount: 3 });
                await page.type(inputSelector, sitemap);
                
                // Submit button
                const clickedSubmit = await page.evaluate(() => {
                    const spans = document.querySelectorAll('span, div');
                    for (let el of spans) {
                        if (el.children.length === 0) {
                            const txt = (el.textContent || '').trim().toLowerCase();
                            if (txt === 'submit' || txt === 'gửi') {
                                let btn = el.closest('div[role="button"]') || el.closest('button') || el;
                                btn.click();
                                return true;
                            }
                        }
                    }
                    return false;
                });
                
                if (clickedSubmit) {
                    await new Promise(r => setTimeout(r, 3001)); // Đợi popup báo gửi thành công
                    // Đóng popup nếu có (Got it / OK)
                    await page.evaluate(() => {
                        const spans = document.querySelectorAll('span, div');
                        for (let el of spans) {
                            if (el.children.length === 0) {
                                const txt = (el.textContent || '').trim().toLowerCase();
                                if (txt === 'ok' || txt === 'got it' || txt === 'đã hiểu') {
                                    let btn = el.closest('div[role="button"]') || el.closest('button') || el;
                                    btn.click();
                                    return;
                                }
                            }
                        }
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

// API ĐỂ DEBUG: XEM NHẬT KÝ CHẠY
app.all('/debug-log', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(__dirname, 'debug_status.txt');
    if (fs.existsSync(logPath)) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(fs.readFileSync(logPath));
    } else {
        res.status(404).send('Chưa có log nào!');
    }
});

app.all('/debug-verify-img', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const imgPath = path.join(__dirname, 'error_verify.png');
    if (fs.existsSync(imgPath)) {
        res.sendFile(imgPath);
    } else {
        res.status(404).send('Not found');
    }
});

// Khởi động HTTP server (port 3002)
http.createServer(app).listen(HTTP_PORT, () => console.log('VPS API chạy HTTP tại port ' + HTTP_PORT));

// Khởi động HTTPS server (port 3001) với self-signed cert
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
