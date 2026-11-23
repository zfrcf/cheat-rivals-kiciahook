// Studio Histoires — moteur "cube3d" : animation 3D low-poly à personnages cubiques
// (style "jeu de blocs" générique). Monde en mètres, sol à y=0.
import * as THREE from './lib/three.module.min.js';

const { clamp, lerp, ease, hash, shade } = S;
let TL, W, H, FPS, renderer, scene, camera, out, octx;
let sceneCourante = -1, acteurs3d = {}, foule = [], animables = [];

const mat = (c, opts = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0, ...opts });
const boite = (w, h, d, c, opts) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'string' || typeof c === 'number' ? mat(c, opts) : c); m.castShadow = true; m.receiveShadow = true; return m; };
const ajout = (o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); scene.add(o); return o; };

// ---------------- Textures procédurales ----------------
function texCanvas(w, h, dessin, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; dessin(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.magFilter = THREE.NearestFilter; return t;
}
const texHerbe = () => texCanvas(64, 64, (g, w, h) => { g.fillStyle = '#5fbf4a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 120; i++) { g.fillStyle = i % 2 ? '#6fd157' : '#53a943'; g.fillRect((i * 37) % w, (i * 53) % h, 3, 5); } }, [40, 40]);
const texPaves = (c1 = '#b9b2d6', c2 = '#a49cc6') => texCanvas(64, 64, (g, w, h) => { g.fillStyle = c2; g.fillRect(0, 0, w, h); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? c1 : shade(c1, -0.05); g.fillRect(x * 16 + (y % 2) * 8 + 1, y * 16 + 1, 14, 14); } }, [30, 30]);
const texParquet = () => texCanvas(64, 64, (g, w, h) => { for (let i = 0; i < 4; i++) { g.fillStyle = ['#c98b52', '#b97c46', '#d39660', '#c08450'][i]; g.fillRect(0, i * 16, w, 15); } }, [8, 8]);
const texFenetres = (c, nuit) => texCanvas(64, 64, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = nuit ? (hash(c + x + y) > 0.3 ? '#ffe08a' : '#2a2f5a') : '#bfe9ff'; g.fillRect(8 + x * 32, 8 + y * 32, 18, 20); g.fillStyle = '#fff'; g.fillRect(8 + x * 32, 28 + y * 32, 18, 3); } });

// ---------------- Décors ----------------
function maison(x, z, rot, couleur, nuit, h = 3.2) {
  const g = new THREE.Group();
  const corps = boite(4, h, 4, new THREE.MeshStandardMaterial({ map: texFenetres(couleur, nuit), roughness: 0.8 })); corps.position.y = h / 2; g.add(corps);
  const toit = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.8, 4), mat(['#c0392b', '#34495e', '#7f8c8d', '#d35400'][Math.floor(hash(couleur) * 4)])); toit.rotation.y = Math.PI / 4; toit.position.y = h + 0.9; toit.castShadow = true; g.add(toit);
  const porte = boite(0.9, 1.6, 0.1, '#6b3f22'); porte.position.set(0, 0.8, 2.01); g.add(porte);
  g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g); return g;
}
function arbre(x, z, s = 1) { const tr = boite(0.4 * s, 1.6 * s, 0.4 * s, '#8a5a3c'); ajout(tr, x, 0.8 * s, z); const f = boite(1.8 * s, 1.6 * s, 1.8 * s, '#3fa34d'); ajout(f, x, 2.2 * s, z); const f2 = boite(1.1 * s, 0.8 * s, 1.1 * s, '#58c262'); ajout(f2, x, 3.2 * s, z); }
function ciel(c, brouillard) { scene.background = new THREE.Color(c); scene.fog = new THREE.Fog(brouillard || c, 25, 70); }
function lumieres(nuit) {
  if (nuit) scene.add(new THREE.AmbientLight(0xfff0e0, 0.9));
  scene.add(new THREE.HemisphereLight(nuit ? 0x8a8cff : 0xffffff, nuit ? 0x221a44 : 0x667755, nuit ? 0.9 : 1.6));
  const d = new THREE.DirectionalLight(nuit ? 0xb0b8ff : 0xfff1dd, nuit ? 0.8 : 2.2); d.position.set(8, 14, 10); d.castShadow = true;
  d.shadow.mapSize.set(1024, 1024); Object.assign(d.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 }); d.shadow.bias = -0.0005; scene.add(d);
}
function sol(tex, taille = 120) { const m = new THREE.Mesh(new THREE.PlaneGeometry(taille, taille), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })); m.rotation.x = -Math.PI / 2; m.receiveShadow = true; scene.add(m); return m; }
function emissif(w, h, d, c, x, y, z) { return ajout(boite(w, h, d, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8 })), x, y, z); }
function guirlande(y, z, x0 = -10, x1 = 10) { const cs = [0xff5c8a, 0xffd23f, 0x3ec1f3, 0x7bff8a]; for (let x = x0, i = 0; x <= x1; x += 0.8, i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: cs[i % 4] })); ajout(b, x, y - Math.sin(((x - x0) / (x1 - x0)) * Math.PI) * 0.6, z); animables.push((t) => { b.material.color.setHex(Math.sin(t * 5 + i) > -0.3 ? cs[i % 4] : 0x333333); }); } }
function mur(w, h, c, x, y, z, ry = 0) { const m = boite(w, h, 0.2, c); m.rotation.y = ry; return ajout(m, x, y, z); }

