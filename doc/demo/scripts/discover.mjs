import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
} catch (e) {
  console.error('chrome channel failed:', e.message, '\n-> trying bundled chromium');
  browser = await chromium.launch({ headless: true });
}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.error('goto:', e.message));
await page.waitForTimeout(2500);

const title = await page.title();
// collect hrefs
const links = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')).filter(Boolean));
const sessionLinks = [...new Set(links.filter(h => h.includes('/sessions/')))];
const projectLinks = [...new Set(links.filter(h => h.includes('/projects/')))];
// top tab labels
const tabs = await page.$$eval('button, [role=tab], nav a', els =>
  els.map(e => (e.textContent || '').trim()).filter(t => t && t.length < 24)).catch(() => []);

console.log(JSON.stringify({
  title,
  url: page.url(),
  sessionLinks: sessionLinks.slice(0, 10),
  projectLinks: projectLinks.slice(0, 10),
  uniqueTabsSample: [...new Set(tabs)].slice(0, 40),
  consoleErrors: errs.slice(0, 5),
}, null, 2));

await browser.close();
