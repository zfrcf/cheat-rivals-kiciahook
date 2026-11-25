#!/usr/bin/env node
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import qrcode from "qrcode-terminal";
import { configPath, loadConfig, rotatePairingToken } from "./config.js";
import { createNodeRuntime } from "./platform/node.js";
import { buildServer } from "./server.js";
import { AdbShell } from "./phone/adb.js";

// En mode stdio, stdout est réservé au protocole MCP : tous les journaux vont sur stderr.
const log = (...a: unknown[]) => console.error("[phonepilot]", ...a);

async function startRuntime() {
  const cfg = loadConfig();
  const { rt, hub } = createNodeRuntime(cfg);
  await hub.listen(cfg.wsHost, cfg.wsPort);
  log(`WebSocket téléphone en écoute sur ws://${cfg.wsHost}:${cfg.wsPort}`);
  rt.hub.on("connected", (d) => log("Téléphone connecté :", JSON.stringify(d)));
  rt.hub.on("disconnected", () => log("Téléphone déconnecté"));
  rt.hub.on("auth_failed", () => log("⚠️ Tentative de connexion avec un jeton invalide"));
  rt.startAutomation();
  return rt;
}

async function serveStdio() {
  const rt = await startRuntime();
  await buildServer(rt).connect(new StdioServerTransport());
  log("Serveur MCP prêt (stdio).");
}

async function serveHttp() {
  const rt = await startRuntime();
  const { httpHost, httpPort, httpToken } = rt.cfg;
  const expected = Buffer.from(`Bearer ${httpToken}`);
  const http = createServer(async (req, res) => {
    const given = Buffer.from(req.headers.authorization ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("non autorisé");
      return;
    }
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    // Mode sans session : un serveur MCP léger par requête, runtime partagé.
    const server = buildServer(rt);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  http.listen(httpPort, httpHost, () => log(`MCP HTTP sur http://${httpHost}:${httpPort}/mcp (Bearer requis)`));
}

function pair(rotate: boolean) {
  let cfg = loadConfig();
  if (rotate) cfg = rotatePairingToken(cfg);
  const payload = JSON.stringify({ v: 1, url: `ws://${cfg.wsHost}:${cfg.wsPort}`, token: cfg.pairingToken });
  console.log("Scanne ce QR code depuis l'app PhonePilot (Réglages › Appairer) :\n");
  qrcode.generate(payload, { small: true });
  console.log(`\nAdresse : ws://${cfg.wsHost}:${cfg.wsPort}`);
  if (cfg.wsHost === "127.0.0.1") {
    console.log("⚠️ wsHost = 127.0.0.1 : le téléphone ne pourra pas joindre le Mac.");
    console.log(`   Mets l'IP Tailscale du Mac (tailscale ip -4) dans ${configPath()} › wsHost.`);
  }
  console.log(rotate ? "Nouveau jeton généré : l'ancien appairage est révoqué." : "Pour révoquer l'appairage : phonepilot-bridge pair --rotate");
}

async function adbWifi() {
  const cfg = loadConfig();
  const adb = new AdbShell(cfg.adbPath, cfg.adbSerial);
  if (!(await adb.available())) {
    console.error("Aucun téléphone ADB détecté. Branche le câble USB et autorise le débogage.");
    process.exit(1);
  }
  const addr = await adb.enableTcpip();
  console.log(`ADB Wi-Fi activé. Débranche le câble puis lance :\n  adb connect ${addr}`);
}

const cmd = process.argv[2] ?? "stdio";
const actions: Record<string, () => unknown> = {
  stdio: serveStdio,
  http: serveHttp,
  pair: () => pair(process.argv.includes("--rotate")),
  "adb-wifi": adbWifi,
};
if (!actions[cmd]) {
  console.error("Usage : phonepilot-bridge [stdio|http|pair [--rotate]|adb-wifi]");
  process.exit(2);
}
Promise.resolve(actions[cmd]()).catch((e) => {
  log("Erreur fatale :", e?.message ?? e);
  process.exit(1);
});
