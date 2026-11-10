import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { discoverLocalProxy } from "./network-auto.js";

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4317);
const DATA_DIR = path.join(os.homedir(), ".mmdi-control-center");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const MAX_BODY = 64 * 1024;
let mmdiProcess = null;
let mmdiLog = [];
let activeAutoProxy = null;
let autoWatchBusy = false;
let autoWatchTimer = null;

const defaults = {
  network: { mode: "auto", proxyUrl: "", proxyName: "", vpnProfile: "" },
  mmdi: { projectDir: path.join(os.homedir(), "Desktop", "mmdi-source") },
  telegram: { botToken: "", apiId: "", apiHash: "", botApiBase: "https://api.telegram.org" },
  ai: { baseUrl: "", apiKey: "", model: "" },
  mcp: { endpoint: "" }
};

async function readConfig() {
  try {
    const saved = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
    return {
      ...structuredClone(defaults), ...saved,
      network: { ...defaults.network, ...saved.network, mode: saved.network?.mode === "system" ? "auto" : (saved.network?.mode || defaults.network.mode) },
      telegram: { ...defaults.telegram, ...saved.telegram },
      ai: { ...defaults.ai, ...saved.ai },
      mcp: { ...defaults.mcp, ...saved.mcp },
      mmdi: { ...defaults.mmdi, ...saved.mmdi }
    };
  } catch { return structuredClone(defaults); }
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
    mmdi: { ...c.mmdi },
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
function parseManualProxy(value) {
  const raw = cleanString(value, 1000);
  if (!raw) return { kind: "none" };
  // Telegram commonly shares MTProxy links as https://t.me/proxy?...;
  // also accept the same link without a scheme.
  let normalized = raw;
  if (/^(?:t\.me|telegram\.me)\/proxy(?:\?|$)/i.test(normalized)) normalized = "https://" + normalized;
  let u;
  try { u = new URL(normalized); } catch { return { kind: "invalid" }; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if ((host === "t.me" || host === "telegram.me") && u.pathname.replace(/\/$/, "") === "/proxy") {
    const server = (u.searchParams.get("server") || "").trim();
    const portText = (u.searchParams.get("port") || "").trim();
    const secret = (u.searchParams.get("secret") || "").trim();
    const port = Number(portText);
    if (!server || !/^\d{1,5}$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535 || !secret) {
      return { kind: "invalid", message: "MTProxy link must contain valid server, port and secret parameters." };
    }
    return { kind: "mtproxy", server, port: String(port), secret };
  }
  if (["http:", "https:", "socks:", "socks5:"].includes(u.protocol) && u.hostname) {
    return { kind: "url", url: u.href };
  }
  return { kind: "invalid" };
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
  if (result.mode === "auto") result.autoProxy = await discoverLocalProxy();
  return result;
}

async function listVpnProfiles() {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile","-NonInteractive","-Command","Get-VpnConnection -ErrorAction SilentlyContinue | Select-Object -Property Name,ConnectionStatus | ConvertTo-Json -Compress"], {timeout:7000,windowsHide:true});
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(x => x && typeof x.Name === "string").map(x => ({name:x.Name,status:x.ConnectionStatus}));
  } catch { return []; }
}
async function vpnAction(action, profile) {
  if (process.platform !== "win32") return {ok:false,message:"Windows only."};
  const name = cleanString(profile,128);
  const profiles = await listVpnProfiles();
  if (!name || !profiles.some(x => x.name === name)) return {ok:false,message:"Choose a VPN profile detected in Windows."};
  try {
    const args = action === "connect" ? [name] : [name,"/disconnect"];
    const r = await execFileAsync("rasdial.exe",args,{timeout:25000,windowsHide:true});
    return {ok:true,message:(r.stdout || r.stderr || "Command completed").trim().slice(0,800),profiles:await listVpnProfiles()};
  } catch(e) { return {ok:false,message:String(e.stderr || e.message).slice(0,800),profiles:await listVpnProfiles()}; }
}
function processSnapshot() { return {running:!!mmdiProcess && mmdiProcess.exitCode === null,pid:mmdiProcess?.pid || null,log:mmdiLog.slice(-60)}; }
async function startMmdi() {
  if (mmdiProcess && mmdiProcess.exitCode === null) return {ok:true,message:"Already running.",...processSnapshot()};
  const c = await readConfig();
  const dir = path.resolve(cleanString(c.mmdi?.projectDir,1000));
  const st = await fs.stat(dir).catch(()=>null);
  if (!st?.isDirectory()) return {ok:false,message:"MmdiBot project folder not found. Set its local path."};
  const pkg = await fs.readFile(path.join(dir,"package.json"),"utf8").catch(()=>"");
  if (!pkg.includes('"start"')) return {ok:false,message:"No start script found in selected package.json."};
  const bin = process.platform === "win32" ? "bun.exe" : "bun";
  mmdiLog = [];
  const childEnv = { ...process.env };
  for (const key of ["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy","TELEGRAM_PROXY_IP","TELEGRAM_PROXY_PORT","TELEGRAM_PROXY_SECRET"]) delete childEnv[key];
  activeAutoProxy = null;
  if (c.network?.mode === "auto") {
    const detected = await discoverLocalProxy();
    if (!detected.ok) return {ok:false,message:"Auto network could not find a working local proxy. " + detected.reason,network:detected};
    activeAutoProxy = detected;
    childEnv.HTTP_PROXY = detected.url;
    childEnv.HTTPS_PROXY = detected.url;
    childEnv.ALL_PROXY = detected.url;
    childEnv.http_proxy = detected.url;
    childEnv.https_proxy = detected.url;
    childEnv.all_proxy = detected.url;
    childEnv.NODE_USE_ENV_PROXY = "1";
  } else if (c.network?.mode === "system") {
    // Use the current Windows network route without pinning a proxy port.
  } else if (c.network?.mode === "manual" && c.network.proxyUrl) {
    const proxy = parseManualProxy(c.network.proxyUrl);
    if (proxy.kind === "invalid") return {ok:false,message:proxy.message || "Proxy profile URL is invalid."};
    if (proxy.kind === "mtproxy") {
      childEnv.TELEGRAM_PROXY_IP = proxy.server;
      childEnv.TELEGRAM_PROXY_PORT = proxy.port;
      childEnv.TELEGRAM_PROXY_SECRET = proxy.secret;
      childEnv.TELEGRAM_USE_WSS = "false";
    } else if (proxy.kind === "url") {
      childEnv.HTTPS_PROXY = proxy.url;
      childEnv.HTTP_PROXY = proxy.url;
      childEnv.ALL_PROXY = proxy.url;
    }
  }
  const child = spawn(bin,["run","start"],{cwd:dir,windowsHide:true,shell:false,env:childEnv,stdio:["ignore","pipe","pipe"]});
  mmdiProcess = child;
  const append = chunk => { mmdiLog.push(chunk.toString("utf8")); if(mmdiLog.length>100)mmdiLog=mmdiLog.slice(-100); };
  child.stdout.on("data",append); child.stderr.on("data",append);
  child.on("error",e=>append("\n[launcher] "+e.message));
  child.on("exit",(code,signal)=>append("\n[process exited code="+code+" signal="+signal+"]"));
  await new Promise(resolve=>setTimeout(resolve,900));
  if (child.exitCode === null && c.network?.mode === "auto") startAutoNetworkWatcher();
  return {ok:child.exitCode===null,message:child.exitCode===null?"MmdiBot launched. Check logs for readiness.":"MmdiBot exited during startup.",network:activeAutoProxy,...processSnapshot()};
}
function startAutoNetworkWatcher() {
  if (autoWatchTimer) clearInterval(autoWatchTimer);
  autoWatchTimer = setInterval(async () => {
    if (autoWatchBusy || !mmdiProcess || mmdiProcess.exitCode !== null) return;
    autoWatchBusy = true;
    try {
      const config = await readConfig();
      if (config.network?.mode !== "auto") return;
      const next = await discoverLocalProxy();
      if (!next.ok || !activeAutoProxy || next.url === activeAutoProxy.url) return;
      mmdiLog.push("\\n[network] Proxy changed; restarting MmdiBot with the newly detected route.");
      await stopMmdi();
      await new Promise(resolve => setTimeout(resolve, 700));
      await startMmdi();
    } catch (error) {
      mmdiLog.push("\\n[network] Automatic reconfiguration failed: " + error.message);
    } finally { autoWatchBusy = false; }
  }, 15000);
  autoWatchTimer.unref?.();
}

async function stopMmdi() {
  if (!mmdiProcess || mmdiProcess.exitCode !== null) return {ok:true,message:"Not running.",...processSnapshot()};
  if (autoWatchTimer) { clearInterval(autoWatchTimer); autoWatchTimer = null; }
  const pid=mmdiProcess.pid;
  if(process.platform==="win32") {
    try { await execFileAsync("taskkill.exe",["/PID",String(pid),"/T","/F"],{timeout:10000,windowsHide:true}); }
    catch(e) { if(mmdiProcess.exitCode===null) return {ok:false,message:e.message,...processSnapshot()}; }
  } else mmdiProcess.kill("SIGTERM");
  return {ok:true,message:"Stop signal sent.",...processSnapshot()};
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
  const networkConfig = (await readConfig()).network;
  if (networkConfig?.mode === "auto") out.details.autoProxy = await discoverLocalProxy();
  out.details.proxyNote = "Diagnostics report the system route; MmdiBot auto mode separately discovers a local proxy and injects it into the bot process.";
  return out;
}
async function readProjectEnv() {
  const c = await readConfig();
  const envPath = path.join(path.resolve(c.mmdi?.projectDir || defaults.mmdi.projectDir), ".env");
  const raw = await fs.readFile(envPath, "utf8").catch(() => null);
  const values = Object.create(null);
  if (raw !== null) {
    for (const line of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      values[m[1]] = value;
    }
  }
  const pick = (...names) => {
    for (const name of names) {
      const value = values[name] ?? process.env[name];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  return {
    exists: raw !== null,
    telegram: {
      botToken: pick("TELEGRAM_BOT_TOKEN", "BOT_TOKEN", "TELEGRAM_TOKEN", "BOT_API_TOKEN", "TG_BOT_TOKEN"),
      apiId: pick("TELEGRAM_API_ID", "API_ID", "APIID", "TG_API_ID"),
      apiHash: pick("TELEGRAM_API_HASH", "API_HASH", "TG_API_HASH"),
      botApiBase: pick("TELEGRAM_BOT_API_BASE", "BOT_API_BASE_URL")
    },
    ai: {
      baseUrl: pick("OPENAI_BASE_URL", "OPENAI_API_BASE_URL", "OPENAI_API_BASE", "AI_BASE_URL", "AI_ROUTER_BASE_URL"),
      apiKey: pick("OPENAI_API_KEY", "AI_API_KEY", "AI_ROUTER_API_KEY", "OPENROUTER_API_KEY", "LLM_API_KEY"),
      model: pick("OPENAI_MODEL", "AI_MODEL", "OPENAI_MODEL_NAME")
    }
  };
}
async function projectEnvStatus() {
  const env = await readProjectEnv();
  return {
    envFileFound: env.exists,
    telegram: { botTokenConfigured: !!env.telegram.botToken, apiIdConfigured: !!env.telegram.apiId, apiHashConfigured: !!env.telegram.apiHash },
    ai: { baseUrlConfigured: !!env.ai.baseUrl, apiKeyConfigured: !!env.ai.apiKey, modelConfigured: !!env.ai.model },
    note: "Only configuration presence is returned. Secret values are never sent to the browser."
  };
}
async function testTelegram() {
  const c = await readConfig();
  const env = await readProjectEnv();
  const token = c.telegram.botToken || env.telegram.botToken;
  if (!token) return { ok:false, message:"Bot API token was not found in dashboard settings or the project .env file." };
  const base = validUrl(env.telegram.botApiBase || c.telegram.botApiBase) || new URL("https://api.telegram.org");
  const url = new URL(`/bot${token}/getMe`, base);
  try {
    const r = await timedFetch(url, {}, 10000);
    const data = await r.json();
    return data.ok ? { ok:true, username:data.result.username || "", id:data.result.id } : { ok:false, message:data.description || "Telegram rejected the token." };
  } catch (e) { return { ok:false, message:e.name === "AbortError" ? "Request timed out. Check HTTPS route/VPN/proxy." : (e.cause?.code || e.message) }; }
}
async function testAi() {
  const c = await readConfig();
  const env = await readProjectEnv();
  const base = validUrl(c.ai.baseUrl || env.ai.baseUrl);
  const apiKey = c.ai.apiKey || env.ai.apiKey;
  if (!base || !apiKey) return { ok:false, message:"AI Router URL or API key was not found in dashboard settings or project .env." };
  const endpoint = new URL((base.href.endsWith("/") ? base.href.slice(0,-1) : base.href) + "/models");
  try {
    const r = await timedFetch(endpoint, { headers:{ authorization:`Bearer ${apiKey}` } }, 10000);
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
  if (req.method === "GET" && url.pathname === "/api/env/status") return send(res,200,await projectEnvStatus());
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
        mode: ["auto","direct","system","manual"].includes(incoming.network?.mode) ? incoming.network.mode : current.network.mode,
        proxyUrl: incoming.network?.mode === "manual" ? (take(incoming.network,"proxyUrl",1000) || current.network.proxyUrl) : "",
        proxyName: take(incoming.network,"proxyName",100),
        vpnProfile: take(incoming.network,"vpnProfile",128)
      },
      mmdi: { projectDir: take(incoming.mmdi,"projectDir",1000) || current.mmdi?.projectDir || defaults.mmdi.projectDir },
      telegram: {
        botToken: take(incoming.telegram,"botToken",500) || current.telegram.botToken,
        apiId: take(incoming.telegram,"apiId",30) || current.telegram.apiId,
        apiHash: take(incoming.telegram,"apiHash",200) || current.telegram.apiHash,
        botApiBase: validUrl(take(incoming.telegram,"botApiBase",500))?.origin || current.telegram.botApiBase
      },
      ai: {
        baseUrl: (validUrl(take(incoming.ai,"baseUrl",1000))?.href.replace(/\/+$/,"")) || current.ai.baseUrl,
        apiKey: take(incoming.ai,"apiKey",1000) || current.ai.apiKey,
        model: take(incoming.ai,"model",200)
      },
      mcp: { endpoint: validUrl(take(incoming.mcp,"endpoint",1000))?.href || current.mcp.endpoint }
    };
    await writeConfig(next);
    return send(res, 200, { ok:true, config:safeConfig(next) });
  }
  if (req.method === "GET" && url.pathname === "/api/vpn/profiles") return send(res,200,{profiles:await listVpnProfiles()});
  if (req.method === "POST" && url.pathname === "/api/vpn/connect") { const b=await bodyJson(req); return send(res,200,await vpnAction("connect",b.profile)); }
  if (req.method === "POST" && url.pathname === "/api/vpn/disconnect") { const b=await bodyJson(req); return send(res,200,await vpnAction("disconnect",b.profile)); }
  if (req.method === "GET" && url.pathname === "/api/mmdi/status") return send(res,200,processSnapshot());
  if (req.method === "POST" && url.pathname === "/api/mmdi/start") return send(res,200,await startMmdi());
  if (req.method === "POST" && url.pathname === "/api/mmdi/stop") return send(res,200,await stopMmdi());
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
