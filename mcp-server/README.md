# AgentRouter MCP Server

# 1. Set up and check the stdio server

## Guide contents

1. [Set up and check the server](#1-set-up-and-check-the-stdio-server) — this section.
2. [Register the server](#2-register-the-stdio-mcp-server) — launch command and verification.
3. [Use the tools](#3-use-the-six-mcp-tools) — requests, batch limits, ledger and failover.
4. [Troubleshoot](#4-troubleshooting) — diagnose build, stdio and upstream failures.

You run the server as a local Node.js process from `mcp-server/`. Your MCP client exchanges messages over stdin and stdout. The server sends requests through AgentRouter to the Azure pool.

```text
[terminal] -> [stdio] -> [MCP server] -> [AgentRouter] -> [Azure pool]
```

The built entry point is `dist/src/server.js`. This is a stdio server, not an HTTP service: there is no browser URL to open.

## Choose your task

| You want to… | Start here |
|---|---|
| Set up a fresh checkout | Follow Steps 1–5 below. |
| Check the built entry point by hand | Complete Step 5, then follow Step 6. |
| Connect an MCP client | Complete this section, then use Section 2. |
| Change keys or model limits | Use Step 3 below; see Section 3 for limits and failover. |
| Rebuild after a code change | Repeat Steps 4–5. |
| Investigate a failed check | Use Section 4. |

## Prerequisites

You need:

- **Node.js 20 or newer.** The server has been tested with **Node.js 24**.
- **npm** available in your terminal.
- **Git** and a local repository checkout containing `mcp-server/`.
- Your two **AgentRouter keys**, authorised for the models you intend to use.
- Network access to the npm registry and AgentRouter.
- A POSIX shell, such as Bash or zsh. On Windows, you can use WSL with Node.js and npm installed there.

Use the same terminal for the steps below. Replace `<placeholders>` with your own values. You do not need a global TypeScript installation.

## Install and check

### Step 1: Check Node.js and npm

```sh
node --version
npm --version
```

**You should see:** a Node.js version of `v20.x.x` or newer and an npm version number. If you use the tested Node.js release, the first line starts with `v24.`.

### Step 2: Install the dependencies

Enter the server directory and install its dependencies:

```sh
cd "<repository-root>/mcp-server" &&
npm install &&
npm ls --depth=0 @modelcontextprotocol/sdk zod typescript
```

The project uses:

| Dependency | Version |
|---|---|
| `@modelcontextprotocol/sdk` | `1.32.1` |
| `zod` | `3.25.76` |
| TypeScript (`typescript`) | `5.9.3` |

Stay in `mcp-server/` for the remaining commands.

**You should see:** installation complete without errors, followed by a dependency listing containing the three versions above.

### Step 3: Create and configure `.env`

For a fresh setup, copy the example file:

```sh
cp .env.example .env
git check-ignore .env
```

If you already have a configured `.env`, skip the copy and edit your existing file.

Before adding secrets, confirm that `git check-ignore` prints `.env`. If it prints nothing, stop and ensure `mcp-server/.env` is ignored and untracked. Add an ignore rule in the repository’s root `.gitignore` if needed, then repeat the check.

**Never commit either AgentRouter key or your populated `.env`.** Keep only placeholders in `.env.example`.

Open `.env` in your editor and replace the two existing key values:

```dotenv
AGENTROUTER_KEY_1='<agentrouter-key-1>'
AGENTROUTER_KEY_2='<agentrouter-key-2>'
```

That snippet shows only the secrets. Keep the **12 per-model limit variables** already supplied by `.env.example`, using their names exactly as written.

Your configuration has **14 variables in total**:

| Entries | Count | What you set or check |
|---|---:|---|
| `AGENTROUTER_KEY_1` | 1 | Your first secret key |
| `AGENTROUTER_KEY_2` | 1 | Your second secret key |
| Astra limit variables | 4 | Context limit: `1050000` tokens |
| DeepSeek limit variables | 4 | Context limit: `1048576` tokens |
| Opus limit variables | 4 | Context limit: `1000000` tokens |
| **Total** | **14** | **2 secrets + 12 limit variables** |

Set each model’s context-limit entry to the value above. Retain the other limit values from `.env.example` unless you have been given different limits for your pool.

Save the file, then count its assignments without printing any values:

```sh
grep -Ec '^[A-Za-z_][A-Za-z0-9_]*=' .env
```

**You should see:** `.env` reported as ignored by Git and an assignment count of `14`. Your file contains two real keys and the three context limits shown above.

### Step 4: Build the server

```sh
npm run build
```

This runs `tsc` and writes the compiled JavaScript into `dist/`. You launch the compiled entry point, not the TypeScript source.

**You should see:** TypeScript finish without errors, with `dist/src/server.js` present.

### Step 5: Run the smoke check

Load your local environment into the current shell so the smoke process inherits it:

```sh
set -a
. ./.env
set +a

npm run smoke && printf '%s\n' 'Smoke check passed.'
```

Only source your own trusted `.env` file. The quoted key assignments shown above and the numeric limit assignments are shell-compatible.

**You should see:** the smoke command complete successfully, followed by `Smoke check passed.` and your shell prompt. If the check fails, fix that error before connecting a client.

### Step 6: Check the stdio entry point

Run the entry point in the same terminal so it inherits the environment loaded in Step 5:

```sh
node dist/src/server.js
```

Do not type ordinary chat text into this process. It expects MCP protocol messages from a client. Keep stdout reserved for MCP traffic; diagnostic messages belong on stderr.

Press **Ctrl+C** when you have finished this manual check. Section 2 covers letting your MCP client launch the process instead.

**You should see:** the process remain running while it waits for MCP messages. A quiet terminal is normal; there is no chat prompt or HTTP listening URL. After Ctrl+C, your shell prompt returns.

## 2. Register the STDIO MCP server

This is a **STDIO MCP server**, not a web server. Your terminal client—Codex or Claude Code—launches `node` and exchanges MCP messages over stdin/stdout. There is no port to open or URL to visit.

If you run `node dist/src/server.js` by hand from the project root, it normally waits for messages on stdin. A quiet terminal is expected. Press `Ctrl+C` to stop it; your client will launch its own process.

Before you copy the commands:

- Replace every `<...>` placeholder.
- Use the absolute path to the checkout containing the built `dist/src/server.js`.
- The examples pass two keys. If you have one, remove the `AGENTROUTER_KEY_2` line.
- Keep the `--` before `node`: it separates client options from the server command.

Register with whichever client you use, or both. The config paths below assume the clients’ default locations. These files contain plaintext keys, so set them to `600`: owner read/write only. That does not remove keys from your shell history.

### 2.1 Register with Codex CLI 0.164.0-alpha.9

```sh
codex mcp add agentrouter \
  --env AGENTROUTER_KEY_1="<agentrouter-key-1>" \
  --env AGENTROUTER_KEY_2="<agentrouter-key-2>" \
  -- node "<absolute-project-path>/dist/src/server.js"

chmod 600 "$HOME/.codex/config.toml"
codex mcp list
```

The list confirms registration and enabled status; it does not prove that a provider request will succeed.

**You should see:** an `agentrouter` entry with command `node`, your absolute server path and status `enabled`.

### 2.2 Register with Claude Code 2.1.308

Install Claude Code, then register the server with user scope so you can use it across projects.

The unpinned install below gets the current release. To install exactly 2.1.308, replace the first command with `npm install -g @anthropic-ai/claude-code@2.1.308`.

```sh
npm install -g @anthropic-ai/claude-code

claude mcp add --scope user agentrouter \
  -e AGENTROUTER_KEY_1="<agentrouter-key-1>" \
  -e AGENTROUTER_KEY_2="<agentrouter-key-2>" \
  -- node "<absolute-project-path>/dist/src/server.js"

chmod 600 "$HOME/.claude.json"
claude mcp list
```

**You should see:** `agentrouter` marked `Connected`.

### 2.3 Discover the tools

Start a fresh session with `codex` or `claude` so it loads the registration. Your client handles MCP initialisation and tool discovery.

Paste this into the client:

```text
List the tools exposed by the agentrouter MCP server and the required arguments for each. Do not send a provider request yet.
```

Use the names and schemas your client reports for this build rather than guessing tool names.

**You should see:** the available `agentrouter` tools and their required arguments, without a connection or initialisation error.

### 2.4 Make your first routed request

Choose a model ID supported by your AgentRouter account and replace `<model-id>` below. This is a live request and may use paid quota.

```text
Using the agentrouter MCP tools you just listed, send one request to <model-id> with the prompt "Reply with exactly OK". Show me the tool result. Do not retry automatically.
```

If your client asks for approval, check that the requested tool belongs to `agentrouter` before allowing it. An `OK` written by the client without a tool call does not test the server.

**You should see:** an `agentrouter` tool invocation followed by a successful result containing the model’s reply, expected to be `OK`.

### 2.5 Run the smoke check

Run the smoke script from the project root. The keys supplied through `--env` or `-e` belong to the client-launched server process; they are not exported to your shell. Supply them again for this run.

The final `printf` adds an explicit success marker. It runs only if `npm run smoke` exits with status `0`.

```sh
cd "<absolute-project-path>" &&
AGENTROUTER_KEY_1="<agentrouter-key-1>" \
AGENTROUTER_KEY_2="<agentrouter-key-2>" \
npm run smoke &&
printf '\nSmoke exit status: 0\n'
```

Unlike the bare server, the smoke runner should complete its checks and exit.

**You should see:** the smoke script’s checks completing without failures, followed by `Smoke exit status: 0` and your shell prompt. The npm script banner alone is not a pass.

## 3. Use the six MCP tools

Paste the tool requests below into your MCP client, not your shell. Replace `<model-id>` with an ID returned by the first tool.

### 3.1 `agentrouter_list_models`

**Purpose:** Find the model IDs you can use for requests.

```text
Call agentrouter_list_models and show me the available model IDs.
```

**You should see:** a list of model IDs you can pass to the chat tools.

### 3.2 `agentrouter_chat`

**Purpose:** Send one prompt to one model.

Set `effort` to `low` for this check. You can raise it up to `max` for harder work.

```text
Call agentrouter_chat with model <model-id>, effort low, and this prompt:
Reply with exactly OK.
```

Check your local usage ledger in your terminal. Replace `<ledger-directory>` with the directory containing `ledger.jsonl`:

```sh
tail -n 1 "<ledger-directory>/ledger.jsonl"
```

**You should see:** an `OK` reply from the model and a usage record in your local `ledger.jsonl`.

### 3.3 `agentrouter_batch_chat`

**Purpose:** Send several model requests in one batch.

Keep each batch to **32 requests or fewer**. The concurrency cap is **8 requests at once**. Split larger jobs into separate batches.

```text
Call agentrouter_batch_chat with these two requests, both using model <model-id> and effort low:
1. Reply with exactly ONE.
2. Reply with exactly TWO.
```

**You should see:** a response for each request: `ONE` and `TWO`.

### 3.4 `agentrouter_health`

**Purpose:** Check the router’s current health.

```text
Call agentrouter_health and show me the health report.
```

**You should see:** the current health status and any reported problems.

### 3.5 `agentrouter_diagnose`

**Purpose:** Run diagnostic checks when a request fails.

If you configure two keys, failover follows their **configuration order**. HTTP `401`, `402` and `503` trigger a retry with the next key.

**HTTP `502` does not trigger failover. This is a known gap.** If you receive a `502`, do not assume the second key was tried.

```text
Call agentrouter_diagnose and summarise any failed checks.
```

**You should see:** which diagnostic checks passed and details of any failures.

### 3.6 `agentrouter_generate_config`

**Purpose:** Write the configuration files for Codex and Claude Code.

> **Warning:** `agentrouter_generate_config` **WRITES** the real `~/.codex/config.toml` and `~/.claude/settings.json`. It is not a preview. **Do not run it casually**, including as a tool-availability check. Back up any existing files before you proceed.

The example below asks your MCP client to wait for approval; do not assume the tool itself provides a confirmation prompt.

```text
Ask for my confirmation before calling agentrouter_generate_config to write the Codex and Claude Code configuration files. Wait for my explicit approval before making the call.
```

**You should see:** a confirmation request first. After you approve the call, you should see the generated configuration in both real files.

## 4. Troubleshooting

These HTTP errors come from the upstream API. Your MCP connection still runs over stdin/stdout.

| Symptom | Cause | Fix and expected result |
|---|---|---|
| **401 mentioning `client-headers`** | The gateway rejects your client-identification headers. This is not the same diagnosis as an invalid token. | Set the gateway-required headers on the server’s **upstream HTTP requests**, not in its stdio input. Keep your token unchanged while checking this. **You should see:** the `client-headers` rejection disappear. |
| **401 mentioning `invalid token`** | The upstream token is missing, malformed, expired or rejected. | Check the token actually loaded by the MCP process, including stray whitespace and whether it belongs to this gateway. Correct or replace it, then restart the process. **You should see:** a fresh request pass token validation. |
| **402 / budget-pool error** | The budget pool serving your request cannot authorise the spend. | Check the pool attached to your key and have its owner replenish or reassign it. Rotating keys will not help if both use the same exhausted pool. **You should see:** available pool budget and no 402 on a fresh request. |
| **503 / `no-channel`** | There is no eligible route for the requested model. The model list is **dynamic**. The recorded “GPT-6-only” snapshots on **2026-10-23** and **2026-10-28** listed `gpt-5.6-sol`, `gpt-6-astra` and `gpt-6.1-sol`. DeepSeek and Opus requests returned 503 when their IDs were off-list. | Fetch the live model list using the same host, key and required headers as your request. Select an exact returned ID; do not treat the October snapshots as a permanent allow-list. **You should see:** your chosen ID in that key’s current list. If it still returns `no-channel`, report a routing fault rather than guessing another model name. |
| **502 that succeeds intermittently — the “lottery”** | About **1 in 5 requests landed on 2026-10-24**. This was intermittent upstream behaviour, not a reliable key/host distinction. | Keep **`<main-host>` fixed** and rotate retries across **`<api-key-1>` and `<api-key-2>`**: key 1, key 2, then repeat. Use back-off and a retry limit. This is retry rotation on the main host, **not a permanent key or host switch**. **You should see:** either a completed response or a failure after your retry limit. |
| **Azure `state-mismatch` on a chained Responses request** | Responses state is pinned to one Azure resource. A later request has reached a different resource from the one that owns the chain. | Start a **fresh stateless request**: omit `previous_response_id` and other resource-bound conversation references, and include the required instructions and context directly. If you resume chaining, keep the entire chain on one Azure resource. **You should see:** a new response without `state-mismatch`. |
| **Startup exits with environment-validation errors** | Required environment variables are missing or malformed in the process launched by your MCP client. | Correct the variables named by the validator in your client’s server `env` configuration, then restart that server process. Do not assume a GUI client inherits your terminal’s exports. **You should see:** the process stay running and answer `initialize`. |
| **Quiet terminal, no browser URL, or malformed stdio messages** | A stdio server waits for MCP messages on stdin; it does not expose a local HTTP endpoint. Ordinary text on stdout corrupts the transport. | Launch it through your client’s stdio configuration. Reserve stdout for MCP messages and send diagnostics to stderr. **You should see:** successful `initialize` and `tools/list` responses in the client; silence while idle is normal. |

### Check the current model list

Run this against the **upstream gateway**, not the stdio server. Replace `<main-host>` with its scheme and hostname, without `/v1` or a trailing slash. Repeat or remove the client-header line to match the gateway’s requirements.

```sh
for key in '<api-key-1>' '<api-key-2>'; do
  curl --silent --show-error --fail-with-body \
    --header "Authorization: Bearer ${key}" \
    --header '<client-header-name>: <client-header-value>' \
    --write-out '\nHTTP %{http_code}\n' \
    '<main-host>/v1/models'
done
```

**You should see:** one result per key, in that order, with HTTP 200 and the currently advertised model IDs. If either request fails, use its status **and response body** with the table above.

### Short FAQ

**Does “1 in 5” mean the fifth retry will work?**  
No. It describes the observed results on 2026-10-24, not a guarantee or a recommended retry count.

**Can you use DeepSeek or Opus because an older example names them?**  
Only if the current host/key combination offers the exact model ID. An old example does not establish current availability.

**Does a quiet terminal mean startup failed?**  
No. A stdio server normally waits for input. Your MCP client’s handshake and tool list are the useful checks, not a startup banner.

### Keeping it updated

After pulling changes, **rebuild before restarting**. Otherwise your client may keep launching old compiled output.

For an npm checkout with a `build` script:

```sh
cd '<server-repo>' &&
git pull --ff-only &&
npm ci &&
npm run build
```

**You should see:** a successful pull, dependency installation and build.

Restart the client-managed MCP server, then check its handshake and tool list. **You should see:** successful `initialize` and `tools/list` responses from the newly launched process.

Refresh the live model list when routing changes, and date new availability or retry observations. **You should see:** examples that match the current host/key results, with historical snapshots clearly labelled.

---

## About this guide

Written with GPT-6-Astra; built, tested and registered by Orion.
