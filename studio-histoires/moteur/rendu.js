#!/usr/bin/env node
// Studio Histoires — rendu image par image dans Chromium (Playwright) puis encodage ffmpeg.
// Usage : node rendu.js <dossier_build> [--apercu] [--workers N] [--de S --a S]
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const { spawn } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  try { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
  catch (e2) { console.error('❌ Playwright introuvable. Installe-le : npm install playwright && npx playwright install chromium'); process.exit(1); }
}

const args = process.argv.slice(2);
const build = path.resolve(args[0] || '.');
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const apercu = args.includes('--apercu');
const fmt = opt('--format', null);
const suffixe = fmt && fmt !== '' ? '_' + fmt.replace(':', 'x') : '';
const TL = JSON.parse(fs.readFileSync(path.join(build, 'timeline.json'), 'utf8'));
if (fmt) {
  const vert = fmt === '9:16'; [TL.W, TL.H] = vert ? [1080, 1920] : [1920, 1080];
  if (TL.projet.format !== fmt) TL.projet.sous_titres = vert ? (TL.projet.sous_titres_vertical || 'mot') : (TL.projet.sous_titres_horizontal || 'bulle');
  TL.projet.format = fmt;
}
TL.rapide = apercu || args.includes('--rapide');
if (apercu) { TL.W = Math.round(TL.W / 2 / 2) * 2; TL.H = Math.round(TL.H / 2 / 2) * 2; }
const fps = apercu ? 15 : TL.fps;
const debut = parseFloat(opt('--de', 0)), fin = Math.min(parseFloat(opt('--a', TL.duree)), TL.duree);
const total = Math.ceil((fin - debut) * fps);
const nW = Math.max(1, Math.min(parseInt(opt('--workers', Math.max(1, os.cpus().length - 1))), 8));
const page_dir = path.join(__dirname, 'page');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg' };
const serveur = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = u.startsWith('/build/') ? path.join(build, u.slice(7)) : path.join(page_dir, u === '/' ? 'index.html' : u);
  if (!f.startsWith(page_dir) && !f.startsWith(build)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, d) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});

function encodeur(fichier) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', apercu ? 'ultrafast' : 'medium', '-crf', apercu ? '26' : '18', '-pix_fmt', 'yuv420p', '-r', String(fps), fichier], { stdio: ['pipe', 'inherit', 'inherit'] });
  return ff;
}
const ecrire = (ff, buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once('drain', r)));

(async () => {
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const port = serveur.address().port;
  const navigateur = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const mini = opt('--miniature', null);
  if (mini) {
    const page = await navigateur.newPage({ viewport: { width: 800, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/index.html`); await page.evaluate((tl) => window.initialiser(tl), TL);
    const b64 = await page.evaluate(([t, titre]) => window.miniature(t, titre), [parseFloat(mini), opt('--titre', TL.projet.titre || '')]);
    const f = path.join(build, `miniature${suffixe}.jpg`); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    console.log(`🖼️  Miniature : ${f}`); await navigateur.close(); serveur.close(); return;
  }
  const inst = opt('--instantanes', null);
  if (inst) {
    const page = await navigateur.newPage({ viewport: { width: 800, height: 800 } });
    page.on('pageerror', (e) => console.error('⚠️  Erreur page :', e.message)); page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
    await page.goto(`http://127.0.0.1:${port}/index.html`); await page.evaluate((tl) => window.initialiser(tl), TL);
    const dir = path.join(build, 'instantanes'); fs.mkdirSync(dir, { recursive: true });
    const ts = inst === 'auto' ? TL.lignes.map((l) => (l.debut + l.fin) / 2) : inst.split(',').map(Number);
    for (const t of ts) { const [b64] = await page.evaluate(([t, f]) => window.images(t * f, 1, f, 0.9), [t, fps]); const f = path.join(dir, `t_${t.toFixed(2).padStart(6, '0')}.jpg`); fs.writeFileSync(f, Buffer.from(b64, 'base64')); }
    console.log(`📸 ${ts.length} instantanés dans ${dir}`); await navigateur.close(); serveur.close(); return;
  }
  const tmp = path.join(build, 'segments'); fs.mkdirSync(tmp, { recursive: true });
  const part = Math.ceil(total / nW); let faites = 0; const t0 = Date.now();
  let dernier = -1; const progres = () => { const p = faites / total, ecoule = (Date.now() - t0) / 1000; if (!process.stdout.isTTY) { const d = Math.floor(p * 10); if (d === dernier) return; dernier = d; } process.stdout.write(`\r🎬 Rendu ${(p * 100).toFixed(0).padStart(3)}%  (${faites}/${total} images, reste ~${p > 0 ? Math.round(ecoule / p - ecoule) : '?'} s)   `); };
  const travail = async (k) => {
    const a = k * part, b = Math.min(total, a + part); if (a >= b) return null;
    const page = await navigateur.newPage({ viewport: { width: Math.min(TL.W, 1920), height: Math.min(TL.H, 1920) } });
    page.on('pageerror', (e) => console.error('\n⚠️  Erreur page :', e.message));
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.evaluate((tl) => window.initialiser(tl), TL);
    const seg = path.join(tmp, `seg_${String(k).padStart(2, '0')}.mp4`); const ff = encodeur(seg);
    const lot = 6;
    for (let i = a; i < b; i += lot) {
      const n = Math.min(lot, b - i);
      const imgs = await page.evaluate(([d, n, f, q]) => window.images(d, n, f, q), [i + debut * fps, n, fps, apercu ? 0.8 : 0.93]);
      for (const b64 of imgs) await ecrire(ff, Buffer.from(b64, 'base64'));
      faites += n; progres();
    }
    ff.stdin.end(); await new Promise((r) => ff.on('close', r)); await page.close(); return seg;
  };
  const segs = (await Promise.all([...Array(nW).keys()].map(travail))).filter(Boolean);
  await navigateur.close(); serveur.close();
  const liste = path.join(tmp, 'liste.txt'); fs.writeFileSync(liste, segs.map((s) => `file '${s}'`).join('\n'));
  const sortie = path.join(build, (apercu ? 'video_apercu' : 'video') + suffixe + '.mp4');
  await new Promise((r, j) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', liste, '-c', 'copy', sortie], { stdio: 'inherit' }).on('close', (c) => (c ? j(new Error('concat')) : r())));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n✅ Vidéo (sans son) : ${sortie}  — ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})().catch((e) => { console.error('\n❌', e); process.exit(1); });
