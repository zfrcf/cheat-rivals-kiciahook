/**
 * Serveur OAuth 2.1 minimal pour le connecteur MCP personnalisé de Claude :
 * enregistrement dynamique (DCR), code d'autorisation + PKCE S256, jetons d'accès et de rafraîchissement.
 * L'autorisation n'a pas de mot de passe : elle est APPROUVÉE SUR LE TÉLÉPHONE (notification Oui/Non).
 * Seuls des hachés SHA-256 des jetons sont stockés.
 */
export interface KV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(opts: { prefix: string }): Promise<Map<string, T>>;
}

export interface Client {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  created: string;
}

const ACCESS_TTL = 30 * 864e5; // 30 jours
const REFRESH_TTL = 180 * 864e5; // 180 jours
const CODE_TTL = 5 * 60e3;

export const rand = (n = 32) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export async function sha256b64url(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*", ...extra },
  });

const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);

export function metadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    revocation_endpoint: `${origin}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["phone"],
  };
}

export function protectedResource(origin: string, path = "/mcp") {
  return { resource: `${origin}${path}`, authorization_servers: [origin], scopes_supported: ["phone"], bearer_methods_supported: ["header"], resource_name: "PhonePilot" };
}

export const unauthorized = (origin: string) =>
  new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`, "access-control-allow-origin": "*", "access-control-expose-headers": "www-authenticate" },
  });

const validRedirect = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

export class OAuth {
  constructor(private kv: KV) {}

  async register(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as any;
    const uris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (!uris.length || !uris.every(validRedirect)) return oauthError("invalid_redirect_uri", "redirect_uris https requis");
    const clients = await this.kv.list({ prefix: "client:" });
    if (clients.size > 50) return oauthError("access_denied", "Trop de clients enregistrés : révoque depuis l'app.", 429);
    const client: Client = { client_id: rand(16), client_name: String(body.client_name ?? "Client MCP").slice(0, 80), redirect_uris: uris, created: new Date().toISOString() };
    // Client confidentiel demandé : on fournit un secret (non vérifié ; la sécurité repose sur PKCE + approbation sur le téléphone).
    const confidential = body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none";
    const extra = confidential ? { client_secret: rand(24), client_secret_expires_at: 0 } : {};
    await this.kv.put(`client:${client.client_id}`, client);
    return json({ ...client, ...extra, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: confidential ? body.token_endpoint_auth_method : "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "phone" }, 201);
  }

  /** Vérifie une demande d'autorisation ; renvoie le client ou un message d'erreur lisible. */
  async check(p: URLSearchParams): Promise<{ client: Client } | { error: string }> {
    const client = await this.kv.get<Client>(`client:${p.get("client_id")}`);
    if (!client) return { error: "Client inconnu (reconnecte le connecteur dans Claude)." };
    if (p.get("response_type") !== "code") return { error: "response_type=code attendu." };
    if (!client.redirect_uris.includes(p.get("redirect_uri") ?? "")) return { error: "redirect_uri non enregistrée." };
    if (!p.get("code_challenge") || (p.get("code_challenge_method") ?? "S256") !== "S256") return { error: "PKCE S256 obligatoire." };
    return { client };
  }

  async issueCode(p: URLSearchParams): Promise<string> {
    const code = rand();
    await this.kv.put(`code:${await sha256b64url(code)}`, {
      client_id: p.get("client_id"),
      redirect_uri: p.get("redirect_uri"),
      challenge: p.get("code_challenge"),
      exp: Date.now() + CODE_TTL,
    });
    const u = new URL(p.get("redirect_uri")!);
    u.searchParams.set("code", code);
    if (p.get("state")) u.searchParams.set("state", p.get("state")!);
    return u.toString();
  }

  private async tokens(client_id: string) {
    const access = rand();
    const refresh = rand();
    await this.kv.put(`at:${await sha256b64url(access)}`, { client_id, exp: Date.now() + ACCESS_TTL });
    await this.kv.put(`rt:${await sha256b64url(refresh)}`, { client_id, exp: Date.now() + REFRESH_TTL });
    return json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: "phone" });
  }

  async token(req: Request): Promise<Response> {
    const ct = req.headers.get("content-type") ?? "";
    const p = ct.includes("application/json") ? new URLSearchParams((await req.json()) as any) : new URLSearchParams(await req.text());
    let clientId = p.get("client_id");
    const basic = req.headers.get("authorization");
    if (!clientId && basic?.startsWith("Basic ")) clientId = atob(basic.slice(6)).split(":")[0];
    if (p.get("grant_type") === "authorization_code") {
      const key = `code:${await sha256b64url(p.get("code") ?? "")}`;
      const c = await this.kv.get<any>(key);
      await this.kv.delete(key); // usage unique
      if (!c || c.exp < Date.now()) return oauthError("invalid_grant", "Code expiré ou inconnu.");
      if (c.client_id !== clientId || c.redirect_uri !== p.get("redirect_uri")) return oauthError("invalid_grant", "Client ou redirect_uri différents.");
      if ((await sha256b64url(p.get("code_verifier") ?? "")) !== c.challenge) return oauthError("invalid_grant", "PKCE invalide.");
      return this.tokens(c.client_id);
    }
    if (p.get("grant_type") === "refresh_token") {
      const key = `rt:${await sha256b64url(p.get("refresh_token") ?? "")}`;
      const r = await this.kv.get<any>(key);
      await this.kv.delete(key); // rotation
      if (!r || r.exp < Date.now() || (clientId && r.client_id !== clientId)) return oauthError("invalid_grant", "Jeton de rafraîchissement invalide.");
      return this.tokens(r.client_id);
    }
    return oauthError("unsupported_grant_type", "authorization_code ou refresh_token");
  }

  async verify(req: Request): Promise<boolean> {
    const h = req.headers.get("authorization") ?? "";
    if (!h.startsWith("Bearer ")) return false;
    const t = await this.kv.get<any>(`at:${await sha256b64url(h.slice(7).trim())}`);
    return !!t && t.exp > Date.now();
  }

  async revoke(req: Request): Promise<Response> {
    const p = new URLSearchParams(await req.text());
    const t = p.get("token") ?? "";
    const h = await sha256b64url(t);
    await this.kv.delete(`at:${h}`);
    await this.kv.delete(`rt:${h}`);
    return new Response(null, { status: 200 });
  }

  /** Bouton « Révoquer tous les accès Claude » de l'app. */
  async revokeAll(): Promise<number> {
    let n = 0;
    for (const prefix of ["at:", "rt:", "code:", "client:"]) {
      for (const k of (await this.kv.list({ prefix })).keys()) {
        await this.kv.delete(k);
        n++;
      }
    }
    return n;
  }
}

export const cors = () =>
  new Response(null, {
    status: 204,
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,mcp-protocol-version" },
  });