const DECORS = {
  ville(o) {
    ciel(o.nuit ? '#141a40' : '#8fd3ff'); lumieres(o.nuit); sol(texHerbe());
    const route = new THREE.Mesh(new THREE.PlaneGeometry(6, 120), mat('#55575f')); route.rotation.x = -Math.PI / 2; route.position.set(0, 0.01, 0); route.receiveShadow = true; scene.add(route);
    for (let k = -50; k < 50; k += 4) { const b = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.8), mat('#f5f5f5')); b.rotation.x = -Math.PI / 2; b.position.set(0, 0.02, k); scene.add(b); }
    const cols = ['#2ecc71', '#e74c3c', '#f1c40f', '#3498db', '#e67e22', '#9b59b6', '#1abc9c', '#ecf0f1'];
    for (let i = -5; i <= 5; i++) { maison(-7, i * 7, Math.PI / 2, cols[(i + 10) % 8], o.nuit); maison(7, i * 7 + 3, -Math.PI / 2, cols[(i + 13) % 8], o.nuit); if (i % 2) { arbre(-4, i * 7 + 3); arbre(4.2, i * 7); } }
    if (o.batiment) { const b = boite(9, 6, 6, new THREE.MeshStandardMaterial({ map: texFenetres('#f3e9d2'), roughness: 0.8 })); ajout(b, 0, 3, -18); }
  },
  chambre(o) {
    ciel('#a8c8ff'); lumieres(false); sol(texParquet(), 14);
    mur(14, 6, o.mur || '#ffffff', 0, 3, -4); mur(14, 6, o.mur2 || '#ff4d6d', -5, 3, 0, Math.PI / 2);
    ajout(boite(3, 0.6, 4.5, '#3f5bd8'), 3, 0.3, -1.5); ajout(boite(3, 0.25, 4.4, '#ff9fb5'), 3, 0.72, -1.4); ajout(boite(1.8, 0.4, 0.8, '#fff'), 3, 0.95, -3.2);
    ajout(boite(2.2, 0.15, 1.1, '#c98b52'), -2.5, 1.5, -3.2); ajout(boite(0.15, 1.5, 0.15, '#8a5a3c'), -3.4, 0.75, -3.4); ajout(boite(0.15, 1.5, 0.15, '#8a5a3c'), -1.6, 0.75, -3.4);
    emissif(1.4, 0.9, 0.1, 0x3ec1f3, -2.5, 2.1, -3.5);
    emissif(2.2, 1.5, 0.05, 0xbfe9ff, 1.5, 3.3, -3.88);
    const poster = ajout(boite(1.2, 1.6, 0.05, new THREE.MeshStandardMaterial({ map: texCanvas(64, 96, (g) => { g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 64, 96); g.fillStyle = '#e2462f'; g.font = 'bold 30px sans-serif'; g.fillText(o.affiche || 'TOUR', 2, 50); }) })), -4.88, 3.2, -1); poster.rotation.y = Math.PI / 2;
    if (o.canape !== false) { ajout(boite(3, 0.7, 1.3, '#e74c3c'), -1, 0.35, 1.2); ajout(boite(3, 1.2, 0.4, '#c0392b'), -1, 0.8, 1.9); }
  },
  place_nuit(o) {
    ciel('#151a46', '#151a46'); lumieres(true); sol(texPaves());
    const cols = ['#f7d6e6', '#d6e4ff', '#ffe3c2', '#e0d6ff'];
    for (let i = -3; i <= 3; i++) { const b = boite(5, 6 + (i % 2) * 2, 5, new THREE.MeshStandardMaterial({ map: texFenetres(cols[(i + 4) % 4], true), roughness: 0.9 })); ajout(b, i * 5.4, 3 + (i % 2), -12); }
    const hall = boite(10, 5, 3, '#f5f0ff'); ajout(hall, 0, 2.5, -9); emissif(5, 0.8, 0.1, 0x6a5cff, 0, 4, -7.45);
    guirlande(4.5, -4, -10, 10); guirlande(4.2, 0, -10, 10); guirlande(4.5, 4, -10, 10);
    if (o.scene_dj !== false) { ajout(boite(3, 1.1, 1.2, '#222'), 0, 0.55, -5.5); emissif(2.6, 0.25, 0.05, 0xff3cac, 0, 0.75, -4.88); ajout(boite(1, 2.2, 1, '#2a2a3a'), -2.8, 1.1, -5.5); ajout(boite(1, 2.2, 1, '#2a2a3a'), 2.8, 1.1, -5.5); for (const x of [-2.8, 2.8]) { const hp = emissif(0.6, 0.6, 0.05, 0xb05cff, x, 1.4, -4.98); animables.push((t) => { const s = 1 + Math.abs(Math.sin(t * 8)) * 0.15; hp.scale.set(s, s, 1); }); } }
    for (const x of [-6, 6]) { ajout(boite(2.4, 0.15, 0.8, '#8a5a3c'), x, 0.6, 3); ajout(boite(0.15, 0.6, 0.6, '#555'), x - 1, 0.3, 3); ajout(boite(0.15, 0.6, 0.6, '#555'), x + 1, 0.3, 3); }
    if (o.eteint) { scene.children.forEach((c) => { if (c.isHemisphereLight) c.intensity = 0.25; if (c.isDirectionalLight) c.intensity = 0.15; }); scene.background = new THREE.Color('#05060f'); }
  },
  pelouse(o) {
    ciel('#7ec8ff'); lumieres(false); sol(texHerbe());
    const cs = ['#ff5c8a', '#ffd23f', '#ffffff', '#c77dff', '#ff8a3d'];
    for (let i = 0; i < 160; i++) { const x = (hash('f' + i) - 0.5) * 30, z = (hash('g' + i) - 0.5) * 30; ajout(boite(0.12, 0.3, 0.12, '#3c8d2f'), x, 0.15, z); ajout(boite(0.22, 0.12, 0.22, cs[i % 5]), x, 0.33, z); }
    for (let i = 0; i < 10; i++) arbre(-14 + i * 3.2, -12 - (i % 3) * 2, 1 + (i % 3) * 0.2);
    for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.ConeGeometry(8, 7, 4), mat(['#9aa7c7', '#b4bfdb'][i % 2])); ajout(m, -24 + i * 12, 3, -40); }
  },
  salle(o) {
    ciel('#3a3d55'); lumieres(false); sol(texPaves('#4a4d66', '#3e4158'), 30);
    mur(16, 7, '#ffd23f', 0, 3.5, -5); mur(16, 7, '#2c2f45', -7, 3.5, 0, Math.PI / 2); mur(16, 7, '#2c2f45', 7, 3.5, 0, Math.PI / 2);
    const ecr = emissif(5, 2, 0.1, 0x2ecc71, 0, 3.6, -4.85); animables.push((t) => { ecr.material.emissiveIntensity = 0.6 + Math.sin(t * 3) * 0.2; });
    const tx = texCanvas(256, 64, (g) => { g.fillStyle = '#111'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.fillText((o.enseigne || 'CENTRALE').toUpperCase(), 10, 45); });
    ajout(boite(6, 1.2, 0.1, new THREE.MeshBasicMaterial({ map: tx })), 0, 6, -4.85);
    ajout(boite(2, 1.2, 1.6, '#c0392b'), 0, 0.6, -0.5); ajout(boite(2, 1.6, 0.4, '#e74c3c'), 0, 1.6, -1.2);
    for (const x of [-4.5, 4.5]) { ajout(boite(1.5, 3, 1, '#555a77'), x, 1.5, -4); for (let k = 0; k < 4; k++) emissif(0.2, 0.2, 0.05, [0xff4d4d, 0x2ecc71, 0xffd23f, 0x3ec1f3][k], x - 0.5 + k * 0.33, 2.4, -3.48); }
  },
  salle_sport(o) {
    ciel('#2b2d42'); lumieres(false); sol(texPaves('#3d3f52', '#34364a'), 30);
    mur(18, 7, '#2b2d42', 0, 3.5, -6); emissif(18, 0.4, 0.1, 0xff6b35, 0, 5.5, -5.85);
    for (const x of [-4, 4]) ajout(boite(5, 3, 0.05, mat('#9fc3e0', { metalness: 0.6, roughness: 0.1 })), x, 2.5, -5.85);
    for (let i = 0; i < 6; i++) { ajout(boite(0.15, 0.15, 0.8, '#666'), -6 + i * 0.7, 0.8, -4.8); ajout(boite(0.35, 0.35, 0.2, '#222'), -6 + i * 0.7, 0.8, -5.2); ajout(boite(0.35, 0.35, 0.2, '#222'), -6 + i * 0.7, 0.8, -4.4); }
    ajout(boite(4, 0.1, 0.8, '#666'), -4.5, 0.65, -4.8);
    for (const x of [3, 5.5]) { ajout(boite(1.2, 0.35, 2.6, '#222'), x, 0.18, -3.5); ajout(boite(1.2, 1.3, 0.15, '#444'), x, 1, -4.7); }
  },
  plage(o) {
    ciel(o.coucher ? '#ffb070' : '#8fd3ff'); lumieres(false);
    sol(texCanvas(64, 64, (g) => { g.fillStyle = '#f3d9a4'; g.fillRect(0, 0, 64, 64); for (let i = 0; i < 80; i++) { g.fillStyle = i % 2 ? '#e8c88a' : '#fbe7bd'; g.fillRect((i * 29) % 64, (i * 41) % 64, 2, 2); } }, [40, 40]));
    const mer = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), new THREE.MeshStandardMaterial({ color: 0x2f9fd8, roughness: 0.3, metalness: 0.1 })); mer.rotation.x = -Math.PI / 2; mer.position.set(0, 0.05, -45); scene.add(mer);
    animables.push((t) => { mer.position.y = 0.05 + Math.sin(t * 1.5) * 0.05; });
    for (const [x, z, c] of [[-4, -2, '#e74c3c'], [5, -3, '#f1c40f']]) { ajout(boite(0.15, 2.6, 0.15, '#eee'), x, 1.3, z); const p = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.7, 8), mat(c)); ajout(p, x, 2.7, z); p.castShadow = true; ajout(boite(1, 0.1, 2, '#3ec1f3'), x + 1.2, 0.05, z + 0.5); }
    for (let i = 0; i < 6; i++) { const x = -14 + i * 6; ajout(boite(0.4, 4, 0.4, '#8a5a3c'), x, 2, -8); for (let k = 0; k < 4; k++) { const f = boite(2.2, 0.15, 0.6, '#2ecc71'); f.rotation.y = k * Math.PI / 2; f.rotation.z = -0.3; ajout(f, x + Math.cos(k * Math.PI / 2) * 0.9, 4, -8 - Math.sin(k * Math.PI / 2) * 0.9); } }
  },
  classe(o) {
    ciel('#f5e6c8'); lumieres(false); sol(texParquet(), 20);
    mur(16, 6, '#f5e6c8', 0, 3, -5); mur(16, 6, '#e8d5b0', -7, 3, 0, Math.PI / 2);
    const tx = texCanvas(256, 128, (g) => { g.fillStyle = '#2f5d4a'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.fillText(o.tableau || '2 + 2 = 4', 20, 75); });
    ajout(boite(7, 3, 0.1, new THREE.MeshStandardMaterial({ map: tx })), 0, 3.2, -4.85);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const x = -4.5 + c * 3, z = -1 + r * 2.6; ajout(boite(1.6, 0.12, 1, '#c98b52'), x, 1.1, z); ajout(boite(0.12, 1.1, 0.12, '#555'), x, 0.55, z); ajout(boite(0.8, 0.1, 0.8, '#3498db'), x, 0.7, z + 0.9); }
    ajout(boite(2.4, 1.2, 1.2, '#8a5a3c'), 4.5, 0.6, -3.5);
  },
  couleur(o) { ciel(o.couleur || '#7b4dff'); lumieres(false); const m = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat(o.couleur || '#7b4dff')); m.rotation.x = -Math.PI / 2; m.receiveShadow = true; scene.add(m); },
};

