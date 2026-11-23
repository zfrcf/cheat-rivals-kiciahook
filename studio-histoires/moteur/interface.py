"""Studio Histoires — interface web locale (français). Lancer : python studio.py interface"""
import json, subprocess, sys, threading, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

RACINE = Path(__file__).resolve().parent.parent
PROJETS = RACINE / "projets"
TACHE = {"log": "", "en_cours": False}

PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Studio Histoires</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--f:#14122b;--c:#211e45;--t:#f3f0ff;--a:#ffc531;--b:#7b4dff}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:var(--f);color:var(--t)}
header{padding:14px 20px;background:var(--c);display:flex;gap:12px;align-items:center}h1{font-size:20px;margin:0}h1 b{color:var(--a)}
main{display:grid;grid-template-columns:260px 1fr 1fr;gap:14px;padding:14px}@media(max-width:1000px){main{grid-template-columns:1fr}}
section{background:var(--c);border-radius:12px;padding:12px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--a);margin:0 0 8px}
button{background:var(--b);color:#fff;border:0;border-radius:8px;padding:8px 12px;margin:3px 2px;cursor:pointer;font-weight:600}button.j{background:var(--a);color:#222}
textarea,input,select{width:100%;background:#0e0c22;color:var(--t);border:1px solid #3a3570;border-radius:8px;padding:8px;font:13px ui-monospace,monospace}
textarea{height:62vh}#log{white-space:pre-wrap;font:12px ui-monospace,monospace;height:22vh;overflow:auto;background:#0e0c22;padding:8px;border-radius:8px}
.p{padding:6px 8px;border-radius:6px;cursor:pointer}.p:hover,.p.on{background:#35307a}video,img{width:100%;border-radius:8px;margin-top:6px}
</style></head><body><header><h1>🎬 Studio <b>Histoires</b></h1><span>de l'idée à la vidéo finie</span></header>
<main><section><h2>Nouveau projet</h2><input id="idee" placeholder="Idée de l'histoire…"><select id="fmt"><option>16:9</option><option>9:16</option></select>
<select id="sty"><option value="plat2d">2D plat (dessin animé)</option><option value="cube3d">3D cubique</option></select><button class="j" onclick="nouveau()">✍️ Écrire le scénario</button>
<h2 style="margin-top:16px">Projets</h2><div id="liste"></div></section>
<section><h2>Scénario (projet.json) — <span id="nom"></span></h2><textarea id="json" spellcheck="false"></textarea>
<button onclick="sauver()">💾 Enregistrer</button><button onclick="lancer('verifier')">✅ Vérifier</button><button onclick="lancer('voix')">🎙️ Voix</button>
<button onclick="lancer('controle')">🔎 Contrôle qualité</button><button onclick="lancer('apercu')">⚡ Aperçu rapide</button><button class="j" onclick="lancer('tout')">🎬 Vidéo finale</button><button class="j" onclick="lancer('tout2')">🎬 16:9 + 9:16</button></section>
<section><h2>Journal</h2><div id="log"></div><h2 style="margin-top:12px">Résultat</h2><div id="res"></div></section></main>
<script>
let cur=null;const $=i=>document.getElementById(i);
async function liste(){const r=await (await fetch('/api/projets')).json();$('liste').innerHTML=r.map(p=>`<div class="p ${p==cur?'on':''}" onclick="ouvrir('${p}')">${p}</div>`).join('')}
async function ouvrir(p){cur=p;$('nom').textContent=p;$('json').value=await (await fetch('/api/projet?nom='+p)).text();liste();resultats()}
async function sauver(){try{JSON.parse($('json').value)}catch(e){alert('JSON invalide : '+e.message);return}await fetch('/api/projet?nom='+cur,{method:'POST',body:$('json').value})}
async function lancer(c){if(!cur)return alert('Choisis un projet');await sauver();await fetch('/api/lancer?nom='+cur+'&cmd='+c,{method:'POST'});suivre()}
async function nouveau(){const i=$('idee').value.trim();if(!i)return;await fetch('/api/nouveau',{method:'POST',body:JSON.stringify({idee:i,format:$('fmt').value,style:$('sty').value})});suivre(true)}
async function suivre(rel){const r=await (await fetch('/api/tache')).json();$('log').textContent=r.log;$('log').scrollTop=1e9;if(r.en_cours)setTimeout(()=>suivre(rel),1000);else{if(rel)liste();resultats()}}
async function resultats(){if(!cur)return;const r=await (await fetch('/api/resultats?nom='+cur)).json();$('res').innerHTML=(r.rapport?`<pre style="white-space:pre-wrap;background:#0e0c22;padding:8px;border-radius:8px">${r.rapport.replace(/</g,'&lt;')}</pre>`:'')+r.videos.map(v=>`<div>${v}</div><video controls src="/f/${cur}/${v}?${Date.now()}"></video>`).join('')+r.images.map(v=>`<img src="/f/${cur}/${v}?${Date.now()}">`).join('')}
liste();
</script></body></html>"""


def executer(cmds):
    TACHE.update(log="", en_cours=True)
    for c in cmds:
        p = subprocess.Popen(c, cwd=RACINE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for l in p.stdout:
            TACHE["log"] += l.replace("\r", "\n")
        if p.wait():
            TACHE["log"] += f"\n❌ échec ({p.returncode})"; break
    TACHE["en_cours"] = False


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def rep(self, data, ct="application/json"):
        b = data if isinstance(data, bytes) else (json.dumps(data, ensure_ascii=False) if ct == "application/json" else data).encode()
        self.send_response(200); self.send_header("Content-Type", ct); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query); nom = q.get("nom", [""])[0]
        if u.path == "/": return self.rep(PAGE, "text/html; charset=utf-8")
        if u.path == "/api/projets": return self.rep(sorted(p.name for p in PROJETS.iterdir() if (p / "projet.json").exists()))
        if u.path == "/api/projet": return self.rep((PROJETS / nom / "projet.json").read_text(encoding="utf-8"), "text/plain; charset=utf-8")
        if u.path == "/api/tache": return self.rep(TACHE)
        if u.path == "/api/resultats":
            d = PROJETS / nom
            return self.rep({"videos": [p.name for p in sorted(d.glob("*.mp4"))], "images": [str(p.relative_to(d)) for p in [*sorted(d.glob("miniature*.jpg")), d / "build/planche.jpg", d / "build/planche_instantanes.jpg"] if p.exists()], "rapport": (d / "build/rapport.md").read_text(encoding="utf-8") if (d / "build/rapport.md").exists() else ""})
        if u.path.startswith("/f/"):
            f = (PROJETS / unquote(u.path[3:])).resolve()
            if not str(f).startswith(str(PROJETS.resolve())) or not f.exists(): self.send_response(404); return self.end_headers()
            return self.rep(f.read_bytes(), {".mp4": "video/mp4", ".jpg": "image/jpeg"}.get(f.suffix, "application/octet-stream"))
        self.send_response(404); self.end_headers()

    def do_POST(self):
        u = urlparse(self.path); q = parse_qs(u.query); nom = q.get("nom", [""])[0]
        corps = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if TACHE["en_cours"] and u.path != "/api/projet": return self.rep({"erreur": "tâche en cours"})
        py, st = sys.executable, str(RACINE / "studio.py")
        if u.path == "/api/projet":
            (PROJETS / nom / "projet.json").write_text(corps.decode("utf-8"), encoding="utf-8"); return self.rep({"ok": True})
        if u.path == "/api/nouveau":
            d = json.loads(corps); threading.Thread(target=executer, args=([[py, st, "nouveau", d["idee"], "--format", d["format"], "--style", d["style"]]],)).start(); return self.rep({"ok": True})
        if u.path == "/api/lancer":
            dos = str(PROJETS / nom); c = q.get("cmd", [""])[0]
            plan = {"verifier": [[py, st, "verifier", dos]], "voix": [[py, st, "voix", dos]],
                    "instantanes": [[py, st, "voix", dos], ["node", str(RACINE / "moteur/rendu.js"), dos + "/build", "--instantanes", "auto"],
                                    ["bash", "-c", f"cd '{dos}/build/instantanes' && ffmpeg -v error -y -pattern_type glob -i '*.jpg' -vf 'scale=480:-1,tile=4x6' -frames:v 1 ../planche_instantanes.jpg"]],
                    "controle": [[py, st, "controle", dos]],
                    "apercu": [[py, st, "tout", dos, "--apercu", "--rapide"]], "tout": [[py, st, "tout", dos]], "tout2": [[py, st, "tout", dos, "--formats", "16:9,9:16"]]}.get(c)
            if plan: threading.Thread(target=executer, args=(plan,)).start()
            return self.rep({"ok": bool(plan)})
        self.send_response(404); self.end_headers()


def lancer(port=8765):
    PROJETS.mkdir(exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    url = f"http://127.0.0.1:{port}"
    print(f"🌐 Interface Studio Histoires : {url}  (Ctrl+C pour quitter)")
    try: webbrowser.open(url)
    except Exception: pass
    srv.serve_forever()
