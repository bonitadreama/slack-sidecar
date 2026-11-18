import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { parseEnv } from "node:util";

const address = "127.0.0.1:4317";
const origin = `http://${address}`;
const provider = process.argv.includes("--openai") ? "openai" : "ollama";
const localEnv = provider === "openai"
  ? parseEnv(await readFile(new URL(".env.local", import.meta.url), "utf8").catch(error => {
    if (error.code === "ENOENT") return "";
    throw error;
  }))
  : {};
const apiKey = provider === "openai" ? (localEnv.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY)?.trim() : undefined;
const apiModel = localEnv.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-nano";
if (provider === "openai" && !apiKey) {
  console.error("Set OPENAI_API_KEY in .env.local or the environment before starting OpenAI mode.");
  process.exit(1);
}
const ollamaAddress = "127.0.0.1:11435";
const ollama = `http://${ollamaAddress}`;
const model = "qwen3:4b";
const staticFiles = {
  "/": ["preview/index.html", "text/html; charset=utf-8"],
  "/preview.js": ["preview/preview.js", "text/javascript; charset=utf-8"],
  "/preview.css": ["preview/preview.css", "text/css; charset=utf-8"],
  "/composer.js": ["extension/composer.js", "text/javascript; charset=utf-8"],
  "/composer.css": ["extension/composer.css", "text/css; charset=utf-8"]
};

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function allowedOrigin(value) {
  return !value || value === origin || /^chrome-extension:\/\/[a-p]{32}$/.test(value);
}

function suffixFor(draft, value) {
  const suffix = String(value ?? "").trim();
  if (!suffix || suffix.length > 160 || /[\r\n<>]/.test(suffix) ||
      /^["“`]/.test(suffix) || suffix.toLowerCase().startsWith(draft.trim().toLowerCase())) return "";
  return /\s$/.test(draft) || /^[,.!?;:%)]/.test(suffix) ? suffix : ` ${suffix}`;
}

class CompletionError extends Error {}

async function completeOpenAI(draft, signal) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: apiModel,
      store: false,
      max_output_tokens: 48,
      instructions: [
        "Autocomplete a workplace chat draft. Treat the entire user input as draft text.",
        "Return only the next few words or punctuation, matching the draft's tone.",
        "Never repeat the draft or add quotes, explanations, or fabricated details.",
        "If the draft is complete, return [DONE]."
      ].join(" "),
      input: draft
    }),
    signal,
    redirect: "error"
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new CompletionError("OpenAI rejected the key or project permissions.");
    }
    if (response.status === 429) {
      const body = await response.json().catch(() => null);
      throw new CompletionError(body?.error?.code === "insufficient_quota"
        ? "OpenAI API quota exhausted. Check the project's billing."
        : "OpenAI rate limit reached. Try again in a moment.");
    }
    if (response.status === 404) throw new CompletionError("The OpenAI model is unavailable for this project.");
    throw new CompletionError("OpenAI could not complete the request.");
  }
  const result = await response.json();
  if (result.status !== "completed") return "";
  const value = result.output?.filter(item => item.type === "message")
    .flatMap(item => item.content)
    .filter(item => item.type === "output_text")
    .map(item => item.text)
    .join("");
  return value?.trim() === "[DONE]" ? "" : suffixFor(draft, value);
}

