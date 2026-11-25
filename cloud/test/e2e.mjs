// Test de bout en bout du mode cloud : wrangler dev + téléphone simulé + flux OAuth complet + appels MCP.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const B = "../../bridge/node_modules";
const { default: WebSocket } = await import(`${B}/ws/wrapper.mjs`);
const { Client } = await import(`${B}/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { StreamableHTTPClientTransport } = await import(`${B}/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js`);

const PORT = 8799;
const O = `http://127.0.0.1:${PORT}`;
const b64u = (b) => Buffer.from(b).toString("base64url");
const ok = (m) => console.log("  ✓", m);

const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", `.wrangler/e2e-${Date.now()}`], { stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));
const stop = (code) => { try { process.kill(-dev.pid, "SIGTERM"); } catch { dev.kill("SIGTERM"); } process.exit(code); };
for (let i = 0; i < 120 && !/Ready on/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
if (!/Ready on/.test(log)) { console.error(log); stop(1); }

const FILE = Buffer.from("Bonjour depuis le P30 — fichier de test ".repeat(40000)); // ~1,6 Mo
const XML_NODES = [
  { path: "0", cls: "android.widget.FrameLayout", bounds: [0, 0, 1080, 2340] },
  { path: "0.0", cls: "android.widget.Switch", desc: "Mode sombre", clickable: true, bounds: [900, 500, 1040, 580] },
];

function phone(token, approve = true) {
  const calls = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/phone`);
  const ready = new Promise((resolve) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token, device: { model: "ELE-L29", android: "10" }, shizuku: false,
      methods: ["confirm.request", "ui.dump", "ui.action", "device.state", "file.stat", "file.read_chunk", "file.write_chunk", "notify", "health"] })));
    ws.on("close", (code) => resolve(code));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "welcome") return resolve("welcome");
      if (m.type !== "req") return;
      calls.push(m);
      const h = {
        "confirm.request": () => ({ approved: phone.approve }),
        "ui.dump": () => XML_NODES,
        "device.state": () => ({ screenOn: true, locked: false, foreground: "com.android.settings" }),
        "file.stat": () => ({ name: "rapport.txt", size: FILE.length, dir: false }),
        "file.read_chunk": (p) => ({ data: FILE.subarray(p.offset, p.offset + p.length).toString("base64") }),
      }[m.method];
      ws.send(JSON.stringify({ type: "res", id: m.id, ok: true, result: h ? h(m.params) : { ok: true } }));
    });
  });
  return { ws, calls, ready };
}
phone.approve = true;

try {
  console.log("Mode cloud — test de bout en bout");
  const token = b64u(randomBytes(32));
  const p = phone(token);
  assert.equal(await p.ready, "welcome"); ok("premier téléphone adopté (appairage)");
  assert.equal(await phone(b64u(randomBytes(32))).ready, 4401); ok("un autre téléphone est refusé");

  assert.match(await (await fetch(O + "/")).text(), /Téléphone connecté/); ok("page d'état");
  const r401 = await fetch(O + "/mcp", { method: "POST" });
  assert.equal(r401.status, 401); assert.match(r401.headers.get("www-authenticate"), /resource_metadata=".*oauth-protected-resource\/mcp"/);
  const rootPost = await fetch(O + "/", { method: "POST" });
  assert.equal(rootPost.status, 401); ok("adresse racine acceptée comme connecteur"); ok("MCP sans jeton → 401 + métadonnées");
  const meta = await (await fetch(O + "/.well-known/oauth-authorization-server")).json();
  assert.equal(meta.token_endpoint, `${O}/token`); ok("métadonnées OAuth");

  const reg = await (await fetch(O + "/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) })).json();
  assert.ok(reg.client_id); ok("enregistrement dynamique du client");

  const verifier = b64u(randomBytes(32));
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: b64u(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", state: "xyz" });
  assert.match(await (await fetch(`${O}/authorize?${q}`)).text(), /notification/); ok("page d'autorisation");

  phone.approve = false;
  assert.equal((await fetch(`${O}/authorize/approve?${q}`, { method: "POST" })).status, 403); ok("refus sur le téléphone → accès refusé");
  phone.approve = true;
  const appr = await (await fetch(`${O}/authorize/approve?${q}`, { method: "POST" })).json();
  const redirect = new URL(appr.redirect);
  assert.equal(redirect.searchParams.get("state"), "xyz");
  assert.equal(p.calls.filter((c) => c.method === "confirm.request").at(-1).params.category, "connexion_claude"); ok("approbation sur le téléphone → code");

  const bad = await fetch(O + "/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: redirect.searchParams.get("code"), code_verifier: "faux", client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback" }) });
  assert.equal(bad.status, 400); ok("PKCE invalide refusé (et code consommé)");
  const appr2 = new URL((await (await fetch(`${O}/authorize/approve?${q}`, { method: "POST" })).json()).redirect);
  const tok = await (await fetch(O + "/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: appr2.searchParams.get("code"), code_verifier: verifier, client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback" }) })).json();
  assert.ok(tok.access_token && tok.refresh_token); ok("jetons d'accès + rafraîchissement");
  const ref = await (await fetch(O + "/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id }) })).json();
  assert.ok(ref.access_token); ok("rafraîchissement (rotation)");

  const client = new Client({ name: "e2e", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(O + "/mcp"), { requestInit: { headers: { Authorization: `Bearer ${ref.access_token}` } } }));
  const { tools } = await client.listTools();
  assert.ok(tools.length > 80); ok(`${tools.length} outils MCP exposés`);
  const st = await client.callTool({ name: "device_state", arguments: {} });
  assert.match(st.content[0].text, /com\.android\.settings/); ok("device_state via le cloud");
  await client.callTool({ name: "tap", arguments: { text: "Mode sombre" } });
  assert.equal(p.calls.filter((c) => c.method === "ui.action").at(-1).params.path, "0.0"); ok("tap → accessibilité du téléphone");
  const pull = await client.callTool({ name: "file_pull", arguments: { remote_path: "/sdcard/Download/rapport.txt" } });
  const link = JSON.parse(pull.content[0].text).link;
  const body = Buffer.from(await (await fetch(link.replace(/^https?:\/\/[^/]+/, O))).arrayBuffer());
  assert.ok(body.equals(FILE)); ok(`lien de téléchargement (${(body.length / 1e6).toFixed(1)} Mo, flux direct depuis le téléphone)`);
  const sch = await client.callTool({ name: "schedule_task", arguments: { name: "matin", cron: "0 8 * * *", steps: [{ tool: "daily_report" }] } });
  assert.match(sch.content[0].text, /ok/); ok("tâche planifiée enregistrée");
  await client.callTool({ name: "emergency_stop", arguments: { reason: "test" } });
  const blocked = await client.callTool({ name: "tap", arguments: { text: "Mode sombre" } });
  assert.match(blocked.content[0].text, /EMERGENCY_STOP/); ok("arrêt d'urgence");
  p.ws.send(JSON.stringify({ type: "event", name: "resume", data: {} }));
  await new Promise((r) => setTimeout(r, 300));
  const again = await client.callTool({ name: "tap", arguments: { text: "Mode sombre" } });
  assert.ok(!again.isError); ok("reprise depuis le téléphone");
  p.ws.send(JSON.stringify({ type: "event", name: "revoke_tokens", data: {} }));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await fetch(O + "/mcp", { method: "POST", headers: { Authorization: `Bearer ${ref.access_token}` } })).status, 401); ok("révocation de tous les accès depuis l'app");
  console.log("TOUT EST VERT");
  stop(0);
} catch (e) {
  console.error("ÉCHEC :", e);
  console.error(log.slice(-3000));
  stop(1);
}
