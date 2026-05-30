import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

const { SERIALIZD_EMAIL, SERIALIZD_PASSWORD, SERIALIZD_USERNAME } = process.env;
if (!SERIALIZD_EMAIL || !SERIALIZD_PASSWORD || !SERIALIZD_USERNAME) {
  console.error('Missing env vars. Copy .env.example to .env and fill in.');
  process.exit(1);
}

const CAPTURE_DIR = path.resolve('captures');
fs.mkdirSync(CAPTURE_DIR, { recursive: true });

const requests = [];

function isInteresting(url) {
  // Skip noise: images, fonts, analytics, css, js bundles
  if (/\.(png|jpe?g|webp|gif|svg|ico|css|woff2?|ttf|map)(\?|$)/i.test(url)) return false;
  if (/google-analytics|googletagmanager|sentry|cloudflareinsights|posthog|hotjar|amplitude/i.test(url)) return false;
  // Keep anything that looks like an API call
  if (/\/api\/|\.json($|\?)|graphql|trpc/i.test(url)) return true;
  // Keep XHR/fetch to serializd or its likely API subdomain
  if (/serializd\.com/i.test(url)) return true;
  return false;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  page.on('request', (req) => {
    const url = req.url();
    if (!isInteresting(url)) return;
    requests.push({
      phase: 'pending',
      method: req.method(),
      url,
      resourceType: req.resourceType(),
      headers: req.headers(),
      postData: req.postData() ?? null,
    });
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (!isInteresting(url)) return;
    let bodyPreview = null;
    let bodyJson = null;
    try {
      const ct = res.headers()['content-type'] ?? '';
      if (ct.includes('application/json') || /\.json($|\?)/i.test(url)) {
        const text = await res.text();
        bodyPreview = text.slice(0, 4000);
        try {
          bodyJson = JSON.parse(text);
        } catch {}
      }
    } catch {}
    requests.push({
      phase: 'response',
      status: res.status(),
      method: res.request().method(),
      url,
      headers: res.headers(),
      bodyPreview,
      bodyJsonKeys: bodyJson && typeof bodyJson === 'object' ? Object.keys(bodyJson).slice(0, 20) : null,
      bodyJsonSample: bodyJson ? JSON.stringify(bodyJson).slice(0, 1500) : null,
    });
  });

  console.log('Navigating to login page...');
  await page.goto('https://www.serializd.com/login', { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Save a screenshot of login page for debugging
  await page.screenshot({ path: path.join(CAPTURE_DIR, '01-login.png'), fullPage: true });

  // Dump page structure so we can see what selectors exist
  const loginHtml = await page.content();
  fs.writeFileSync(path.join(CAPTURE_DIR, '01-login.html'), loginHtml);

  console.log('Attempting to fill login form...');
  // Try multiple selector strategies
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[placeholder*="mail" i]',
    'input[placeholder*="user" i]',
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="pass" i]',
  ];

  let emailEl = null, pwEl = null;
  for (const sel of emailSelectors) {
    const el = await page.$(sel);
    if (el) {
      emailEl = el;
      console.log('  email selector matched:', sel);
      break;
    }
  }
  for (const sel of passwordSelectors) {
    const el = await page.$(sel);
    if (el) {
      pwEl = el;
      console.log('  password selector matched:', sel);
      break;
    }
  }

  if (!emailEl || !pwEl) {
    console.error('Could not find login form fields. Inspect captures/01-login.html');
    await browser.close();
    fs.writeFileSync(path.join(CAPTURE_DIR, 'requests.json'), JSON.stringify(requests, null, 2));
    process.exit(2);
  }

  await emailEl.fill(SERIALIZD_EMAIL);
  await pwEl.fill(SERIALIZD_PASSWORD);

  // Find submit button
  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'input[type="submit"]',
  ];
  let submitEl = null;
  for (const sel of submitSelectors) {
    const el = await page.$(sel);
    if (el) {
      submitEl = el;
      console.log('  submit selector matched:', sel);
      break;
    }
  }

  if (!submitEl) {
    // Try pressing Enter on password field
    console.log('  no submit button found, pressing Enter');
    await pwEl.press('Enter');
  } else {
    await submitEl.click();
  }

  console.log('Waiting for post-login navigation...');
  try {
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
  } catch {
    console.log('  networkidle timeout, continuing');
  }

  await page.screenshot({ path: path.join(CAPTURE_DIR, '02-post-login.png'), fullPage: true });

  const cookies = await context.cookies();
  fs.writeFileSync(path.join(CAPTURE_DIR, 'cookies.json'), JSON.stringify(cookies, null, 2));
  console.log(`Saved ${cookies.length} cookies.`);

  // Navigate to shows page
  const showsUrl = `https://www.serializd.com/user/${SERIALIZD_USERNAME}/shows`;
  console.log(`Navigating to ${showsUrl}...`);
  await page.goto(showsUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  try {
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
  } catch {}

  await page.screenshot({ path: path.join(CAPTURE_DIR, '03-shows-initial.png'), fullPage: true });
  fs.writeFileSync(path.join(CAPTURE_DIR, '03-shows-initial.html'), await page.content());

  // Try scrolling to trigger pagination
  console.log('Scrolling to trigger pagination...');
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  // Look for any "next page" / pagination button
  const paginationButtons = await page.$$('button, a');
  const paginationCandidates = [];
  for (const btn of paginationButtons) {
    const text = (await btn.textContent().catch(() => null))?.trim() ?? '';
    if (/next|load more|more|page|→|»/i.test(text) && text.length < 30) {
      paginationCandidates.push(text);
    }
  }
  console.log('Possible pagination buttons:', paginationCandidates.slice(0, 20));

  // Try clicking "Next" a few times if present
  for (let i = 0; i < 3; i++) {
    const next = await page.$('button:has-text("Next"), a:has-text("Next"), [aria-label*="next" i]');
    if (!next) break;
    console.log(`Clicking next (round ${i + 1})...`);
    await next.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: path.join(CAPTURE_DIR, '04-shows-paginated.png'), fullPage: true });
  fs.writeFileSync(path.join(CAPTURE_DIR, '04-shows-paginated.html'), await page.content());

  fs.writeFileSync(path.join(CAPTURE_DIR, 'requests.json'), JSON.stringify(requests, null, 2));

  // Also build a summarized view: unique endpoints with method
  const endpointSummary = {};
  for (const r of requests) {
    const key = `${r.method} ${r.url.split('?')[0]}`;
    if (!endpointSummary[key]) endpointSummary[key] = { count: 0, sampleUrls: new Set(), statuses: new Set() };
    endpointSummary[key].count++;
    endpointSummary[key].sampleUrls.add(r.url);
    if (r.status) endpointSummary[key].statuses.add(r.status);
  }
  const summaryOut = Object.entries(endpointSummary).map(([k, v]) => ({
    endpoint: k,
    count: v.count,
    statuses: [...v.statuses],
    sampleUrls: [...v.sampleUrls].slice(0, 3),
  }));
  fs.writeFileSync(path.join(CAPTURE_DIR, 'endpoint-summary.json'), JSON.stringify(summaryOut, null, 2));

  console.log(`\nCaptured ${requests.length} interesting requests.`);
  console.log(`Unique endpoints: ${Object.keys(endpointSummary).length}`);
  console.log(`See captures/endpoint-summary.json and captures/requests.json`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  fs.writeFileSync(path.join(CAPTURE_DIR, 'requests.json'), JSON.stringify(requests, null, 2));
  process.exit(1);
});
