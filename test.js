const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('index.html', 'utf8');

const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    resources: 'usable'
});

dom.window.console.log = (...args) => console.log('[LOG]', ...args);
dom.window.console.warn = (...args) => console.warn('[WARN]', ...args);
dom.window.console.error = (...args) => console.error('[ERROR]', ...args);

dom.window.addEventListener('error', (event) => {
    console.error('Uncaught Exception:', event.error);
});

setTimeout(() => {
    console.log('Finished simulating DOM load.');
}, 3000);