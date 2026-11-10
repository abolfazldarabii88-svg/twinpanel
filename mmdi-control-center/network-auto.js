import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROBE_HOST = "api.telegram.org";

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(fallback), ms))]);
}

function connectSocket(port, onConnect, timeout = 1200) {
  return new Promise(resolve => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", async () => {
      try { finish(await onConnect(socket)); } catch { finish(false); }
    });
  });
}

async function probeHttp(port) {
  return connectSocket(port, socket => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 1400);
    socket.once("data", data => {
      clearTimeout(timer);
      const line = data.toString("latin1").split("\r\n", 1)[0];
      resolve(/^HTTP\/1\.[01] 200\b/.test(line));
    });
    socket.write(`CONNECT ${PROBE_HOST}:443 HTTP/1.1\r\nHost: ${PROBE_HOST}:443\r\nProxy-Connection: keep-alive\r\n\r\n`);
  }));
}

async function probeSocks(port) {
  return connectSocket(port, socket => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 1400);
    let stage = 0;
    socket.on("data", data => {
      if (stage === 0) {
        if (data.length < 2 || data[0] !== 5 || data[1] === 255) { clearTimeout(timer); resolve(false); return; }
        stage = 1;
        const host = Buffer.from(PROBE_HOST);
        socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([1, 187])]));
      } else {
        clearTimeout(timer);
        resolve(data.length >= 2 && data[0] === 5 && data[1] === 0);
      }
    });
    socket.write(Buffer.from([5, 1, 0]));
  }));
}

export async function discoverLocalProxy() {
  if (process.platform !== "win32") return { ok: false, reason: "Automatic local proxy discovery currently supports Windows." };
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='SilentlyContinue'; Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1') -and $_.LocalPort -gt 0 } | ForEach-Object { $p=Get-Process -Id $_.OwningProcess; [pscustomobject]@{Port=$_.LocalPort;Process=$p.ProcessName} } | ConvertTo-Json -Compress"], { timeout: 7000, windowsHide: true }));
  } catch (error) {
    return { ok: false, reason: "Could not enumerate local listening ports: " + (error.message || "PowerShell failed") };
  }
  let rows;
  try { rows = stdout.trim() ? JSON.parse(stdout) : []; } catch { rows = []; }
  if (!Array.isArray(rows)) rows = [rows];
  const seen = new Set();
  const candidates = rows.filter(row => {
    const port = Number(row?.Port);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || seen.has(port)) return false;
    seen.add(port);
    return !["node","bun","system","svchost"].includes(String(row.Process || "").toLowerCase());
  }).slice(0, 80);
  const matches = await Promise.all(candidates.map(async row => {
    const port = Number(row.Port);
    const process = String(row.Process || "");
    if (await withTimeout(probeHttp(port), 1800, false)) return { ok: true, kind: "http", url: `http://127.0.0.1:${port}`, port, process };
    if (await withTimeout(probeSocks(port), 1800, false)) return { ok: true, kind: "socks5", url: `socks5://127.0.0.1:${port}`, port, process };
    return null;
  }));
  return matches.find(Boolean) || { ok: false, reason: "No working local HTTP CONNECT or SOCKS5 proxy was found.", scanned: candidates.length };
}
