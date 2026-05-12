const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const os = require('os');

function getChromeExecutablePath() {
    if (os.platform() === 'linux') {
        if (fs.existsSync('/usr/bin/google-chrome')) return '/usr/bin/google-chrome';
        if (fs.existsSync('/usr/bin/chromium-browser')) return '/usr/bin/chromium-browser';
    }
    return null;
}

(async () => {
    const cookieFile = process.argv[2];
    const profileId = process.argv[3];

    if (!cookieFile || !profileId) {
        console.log("Cách dùng: node inject-cookie.js <file_cookie.json> <ten_profile>");
        process.exit(1);
    }

    if (!fs.existsSync(cookieFile)) {
        console.log("❌ Không tìm thấy file:", cookieFile);
        process.exit(1);
    }

    console.log(`Đang nạp cookie từ ${cookieFile} vào profile ${profileId}...`);
    const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));

    const path = require('path');
    const profilesDir = path.join(__dirname, 'google_profiles');
    if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir);
    const userDataDir = path.join(profilesDir, profileId);

    // BƯỚC ĐỘT PHÁ: Lưu file cookies.json vào thư mục profile để VPS API tự động bơm mỗi lần chạy!
    fs.writeFileSync(path.join(userDataDir, 'cookies.json'), JSON.stringify(cookies, null, 2));
    console.log(`Đã sao chép an toàn cookies vào ${path.join(userDataDir, 'cookies.json')}`);

    const browser = await puppeteer.launch({
        executablePath: getChromeExecutablePath(),
        headless: 'new',
        userDataDir: userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Nạp từng cookie
    for (let cookie of cookies) {
        // Puppeteer yêu cầu url hoặc domain để set cookie
        if (!cookie.url) {
            cookie.url = (cookie.secure ? "https://" : "http://") + cookie.domain.replace(/^\./, '');
        }
        // Chuyển đổi định dạng expirationDate của Cookie-Editor sang expires của Puppeteer
        if (cookie.expirationDate) {
            cookie.expires = cookie.expirationDate;
            delete cookie.expirationDate;
        } else if (!cookie.expires) {
            // Nếu không có hạn, set bừa 1 năm nữa để nó không bị coi là Session Cookie (bị xóa khi đóng trình duyệt)
            cookie.expires = Date.now() / 1000 + 31536000;
        }
        
        try {
            await page.setCookie(cookie);
        } catch (e) {
            console.log("Bỏ qua cookie lỗi:", cookie.name);
        }
    }

    console.log("✅ Nạp cookie thành công! Đang kiểm tra đăng nhập Google...");
    await page.goto('https://search.google.com/search-console/welcome', { waitUntil: 'networkidle2' });

    if (page.url().includes('accounts.google.com')) {
        console.log("❌ THẤT BẠI: Google vẫn yêu cầu đăng nhập. Cookie có thể đã hết hạn hoặc không đủ.");
    } else {
        console.log("🎉 THÀNH CÔNG: Đã đăng nhập vào GSC ngon lành!");
    }

    await browser.close();
    console.log("Đã lưu phiên đăng nhập vào thư mục:", userDataDir);
})();
