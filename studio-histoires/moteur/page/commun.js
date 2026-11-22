// Studio Histoires — fonctions communes aux deux moteurs (plat2d / cube3d)
// Sous-titres animés, inserts graphiques (notif, badge, écran de téléphone...),
// symboles au-dessus des têtes, transitions.
(function () {
  const S = (window.S = {});
  S.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  S.lerp = (a, b, t) => a + (b - a) * t;
  S.ease = (t) => { t = S.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  S.easeOut = (t) => { t = S.clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
  S.easeOutBack = (t) => { t = S.clamp(t, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  S.hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
  S.rand = (seed) => { let x = Math.floor(S.hash(seed) * 2147483646) + 1; return () => (x = (x * 16807) % 2147483647) / 2147483647; };
  S.shade = (hex, f) => {
    let c = hex.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    let r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const k = (v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f);
    return `rgb(${k(r)},${k(g)},${k(b)})`;
  };
  S.rr = (ctx, x, y, w, h, r) => {
    r = Math.min(r, w / 2, h / 2); ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };
  S.FONT = '"Fredoka", "Arial Rounded MT Bold", "Arial", sans-serif';
  S.JAUNE = '#FFC531';
  S.ENCRE = '#1c1838';

  S.chargerPolices = async () => {
    for (const [w, f] of [[600, 'fredoka-latin-600-normal.woff2'], [700, 'fredoka-latin-700-normal.woff2']]) {
      try { const ff = new FontFace('Fredoka', `url(polices/${f})`, { weight: String(w) }); await ff.load(); document.fonts.add(ff); } catch (e) { console.warn('police', e); }
    }
  };

  // ---------- Préparation du timeline ----------
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%]/g, '');
  S.preparer = (TL) => {
    const style = TL.projet.sous_titres || (TL.projet.format === '9:16' ? 'mot' : 'bulle');
    TL.styleST = style;
    const maxMots = style === 'phrase' ? 6 : style === 'mot' ? 1 : 3;
    for (const L of TL.lignes) {
      const cles = (L.cles || []).map(norm);
      L.mots.forEach((m) => { m.cle = cles.some((c) => c && norm(m.m).includes(c)) || /^\*.*\*$/.test(m.m); m.m = m.m.replace(/\*/g, ''); });
      const chunks = []; let cur = [];
      L.mots.forEach((m, i) => {
        cur.push(m);
        const ponct = /[.,!?…:;]$/.test(m.m);
        if (cur.length >= maxMots || ponct || i === L.mots.length - 1) { chunks.push(cur); cur = []; }
      });
      L.chunks = chunks;
    }
  };
  S.sceneA = (TL, t) => { let s = TL.scenes[0]; for (const sc of TL.scenes) if (t >= sc.debut) s = sc; return s; };
  S.lignesScene = (TL, si) => TL.lignes.filter((l) => l.scene === si);
  S.ligneA = (TL, t, marge = 0) => { for (const l of TL.lignes) if (t >= l.debut - 0.001 && t < l.fin + marge) return l; return null; };
  S.derniereLigne = (TL, t, si) => { let r = null; for (const l of TL.lignes) if (l.scene === si && l.debut <= t) r = l; return r; };
  S.env = (L, t, fps) => { if (!L || !L.env) return 0; const i = Math.floor((t - L.debut) * fps); return i >= 0 && i < L.env.length ? L.env[i] : 0; };

  // ---------- Texte détouré ----------
  S.texte = (ctx, txt, x, y, taille, couleur, opts = {}) => {
    ctx.save(); ctx.font = `${opts.poids || 700} ${taille}px ${S.FONT}`; ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    if (opts.ombre !== false) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowOffsetY = taille * 0.06; ctx.shadowBlur = taille * 0.08; }
    ctx.strokeStyle = opts.contour || S.ENCRE; ctx.lineWidth = taille * (opts.epaisseur || 0.22); ctx.strokeText(txt, x, y);
    ctx.shadowColor = 'transparent'; ctx.fillStyle = couleur; ctx.fillText(txt, x, y); ctx.restore();
  };
  S.mesure = (ctx, txt, taille, poids = 700) => { ctx.save(); ctx.font = `${poids} ${taille}px ${S.FONT}`; const w = ctx.measureText(txt).width; ctx.restore(); return w; };

  // ---------- Sous-titres ----------
  // ancre(qui) -> {x,y,r} en pixels écran (tête du personnage) ou null
  S.sousTitres = (ctx, TL, t, W, H, ancre) => {
    if (TL.projet.sous_titres === 'aucun') return;
    const L = S.ligneA(TL, t, 0.12); if (!L) return;
    let ci = 0; L.chunks.forEach((c, i) => { if (t >= c[0].d - 0.02) ci = i; });
    const chunk = L.chunks[ci]; if (!chunk) return;
    const style = TL.styleST, U = Math.min(W, H);
    if (style === 'mot') {
      let mot = chunk[0];
      const taille = U * 0.085, age = t - mot.d, sc = S.easeOutBack(age / 0.14) * 0.25 + 0.75;
      ctx.save(); ctx.translate(W / 2, H * 0.6); ctx.scale(sc, sc);
      S.texte(ctx, mot.m, 0, 0, taille, mot.cle ? S.JAUNE : '#fff', { epaisseur: 0.26 }); ctx.restore();
      return;
    }
    const taille = style === 'phrase' ? U * 0.062 : U * 0.058;
    const visibles = chunk.filter((m) => t >= m.d - 0.02);
    const esp = taille * 0.28; const largeurs = chunk.map((m) => S.mesure(ctx, m.m, taille));
    const total = largeurs.reduce((a, b) => a + b, 0) + esp * (chunk.length - 1);
    let x0, y0;
    const a = style === 'bulle' ? ancre(L.qui) : null;
    if (a) {
      const versDroite = a.x < W * 0.5;
      x0 = versDroite ? a.x + a.r * 0.9 : a.x - a.r * 0.9 - total;
      y0 = a.y - a.r * 1.05;
      x0 = S.clamp(x0, U * 0.04, W - U * 0.04 - total); y0 = S.clamp(y0, taille, H - taille);
    } else { x0 = W / 2 - total / 2; y0 = style === 'phrase' ? H * 0.86 : H * 0.8; }
    let x = x0;
    chunk.forEach((m, i) => {
      const w = largeurs[i];
      if (visibles.includes(m)) {
        const age = t - m.d, sc = 0.7 + 0.3 * S.easeOutBack(age / 0.16);
        const actif = style === 'phrase' && t >= m.d && t < m.f + 0.05;
        ctx.save(); ctx.translate(x + w / 2, y0); ctx.scale(sc, sc);
        S.texte(ctx, m.m, 0, 0, taille, m.cle || actif ? S.JAUNE : '#fff'); ctx.restore();
      }
      x += w + esp;
    });
  };

  // ---------- Symboles au-dessus de la tête ----------
  S.coeur = (ctx, x, y, s, c) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(s / 100, s / 100); ctx.beginPath();
    ctx.moveTo(0, 30); ctx.bezierCurveTo(-60, -10, -40, -60, 0, -30); ctx.bezierCurveTo(40, -60, 60, -10, 0, 30);
    ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = S.ENCRE; ctx.stroke(); ctx.restore();
  };
  S.symbole = (ctx, TL, t, W, H, ancre) => {
    const L = S.ligneA(TL, t, 0.3); if (!L || !L.symbole) return;
    const a = ancre(L.symbole_qui || L.qui); if (!a) return;
    const age = t - L.debut, sc = S.easeOutBack(age / 0.25), fl = Math.sin(t * 5) * a.r * 0.05;
    const x = a.x + a.r * 0.75, y = a.y - a.r * 1.45 + fl, s = a.r * 0.9 * sc;
    if (s <= 0) return;
    const sym = L.symbole;
    if (sym === 'coeur') S.coeur(ctx, x, y, s, '#ff5c8a');
    else if (sym === 'goutte') {
      ctx.save(); ctx.translate(a.x + a.r * 0.85, a.y - a.r * 0.6 + age * a.r * 0.15); ctx.scale(sc, sc); ctx.beginPath();
      ctx.moveTo(0, -a.r * 0.25); ctx.quadraticCurveTo(a.r * 0.16, 0, 0, a.r * 0.12); ctx.quadraticCurveTo(-a.r * 0.16, 0, 0, -a.r * 0.25);
      ctx.fillStyle = '#7fd3ff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#2a6fa8'; ctx.stroke(); ctx.restore();
    } else if (sym === 'etoiles') {
      for (let i = 0; i < 3; i++) { const an = t * 3 + i * 2.1; S.texte(ctx, '✦', a.x + Math.cos(an) * a.r * 1.1, a.y - a.r * 1.1 + Math.sin(an) * a.r * 0.3, s * 0.45, S.JAUNE, { epaisseur: 0.12 }); }
    } else S.texte(ctx, sym === 'zzz' ? 'Z z z' : sym, x, y, s * 0.8, sym === '!' ? '#ff4d4d' : sym === '?' ? S.JAUNE : '#fff');
  };

  // ---------- Inserts (éléments graphiques en surimpression) ----------
  const actifInsert = (L, t) => { const fin = L.fin + (L.insert.prolonge ?? 0.35); return t >= L.debut && t < fin ? { age: t - L.debut, reste: fin - t } : null; };
  S.inserts = (ctx, TL, t, W, H, ancre) => {
    for (const L of TL.lignes) {
      if (!L.insert) continue; const st = actifInsert(L, t); if (!st) continue;
      const I = L.insert, U = Math.min(W, H);
      const entree = S.easeOutBack(st.age / 0.3), sortie = S.ease(st.reste / 0.25), k = Math.min(entree, sortie);
      ctx.save(); ctx.globalAlpha = S.clamp(sortie * 1.2, 0, 1);
      const type = I.type;
      if (type === 'notif') {
        const w = U * 0.42, h = U * 0.3, x = W * (I.x ?? 0.04), y = H * (I.y ?? 0.06);
        ctx.translate(x + w / 2, y + h / 2); ctx.scale(k, k); ctx.translate(-w / 2, -h / 2);
        ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = U * 0.03; S.rr(ctx, 0, 0, w, h, U * 0.025); ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
        ctx.lineWidth = U * 0.006; ctx.strokeStyle = S.ENCRE; ctx.stroke();
        const ic = h * 0.17; ctx.beginPath(); ctx.arc(w / 2, h * 0.24, ic, 0, 7); ctx.fillStyle = I.couleur || '#7b4dff'; ctx.fill();
        S.coeur(ctx, w / 2, h * 0.25, ic * 1.1, '#ff7aa5');
        S.texte(ctx, I.titre || 'Maman', w / 2, h * 0.52, U * 0.04, S.ENCRE, { contour: '#fff', epaisseur: 0.01, ombre: false });
        S.texte(ctx, I.texte || 'appel entrant…', w / 2, h * 0.66, U * 0.025, '#777', { contour: '#fff', epaisseur: 0.01, ombre: false, poids: 600 });
        const vib = Math.sin(t * 40) * U * 0.003;
        [['#ff4d4d', 0.3], ['#2ecc71', 0.7]].forEach(([c, fx]) => { ctx.beginPath(); ctx.arc(w * fx + vib, h * 0.84, h * 0.08, 0, 7); ctx.fillStyle = c; ctx.fill(); });
      } else if (type === 'badge') {
        const a = ancre(L.qui); const x = a ? a.x + (a.x < W / 2 ? -a.r * 1.5 : a.r * 1.5) : W * 0.7, y = a ? a.y - a.r * 0.9 : H * 0.3;
        const r = U * 0.075 * k; ctx.beginPath(); ctx.arc(x, y, Math.max(r, 0), 0, 7); ctx.fillStyle = I.couleur || S.JAUNE; ctx.fill();
        ctx.lineWidth = U * 0.008; ctx.strokeStyle = '#e08a00'; ctx.stroke();
        S.texte(ctx, I.texte || '!', x, y + r * 0.04, r * 0.9, '#e2462f', { contour: '#fff', epaisseur: 0.12, ombre: false });
      } else if (type === 'panneau') {
        const w = U * 0.38, h = U * 0.3, x = W * (I.x ?? 0.08), y = H * (I.y ?? 0.08);
        ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-0.08 + Math.sin(t * 2) * 0.02); ctx.scale(k, k); ctx.translate(-w / 2, -h / 2);
        ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = U * 0.02; S.rr(ctx, 0, 0, w, h, U * 0.01); ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
        S.rr(ctx, 0, 0, w, h * 0.3, U * 0.01); ctx.fillStyle = I.couleur || '#e2462f'; ctx.fill();
        S.texte(ctx, (I.titre || 'AUJOURD’HUI').toUpperCase(), w / 2, h * 0.15, U * 0.03, '#fff', { contour: I.couleur || '#e2462f', epaisseur: 0.05, ombre: false });
        const lignes = String(I.texte || '').toUpperCase().split('\n');
        lignes.forEach((lg, i) => S.texte(ctx, lg, w / 2, h * (0.48 + i * 0.2 - (lignes.length - 1) * 0.08), U * 0.055, I.couleur || '#e2462f', { contour: '#fff', epaisseur: 0.02, ombre: false }));
      } else if (type === 'ecran') {
        const w = U * 0.62, h = w * 1.85, cx = W / 2, cy = H * 0.5 + (1 - k) * H * 0.7 + Math.sin(t * 2) * U * 0.004;
        ctx.translate(cx, cy); ctx.rotate(-0.05);
        S.rr(ctx, -w / 2 - U * 0.02, -h / 2 - U * 0.02, w + U * 0.04, h + U * 0.04, U * 0.07); ctx.fillStyle = '#111'; ctx.fill();
        S.rr(ctx, -w / 2, -h / 2, w, h, U * 0.055); ctx.save(); ctx.clip();
        ctx.fillStyle = I.fond || '#7b2ff7'; ctx.fillRect(-w / 2, -h / 2, w, h);
        if (I.fond2) { ctx.fillStyle = I.fond2; ctx.fillRect(-w / 2, -h / 2 + h * 0.35, w, h); }
        if (I.pseudo) S.texte(ctx, I.pseudo, -w * 0.38, -h * 0.3, U * 0.032, '#fff', { align: 'left', epaisseur: 0.12 });
        const tl = String(I.titre || '').split('\n');
        tl.forEach((lg, i) => S.texte(ctx, lg.toUpperCase(), 0, -h * 0.2 + i * U * 0.075, U * 0.062, '#fff', { epaisseur: 0.16 }));
        if (I.gros) S.texte(ctx, I.gros, 0, h * 0.12, U * (I.gros.length > 4 ? 0.12 : 0.2), I.couleur_gros || '#fff', { epaisseur: 0.12 });
        if (I.texte) S.texte(ctx, I.texte, 0, h * 0.33, U * 0.045, '#fff', { epaisseur: 0.14 });
        if (I.likes) { S.coeur(ctx, w * 0.36, -h * 0.4, U * 0.06, '#ff3b5c'); S.texte(ctx, I.likes, w * 0.36, -h * 0.34, U * 0.028, '#fff', { epaisseur: 0.14 }); }
        ctx.restore();
        // pouce qui scrolle
        const py = h * 0.15 - ((t * 2.2) % 1) * h * 0.3; S.rr(ctx, w * 0.18, py, w * 0.2, h * 0.17, w * 0.1); ctx.fillStyle = I.peau || '#d9a066'; ctx.fill(); ctx.lineWidth = U * 0.004; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.stroke();
      } else if (type === 'compteur' || type === 'titre') {
        const lignes = String(I.texte || '').split('\n');
        ctx.translate(W / 2, H * (I.y ?? 0.32)); ctx.scale(k, k); ctx.rotate(type === 'compteur' ? -0.04 : 0);
        lignes.forEach((lg, i) => S.texte(ctx, lg.toUpperCase(), 0, (i - (lignes.length - 1) / 2) * U * 0.13, U * (i === 0 ? 0.12 : 0.07), i === 0 ? (I.couleur || S.JAUNE) : '#fff', { epaisseur: 0.18 }));
      } else if (type === 'bulle') {
        const a = ancre(L.qui); const x = a ? a.x + (a.x < W / 2 ? a.r * 1.7 : -a.r * 1.7) : W * 0.7, y = a ? a.y - a.r * 1.5 : H * 0.25;
        const r = U * 0.11 * k; if (r > 0) {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = S.ENCRE; ctx.lineWidth = U * 0.006;
          for (const [dx, dy, rr] of [[-0.9, 0.9, 0.12], [-0.6, 0.55, 0.2]]) { ctx.beginPath(); ctx.arc(x + dx * r * (a && a.x > W / 2 ? -1 : 1), y + dy * r, rr * r, 0, 7); ctx.fill(); ctx.stroke(); }
          ctx.beginPath(); ctx.ellipse(x, y, r * 1.25, r, 0, 0, 7); ctx.fill(); ctx.stroke();
          S.texte(ctx, I.texte || '…', x, y, r * (String(I.texte || '').length > 3 ? 0.4 : 0.8), S.ENCRE, { contour: '#fff', epaisseur: 0.02, ombre: false });
        }
      } else if (type === 'icones') {
        const items = I.liste || ['☎', '☎', '☎']; const n = items.length;
        items.forEach((it, i) => {
          const ap = S.easeOutBack((st.age - i * 0.12) / 0.25); if (ap <= 0) return;
          const x = W * (0.5 + (i - (n - 1) / 2) * 0.09), y = H * (I.y ?? 0.2);
          ctx.save(); ctx.translate(x, y); ctx.scale(ap, ap); ctx.beginPath(); ctx.arc(0, 0, U * 0.035, 0, 7); ctx.fillStyle = I.couleur || '#2ecc71'; ctx.fill();
          S.texte(ctx, it, 0, U * 0.003, U * 0.04, '#fff', { epaisseur: 0.1, ombre: false });
          if (I.legendes) S.texte(ctx, I.legendes[i] || '', 0, U * 0.06, U * 0.025, '#fff', { epaisseur: 0.15 });
          ctx.restore();
        });
      }
      ctx.restore();
    }
  };

  // ---------- Transitions de scène ----------
  S.transition = (ctx, TL, t, W, H) => {
    for (let i = 1; i < TL.scenes.length; i++) {
      const sc = TL.scenes[i], tr = sc.transition || 'coupe', d = t - sc.debut;
      if (tr === 'fondu' && Math.abs(d) < 0.35) { ctx.fillStyle = `rgba(10,8,25,${1 - Math.abs(d) / 0.35})`; ctx.fillRect(0, 0, W, H); }
      if (tr === 'glisse' && Math.abs(d) < 0.3) { const k = (d + 0.3) / 0.6; ctx.fillStyle = '#ffc531'; ctx.fillRect(W * (k * 2.2 - 1.1), 0, W * 0.9, H); ctx.fillStyle = '#7b4dff'; ctx.fillRect(W * (k * 2.2 - 1.3), 0, W * 0.25, H); }
      if (tr === 'flash' && d >= 0 && d < 0.2) { ctx.fillStyle = `rgba(255,255,255,${1 - d / 0.2})`; ctx.fillRect(0, 0, W, H); }
    }
    const fin = TL.duree - t; if (fin < 0.5) { ctx.fillStyle = `rgba(10,8,25,${1 - fin / 0.5})`; ctx.fillRect(0, 0, W, H); }
  };
})();
