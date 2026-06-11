const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    console.log('Starting browser...');
    const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: false });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        console.log('Navigating to login...');
        await page.goto('https://789fcasino.io/wp-login.php');
        await page.waitForSelector('#user_login', {timeout: 10000});
        
        console.log('Typing credentials...');
        await page.type('#user_login', 'admin@#88');
        await page.type('#user_pass', 'Reset@cmlz40ey!202');
        
        console.log('Clicking login...');
        await Promise.all([
            page.click('#wp-submit'),
            page.waitForNavigation({waitUntil: 'networkidle2'})
        ]);
        
        console.log('Login done, current URL:', page.url());
        
        console.log('Navigating to wpcode...');
        await page.goto('https://789fcasino.io/wp-admin/admin.php?page=wpcode-headers-footers');
        await page.waitForTimeout(3000);
        
        console.log('Injecting tag...');
        const injected = await page.evaluate(() => {
            let foundTa = false;
            const cm = document.querySelector('.CodeMirror');
            if (cm && cm.CodeMirror) {
                const currentVal = cm.CodeMirror.getValue();
                cm.CodeMirror.setValue(currentVal + '\n<meta name="test-tag" content="123">');
                foundTa = true;
            } else {
                const ta = document.querySelector('textarea[name*="header"]');
                if (ta) {
                    ta.value = ta.value + '\n<meta name="test-tag" content="123">';
                    foundTa = true;
                }
            }
            if (!foundTa) return 'No textarea';
            
            const submitBtn = document.getElementById('submit') || document.querySelector('.wpcode-button-save');
            if (submitBtn) {
                submitBtn.click();
                return 'OK';
            }
            return 'No save btn';
        });
        
        console.log('Inject Result:', injected);
        await page.waitForNavigation({waitUntil:'networkidle2', timeout: 10000}).catch(()=>{});
        
        console.log('Current URL after save:', page.url());
        
        console.log('Done');
    } catch(e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
