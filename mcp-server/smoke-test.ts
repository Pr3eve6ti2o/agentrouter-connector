// Source: Astra R-10a2a + R-10a2b (recovered 2026-10-23), verbatim extraction.
// [glue] 2026-10-23 glue pass (see BUILD-REPORT.md): imports for the assumed
// helpers, the classifier call fixed to the two-argument signature, and a
// standalone entry point at the end of the file.
import { config } from "./src/config.js";
import { probeOnce } from "./src/upstream.js";
import { classifyStatus } from "./src/tools/diagnostics.js";

// --- R-10a2a (Astra, verbatim) ---
async function smokeTest(model: string, key: string) {
  const started = Date.now();
  const { status } = await probeOnce(model, key);
  const ms = Date.now() - started;
  // [glue] Was classifyStatus(status), assigned whole to `kind`; the
  // classifier takes (status, bodyText) and returns { kind, fix }.
  const kind = classifyStatus(status, "").kind;
  const ok = status >= 200 && status < 300;
  return { model, ok, status, kind, ms };
}

// --- R-10a2b (Astra, verbatim) ---
async function smokeAll(keys: string[]) {
  if (!keys[0]) throw new Error("At least one API key is required.");
  const models = [
    "gpt-6-astra", "deepseek-v4-flash", "claude-opus-5", "claude-opus-4-8",
  ] as const;
  const results: Array<{ model: string; passed: boolean; value?: unknown; error?: string }> = [];
  for (const model of models) {
    try {
      const value = await smokeTest(model, keys[0]);
      results.push({ model, passed: true, value });
    } catch (error) {
      results.push({
        model, passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const passed = results.filter(result => result.passed).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}

// [glue] Standalone entry point: `node dist/smoke-test.js` probes all four
// models on the first configured key and prints the smokeAll() JSON.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeAll([...config.apiKeys])
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
