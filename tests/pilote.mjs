// node pilote.mjs <port> <etapes.json> <dossier-captures>
// étapes : {go:url} | {eval:"js async"} | {attendre:"expr js vraie"} | {shot:"nom"} | {pause:ms}
import { readFileSync, writeFileSync } from "node:fs";
const [port, fichier, dossier] = process.argv.slice(2);
const etapes = JSON.parse(readFileSync(fichier, "utf8"));
const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
let tab = liste.find((t) => t.type === "page") || await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const wait = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.type + " " + m.params.args.map((a) => a.value ?? a.description).join(" ")); });
const call = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await call("Runtime.enable"); await call("Page.enable");
await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "ERREUR " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) : r.result?.result?.value; };
for (const s of etapes) {
  if (s.go) { await call("Page.navigate", { url: s.go }); await new Promise((r) => setTimeout(r, 1500)); }
  if (s.eval) { const v = await ev(`(async()=>{${s.eval}})()`); console.log("eval:", JSON.stringify(v)?.slice(0, 300)); }
  if (s.attendre) { const t0 = Date.now(); let ok = false; while (Date.now() - t0 < 15000) { if (await ev(`!!(${s.attendre})`) === true) { ok = true; break; } await new Promise((r) => setTimeout(r, 250)); } console.log("attendre", s.attendre.slice(0, 60), ok ? "ok" : "TIMEOUT"); }
  if (s.cdp) { const r = await call(s.cdp, s.params || {}); console.log("cdp", JSON.stringify(r).slice(0, 200)); }
  if (s.pause) await new Promise((r) => setTimeout(r, s.pause));
  if (s.shot) { const h = await ev("Math.max(844, document.documentElement.scrollHeight)"); if (s.pleine) await call("Emulation.setDeviceMetricsOverride", { width: 390, height: Math.min(h, 4000), deviceScaleFactor: 2, mobile: true });
    const c = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(`${dossier}/${s.shot}.png`, Buffer.from(c.result.data, "base64"));
    if (s.pleine) await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); console.log("capture", s.shot); }
}
console.log(logs.filter((l) => !/^(log|debug|info)/.test(l)).join("\n"));
ws.close(); process.exit(0);
