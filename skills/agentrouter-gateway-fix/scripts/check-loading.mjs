// Never prints credential values.
// Prints only pass/fail per key name and per host and key combination.
// Usage: node scripts/check-loading.mjs [server-root] [key-file]

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const [
  rootArg = "~/workspace/agentrouter-connector/mcp-server",
  keyFileArg = "~/workspace/.agentrouter-keys",
] = process.argv.slice(2);

function resolveHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir() + path.slice(1));
  return resolve(path);
}

const ROOT = resolveHome(rootArg);
const KEYFILE = resolveHome(keyFileArg);

let child;
let lines;
let sawStderr = false;
let serverStopped = false;
let gate1 = false;
let gate2 = false;
let nextId = 1;
const pending = new Map();

function stopRpc() {
  serverStopped = true;
  for (const finish of pending.values()) finish();
  pending.clear();
}

function rpc(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (
      serverStopped ||
      !child ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      reject(new Error("server unavailable"));
      return;
    }

    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout"));
    }, timeoutMs);

    const finish = (msg) => {
      clearTimeout(timer);
      pending.delete(id);
      if (!msg || msg.error !== undefined) {
        reject(new Error("RPC failed"));
      } else {
        resolve(msg);
      }
    };

    pending.set(id, finish);
    try {
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        (error) => {
          if (error) finish();
        },
      );
    } catch {
      finish();
    }
  });
}

try {
  const keysText = readFileSync(KEYFILE, "utf8");
  const kv = Object.create(null);
  for (const line of keysText.split("\n")) {
    const m = line.match(/^(AGENTROUTER_KEY_\d+)=(.+)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  console.log("file key names:", Object.keys(kv).join(",") || "(none)");

  // Preserve inherited keys so GATE1 can detect keys absent from the file.
  const env = {
    ...process.env,
    ...kv,
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
  };

  child = spawn("node", ["dist/src/server.js"], {
    cwd: ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.on("error", stopRpc);
  child.on("exit", stopRpc);
  child.stdin.on("error", stopRpc);

  // Drain stderr without echoing it; diagnostics can contain credentials.
  child.stderr.on("data", () => {
    sawStderr = true;
  });
  child.stderr.on("error", stopRpc);

  lines = createInterface({ input: child.stdout });
  lines.on("error", stopRpc);
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg?.id !== undefined) pending.get(msg.id)?.(msg);
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));

  // GATE1: compare actual child environment values with file values in memory.
  try {
    const childEnv = readFileSync(
      `/proc/${child.pid}/environ`,
      "utf8",
    ).split("\0");
    const childKv = Object.create(null);
    for (const entry of childEnv) {
      const m = entry.match(/^(AGENTROUTER_KEY_\d+)=(.*)$/);
      if (m) childKv[m[1]] = m[2];
    }

    gate1 = true;
    for (const name of new Set([
      ...Object.keys(kv),
      ...Object.keys(childKv),
    ])) {
      const inFile = name in kv;
      const inChild = name in childKv;
      const match = inFile && inChild && kv[name] === childKv[name];
      if (!match) gate1 = false;
      console.log(
        `GATE1 ${name}: file=${inFile ? "present" : "absent"} child=${inChild ? "present" : "absent"} match=${match ? "yes" : "NO"}`,
      );
    }
  } catch {
    gate1 = false;
  }

  // GATE2: call the health tool through the spawned server's final transport.
  try {
    await rpc(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "r1-gates", version: "0.1.0" },
      },
      30000,
    );
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }) + "\n",
    );

    const list = await rpc("tools/list", {}, 30000);
    const names = (list.result?.tools ?? []).map((tool) => tool.name);
    console.log(
      "tools:",
      names.length,
      "health tool present:",
      names.includes("agentrouter_health"),
    );

    const res = await rpc(
      "tools/call",
      { name: "agentrouter_health", arguments: {} },
      120000,
    );
    if (res.result?.isError) throw new Error("health tool failed");

    const text = (res.result?.content ?? [])
      .map((content) => content.text ?? "")
      .join("\n");
    const data = JSON.parse(text);
    const combos = Array.isArray(data) ? data : data.results ?? [];

    gate2 = combos.length > 0;
    for (const c of combos) {
      console.log(
        `GATE2 host=${c.host} keyIndex=${c.keyIndex} ok=${c.ok} status=${c.status} kind=${c.kind}`,
      );
      if (c.ok !== true) gate2 = false;
    }
  } catch {
    // Do not echo RPC payloads or exception text.
    gate2 = false;
  }
} catch {
  // Setup failures are reported without echoing exception text.
  gate1 = false;
  gate2 = false;
} finally {
  stopRpc();
  lines?.close();
  try {
    child?.kill("SIGTERM");
  } catch {
    // Do not echo cleanup errors.
  }

  if (child) {
    console.log("server stderr:", sawStderr ? "(suppressed)" : "(empty)");
  }

  // Flush the final verdict lines before exiting.
  process.stdout.write(
    `GATE1 result: ${gate1 ? "PASS" : "FAIL"}\n` +
      `GATE2 result: ${gate2 ? "PASS" : "FAIL"}\n`,
    () => process.exit(gate1 && gate2 ? 0 : 1),
  );
}