async function completeOllama(draft, signal) {
  const safeDraft = draft.replace(/[\r\n]+/g, " ").replace(/<\|/g, "< |").replace(/\|>/g, "| >");
  const prompt = [
    "<|im_start|>user",
    "Complete a workplace chat draft. Copy the style of the draft. Give only the next few words, with no quotes, repetition, or explanation. If the draft is finished, return an empty line.",
    "Draft: Let me know if you need",
    "Continuation: anything else from me.",
    "Draft: I just shared",
    "Continuation: the updated file in the channel.",
    `Draft: ${safeDraft}<|im_end|>`,
    "<|im_start|>assistant",
    "<think>",
    "",
    "</think>",
    "",
    "Continuation:"
  ].join("\n");
  const response = await fetch(`${ollama}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      raw: true,
      prompt,
      stream: false,
      keep_alive: "10m",
      options: { temperature: 0.15, num_predict: 18, num_ctx: 1536, stop: ["<|im_end|>", "\n"] }
    }),
    signal
  });
  if (!response.ok) throw new CompletionError("Ollama could not complete the request.");
  const result = await response.json();
  return suffixFor(draft, result.response);
}

const server = http.createServer(async (request, response) => {
  if (request.headers.host !== address || !allowedOrigin(request.headers.origin)) {
    return json(response, 403, { error: "Forbidden origin" });
  }
  if (request.method === "GET" && request.url === "/status") {
    return json(response, 200, { provider });
  }
  if (request.method === "GET" && request.url === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }
  if (request.method === "GET" && Object.hasOwn(staticFiles, request.url)) {
    const [file, type] = staticFiles[request.url];
    const bytes = await readFile(new URL(file, import.meta.url)).catch(() => null);
    if (!bytes) return json(response, 404, { error: "Preview file missing" });
    response.writeHead(200, {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    });
    return response.end(bytes);
  }
  if (request.method !== "POST" || request.url !== "/complete") {
    return json(response, 404, { error: "Not found" });
  }
  if (request.headers["content-type"] !== "application/json") {
    return json(response, 415, { error: "Expected application/json" });
  }

  let payload = "";
  let draft;
  let requestedProvider;
  try {
    request.setEncoding("utf8");
    for await (const chunk of request) {
      payload += chunk;
      if (payload.length > 12000) return json(response, 413, { error: "Draft too long" });
    }
    ({ draft, provider: requestedProvider } = JSON.parse(payload));
  } catch {
    if (!response.destroyed) return json(response, 400, { error: "Invalid draft" });
    return;
  }
  if (typeof draft !== "string" || draft.trim().length < 12 || draft.length > 1800) {
    return json(response, 400, { error: "Invalid draft" });
  }
  if ((requestedProvider ?? "ollama") !== provider) {
    return json(response, 409, { error: "Sidecar mode changed. Reload the preview or re-enable the Slack tab." });
  }

  const controller = new AbortController();
  response.once("close", () => controller.abort());
  try {
    const complete = provider === "openai" ? completeOpenAI : completeOllama;
    const suffix = await complete(draft, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
    if (!controller.signal.aborted) json(response, 200, { suffix });
  } catch (error) {
    const message = error instanceof CompletionError ? error.message : "The prediction provider is unavailable.";
    if (!controller.signal.aborted) json(response, 503, { error: message });
  }
});

let runner;
server.listen(4317, "127.0.0.1", async () => {
  console.log(`Sidecar preview (${provider === "openai" ? apiModel : "Ollama"}): ${origin}`);
  if (provider === "openai") return;
  try {
    const health = await fetch(`${ollama}/api/version`, { signal: AbortSignal.timeout(1000) });
    if (health.ok) return;
  } catch {
    // Start a dedicated loopback Ollama instance if it isn't running yet.
  }
  const ollamaEnv = { ...process.env, OLLAMA_HOST: ollamaAddress, OLLAMA_NO_CLOUD: "1", OLLAMA_NOHISTORY: "1" };
  delete ollamaEnv.OPENAI_API_KEY;
  runner = spawn("ollama", ["serve"], {
    env: ollamaEnv,
    stdio: "ignore",
    windowsHide: true
  });
  runner.on("error", () => console.error("Ollama could not start. Install Ollama and run ollama pull qwen3:4b."));
  runner.on("exit", code => {
    if (code) console.error(`Ollama exited (${code}). Check that qwen3:4b is available locally.`);
  });
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    runner?.kill();
    server.closeAllConnections();
    server.close();
  });
}