// ---------------- Personnages cubiques ----------------
function dessinerVisage(g, look, st) {
  const peau = look.peau || '#f5c99b';
  g.fillStyle = peau; g.fillRect(0, 0, 128, 128);
  const em = st.emotion || 'neutre', bl = st.cligne;
  if (look.lunettes) {
    g.fillStyle = '#1b1b1b'; g.fillRect(4, 30, 120, 10);
    for (const x of [34, 94]) { g.beginPath(); g.arc(x, 50, 24, 0, 7); g.fillStyle = '#1b1b1b'; g.fill(); g.beginPath(); g.arc(x, 50, 18, 0, 7); g.fillStyle = look.couleur_lunettes || '#36d6ff'; g.fill(); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x - 10, 40, 6, 6);
      if (!bl) { g.fillStyle = '#111'; g.beginPath(); g.arc(x + (st.regard || 0) * 4, 52, em === 'surpris' ? 5 : 7, 0, 7); g.fill(); } else { g.fillStyle = '#111'; g.fillRect(x - 12, 50, 24, 4); } }
  } else {
    for (const x of [38, 90]) { if (bl || em === 'rire') { g.fillStyle = '#111'; g.fillRect(x - 10, 50, 20, 5); continue; } g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, 52, 12, em === 'surpris' ? 17 : 14, 0, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(x + (st.regard || 0) * 3, 54, 7, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(x + 1, 49, 3, 3); }
    g.fillStyle = '#3a2a20'; const sb = em === 'fache' ? 6 : em === 'triste' ? -6 : 0;
    g.save(); g.translate(38, 32); g.rotate(sb * 0.05); g.fillRect(-13, -3, 26, 6); g.restore(); g.save(); g.translate(90, 32); g.rotate(-sb * 0.05); g.fillRect(-13, -3, 26, 6); g.restore();
  }
  const o = st.bouche || 0;
  g.fillStyle = '#5a1f1f';
  if (o > 0.08 && st.viseme === 'M') g.fillRect(50, 95, 28, 5); else if (o > 0.08) { const fw = { O: 0.6, E: 1.35 }[st.viseme] || 1, fh = { O: 1, E: 0.55 }[st.viseme] || 1; g.beginPath(); g.ellipse(64, 96, (14 + o * 6) * fw, (4 + o * 14) * fh, 0, 0, 7); g.fill(); g.fillStyle = '#ff7a8a'; g.fillRect(56, 98 + o * 6 * fh, 16, 4); }
  else if (em === 'triste') { g.lineWidth = 5; g.strokeStyle = '#5a1f1f'; g.beginPath(); g.arc(64, 108, 14, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); }
  else if (em === 'surpris' || em === 'choque') { g.beginPath(); g.ellipse(64, 98, 8, 11, 0, 0, 7); g.fill(); }
  else if (em === 'fache' || em === 'blase') g.fillRect(50, 96, 28, 5);
  else { g.lineWidth = 5; g.strokeStyle = '#5a1f1f'; g.beginPath(); g.arc(64, 86, 16, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); }
  if (em === 'triste' || em === 'pleure') { g.fillStyle = '#7fd3ff'; g.fillRect(28, 66, 6, 20 + ((st.t * 30) % 20)); g.fillRect(96, 66, 6, 20 + ((st.t * 30 + 10) % 20)); }
}
function creerActeur(id, def) {
  const look = def.look || {}; const g = new THREE.Group();
  const enfant = look.age === 'enfant', k = enfant ? 0.8 : 1;
  const haut = look.couleur_haut || '#f1c40f', bas = look.couleur_bas || '#27ae60', peau = look.peau || '#f5c99b';
  const jambeG = new THREE.Group(), jambeD = new THREE.Group();
  for (const j of [jambeG, jambeD]) { const m = boite(0.42, 0.9, 0.45, bas); m.position.y = -0.45; j.add(m); const c = boite(0.44, 0.16, 0.5, look.chaussures || '#333'); c.position.set(0, -0.85, 0.03); j.add(c); }
  jambeG.position.set(-0.23, 0.9, 0); jambeD.position.set(0.23, 0.9, 0);
  const torse = boite(0.95, 0.95, 0.5, haut); torse.position.y = 1.38;
  if (look.couleur_dessous) { const d = boite(0.5, 0.95, 0.02, look.couleur_dessous); d.position.set(0, 1.38, 0.26); g.add(d); }
  const brasG = new THREE.Group(), brasD = new THREE.Group();
  for (const [b, sx] of [[brasG, -1], [brasD, 1]]) { const m = boite(0.36, 0.95, 0.4, look.manches === 'courtes' ? peau : haut); m.position.y = -0.42; b.add(m); const main = boite(0.34, 0.18, 0.38, peau); main.position.y = -0.95; b.add(main); b.position.set(sx * 0.66, 1.82, 0); }
  const tete = new THREE.Group(); tete.position.y = 1.85;
  const c = document.createElement('canvas'); c.width = c.height = 128; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mPeau = mat(peau), mFace = mat('#ffffff', { map: tex });
  const crane = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), [mPeau, mPeau, mPeau, mPeau, mFace, mPeau]); crane.position.y = 0.4; crane.castShadow = true; tete.add(crane);
  const ch = look.couleur_cheveux || '#c0592b', st = look.cheveux || 'court';
  if (st !== 'chauve') {
    const dessus = boite(0.86, 0.22, 0.86, ch); dessus.position.y = 0.85; tete.add(dessus);
    if (st === 'epi' || st === 'boucle') for (let i = 0; i < 6; i++) { const p = boite(0.22, 0.22, 0.22, ch); p.position.set(-0.3 + (i % 3) * 0.3, 0.98, -0.2 + Math.floor(i / 3) * 0.3); p.rotation.set(0.3 * i, 0.5 * i, 0); tete.add(p); }
    const arr = boite(0.86, 0.55, 0.15, ch); arr.position.set(0, 0.6, -0.38); tete.add(arr);
    if (st === 'long' || st === 'queue' || st === 'chignon') { const l = boite(0.9, 0.9, 0.2, ch); l.position.set(0, 0.25, -0.42); tete.add(l); }
    if (st === 'chignon') { const b = boite(0.35, 0.35, 0.35, ch); b.position.set(0, 1.05, -0.1); tete.add(b); }
  }
  if (look.chapeau === 'haut_de_forme') { const h1 = boite(0.6, 0.6, 0.6, '#111'); h1.position.y = 1.15; tete.add(h1); const h2 = boite(0.95, 0.06, 0.95, '#111'); h2.position.y = 0.85; tete.add(h2); const r = boite(0.62, 0.1, 0.62, '#c0392b'); r.position.y = 0.92; tete.add(r); }
  if (look.chapeau === 'casque') { const h1 = boite(0.92, 0.3, 0.92, look.couleur_chapeau || '#f1c40f'); h1.position.y = 0.9; tete.add(h1); const v = boite(0.92, 0.06, 0.3, look.couleur_chapeau || '#f1c40f'); v.position.set(0, 0.78, 0.5); tete.add(v); }
  if (look.chapeau === 'casquette') { const h1 = boite(0.88, 0.22, 0.88, look.couleur_chapeau || '#e74c3c'); h1.position.y = 0.88; tete.add(h1); const v = boite(0.8, 0.06, 0.4, look.couleur_chapeau || '#e74c3c'); v.position.set(0, 0.8, 0.55); tete.add(v); }
  const tel = new THREE.Group(); tel.add(boite(0.36, 0.62, 0.06, '#111')); const ec = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.54), new THREE.MeshBasicMaterial({ color: 0x8fd3ff })); ec.position.z = 0.035; tel.add(ec); tel.visible = false; scene.add(tel);
  g.add(jambeG, jambeD, torse, brasG, brasD, tete); g.scale.setScalar(k); scene.add(g);
  return { id, def, look, g, jambeG, jambeD, brasG, brasD, tete, ctx: c.getContext('2d'), tex, cle: '', tel, ecran: ec, k };
}
function poserActeur(A, st, t) {
  const g = A.g; g.position.set(st.x, 0, st.z); g.rotation.y = st.rot;
  const sw = st.marche ? Math.sin(t * 9) * 0.6 : 0; A.jambeG.rotation.x = sw; A.jambeD.rotation.x = -sw;
  let bg = st.marche ? -sw * 0.8 : 0.05 * Math.sin(t * 2), bd = st.marche ? sw * 0.8 : -0.05 * Math.sin(t * 2), bgz = 0, bdz = 0, y = 0;
  A.tel.visible = false;
  if (st.anim === 'scroll' || st.tient === 'telephone') { bd = -1.2; bdz = 0.35; bg = -0.9; bgz = -0.3; A.tel.visible = true; }
  if (st.anim === 'danse') { bg = -2.6 + Math.sin(t * 8) * 0.6; bd = -2.6 - Math.sin(t * 8) * 0.6; y = Math.abs(Math.sin(t * 8)) * 0.25; g.rotation.y = st.rot + Math.sin(t * 4) * 0.4; }
  if (st.anim === 'saute' || st.anim === 'joie') { y = Math.abs(Math.sin(t * 6)) * 0.7; bg = -2.8; bd = -2.8; }
  if (st.anim === 'bras_leves') { bg = -2.9; bd = -2.9; bgz = -0.3; bdz = 0.3; }
  if (st.anim === 'porte') { y = 1.2 + Math.sin(t * 5) * 0.15; bg = -2.6; bd = -2.6; }
  if (st.anim === 'explique' || (st.parle && !st.anim && !A.tel.visible)) { bd = -0.6 + Math.sin(t * 6) * 0.35; }
  if (st.pose === 'assis') { A.jambeG.rotation.x = -1.5; A.jambeD.rotation.x = -1.5; y -= 0.45; }
  A.brasG.rotation.set(bg, 0, bgz); A.brasD.rotation.set(bd, 0, bdz); g.position.y = y;
  A.tete.rotation.set(st.parle ? Math.sin(t * 9) * 0.05 : 0, Math.sin(t * 0.7 + A.k) * 0.08, st.parle ? Math.sin(t * 4) * 0.04 : 0);
  if (A.tel.visible) { A.g.updateMatrixWorld(true); const p = new THREE.Vector3(0.15, -0.9, 0.12); A.brasD.localToWorld(p); A.tel.position.copy(p); A.tel.rotation.set(-0.5, st.rot, 0); A.ecran.material.color.setHSL(((t * 1.7) | 0) * 0.13 % 1, 0.7, 0.6); }
  const cle = [st.emotion, st.cligne, Math.round((st.bouche || 0) * 6), st.viseme, st.regard, (st.emotion === 'triste' ? (t * 10) | 0 : 0)].join('|');
  if (cle !== A.cle) { A.cle = cle; dessinerVisage(A.ctx, A.look, { ...st, t }); A.tex.needsUpdate = true; }
}

