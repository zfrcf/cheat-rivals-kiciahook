// Studio Histoires — moteur "plat2d" : animation 2D vectorielle style motion design
// Monde virtuel 1920x1080 (le décor déborde en haut/bas pour le format vertical).
(function () {
  const { clamp, lerp, ease, rr, shade, hash } = S;
  const P = (window.Plat2D = {});
  const WW = 1920, WH = 1080;
  let TL, ctx, W, H, FPS, baseScale;

  // ================= PRIMITIVES DE DÉCOR =================
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const rrect = (x, y, w, h, r, c, stroke) => { rr(ctx, x, y, w, h, r); ctx.fillStyle = c; ctx.fill(); if (stroke) { ctx.lineWidth = stroke[1]; ctx.strokeStyle = stroke[0]; ctx.stroke(); } };
  const disque = (x, y, r, c) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); };
  const ciel = (haut, bas) => { const g = ctx.createLinearGradient(0, -1000, 0, 900); g.addColorStop(0, haut); g.addColorStop(1, bas); ctx.fillStyle = g; ctx.fillRect(-2000, -1200, 6000, 2200); };
  const sol = (y, c) => rect(-2000, y, 6000, 2000, c);
  const PAL_IMM = ['#f7c873', '#f28b82', '#f6a97a', '#9ad1d4', '#c7a4e8', '#a8d672', '#f5d76e', '#ef8fa9'];
  function immeuble(x, yBas, w, h, c, nuit) {
    rect(x, yBas - h, w, h, c);
    const cols = Math.max(2, Math.floor(w / 55)), rows = Math.max(2, Math.floor(h / 70));
    const fw = w / cols, fh = h / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows - 0.5; j++) {
      const allume = nuit ? hash(x * 7 + i * 13 + j) > 0.45 : true;
      rrect(x + i * fw + fw * 0.22, yBas - h + j * fh + fh * 0.22, fw * 0.56, fh * 0.5, 4, nuit ? (allume ? '#ffe08a' : '#3b3f6b') : 'rgba(255,255,255,0.75)');
    }
  }
  function arbre(x, yBas, s, feuille, tronc = '#8a5a3c') {
    rect(x - 10 * s, yBas - 110 * s, 20 * s, 110 * s, tronc);
    disque(x, yBas - 150 * s, 70 * s, feuille); disque(x - 50 * s, yBas - 120 * s, 48 * s, feuille); disque(x + 52 * s, yBas - 118 * s, 50 * s, feuille);
    disque(x - 20 * s, yBas - 175 * s, 30 * s, shade(feuille, 0.18));
  }
  function nuage(x, y, s) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; [[0, 0, 40], [40, -15, 50], [85, 0, 38]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, 7); ctx.fill(); }); }
  function banc(x, y) { rect(x - 110, y - 70, 220, 18, '#b5713f'); rect(x - 110, y - 110, 220, 16, '#c98550'); rect(x - 95, y - 55, 14, 55, '#5b3a22'); rect(x + 81, y - 55, 14, 55, '#5b3a22'); }
  function enseigne(x, y, w, txt, c = '#2f8f5b') { rrect(x - w / 2, y - 30, w, 60, 8, c); S.texte(ctx, txt.toUpperCase(), x, y + 2, 34, '#fff', { contour: c, epaisseur: 0.05, ombre: false }); }
  function lumieresGuirlande(y, t) { ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.beginPath(); for (let x = -200; x <= 2120; x += 20) ctx.lineTo(x, y + Math.sin(x / 160) * 25); ctx.stroke(); const cs = ['#ff5c8a', '#ffd23f', '#3ec1f3', '#7bff8a']; for (let x = -200, i = 0; x <= 2120; x += 80, i++) disque(x, y + Math.sin(x / 160) * 25 + 12, 9, cs[i % 4] + (Math.sin(t * 6 + i) > 0 ? '' : '99')); }

  const AMB = {
    jour: ['#8fd3ff', '#d6f1ff'], coucher: ['#f7a35c', '#ffd9a0'], nuit: ['#0d1033', '#2a2f6b'], matin: ['#a5e1ff', '#fff3d6'],
  };

  // ================= DÉCORS =================
  const DECORS = {};
  DECORS.bus = (t, o) => {
    ciel('#2a2a5e', '#2a2a5e'); sol(1000, '#1f1f47'); rect(-2000, 455, 6000, 14, '#232350');
    const v = (t * (o.vitesse ?? 240)) % 1400;
    ctx.save(); ctx.beginPath(); for (let x = -880; x < 2900; x += 480) { const X = x + 22, Y = -260, w = 436, h = 700, r = 30; ctx.moveTo(X + r, Y); ctx.arcTo(X + w, Y, X + w, Y + h, r); ctx.arcTo(X + w, Y + h, X, Y + h, r); ctx.arcTo(X, Y + h, X, Y, r); ctx.arcTo(X, Y, X + w, Y, r); ctx.closePath(); } ctx.clip();
    rect(-2000, -300, 6000, 760, o.ambiance === 'nuit' ? '#1b2050' : '#c9ecff');
    for (let k = -2; k < 5; k++) { const bx = k * 1400 - v, n = o.ambiance === 'nuit'; immeuble(bx + 20, 440, 230, 330, '#f7c873', n); immeuble(bx + 300, 440, 260, 260, '#f28b82', n); arbre(bx + 640, 440, 1.1, '#6cc56a'); immeuble(bx + 760, 440, 220, 360, '#f6a97a', n); immeuble(bx + 1030, 440, 300, 300, '#b9e3f5', n); rect(bx, 400, 1400, 40, '#9aa0aa'); }
    if (o.panneau) { const px = 2600 - ((t * (o.vitesse ?? 240)) % 3400); rrect(px, 150, 300, 160, 12, '#ff7aa5', ['#fff', 8]); S.texte(ctx, o.panneau.toUpperCase(), px + 150, 230, 34, '#fff', { contour: '#d94a7a', epaisseur: 0.08, ombre: false }); }
    ctx.restore();
    // barres jaunes
    for (const bx of o.barres || [1210, 1720]) { rect(bx - 7, -100, 14, 1200, '#ffc531'); disque(bx, 610, 14, '#ff4d6d'); }
    // sièges
    for (const sx of SIEGES) { rrect(sx - 115, 520, 230, 420, 40, '#3b6fe0'); rrect(sx - 95, 545, 190, 330, 30, '#4f86f7'); for (let k = 0; k < 4; k++) rect(sx - 80, 600 + k * 50, 160, 5, 'rgba(255,255,255,0.18)'); rrect(sx - 125, 900, 250, 60, 22, '#2f5fcc'); }
  };
  const SIEGES = [-450, -130, 190, 510, 830, 1150, 1470, 1790, 2110, 2430];
  DECORS.rue = (t, o) => {
    const a = AMB[o.ambiance || 'jour']; ciel(a[0], a[1]); nuage(300 + (t * 10) % 300, 150, 1); nuage(1300 - (t * 8) % 300, 100, 0.8);
    const nuit = o.ambiance === 'nuit';
    immeuble(-300, 760, 380, 520, '#f6a97a', nuit); immeuble(110, 760, 300, 420, PAL_IMM[0], nuit); immeuble(1380, 760, 320, 460, PAL_IMM[1], nuit); immeuble(1720, 760, 420, 560, PAL_IMM[3], nuit);
    if (o.enseigne) { // boutique
      rect(470, 380, 860, 380, '#fff7ec'); for (let i = 0; i < 8; i++) rect(470 + i * 108, 330, 108, 60, i % 2 ? '#e2462f' : '#fff');
      enseigne(900, 300, Math.max(360, o.enseigne.length * 26), o.enseigne);
      rrect(560, 470, 680, 240, 10, '#bfe6ff', ['#5a4a3a', 8]);
      const cs = ['#ff5c8a', '#ffd23f', '#ff8a3d', '#c77dff', '#ff4d4d'];
      for (let i = 0; i < 12; i++) { rect(590 + i * 52, 650, 40, 50, '#8a5a3c'); for (let k = 0; k < 3; k++) disque(600 + i * 52 + k * 10, 640 - k * 8, 13, cs[(i + k) % 5]); }
    } else { immeuble(470, 760, 420, 380, PAL_IMM[4], nuit); immeuble(900, 760, 460, 470, PAL_IMM[2], nuit); }
    arbre(o.arbre_x ?? 160, 900, 1.25, o.arbre || (o.ambiance === 'coucher' ? '#f4a6c7' : '#5dbb63'));
    sol(760, '#d9d4cc'); rect(-2000, 760, 6000, 12, '#bdb6ab'); sol(930, '#8d8f99'); for (let x = -2000; x < 4000; x += 200) rect(x, 990, 110, 10, '#e9e9e9');
    if (o.banc !== false) banc(o.banc_x ?? 1500, 900);
    if (o.arret) { rect(1250, 560, 10, 340, '#555'); rrect(1205, 520, 100, 60, 10, '#2f6fe0'); S.texte(ctx, 'BUS', 1255, 551, 30, '#fff', { contour: '#2f6fe0', epaisseur: 0.04, ombre: false }); }
    if (nuit) lumieresGuirlande(120, t);
  };
  DECORS.cuisine = (t, o) => {
    ciel('#fde6b8', '#fde6b8'); for (let x = -2000; x < 4000; x += 70) rect(x, -1200, 30, 2200, 'rgba(255,255,255,0.25)');
    sol(860, '#c98b52'); rect(-2000, 860, 6000, 14, '#a8703f');
    rrect(1350, 180, 300, 240, 12, '#cfefff', ['#fff', 16]); rect(1495, 180, 10, 240, '#fff');
    rect(200, 540, 1300, 320, '#ecebf5'); rect(180, 520, 1340, 40, '#ffffff'); rect(450, 600, 340, 230, '#3a3a4a'); rrect(480, 640, 280, 150, 12, '#22222c');
    rect(470, 500, 120, 30, '#555'); rect(620, 495, 140, 35, '#666'); // casseroles
    for (let i = 0; i < 3; i++) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 6; ctx.beginPath(); const y0 = 480 - ((t * 40 + i * 25) % 70); ctx.moveTo(690 + i * 20, y0); ctx.quadraticCurveTo(700 + i * 20, y0 - 20, 690 + i * 20, y0 - 40); ctx.stroke(); }
    rrect(1600, 300, 260, 560, 20, '#f4f4f8', ['#d9d9e3', 6]); rect(1620, 520, 220, 6, '#d9d9e3'); rect(1630, 360, 12, 100, '#bbb');
    rect(-200, 160, 340, 30, '#c98b52'); rect(-180, 120, 60, 40, '#e86a5a'); rect(-100, 110, 50, 50, '#5ab0e8');
  };
  DECORS.chambre = (t, o) => {
    ciel('#7fb3e8', '#7fb3e8'); for (let x = -2000; x < 4000; x += 90) rect(x, -1200, 45, 2200, 'rgba(255,255,255,0.08)');
    sol(860, '#7a5bd1'); rect(-2000, 860, 6000, 16, '#6246b8');
    rrect(1300, 180, 320, 280, 14, o.ambiance === 'nuit' ? '#1b2050' : '#d6f1ff', ['#fff', 16]); rect(1452, 180, 12, 280, '#fff');
    if (o.ambiance === 'nuit') disque(1540, 260, 36, '#fff3b0');
    rrect(80, 640, 600, 220, 30, '#3f5bd8'); rrect(60, 560, 90, 300, 20, '#2c3e9e'); rrect(120, 620, 170, 70, 30, '#ffffff'); rrect(250, 650, 420, 120, 30, '#ff9fb5');
    rrect(820, 260, 200, 260, 10, '#ffd23f'); S.texte(ctx, '★', 920, 390, 120, '#ff8a3d', { contour: '#fff', epaisseur: 0.02, ombre: false });
    rect(1700, 600, 200, 260, '#b5713f'); rect(1760, 470, 16, 130, '#444'); ctx.beginPath(); ctx.moveTo(1710, 470); ctx.lineTo(1830, 470); ctx.lineTo(1800, 400); ctx.lineTo(1740, 400); ctx.fillStyle = '#ffe08a'; ctx.fill();
  };
  DECORS.buanderie = (t, o) => {
    ciel('#d7e6f5', '#d7e6f5'); sol(880, '#9fb2c6');
    for (const x of [260, 520]) { rrect(x, 560, 230, 320, 16, '#f7f9fc', ['#c9d3de', 6]); disque(x + 115, 730, 80, '#bcd9f0'); disque(x + 115, 730, 60, '#7fb5e0'); ctx.save(); ctx.translate(x + 115, 730); ctx.rotate(t * 4); rect(-40, -5, 80, 10, 'rgba(255,255,255,0.6)'); ctx.restore(); rect(x + 20, 580, 60, 14, '#c9d3de'); }
    ctx.strokeStyle = '#555'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(900, 180); ctx.lineTo(1800, 180); ctx.stroke();
    const cs = ['#2bb39a', '#f5a623', '#3b4ba8', '#2bb39a', '#e2462f', '#7b4dff'];
    cs.forEach((c, i) => { const x = 950 + i * 140, sw = Math.sin(t * 2 + i) * 4; ctx.save(); ctx.translate(x, 180); ctx.rotate(sw * 0.01); rrect(-45, 0, 90, 110, 10, c); rect(-60, 0, 120, 30, c); ctx.restore(); });
    rect(1000, 600, 12, 280, '#888'); rect(1600, 600, 12, 280, '#888'); rect(990, 600, 630, 10, '#999');
  };
  DECORS.salon = (t, o) => {
    ciel('#f3e2c7', '#f3e2c7'); sol(860, '#b07a4f'); rect(-2000, 860, 6000, 14, '#8f5f3a');
    rrect(500, 600, 900, 260, 40, '#e86a5a'); rrect(470, 520, 960, 140, 50, '#d65a4b'); rrect(440, 600, 110, 260, 40, '#c44d40'); rrect(1350, 600, 110, 260, 40, '#c44d40');
    rrect(1550, 300, 300, 200, 14, '#22222c', ['#444', 10]); rect(1690, 500, 20, 80, '#444'); rect(1620, 860 - 280, 160, 20, '#8f5f3a');
    rect(170, 680, 30, 180, '#8a5a3c'); disque(185, 640, 80, '#5dbb63'); rrect(120, 760, 130, 100, 16, '#f4f4f8');
    rrect(700, 160, 260, 200, 8, '#9ad1d4', ['#fff', 14]); rrect(1020, 200, 200, 160, 8, '#f5d76e', ['#fff', 14]);
  };
  DECORS.parc = (t, o) => {
    const a = AMB[o.ambiance || 'jour']; ciel(a[0], a[1]);
    if (o.ambiance === 'coucher') { disque(380, 260, 220, 'rgba(255,230,180,0.35)'); disque(380, 260, 140, '#ffe8b0'); } else disque(1700, 140, 70, '#fff3b0');
    nuage(500 + (t * 12) % 200, 140, 1.1);
    sol(760, '#8fd46b'); disque(300, 1300, 700, '#7cc75a'); disque(1600, 1350, 800, '#86cf62');
    arbre(250, 780, 1.6, '#4fae5a'); arbre(1650, 790, 1.8, '#46a052'); arbre(1100, 760, 1.1, '#5dbb63');
    if (o.cloture) { for (let x = -100; x < 2100; x += 60) rect(x, 700, 10, 160, '#3a3a4a'); rect(-100, 720, 2200, 8, '#3a3a4a'); rect(-100, 820, 2200, 8, '#3a3a4a'); }
    sol(930, '#e8d8b0'); rect(-2000, 930, 6000, 10, '#d4c294');
    if (o.banc) banc(o.banc_x ?? 1400, 935);
    if (o.fleurs !== false) for (let i = 0; i < 18; i++) { const x = (i * 137) % 1920, y = 800 + (i * 53) % 110; disque(x, y, 9, ['#ff5c8a', '#ffd23f', '#fff', '#c77dff'][i % 4]); }
  };
  DECORS.cimetiere = (t, o) => {
    DECORS.parc(t, { ambiance: o.ambiance || 'coucher', cloture: true, fleurs: false });
    const tombes = o.tombes || [[220, ''], [620, o.nom || ''], [1000, ''], [1500, '']];
    for (const [x, nom] of tombes) { rrect(x - 70, 700, 140, 190, 60, '#a7a7b8'); rrect(x - 60, 710, 120, 170, 55, '#bdbdcc'); rect(x - 80, 880, 160, 20, '#8d8da0'); if (nom) S.texte(ctx, nom.toUpperCase(), x, 770, 24, '#6b6b80', { contour: '#bdbdcc', epaisseur: 0.02, ombre: false }); }
  };
  DECORS.salle_sport = (t, o) => {
    ciel('#2b2d42', '#2b2d42'); for (let x = -2000; x < 4000; x += 240) rect(x, -1200, 120, 2200, 'rgba(255,255,255,0.03)');
    rect(-2000, 120, 6000, 26, o.couleur || '#ff6b35'); rect(-2000, 160, 6000, 10, '#ffc531');
    if (o.enseigne) S.texte(ctx, o.enseigne.toUpperCase(), 960, 75, 64, '#fff', { contour: o.couleur || '#ff6b35', epaisseur: 0.12 });
    rrect(200, 220, 700, 420, 8, '#8fb8d8', ['#c0c6d0', 12]); rect(220, 240, 120, 380, 'rgba(255,255,255,0.18)'); rrect(1000, 220, 700, 420, 8, '#8fb8d8', ['#c0c6d0', 12]); rect(1020, 240, 120, 380, 'rgba(255,255,255,0.18)');
    sol(860, '#3d3f52'); for (let x = -2000; x < 4000; x += 160) rect(x, 860, 4, 600, 'rgba(0,0,0,0.25)');
    rect(150, 700, 600, 16, '#888'); rect(170, 716, 14, 140, '#666'); rect(716, 716, 14, 140, '#666');
    for (let i = 0; i < 6; i++) { const x = 200 + i * 95; rect(x, 676, 50, 14, '#333'); disque(x, 683, 18, '#222'); disque(x + 50, 683, 18, '#222'); }
    // tapis de course
    rrect(1250, 760, 420, 70, 20, '#222'); rect(1610, 560, 20, 220, '#444'); rrect(1560, 520, 120, 60, 10, '#555'); rrect(1580, 535, 80, 30, 6, '#3ec1f3');
    for (let k = 0; k < 6; k++) rect(1270 + ((t * 300 + k * 70) % 380), 775, 30, 6, '#444');
  };
  DECORS.bureau = (t, o) => {
    ciel('#e6eef5', '#e6eef5'); sol(860, '#9aa7b8');
    rrect(1250, 150, 520, 360, 10, '#bfe6ff', ['#fff', 14]); for (let k = 0; k < 9; k++) rect(1260, 165 + k * 38, 500, 14, 'rgba(255,255,255,0.7)');
    rect(300, 620, 1000, 30, '#c98b52'); rect(330, 650, 30, 210, '#8f5f3a'); rect(1240, 650, 30, 210, '#8f5f3a');
    rrect(600, 400, 340, 220, 12, '#22222c'); rrect(615, 415, 310, 180, 8, '#3ec1f3'); rect(750, 600, 40, 30, '#444');
    rect(1700, 700, 30, 160, '#8a5a3c'); disque(1715, 660, 70, '#5dbb63'); rrect(1660, 760, 110, 100, 14, '#e86a5a');
  };
  DECORS.ville_nuit = (t, o) => {
    ciel('#0b0d2e', '#2e2a6b'); for (let i = 0; i < 60; i++) disque((i * 331) % 1920, (i * 97) % 450 - 200, 2 + (i % 3), `rgba(255,255,255,${0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i))})`);
    disque(1600, 120, 60, '#fff3b0');
    for (let i = 0; i < 9; i++) immeuble(-200 + i * 260, 780, 230, 300 + ((i * 97) % 300), ['#2c2f5e', '#33386e', '#3b2f63'][i % 3], true);
    sol(780, '#3a3f66'); sol(930, '#25284a'); lumieresGuirlande(200, t);
  };
  DECORS.porte = (t, o) => {
    ciel('#f6d9a8', '#f6d9a8'); for (let x = -2000; x < 4000; x += 60) rect(x, -1200, 26, 2200, 'rgba(255,255,255,0.2)');
    sol(900, '#c98b52');
    rect(760, 200, 400, 700, '#8a5a3c'); rect(790, 230, 340, 670, o.ouverte === false ? '#b5713f' : '#fff1c9');
    if (o.ouverte !== false) { ctx.fillStyle = 'rgba(255,230,150,0.35)'; ctx.beginPath(); ctx.moveTo(790, 900); ctx.lineTo(1130, 900); ctx.lineTo(1300, 1080); ctx.lineTo(620, 1080); ctx.fill(); }
    rrect(780, 905, 360, 50, 10, '#e86a8a'); S.texte(ctx, (o.texte || 'BIENVENUE'), 960, 931, 26, '#fff', { contour: '#e86a8a', epaisseur: 0.04, ombre: false });
    rect(560, 780, 120, 120, '#e86a5a'); disque(620, 740, 70, '#5dbb63'); rect(1240, 780, 120, 120, '#e86a5a'); disque(1300, 740, 70, '#5dbb63');
  };
  DECORS.immeuble = (t, o) => {
    ciel('#a5e1ff', '#e6f7ff'); rect(-400, -200, 2720, 1100, o.couleur || '#f6a97a');
    for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) rrect(-300 + i * 330, -100 + j * 220, 160, 150, 10, '#fde6b8', ['#fff', 8]);
    for (let i = 0; i < 6; i++) { const x = -150 + i * 400; rrect(x, 560, 180, 340, 10, '#5a3a22'); disque(x + 150, 740, 8, '#ffc531'); }
    sol(900, '#cfcfd6');
  };
  DECORS.couleur = (t, o) => { ciel(o.couleur || '#7b4dff', o.couleur2 || o.couleur || '#7b4dff'); };

  // ================= PERSONNAGES =================
  function cheveux(look, r, avant) {
    const c = look.couleur_cheveux || '#2a2238', st = look.cheveux || 'court';
    ctx.fillStyle = c;
    if (!avant) {
      if (st === 'long' || st === 'queue') { rr(ctx, -r * 1.05, -r * 0.6, r * 2.1, r * 1.8, r * 0.6); ctx.fill(); }
      if (st === 'chignon') { disque(0, -r * 1.12, r * 0.38, c); }
      if (st === 'boucle') { for (let i = 0; i < 9; i++) { const a = Math.PI + (i / 8) * Math.PI; disque(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.85 - r * 0.15, r * 0.36, c); } }
      return;
    }
    if (st === 'chauve') { ctx.beginPath(); ctx.ellipse(-r * 0.85, -r * 0.1, r * 0.22, r * 0.35, 0, 0, 7); ctx.ellipse(r * 0.85, -r * 0.1, r * 0.22, r * 0.35, 0, 0, 7); ctx.fill(); return; }
    if (st === 'boucle') { for (let i = 0; i < 7; i++) disque(-r * 0.7 + i * r * 0.23, -r * 0.78 + Math.sin(i * 1.3) * r * 0.05, r * 0.26, c); return; }
    ctx.beginPath(); ctx.moveTo(-r * 0.98, -r * 0.05);
    ctx.bezierCurveTo(-r * 1.05, -r * 1.25, r * 1.05, -r * 1.25, r * 0.98, -r * 0.05);
    if (st === 'long' || st === 'queue' || st === 'chignon') { ctx.bezierCurveTo(r * 0.7, -r * 0.6, r * 0.1, -r * 0.75, 0, -r * 0.62); ctx.bezierCurveTo(-r * 0.1, -r * 0.75, -r * 0.7, -r * 0.6, -r * 0.98, -r * 0.05); }
    else { ctx.bezierCurveTo(r * 0.8, -r * 0.45, r * 0.2, -r * 0.6, -r * 0.2, -r * 0.5); ctx.bezierCurveTo(-r * 0.5, -r * 0.45, -r * 0.8, -r * 0.35, -r * 0.98, -r * 0.05); }
    ctx.fill();
    if (st === 'epi') { ctx.beginPath(); ctx.moveTo(-r * 0.1, -r * 0.95); ctx.quadraticCurveTo(r * 0.05, -r * 1.55, r * 0.35, -r * 1.35); ctx.quadraticCurveTo(r * 0.1, -r * 1.25, r * 0.2, -r * 0.95); ctx.fill(); }
    if (st === 'queue') { ctx.beginPath(); ctx.ellipse(r * 1.0, r * 0.1, r * 0.22, r * 0.55, -0.3, 0, 7); ctx.fill(); }
  }
  function chapeau(look, r) {
    const h = look.chapeau; if (!h) return; const c = look.couleur_chapeau || '#7a5a3c';
    if (h === 'beret' || h === 'casquette_plate') { ctx.beginPath(); ctx.ellipse(0, -r * 0.72, r * 1.08, r * 0.42, 0, Math.PI, 0); ctx.lineTo(r * 1.15, -r * 0.6); ctx.lineTo(-r * 0.95, -r * 0.62); ctx.fillStyle = c; ctx.fill(); rr(ctx, -r * 0.2, -r * 0.72, r * 1.4, r * 0.18, r * 0.09); ctx.fillStyle = shade(c, -0.2); ctx.fill(); }
    else if (h === 'casquette') { ctx.beginPath(); ctx.ellipse(0, -r * 0.62, r * 1.0, r * 0.62, 0, Math.PI, 0); ctx.fillStyle = c; ctx.fill(); rr(ctx, -r * 0.1, -r * 0.7, r * 1.35, r * 0.2, r * 0.1); ctx.fillStyle = shade(c, -0.2); ctx.fill(); }
    else if (h === 'bonnet') { ctx.beginPath(); ctx.ellipse(0, -r * 0.55, r * 1.02, r * 0.75, 0, Math.PI, 0); ctx.fillStyle = c; ctx.fill(); rect(-r * 1.02, -r * 0.62, r * 2.04, r * 0.22, shade(c, -0.2)); disque(0, -r * 1.35, r * 0.18, '#fff'); }
    else if (h === 'haut_de_forme') { rect(-r * 0.6, -r * 1.9, r * 1.2, r * 1.1, '#222'); rect(-r * 1.0, -r * 0.85, r * 2.0, r * 0.18, '#222'); rect(-r * 0.6, -r * 1.05, r * 1.2, r * 0.16, '#c0392b'); }
  }
  function visage(look, r, st) {
    const peau = look.peau || '#f2c39b', em = ({ pleure: 'triste', joie: 'rire' })[st.emotion] || st.emotion || 'neutre', rg = st.regard || 0;
    // oreilles
    disque(-r * 0.95, r * 0.05, r * 0.2, shade(peau, -0.06)); disque(r * 0.95, r * 0.05, r * 0.2, shade(peau, -0.06));
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.97, r, 0, 0, 7); ctx.fillStyle = peau; ctx.fill();
    // joues
    ctx.globalAlpha = 0.35; disque(-r * 0.55, r * 0.3, r * 0.16, '#ff7a7a'); disque(r * 0.55, r * 0.3, r * 0.16, '#ff7a7a'); ctx.globalAlpha = 1;
    if (look.age === 'vieux') { ctx.strokeStyle = shade(peau, -0.25); ctx.lineWidth = r * 0.03; ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.5); ctx.lineTo(r * 0.3, -r * 0.5); ctx.stroke(); }
    // yeux
    const blink = st.cligne ? 0.1 : 1;
    const yeuxRieurs = em === 'rire' || em === 'heureux';
    for (const sx of [-1, 1]) {
      const ex = sx * r * 0.36, ey = -r * 0.02;
      if (yeuxRieurs) { ctx.strokeStyle = S.ENCRE; ctx.lineWidth = r * 0.07; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(ex, ey + r * 0.06, r * 0.14, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); continue; }
      const big = em === 'surpris' || em === 'choque' ? 1.2 : 1;
      ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.2 * big, r * 0.24 * big * blink, 0, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = r * 0.035; ctx.strokeStyle = S.ENCRE; ctx.stroke();
      if (blink > 0.5) { const pr = r * (em === 'surpris' || em === 'choque' ? 0.08 : 0.12); disque(ex + rg * r * 0.06, ey + r * 0.03, pr, S.ENCRE); disque(ex + rg * r * 0.06 + pr * 0.35, ey - pr * 0.2, pr * 0.32, '#fff'); }
      if (em === 'blase' || em === 'gene' || em === 'fatigue') { ctx.save(); ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.21, r * 0.25, 0, 0, 7); ctx.clip(); rect(ex - r * 0.25, ey - r * 0.3, r * 0.5, r * 0.27, peau); ctx.restore(); ctx.strokeStyle = S.ENCRE; ctx.lineWidth = r * 0.04; ctx.beginPath(); ctx.moveTo(ex - r * 0.2, ey - r * 0.03); ctx.lineTo(ex + r * 0.2, ey - r * 0.03); ctx.stroke(); }
    }
    // sourcils
    ctx.strokeStyle = look.couleur_sourcils || (look.cheveux === 'chauve' ? '#ccc' : (look.couleur_cheveux || '#2a2238')); ctx.lineWidth = r * 0.07; ctx.lineCap = 'round';
    const sb = { triste: [0.12, -0.08], fache: [-0.14, 0.1], surpris: [0, 0], choque: [0, 0], gene: [0.08, -0.04] }[em] || [0, 0];
    const lift = em === 'surpris' || em === 'choque' ? -r * 0.12 : 0;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * r * 0.52, -r * 0.33 + lift + sb[1] * r * 0); ctx.lineTo(sx * r * 0.2, -r * 0.33 + lift + sb[0] * r * -1); ctx.stroke(); }
    // nez
    ctx.strokeStyle = shade(peau, -0.25); ctx.lineWidth = r * 0.045; ctx.beginPath(); ctx.arc(0, r * 0.16, r * 0.08, 0.2, Math.PI - 0.2); ctx.stroke();
    // lunettes
    if (look.lunettes) { ctx.strokeStyle = look.couleur_lunettes || '#5a3a22'; ctx.lineWidth = r * 0.06; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * r * 0.36, -r * 0.02, r * 0.28, 0, 7); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(-r * 0.08, -r * 0.05); ctx.lineTo(r * 0.08, -r * 0.05); ctx.stroke(); }
    // barbe
    if (look.barbe) { const bc = look.couleur_barbe || '#f4f4f4'; ctx.beginPath(); ctx.moveTo(-r * 0.92, r * 0.05); ctx.quadraticCurveTo(-r * 0.85, r * 1.25, 0, r * 1.25); ctx.quadraticCurveTo(r * 0.85, r * 1.25, r * 0.92, r * 0.05); ctx.quadraticCurveTo(r * 0.5, r * 0.55, 0, r * 0.3); ctx.quadraticCurveTo(-r * 0.5, r * 0.55, -r * 0.92, r * 0.05); ctx.fillStyle = bc; ctx.fill(); }
    if (look.moustache) { ctx.fillStyle = look.couleur_barbe || look.couleur_cheveux || '#3a2a20'; ctx.beginPath(); ctx.ellipse(-r * 0.14, r * 0.33, r * 0.18, r * 0.08, 0.2, 0, 7); ctx.ellipse(r * 0.14, r * 0.33, r * 0.18, r * 0.08, -0.2, 0, 7); ctx.fill(); }
    // bouche
    const my = r * 0.47, o = st.bouche || 0;
    ctx.lineCap = 'round';
    if (o > 0.08) {
      const h = r * (0.06 + o * 0.26), w = r * (0.22 + o * 0.08);
      ctx.beginPath(); ctx.ellipse(0, my, w, h, 0, 0, 7); ctx.fillStyle = '#7a2230'; ctx.fill();
      ctx.save(); ctx.clip(); disque(0, my + h * 0.9, w * 0.7, '#ff7a8a'); rect(-w, my - h, w * 2, h * 0.35, '#fff'); ctx.restore();
      ctx.lineWidth = r * 0.035; ctx.strokeStyle = S.ENCRE; ctx.beginPath(); ctx.ellipse(0, my, w, h, 0, 0, 7); ctx.stroke();
    } else {
      ctx.strokeStyle = S.ENCRE; ctx.lineWidth = r * 0.055; ctx.beginPath();
      if (em === 'content' || em === 'heureux' || em === 'neutre_sourire') ctx.arc(0, my - r * 0.12, r * 0.2, 0.25 * Math.PI, 0.75 * Math.PI);
      else if (em === 'rire') { ctx.moveTo(-r * 0.22, my - r * 0.05); ctx.quadraticCurveTo(0, my + r * 0.35, r * 0.22, my - r * 0.05); ctx.closePath(); ctx.fillStyle = '#7a2230'; ctx.fill(); }
      else if (em === 'triste') ctx.arc(0, my + r * 0.14, r * 0.17, 1.2 * Math.PI, 1.8 * Math.PI);
      else if (em === 'surpris' || em === 'choque') { ctx.ellipse(0, my, r * 0.09, r * 0.12, 0, 0, 7); ctx.fillStyle = '#7a2230'; ctx.fill(); }
      else if (em === 'fache') { ctx.moveTo(-r * 0.16, my + r * 0.04); ctx.lineTo(r * 0.16, my); }
      else if (em === 'blase' || em === 'gene') { ctx.moveTo(-r * 0.14, my); ctx.quadraticCurveTo(0, my - r * 0.04, r * 0.16, my + r * 0.03); }
      else ctx.arc(0, my - r * 0.06, r * 0.13, 0.3 * Math.PI, 0.7 * Math.PI);
      ctx.stroke();
    }
  }
  function objet(nom, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (nom === 'telephone') { rrect(-22, -40, 44, 76, 8, '#22222c'); rrect(-17, -34, 34, 62, 5, '#8fd3ff'); }
    else if (nom === 'bouquet') { ctx.beginPath(); ctx.moveTo(-45, -30); ctx.lineTo(45, -30); ctx.lineTo(12, 70); ctx.lineTo(-12, 70); ctx.fillStyle = '#e8c89a'; ctx.fill(); for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; disque(Math.cos(a) * 28 * (i % 2 ? 1 : 0.5), -45 + Math.sin(a) * 16, 17, i % 2 ? '#e63950' : '#ff4d6d'); disque(Math.cos(a) * 28 * (i % 2 ? 1 : 0.5) + 3, -48 + Math.sin(a) * 16, 6, '#b51f3a'); } }
    else if (nom === 'tasse') { rrect(-25, -30, 50, 55, 8, '#fff', ['#ccc', 3]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(28, -5, 14, -1.3, 1.3); ctx.stroke(); }
    else if (nom === 'haltere') { rect(-55, -6, 110, 12, '#666'); rrect(-70, -28, 22, 56, 6, '#222'); rrect(48, -28, 22, 56, 6, '#222'); }
    else if (nom === 'sac') { rrect(-40, -20, 80, 70, 10, '#e86a5a'); ctx.strokeStyle = '#a8443a'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(0, -20, 22, Math.PI, 0); ctx.stroke(); }
    else if (nom === 'livre') { rect(-40, -30, 80, 60, '#3b6fe0'); rect(-2, -30, 4, 60, '#fff'); }
    else if (nom === 'cadeau') { rrect(-38, -30, 76, 64, 6, '#ff5c8a'); rect(-6, -30, 12, 64, '#ffd23f'); rect(-38, -4, 76, 10, '#ffd23f'); disque(-12, -36, 12, '#ffd23f'); disque(12, -36, 12, '#ffd23f'); }
    else if (nom === 'gourde') { rrect(-16, -45, 32, 85, 10, '#3ec1f3'); rect(-10, -55, 20, 12, '#222'); }
    ctx.restore();
  }
  function bras(x0, y0, x1, y1, couleur, peau, ep) { ctx.strokeStyle = couleur; ctx.lineWidth = ep; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + (x1 - x0) * 0.1, (y0 + y1) / 2 + 12, x1, y1); ctx.stroke(); disque(x1, y1, ep * 0.55, peau); }

  function dessinerPerso(def, st) {
    const look = def.look || {}; const peau = look.peau || '#f2c39b';
    const haut = look.couleur_haut || '#2bb39a', bas = look.couleur_bas || '#2c3e70';
    const enfant = look.age === 'enfant', echelle = (st.echelle || 1) * (enfant ? 0.78 : look.age === 'vieux' ? 0.97 : 1);
    ctx.save(); ctx.translate(st.x, st.y - (st.saut || 0)); ctx.scale(echelle, echelle);
    const assis = st.pose === 'assis';
    const resp = Math.sin(st.t * 2.2 + st.graine * 6) * 3;
    const r = enfant ? 92 : 84;
    const torseH = 170, torseBas = assis ? -110 : -150, torseHaut = torseBas - torseH + resp * 0.3;
    // ombre
    ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.ellipse(0, 4, 90, 16, 0, 0, 7); ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1;
    // jambes
    const pas = st.marche != null ? Math.sin(st.marche) : 0;
    if (assis) { rrect(-58, torseBas - 10, 50, 120, 20, bas); rrect(8, torseBas - 10, 50, 120, 20, bas); rrect(-66, -14, 62, 26, 12, look.chaussures || '#e8e8f0'); rrect(4, -14, 62, 26, 12, look.chaussures || '#e8e8f0'); }
    else {
      for (const [sx, ph] of [[-1, pas], [1, -pas]]) { ctx.save(); ctx.translate(sx * 24, torseBas); ctx.rotate(ph * 0.35); rrect(-20, -10, 40, 160, 18, bas); rrect(-26 + sx * 4, 135, 56, 26, 12, look.chaussures || '#e8e8f0'); ctx.restore(); }
    }
    // cheveux arrière
    const headY = torseHaut - r * 0.92 + (st.parle ? Math.sin(st.t * 9) * 2 : 0);
    ctx.save(); ctx.translate(st.regard * 4, headY); ctx.rotate((st.parle ? Math.sin(st.t * 3.1) * 0.03 : 0) + st.regard * 0.03); cheveux(look, r, false); ctx.restore();
    // torse
    const type = look.haut || 'sweat';
    if (type === 'robe') { ctx.beginPath(); ctx.moveTo(-55, torseHaut + 10); ctx.lineTo(55, torseHaut + 10); ctx.lineTo(85, torseBas + 40); ctx.lineTo(-85, torseBas + 40); ctx.closePath(); ctx.fillStyle = haut; ctx.fill(); rrect(-60, torseHaut, 120, 90, 40, haut); }
    else rrect(-64, torseHaut, 128, torseH + 14, 46, haut);
    if (type === 'sweat') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-14, torseHaut + 10); ctx.lineTo(-16, torseHaut + 60); ctx.moveTo(14, torseHaut + 10); ctx.lineTo(16, torseHaut + 60); ctx.stroke(); rrect(-44, torseBas - 64, 88, 44, 16, shade(haut, -0.12)); }
    if (type === 'veste') { ctx.fillStyle = look.couleur_dessous || '#f1e6d0'; ctx.beginPath(); ctx.moveTo(-26, torseHaut + 4); ctx.lineTo(26, torseHaut + 4); ctx.lineTo(0, torseHaut + 80); ctx.fill(); ctx.strokeStyle = shade(haut, -0.25); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, torseHaut + 80); ctx.lineTo(0, torseBas); ctx.stroke(); disque(-8, torseHaut + 110, 5, shade(haut, -0.35)); disque(-8, torseHaut + 140, 5, shade(haut, -0.35)); }
    if (type === 'debardeur') { rrect(-64, torseHaut, 128, torseH + 14, 46, haut); ctx.fillStyle = peau; ctx.beginPath(); ctx.ellipse(-58, torseHaut + 20, 20, 40, 0, 0, 7); ctx.ellipse(58, torseHaut + 20, 20, 40, 0, 0, 7); ctx.fill(); }
    if (type === 'chemise') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-24, torseHaut + 2); ctx.lineTo(0, torseHaut + 30); ctx.lineTo(24, torseHaut + 2); ctx.fill(); for (let k = 0; k < 4; k++) disque(0, torseHaut + 45 + k * 30, 4, shade(haut, -0.3)); }
    if (look.logo) S.texte(ctx, look.logo, 0, torseHaut + 75, 26, '#fff', { contour: shade(haut, -0.3), epaisseur: 0.1, ombre: false });
    // bras
    const manche = type === 'debardeur' ? peau : haut, ep = 30;
    const sy = torseHaut + 34, g = st.geste, side = st.regard >= 0 ? 1 : -1, wav = Math.sin(st.t * 8);
    const tient = st.tient && st.tient !== 'rien';
    let mainG = [-74, torseBas - 22], mainD = [74, torseBas - 22];
    if (tient) { mainG = [-26, torseHaut + 118]; mainD = [26, torseHaut + 118]; }
    if (st.marche != null && !tient) { mainG = [-80 + pas * 20, torseBas - 26]; mainD = [80 - pas * 20, torseBas - 26]; }
    const gesteBras = (arr) => { if (side > 0) mainD = arr; else mainG = [-arr[0], arr[1]]; };
    if (g === 'pointe' || g === 'explique') gesteBras([170 + (g === 'explique' ? wav * 14 : 0), torseHaut + 70 + (g === 'explique' ? wav * 10 : 0)]);
    else if (g === 'salue') gesteBras([120 + wav * 18, torseHaut - 90]);
    else if (g === 'leve_bras' || g === 'joie') { mainG = [-130, torseHaut - 110 + wav * 8]; mainD = [130, torseHaut - 110 - wav * 8]; }
    else if (g === 'bras_croises') { mainG = [40, torseHaut + 80]; mainD = [-40, torseHaut + 90]; }
    else if (g === 'mains_hanches') { mainG = [-50, torseBas - 30]; mainD = [50, torseBas - 30]; }
    else if (g === 'tete') gesteBras([40, torseHaut - 120]);
    else if (g === 'haussement') { mainG = [-140, torseHaut + 30 + wav * 5]; mainD = [140, torseHaut + 30 + wav * 5]; }
    const coudeG = g === 'mains_hanches' ? [-110, torseHaut + 80] : null, coudeD = g === 'mains_hanches' ? [110, torseHaut + 80] : null;
    if (coudeG) { bras(-56, sy, coudeG[0], coudeG[1], manche, manche, ep); bras(coudeG[0], coudeG[1], mainG[0], mainG[1], manche, peau, ep); bras(56, sy, coudeD[0], coudeD[1], manche, manche, ep); bras(coudeD[0], coudeD[1], mainD[0], mainD[1], manche, peau, ep); }
    else {
      if (tient) objet(st.tient, (mainG[0] + mainD[0]) / 2 || 0, Math.min(mainG[1], mainD[1]) - 10, 1);
      bras(-56, sy, mainG[0], mainG[1], manche, peau, ep); bras(56, sy, mainD[0], mainD[1], manche, peau, ep);
      if (tient && st.tient === 'telephone') objet('telephone', 0, torseHaut + 100, 0.9);
    }
    // tête
    ctx.save(); ctx.translate(st.regard * 4, headY); ctx.rotate((st.parle ? Math.sin(st.t * 3.1) * 0.03 : 0) + st.regard * 0.03 + (st.secoue || 0));
    visage(look, r, st); cheveux(look, r, true); chapeau(look, r);
    ctx.restore();
    ctx.restore();
    return { x: st.x, y: st.y - (st.saut || 0) + headY * echelle, r: r * echelle };
  }

  // ================= ÉTAT DES ACTEURS DANS LE TEMPS =================
  function decorDe(sc) { return typeof sc.decor === 'string' ? { nom: sc.decor } : (sc.decor || { nom: 'couleur' }); }
  function xActeur(sc, a) { let x = (a.x ?? 0.5) * WW; if (decorDe(sc).nom === 'bus' && (a.pose || 'assis') === 'assis') { let best = SIEGES[0]; for (const s of SIEGES) if (Math.abs(s - x) < Math.abs(best - x)) best = s; x = best; } return x; }
  function solDe(sc) { const n = decorDe(sc).nom; return ({ bus: 960, rue: 905, cuisine: 900, chambre: 895, buanderie: 905, salon: 895, parc: 950, cimetiere: 945, salle_sport: 900, bureau: 900, ville_nuit: 900, porte: 960, immeuble: 925, couleur: 940 })[n] || 900; }
  function etatActeurs(si, t) {
    const sc = TL.scenes[si], def = TL.projet.scenes[si];
    const lignes = TL.lignes.filter((l) => l.scene === si);
    const ligneCourante = S.ligneA(TL, t, 0);
    const res = [];
    for (const a of def.acteurs || []) {
      const st = { id: a.id, pose: a.pose || (decorDe(def).nom === 'bus' ? 'assis' : 'debout'), x: xActeur(def, a), tient: a.tient, emotion: a.emotion || 'neutre', geste: null, regard: a.regard === 'gauche' ? -1 : a.regard === 'droite' ? 1 : 0, echelle: a.echelle || 1, marche: null, saut: 0, cache: false, t, graine: hash(a.id) };
      // entrée / sortie
      const dE = 1.3;
      if (a.entre) { const p = (t - sc.debut) / dE; const x0 = a.entre === 'gauche' ? -250 : WW + 250; if (p < 1) { st.x = lerp(x0, st.x, ease(p)); st.marche = t * 9; st.regard = a.entre === 'gauche' ? 1 : -1; } }
      // mouvements déclenchés par les lignes
      for (const l of lignes) {
        if (l.debut > t) break;
        for (const b of l.bouge || []) if (b.id === a.id) {
          const x1 = b.x != null ? b.x * WW : st.x, d = b.duree || Math.min(1.6, Math.max(0.6, l.fin - l.debut));
          const p = (t - l.debut) / d; if (p < 1) { st.marche = t * 9; st.regard = x1 > st.x ? 1 : -1; }
          st.x = lerp(st.x, x1, ease(p)); if (b.pose) st.pose = b.pose; if (b.tient !== undefined) st.tient = b.tient; if (b.cache !== undefined) st.cache = b.cache;
        }
        if (l.qui === a.id && l.emotion) st.emotion = l.emotion;
        if (l.reactions && l.reactions[a.id]) st.emotion = l.reactions[a.id];
      }
      if (a.sort) { const p = (t - (sc.fin - dE)) / dE; if (p > 0) { const x1 = a.sort === 'gauche' ? -300 : WW + 300; st.x = lerp(st.x, x1, ease(p)); st.marche = t * 9; st.regard = a.sort === 'gauche' ? -1 : 1; } }
      if (ligneCourante && ligneCourante.scene === si) {
        const L = ligneCourante;
        if (L.qui === a.id) {
          st.parle = true; st.bouche = S.env(L, t, FPS); st.geste = L.geste || null;
          if (L.emotion) st.emotion = L.emotion;
          if (L.emotion === 'joie' || L.geste === 'saute') st.saut = Math.abs(Math.sin((t - L.debut) * 7)) * 40;
          if (L.emotion === 'fache') st.secoue = Math.sin(t * 40) * 0.02;
        } else if (st.marche == null && a.regard == null) {
          const sp = (def.acteurs || []).find((o) => o.id === L.qui); if (sp) st.regard = xActeur(def, sp) > st.x ? 1 : -1;
        }
        if (L.reactions && L.reactions[a.id]) st.emotion = L.reactions[a.id];
      }
      if (st.marche == null && st.pose !== 'assis' && !st.parle) st.marche = null;
      st.cligne = ((t + st.graine * 4) % 3.7) < 0.12;
      st.y = solDe(def);
      if (!st.cache) res.push(st);
    }
    return res;
  }

  // ================= CAMÉRA =================
  function tete(def, st) { const enf = (TL.projet.personnages[st.id]?.look || {}).age === 'enfant'; const k = (enf ? 0.78 : 1) * (st.echelle || 1); return { x: st.x, y: st.y - (st.pose === 'assis' ? 420 : 470) * k }; }
  function plan(si, t) {
    const def = TL.projet.scenes[si], sc = TL.scenes[si], vertical = W < H;
    const L = S.ligneA(TL, t, 0) || S.derniereLigne(TL, t, si);
    const acteurs = etatActeurs(si, t);
    const zLarge = vertical ? 0.62 : 1;
    let type = 'large';
    let li = -1, lignesSc = TL.lignes.filter((l) => l.scene === si);
    if (L && L.scene === si) { li = lignesSc.indexOf(L); type = L.camera || def.camera || 'auto'; }
    else type = def.camera || 'large';
    if (type === 'auto') {
      if (li <= 0) type = vertical ? 'deux' : 'large';
      else if (['surpris', 'choque', 'fache', 'rire', 'joie'].includes(L.emotion)) type = 'gros';
      else if (li % 4 === 3) type = vertical ? 'deux' : 'large';
      else type = 'moyen';
    }
    const sp = L && acteurs.find((a) => a.id === L.qui);
    let cx = 960, cy = 540, z = zLarge;
    if (type === 'large') {
      cx = def.centre != null ? def.centre * WW : 960; cy = 540; z = zLarge * (def.zoom || 1);
      if (acteurs.length && def.centre == null) { const xs = acteurs.map((a) => a.x); const span = Math.max(...xs) - Math.min(...xs); cx = (Math.max(...xs) + Math.min(...xs)) / 2; if (vertical) cy = 600; else { z = clamp(1920 / (span + 1000), 1, 1.45) * (def.zoom || 1); cy = 540 + (z - 1) * 260; } }
    }
    else if (sp && (type === 'moyen' || type === 'gros')) { const h = tete(def, sp); z = (type === 'gros' ? 2.0 : 1.45) * (vertical ? 0.75 : 1); cx = h.x; cy = h.y + (type === 'gros' ? 110 : 190) * (vertical ? 1.2 : 1); }
    else if (type === 'deux' && acteurs.length) { const sp2 = sp || acteurs[0]; let other = null, d = 1e9; for (const a of acteurs) if (a !== sp2 && Math.abs(a.x - sp2.x) < d) { d = Math.abs(a.x - sp2.x); other = a; } const xs = other ? [sp2.x, other.x] : [sp2.x]; cx = (Math.min(...xs) + Math.max(...xs)) / 2; const span = Math.max(...xs) - Math.min(...xs) + 520; z = clamp((vertical ? 607 : 1920) / span, vertical ? 0.55 : 1, vertical ? 1.0 : 1.6); cy = tete(def, sp2).y + 260; }
    // léger travelling avant
    const t0 = L && L.scene === si ? L.debut : sc.debut; const p = clamp((t - t0) / 6, 0, 1); z *= 1 + 0.035 * p;
    // limites
    const demiW = W / (baseScale * z) / 2, demiH = H / (baseScale * z) / 2;
    if (demiW * 2 < WW) cx = clamp(cx, demiW, WW - demiW); else cx = 960;
    if (!vertical) cy = clamp(cy, demiH, Math.max(demiH, WH - demiH)); else cy = clamp(cy, demiH - 600, WH + 200 - demiH);
    let sx = 0, sy = 0;
    if (L && L.scene === si && ['surpris', 'choque', 'fache'].includes(L.emotion) && t - L.debut < 0.3) { sx = Math.sin(t * 70) * 8; sy = Math.cos(t * 63) * 6; }
    return { cx: cx + sx, cy: cy + sy, z, acteurs };
  }

  // ================= API =================
  P.init = (timeline, canvas) => { TL = timeline; W = TL.W; H = TL.H; FPS = TL.fps; ctx = canvas.getContext('2d'); baseScale = H / WH; };
  P.frame = (t) => {
    const sc = S.sceneA(TL, t), si = TL.scenes.indexOf(sc), def = TL.projet.scenes[si];
    const cam = plan(si, t), s = baseScale * cam.z;
    ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-cam.cx, -cam.cy);
    const d = decorDe(def); (DECORS[d.nom] || DECORS.couleur)(t, d);
    const tetes = {};
    const tri = [...cam.acteurs].sort((a, b) => (a.pose === 'assis') - (b.pose === 'assis'));
    for (const st of tri) { const def2 = TL.projet.personnages[st.id] || {}; const h = dessinerPerso(def2, st); tetes[st.id] = h; }
    if (d.premier_plan === 'bus_barre') rect(1210 - 7, -100, 14, 1200, '#ffc531');
    ctx.restore();
    const ancre = (qui) => { const h = tetes[qui]; if (!h) return null; return { x: (h.x - cam.cx) * s + W / 2, y: (h.y - cam.cy) * s + H / 2, r: h.r * s }; };
    S.symbole(ctx, TL, t, W, H, ancre);
    S.inserts(ctx, TL, t, W, H, ancre);
    S.sousTitres(ctx, TL, t, W, H, ancre);
    S.transition(ctx, TL, t, W, H);
  };
  P.DECORS = Object.keys(DECORS);
})();
