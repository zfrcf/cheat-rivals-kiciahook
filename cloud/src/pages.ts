/** Pages HTML minimales (français), sans dépendance externe. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const shell = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#15171a;--card:#fff;--mut:#5b6270;--acc:#1e5bb8}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9ebee;--card:#1b1e23;--mut:#9aa1ad;--acc:#6ea0ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:16px}
main{max-width:560px;margin:8vh auto;background:var(--card);border-radius:14px;padding:24px;box-shadow:0 2px 12px #0002}
h1{font-size:22px;margin:0 0 12px}p{color:var(--mut)}code{word-break:break-all;background:#8882;padding:2px 6px;border-radius:6px}
.ok{color:#1f9d55}.ko{color:#d33}</style></head><body><main>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } },
  );

export function statusPage(s: { connected: boolean; device: { model?: string; android?: string }; paired: boolean; origin: string; stopped: boolean }) {
  return shell(
    "PhonePilot",
    `<h1>PhonePilot</h1>
<p>${s.connected ? `<b class="ok">● Téléphone connecté</b> (${esc(s.device.model ?? "?")}, Android ${esc(s.device.android ?? "?")})` : `<b class="ko">● Téléphone hors ligne</b>`}</p>
<p>Appairage : ${s.paired ? "fait" : "<b>en attente</b> — ouvre l'app PhonePilot et saisis l'adresse de cette page."}</p>
${s.stopped ? `<p class="ko"><b>⛔ Arrêt d'urgence actif</b> — reprise depuis l'app.</p>` : ""}
<p>Adresse du connecteur MCP à ajouter dans Claude :<br><code>${esc(s.origin)}/mcp</code></p>`,
  );
}

export function authorizePage(client: string, host: string, phoneOnline: boolean) {
  return shell(
    "Autoriser l'accès",
    `<h1>Autoriser « ${esc(client)} »</h1>
<p>Demandé par <code>${esc(host)}</code>. Une notification <b>Oui / Non</b> va apparaître sur ton téléphone.</p>
<p id="s">${phoneOnline ? "En attente de ta réponse sur le téléphone…" : "<b class='ko'>Téléphone hors ligne</b> : ouvre l'app PhonePilot puis recharge cette page."}</p>
<script>
${phoneOnline ? `fetch('/authorize/approve'+location.search,{method:'POST'}).then(r=>r.json()).then(j=>{
 if(j.redirect){document.getElementById('s').textContent='Autorisé ✔ — retour vers Claude…';location.href=j.redirect}
 else document.getElementById('s').textContent='✖ '+(j.error||'Refusé');
}).catch(()=>document.getElementById('s').textContent='Erreur réseau, recharge la page.');` : ""}
</script>`,
  );
}

export function errorPage(msg: string) {
  return shell("Erreur", `<h1>Autorisation impossible</h1><p>${esc(msg)}</p>`);
}