// ---------------- Construction de scène ----------------
function construire(si) {
  scene = new THREE.Scene(); acteurs3d = {}; foule = []; animables = [];
  const def = TL.projet.scenes[si]; const d = typeof def.decor === 'string' ? { nom: def.decor } : def.decor || { nom: 'couleur' };
  (DECORS[d.nom] || DECORS.couleur)(d);
  for (const a of def.acteurs || []) acteurs3d[a.id] = creerActeur(a.id, TL.projet.personnages[a.id] || {});
  const nF = def.foule || 0; const cs = ['#e74c3c', '#3498db', '#9b59b6', '#1abc9c', '#f39c12', '#e84393', '#2ecc71'];
  for (let i = 0; i < nF; i++) { const r = S.rand('foule' + si + i); const A = creerActeur('f' + i, { look: { couleur_haut: cs[i % 7], couleur_bas: cs[(i + 3) % 7], peau: ['#f5c99b', '#c68642', '#8d5524', '#ffdbac'][i % 4], cheveux: ['court', 'long', 'chauve', 'boucle'][i % 4], couleur_cheveux: ['#222', '#7a4a1e', '#d4a017', '#c0592b'][i % 4], age: r() < 0.2 ? 'enfant' : '' } }); foule.push({ A, x: (r() - 0.5) * 14, z: -3 + r() * 6, rot: (r() - 0.5) * 1.5, ph: r() * 6 }); }
  sceneCourante = si;
}
function etat(si, t) {
  const def = TL.projet.scenes[si], sc = TL.scenes[si], L = S.ligneA(TL, t, 0);
  const lignes = TL.lignes.filter((l) => l.scene === si); const res = {};
  (def.acteurs || []).forEach((a, i) => {
    const st = { x: a.x ?? (i - ((def.acteurs.length - 1) / 2)) * 1.8, z: a.z ?? 0, rot: (a.rot ?? 0) * Math.PI / 180, pose: a.pose || 'debout', anim: a.anim || null, tient: a.tient, emotion: a.emotion || 'neutre', regard: 0, marche: false };
    for (const l of lignes) { if (l.debut > t) break; for (const b of l.bouge || []) if (b.id === a.id) { const d = b.duree || Math.max(0.6, l.fin - l.debut); const p = clamp((t - l.debut) / d, 0, 1); if (b.x != null) st.x = lerp(st.x, b.x, ease(p)); if (b.z != null) st.z = lerp(st.z, b.z, ease(p)); if (p < 1 && (b.x != null || b.z != null)) st.marche = true; if (b.anim !== undefined) st.anim = b.anim; if (b.rot != null) st.rot = b.rot * Math.PI / 180; if (b.pose) st.pose = b.pose; if (b.tient !== undefined) st.tient = b.tient; }
      if (l.qui === a.id && l.emotion) st.emotion = l.emotion; if (l.reactions && l.reactions[a.id]) st.emotion = l.reactions[a.id]; if (l.anims && l.anims[a.id] !== undefined) st.anim = l.anims[a.id]; }
    if (L && L.scene === si) { if (L.qui === a.id || (L.qui === 'narrateur' && i === 0 && def.narrateur_visible !== false)) { st.parle = true; st.bouche = S.env(L, t, FPS); st.viseme = S.viseme(L, t); if (L.emotion) st.emotion = L.emotion; if (L.anim) st.anim = L.anim; } }
    st.cligne = ((t + hash(a.id) * 4) % 3.3) < 0.12;
    res[a.id] = st;
  });
  return res;
}
const PLANS = ['moyen', 'gros', 'large', 'trois_quart', 'plongee', 'bas', 'gros', 'moyen'];
function cadrer(si, t, etats) {
  const def = TL.projet.scenes[si], sc = TL.scenes[si]; const L = S.ligneA(TL, t, 0) || S.derniereLigne(TL, t, si);
  const lignesSc = TL.lignes.filter((l) => l.scene === si); const li = L && L.scene === si ? lignesSc.indexOf(L) : -1;
  let type = (L && L.scene === si && L.camera) || def.camera || 'auto';
  const gi = TL.lignes.indexOf(L);
  if (type === 'auto') type = li <= 0 ? (def.ouverture || 'large') : PLANS[Math.floor(hash('p' + gi) * PLANS.length)];
  let focusId = (L && L.focus) || (L && etats[L.qui] ? L.qui : null) || def.focus || Object.keys(etats)[0];
  const f = focusId && etats[focusId] ? etats[focusId] : { x: 0, z: 0, rot: 0 };
  const cible = new THREE.Vector3(f.x, 2.0, f.z), t0 = L && L.scene === si ? L.debut : sc.debut, p = clamp((t - t0) / 3, 0, 1);
  const fr = f.rot || 0, fwd = new THREE.Vector3(Math.sin(fr), 0, Math.cos(fr)), side = new THREE.Vector3(Math.cos(fr), 0, -Math.sin(fr));
  let pos; const v = W < H;
  const dist = (d) => d * (v ? 1.35 : 1);
  if (type === 'gros') { cible.y = 2.35; pos = cible.clone().add(fwd.clone().multiplyScalar(dist(2.7 - p * 0.3))).add(side.clone().multiplyScalar(0.3)).add(new THREE.Vector3(0, 0.15, 0)); }
  else if (type === 'moyen') { pos = cible.clone().add(fwd.clone().multiplyScalar(dist(4 - p * 0.4))).add(side.clone().multiplyScalar(0.6)).add(new THREE.Vector3(0, 0.6, 0)); }
  else if (type === 'trois_quart') { pos = cible.clone().add(fwd.clone().multiplyScalar(dist(3.6))).add(side.clone().multiplyScalar(2.4 - p * 0.6)).add(new THREE.Vector3(0, 0.8, 0)); }
  else if (type === 'plongee') { pos = cible.clone().add(fwd.clone().multiplyScalar(dist(2.5))).add(new THREE.Vector3(0, 6 - p * 0.6, 0)); }
  else if (type === 'bas') { cible.y = 2.4; pos = cible.clone().add(fwd.clone().multiplyScalar(dist(3))).add(new THREE.Vector3(0, -1.4, 0)); }
  else if (type === 'dos') { pos = cible.clone().add(fwd.clone().multiplyScalar(-3)).add(side.clone().multiplyScalar(1)).add(new THREE.Vector3(0, 0.8, 0)); cible.add(fwd.clone().multiplyScalar(4)); }
  else if (type === 'orbite') { const a = t * 0.3; pos = cible.clone().add(new THREE.Vector3(Math.sin(a) * dist(7), 3, Math.cos(a) * dist(7))); }
  else if (type === 'drone') { cible.set(0, 0, 0); pos = new THREE.Vector3(0, 14 - p * 2, dist(16)); }
  else { pos = cible.clone().add(fwd.clone().multiplyScalar(dist(9 - p * 1.2))).add(new THREE.Vector3(0, 3.5, 0)); cible.y = 1.6; }
  // évite qu'un autre acteur bouche la vue
  const bouche = (q) => { for (const id in etats) { if (id === focusId) continue; const o = etats[id]; const P = new THREE.Vector3(o.x, 1.8, o.z); if (P.distanceTo(q) < 1.4) return true; const seg = cible.clone().sub(q); const u = clamp(P.clone().sub(q).dot(seg) / seg.lengthSq(), 0, 1); if (u < 0.9 && q.clone().add(seg.multiplyScalar(u)).distanceTo(P) < 1.2) return true; } return false; };
  if (bouche(pos)) { for (const k of [1.8, -1.8, 3.6, -3.6]) { const q = pos.clone().add(side.clone().multiplyScalar(k)); if (!bouche(q)) { pos = q; break; } } }
  if (def.camera_pos) pos = new THREE.Vector3(...def.camera_pos);
  if (def.camera_cible) cible.set(...def.camera_cible);
  camera.position.copy(pos); camera.lookAt(cible);
  if (L && L.scene === si && ['surpris', 'choque'].includes(L.emotion) && t - L.debut < 0.3) camera.position.x += Math.sin(t * 70) * 0.05;
}

