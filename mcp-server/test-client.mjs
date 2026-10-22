// ORION GLUE — live test client for the built AgentRouter MCP server.
// Raw JSON-RPC over stdio (NDJSON). Spawns dist/src/server.js with env built
// from ~/workspace/.agentrouter-keys (values are never printed) plus the
// canonical per-model config env from .env.example. Writes test-results.json.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ROOT = "/home/hatch/workspace/agentrouter-mcp-build/mcp-skeleton";
const LEDGER = "/tmp/agentrouter-mcp-test-ledger.jsonl";

const keysText = readFileSync("/home/hatch/workspace/.agentrouter-keys", "utf8");
const kv = {};
for (const line of keysText.split("\n")) {
  const m = line.match(/^(AGENTROUTER_KEY_\d+)=(.+)$/);
  if (m) kv[m[1]] = m[2].trim();
}
if (!kv.AGENTROUTER_KEY_1 && !kv.AGENTROUTER_KEY_2) throw new Error("No keys parsed");

const env = {
  ...process.env,
  ...kv,
  AGENTROUTER_API_KEY: kv.AGENTROUTER_KEY_1 ?? kv.AGENTROUTER_KEY_2, // transition only
  AGENTROUTER_GPT_6_ASTRA_CONTEXT_TOKENS: "1050000",
  AGENTROUTER_GPT_6_ASTRA_EFFORT_MIN: "low",
  AGENTROUTER_GPT_6_ASTRA_EFFORT_MAX: "max",
  AGENTROUTER_DEEPSEEK_V4_FLASH_CONTEXT_TOKENS: "1048576",
  AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MIN: "none",
  AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MAX: "max",
  AGENTROUTER_CLAUDE_OPUS_5_CONTEXT_TOKENS: "1000000",
  AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MIN: "low",
  AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MAX: "max",
  AGENTROUTER_CLAUDE_OPUS_4_8_CONTEXT_TOKENS: "1000000",
  AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MIN: "low",
  AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MAX: "max",
  AGENTROUTER_LEDGER_PATH: LEDGER,
};

const child = spawn("node", ["dist/src/server.js"], { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => { stderr += d.toString(); });

let nextId = 1;
const pending = new Map();
createInterface({ input: child.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function rpc(method, params, timeoutMs = 240_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function classify(text) {
  const m = text.match(/\((\d{3})\)/);
  if (!m) return "n/a";
  const s = Number(m[1]);
  if (s === 401) return /unauthorized[\s_-]+client/i.test(text) ? "auth-client" : "auth-token";
  if (s === 402) return "pool-exhausted";
  if (s === 503) return "no-channel";
  if (s === 400) return "bad-request";
  if (s === 429) return "rate-limited";
  return `http-${s}`;
}

function answerText(toolText) {
  try {
    const data = JSON.parse(toolText);
    if (typeof data.output_text === "string" && data.output_text) return data.output_text;
    let out = "";
    for (const item of data.output ?? []) for (const c of item.content ?? []) if (c.text) out += c.text;
    if (out) return out;
    for (const c of data.content ?? []) if (c.type === "text" && c.text) out += c.text;
    return out;
  } catch { return ""; }
}

const results = [];
async function call(name, tool, args) {
  const t0 = Date.now();
  try {
    const res = await rpc("tools/call", { name: tool, arguments: args });
    const ms = Date.now() - t0;
    if (res.error) {
      results.push({ name, tool, ms, outcome: "rpc-error", detail: JSON.stringify(res.error).slice(0, 300) });
      console.log(`${name}: RPC-ERROR ${JSON.stringify(res.error).slice(0, 200)} (${ms}ms)`);
      return;
    }
    const r = res.result;
    const text = (r.content ?? []).map((c) => c.text ?? "").join("\n");
    if (r.isError) {
      results.push({ name, tool, ms, outcome: "tool-error", class: classify(text), detail: text.slice(0, 300) });
      console.log(`${name}: TOOL-ERROR [${classify(text)}] ${text.slice(0, 160)} (${ms}ms)`);
    } else {
      const ans = answerText(text);
      results.push({ name, tool, ms, outcome: "ok", answerChars: ans.length, answerPreview: ans.slice(0, 60), rawChars: text.length, rawExcerpt: text.slice(0, 1500) });
      console.log(`${name}: OK answerChars=${ans.length} preview=${JSON.stringify(ans.slice(0, 60))} (${ms}ms)`);
    }
  } catch (e) {
    const ms = Date.now() - t0;
    results.push({ name, tool, ms, outcome: "exception", detail: String(e).slice(0, 300) });
    console.log(`${name}: EXCEPTION ${String(e).slice(0, 160)} (${ms}ms)`);
  }
}

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "glue-test-client", version: "0.1.0" },
}, 30_000);
console.log("initialize:", init.result?.serverInfo?.name, init.result?.serverInfo?.version);
notify("notifications/initialized", {});

const list = await rpc("tools/list", {}, 30_000);
const toolNames = (list.result?.tools ?? []).map((t) => t.name);
console.log("tools/list:", toolNames.join(", "));
results.push({ name: "tools/list", outcome: "ok", tools: toolNames });

await call("health", "agentrouter_health", {});
await call("chat gpt-6-astra", "agentrouter_chat", {
  model: "gpt-6-astra",
  messages: [{ role: "user", content: "Reply with the single word: ready" }],
  max_tokens: 3200,
});
await call("chat deepseek-v4-flash", "agentrouter_chat", {
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "Reply with the single word: ready" }],
  max_tokens: 1024,
});
await call("chat claude-opus-5", "agentrouter_chat", {
  model: "claude-opus-5",
  messages: [{ role: "user", content: "Reply with the single word: ready" }],
  max_tokens: 512,
});
await call("batch 2 tasks", "agentrouter_batch_chat", {
  requests: [
    { model: "gpt-6-astra", prompt: "Reply with the single word: ready" },
    { model: "deepseek-v4-flash", prompt: "Reply with the single word: ready" },
  ],
  concurrency: 2,
});
await call("diagnose 2 models x 2 keys", "agentrouter_diagnose", {
  models: ["gpt-6-astra", "claude-opus-5"],
});

writeFileSync(`${ROOT}/test-results.json`, JSON.stringify({ at: new Date().toISOString(), toolNames, results, stderrTail: stderr.slice(-500) }, null, 2));
console.log("stderr tail:", stderr.slice(-300) || "(empty)");
child.kill("SIGTERM");
process.exit(0);
