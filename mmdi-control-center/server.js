import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4317);
const DATA_DIR = path.join(os.homedir(), ".mmdi-control-center");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const MAX_BODY = 64 * 1024;

const defaults = {
  network: { mode: "system", proxyUrl: "", proxyName: "" },
  telegram: { botToken: "", apiId: "", apiHash: "", botApiBase: "https://api.telegram.org" },
  ai: { baseUrl: "", apiKey: "", model: "" },
  mcp: { endpoint: "" }
};

async function readConfig() {
  try {
    return { ...structuredClone(defaults), ...JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")) };
  } catch {
    return structuredClone(defaults);
  }
}
async function writeConfig(next) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { await fs.chmod(CONFIG_FILE, 0o600); } catch {}
}
function safeConfig(c) {
  const mask = v => v ? "••••••••" : "";
  return {
    network: { ...c.network, proxyUrl: c.network.proxyUrl ? "•••••••• (saved)" : "" },
    telegram: { ...c.telegram, botToken: mask(c.telegram.botToken), apiHash: mask(c.telegram.apiHash) },
    ai: { ...c.ai, apiKey: mask(c.ai.apiKey) },
    mcp: { ...c.mcp }
  };
}
function send(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  });
  res.end(JSON.stringify(data));
}
function localRequest(req) {
  const host = req.headers.host || "";
  const origin = req.headers.origin;
  if (!(host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`)) return false;
  if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) return false;
  return true;
}
async function bodyJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error("Request body too large");
  }
  return raw ? JSON.parse(raw) : {};
}
function cleanString(value, max=2048) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validUrl(value, protocols=["http:", "https:"]) {
  try { const u = new URL(value); return protocols.includes(u.protocol) ? u : null; } catch { return null; }
}
async function timedFetch(url, options={}, timeout=9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal, redirect: "error" }); }
  finally { clearTimeout(timer); }
}
async function networkStatus() {
  const result = { platform: process.platform, mode: (await readConfig()).network.mode, proxy: "unknown", vpn: [], note: "System detection is read-only." };
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-VpnConnection -ErrorAction SilentlyContinue | Select-Object -Property Name,ConnectionStatus | ConvertTo-Json -Compress"], { timeout: 6000, windowsHide: true });
      const parsed = stdout.trim() ? JSON.parse(stdout) : [];
      result.vpn = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
    } catch { result.vpn = []; }
    try {
      const { stdout } = await execFileAsync("netsh.exe", ["winhttp", "show", "proxy"], { timeout: 5000, windowsHide: true });
      result.proxy = stdout.trim().replace(/\s+/g, " ").slice(0, 500);
    } catch { result.proxy = "Could not read WinHTTP proxy"; }
  } else {
    result.proxy = process.env.HTTPS_PROXY || process.env.https_proxy || "No HTTPS_PROXY environment variable";
  }
  return result;
}
async function diagnostics() {
  const out = { time: new Date().toISOString(), dns: "unknown", telegramHttps: "unknown", details: {} };
  try {
    const { lookup } = await import("node:dns/promises");
    const a = await lookup("api.telegram.org");
    out.dns = "ok"; out.details.dnsAddress = a.address;
  } catch (e) { out.dns = "failed"; out.details.dnsError = e.code || e.message; }
  try {
    const r = await timedFetch("https://api.telegram.org", {}, 7000);
    out.telegramHttps = `reachable (HTTP ${r.status})`;
  } catch (e) { out.telegramHttps = "failed"; out.details.telegramError = e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message); }
  out.details.proxyNote = "These checks use Node's default network route. The saved proxy profile is not automatically applied to requests.";
  return out;
}
async function testTelegram() {
  const c = await readConfig();
  if (!c.telegram.botToken) return { ok:false, message:"Bot API token is not configured." };
  const base = validUrl(c.telegram.botApiBase) || new URL("https://api.telegram.org");
  const url = new URL(`/bot${c.telegram.botToken}/getMe`, base);
  try {
    const r = await timedFetch(url, {}, 10000);
    const data = await r.json();
    return data.ok ? { ok:true, username:data.result.username || "", id:data.result.id } : { ok:false, message:data.description || "Telegram rejected the token." };
  } catch (e) { return { ok:false, message:e.name === "AbortError" ? "Request timed out. Check HTTPS route/VPN/proxy." : (e.cause?.code || e.message) }; }
}
async function testAi() {
  const c = await readConfig();
  const base = validUrl(c.ai.baseUrl);
  if (!base || !c.ai.apiKey) return { ok:false, message:"Set a valid AI Router URL and API key first." };
  const endpoint = new URL((base.href.endsWith("/") ? base.href.slice(0,-1) : base.href) + "/models");
  try {
    const r = await timedFetch(endpoint, { headers:{ authorization:`Bearer ${c.ai.apiKey}` } }, 10000);
    return { ok:r.ok, message:`AI Router replied with HTTP ${r.status}.` };
  } catch (e) { return { ok:false, message:e.name === "AbortError" ? "Request timed out." : (e.cause?.code || e.message) }; }
}
async function testMcp() {
  const c = await readConfig();
  const u = validUrl(c.mcp.endpoint);
  if (!u) return { ok:false, message:"MCP endpoint is not configured." };
  try {
    const r = await timedFetch(u, {}, 7000);
    return { ok:r.ok, message:`Endpoint replied with HTTP ${r.status}. This is a reachability check, not an MCP protocol handshake.` };
  } catch (e) { return { ok:false, message:e.name === "AbortError" ? "Request timed out." : (e.cause?.code || e.message) }; }
}
async function handle(req, res) {
  if (!localRequest(req)) return send(res, 403, { error:"Local requests only." });
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === "GET" && url.pathname === "/api/status") {
    const c = await readConfig();
    return send(res, 200, { config:safeConfig(c), network:await networkStatus(), dataDirectory:DATA_DIR });
  }
  if (req.method === "POST" && url.pathname === "/api/config") {
    const incoming = await bodyJson(req);
    const current = await readConfig();
    const take = (obj,key,max=2048) => cleanString(obj?.[key],max);
    const next = {
      network: {
        mode: ["direct","system","manual"].includes(incoming.network?.mode) ? incoming.network.mode : current.network.mode,
        proxyUrl: take(incoming.network,"proxyUrl",1000) || current.network.proxyUrl,
        proxyName: take(incoming.network,"proxyName",100)
      },
      telegram: {
        botToken: take(incoming.telegram,"botToken",500) || current.telegram.botToken,
        apiId: take(incoming.telegram,"apiId",30) || current.telegram.apiId,
        apiHash: take(incoming.telegram,"apiHash",200) || current.telegram.apiHash,
        botApiBase: validUrl(take(incoming.telegram,"botApiBase",500))?.origin || current.telegram.botApiBase
      },
      ai: {
        baseUrl: validUrl(take(incoming.ai,"baseUrl",1000))?.origin || current.ai.baseUrl,
        apiKey: take(incoming.ai,"apiKey",1000) || current.ai.apiKey,
        model: take(incoming.ai,"model",200)
      },
      mcp: { endpoint: validUrl(take(incoming.mcp,"endpoint",1000))?.href || current.mcp.endpoint }
    };
    await writeConfig(next);
    return send(res, 200, { ok:true, config:safeConfig(next) });
  }
  if (req.method === "POST" && url.pathname === "/api/test/telegram") return send(res,200,await testTelegram());
  if (req.method === "POST" && url.pathname === "/api/test/ai") return send(res,200,await testAi());
  if (req.method === "POST" && url.pathname === "/api/test/mcp") return send(res,200,await testMcp());
  if (req.method === "POST" && url.pathname === "/api/diagnostics") return send(res,200,await diagnostics());
  if (req.method === "GET" && url.pathname === "/api/backup") {
    const c = await readConfig();
    const safe = { ...c, telegram:{ ...c.telegram, botToken:"[REDACTED]", apiHash:"[REDACTED]" }, ai:{ ...c.ai, apiKey:"[REDACTED]" }, network:{ ...c.network, proxyUrl:"[REDACTED]" } };
    return send(res,200,{ filename:"mmdi-control-center-settings-redacted.json", contents:safe, note:"Credentials are deliberately excluded. Telegram sessions and MmdiBot databases are not accessed." });
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/")) return send(res,404,{error:"Unknown API route"});
  if (req.method !== "GET" || url.pathname !== "/") return send(res,404,{error:"Not found"});
  const html = await fs.readFile(path.join(ROOT,"index.html"));
  res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(html);
}
const server = http.createServer((req,res) => {
  handle(req,res).catch(err => {
    console.error("[control-center]", err.message);
    if (!res.headersSent) send(res,400,{error:err instanceof SyntaxError ? "Invalid JSON body" : err.message});
    else res.destroy();
  });
});
server.listen(PORT,HOST,() => console.log(`Mmdi Control Center: http://${HOST}:${PORT}`));
server.on("error",err => { console.error(err.message); process.exitCode=1; });