window.Cube3D = {
  init(timeline) {
    TL = timeline; W = TL.W; H = TL.H; FPS = TL.fps;
    renderer = new THREE.WebGLRenderer({ antialias: !timeline.rapide, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false); renderer.setPixelRatio(1); renderer.shadowMap.enabled = !TL.rapide; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
    camera = new THREE.PerspectiveCamera(W < H ? 62 : 45, W / H, 0.1, 200);
    out = document.getElementById('out'); octx = out.getContext('2d');
  },
  frame(t) {
    const sc = S.sceneA(TL, t), si = TL.scenes.indexOf(sc);
    if (si !== sceneCourante) construire(si);
    const etats = etat(si, t);
    for (const id in acteurs3d) poserActeur(acteurs3d[id], etats[id], t);
    for (const f of foule) poserActeur(f.A, { x: f.x, z: f.z, rot: f.rot, pose: TL.projet.scenes[si].foule_anim === 'assis' ? 'assis' : 'debout', anim: TL.projet.scenes[si].foule_anim === 'assis' ? null : (TL.projet.scenes[si].foule_anim || 'danse'), emotion: TL.projet.scenes[si].foule_emotion || 'content', cligne: false }, t + f.ph);
    for (const fn of animables) fn(t);
    cadrer(si, t, etats);
    renderer.render(scene, camera);
    octx.drawImage(renderer.domElement, 0, 0, W, H);
    const ancre = (qui) => { const A = acteurs3d[qui]; if (!A) return null; const p = new THREE.Vector3(); A.tete.getWorldPosition(p); p.y += 0.4 * A.k; const q = p.clone().project(camera); if (q.z > 1) return null; const p2 = p.clone(); p2.y += 0.45 * A.k; const q2 = p2.project(camera); const r = Math.abs(q2.y - q.y) * H / 2; return { x: (q.x + 1) / 2 * W, y: (1 - q.y) / 2 * H, r }; };
    S.symbole(octx, TL, t, W, H, ancre); S.inserts(octx, TL, t, W, H, ancre); S.sousTitres(octx, TL, t, W, H, ancre); S.transition(octx, TL, t, W, H);
  },
};
