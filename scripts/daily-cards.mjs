// Generates daily listing cards + captions from epd2.html (no Claude, runs on GitHub Actions)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const COUNT = +(process.env.CARD_COUNT || 9);
const PHONE = process.env.CARD_PHONE || '0976-339-8960';
const AGENT = process.env.CARD_AGENT || 'Florence Alvarez';
const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Manila date
const OUT = path.join(ROOT, 'daily-cards', day);
fs.mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8765);

const browser = await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
page.on('pageerror', e => console.error('page error:', e.message));
await page.addInitScript(h => { try { localStorage.setItem('epd2ok', h); } catch (e) {} }, 'ad1fd506789e51eee00bbd62843a02e16f3f355686807e03e7bce814a4c3f361');
await page.goto('http://localhost:8765/epd2.html');
await page.waitForTimeout(1500);
await page.evaluate(([ph, ag]) => { if (ph) document.getElementById('phone').value = ph; if (ag) document.getElementById('agent').value = ag; }, [PHONE, AGENT]);

// candidates: real priced entries (not placeholders), order rotates daily
const cands = await page.evaluate((seed) => {
  const ix = PROPS.map((p, i) => [p, i]).filter(([p]) => !String(p.id || '').startsWith('p_APEC_PH') && (p.term30 || p.monthlyDp || p.tcp)).map(([, i]) => i);
  let s = seed; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = ix.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ix[i], ix[j]] = [ix[j], ix[i]]; }
  return ix;
}, Math.floor(Date.now() / 864e5));

const made = [];const ids = [];const sts = [];
const seen = new Set();
for (const i of cands) {
  if (made.length >= COUNT) break;
  const ok = await page.evaluate(async (i) => {
    const sel = document.getElementById('prop');
    if (![...sel.options].some(o => o.value == i)) sel.add(new Option('x', i));
    sel.value = String(i); sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 2500));
    return document.getElementById('libInfo').textContent.includes('📚');
  }, i);
  if (!ok) continue;
  const key = await page.evaluate(i => PROPS[i].name.toLowerCase().trim(), i); // one card per project
  if (seen.has(key)) continue; seen.add(key);
  await page.evaluate(k => window.setAgentLib && window.setAgentLib(k), made.length + Math.floor(Date.now() / 864e5));
  await page.click('#autoBtn');
  await page.waitForTimeout(1500);
  // each card gets a different layout
  await page.evaluate(k => { const L = LAYOUTS[k % LAYOUTS.length][0]; document.getElementById('layout').value = L; draw(); }, made.length + Math.floor(Date.now() / 864e5));
  await page.waitForTimeout(500);
  const { png, cap, name } = await page.evaluate(i => {
    const p = PROPS[i];
    return { png: document.getElementById('cv').toDataURL('image/jpeg', 0.88), cap: document.getElementById('cap').textContent,
             name: (p.name + '-' + cleanModel(p.model)).replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 70) };
  }, i);
  const n = String(made.length + 1).padStart(2, '0');
  fs.writeFileSync(path.join(OUT, `${n}-${name}.jpg`), Buffer.from(png.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, `${n}-${name}.txt`), cap);
  made.push(`${n}-${name}`);ids.push(await page.evaluate(i=>PROPS[i].id,i));sts.push(await page.evaluate(()=>({layout:document.getElementById('layout').value,kicker:document.getElementById('kicker').value,rot})));
  console.log('made', n, name);
}
const idx = { day, cards: made.map((m, j) => ({ id: ids[j], st: sts[j], png: `${day}/${m}.jpg`, txt: `${day}/${m}.txt`, title: m.replace(/^\d+-/, '').replace(/-/g, ' ') })) };
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(idx));
fs.writeFileSync(path.join(ROOT, 'daily-cards', 'latest.json'), JSON.stringify(idx));
fs.writeFileSync(path.join(OUT, 'README.md'), `# Daily cards — ${day}\n\n${made.map(m => `- ${m}.jpg + ${m}.txt (caption)`).join('\n')}\n`);
// keep only the last 7 days of cards
for (const d of fs.readdirSync(path.join(ROOT, 'daily-cards'))) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (Date.parse(day) - Date.parse(d)) / 864e5 >= 7) { fs.rmSync(path.join(ROOT, 'daily-cards', d), { recursive: true, force: true }); console.log('removed old', d); }
}
await browser.close(); server.close();
console.log(`Done: ${made.length} cards in daily-cards/${day}`);
