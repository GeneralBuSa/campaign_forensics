// Regenerates the README screenshots in docs/screenshots/{light,dark}/ from a running server.
//
//   npm run build && npm start            # in one terminal
//   npm run screenshots [base-url]        # in another (default http://localhost:3000)
//
// Drives a locally installed Chrome/Edge over the DevTools protocol so each theme can be set
// the way a visitor sets it (cf-theme in local storage). Set CHROME_PATH if no browser is found.
// Needs Node 22+ (global WebSocket).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const out = path.join(process.cwd(), "docs", "screenshots");
const THEMES = ["light", "dark"];
const PORT = 9333;

// [file name, route, window height]. Report tabs get a taller window so the content below the header shows.
const SHOTS = [
  ["landing", "/", 900],
  ["cases", "/cases", 900],
  ["report-case", "/cases/lays-rebrand", 1300],
  ["report-evidence", "/cases/lays-rebrand?tab=evidence", 1300],
  ["report-diagnosis", "/cases/lays-rebrand?tab=diagnosis", 1500],
  ["report-relaunch", "/cases/instagram-wordmark-2026?tab=relaunch", 1500],
  ["new-case", "/new", 900],
];

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const chrome = CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error("No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cf-shots-"));
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

let page;
for (let i = 0; i < 40 && !page; i++) {
  try {
    page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page");
  } catch {
    await sleep(250);
  }
}
if (!page) {
  console.error("Could not connect to the browser.");
  browser.kill();
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let nextId = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method) listeners.filter((l) => l.method === m.method).forEach((l) => l.resolve(m));
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const next = (method) => new Promise((resolve) => listeners.push({ method, resolve }));

await send("Page.enable");
// Skip the tab fade-in so nothing is captured mid-animation.
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

for (const theme of THEMES) {
  const dir = path.join(out, theme);
  fs.mkdirSync(dir, { recursive: true });
  const { result } = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem("cf-theme","${theme}")}catch(e){}`,
  });
  for (const [name, route, height] of SHOTS) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height, deviceScaleFactor: 1, mobile: false });
    const loaded = next("Page.loadEventFired");
    await send("Page.navigate", { url: base + route });
    await loaded;
    // Show a frame of the relaunch video instead of a black poster.
    await send("Runtime.evaluate", {
      expression: `document.querySelectorAll("video").forEach((v) => { v.muted = true; v.currentTime = 9; })`,
    });
    await sleep(2500);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(shot.result.data, "base64"));
    console.log(`${theme.padEnd(6)} ${name.padEnd(18)} ${route}`);
  }
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: result.identifier });
}

ws.close();
const exited = new Promise((r) => browser.once("exit", r));
browser.kill();
await exited;
// Windows can hold the profile a moment after the browser exits; a leftover temp folder is harmless.
try {
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
} catch {}
console.log(`\nSaved ${SHOTS.length * THEMES.length} screenshots to ${path.relative(process.cwd(), out)}/{light,dark}/`);
