import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";

const address = "127.0.0.1:4317";
const origin = `http://${address}`;
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

async function complete(draft, signal) {
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
  if (!response.ok) throw new Error("Local model unavailable");
  const result = await response.json();
  return suffixFor(draft, result.response);
}

const server = http.createServer(async (request, response) => {
  if (request.headers.host !== address || !allowedOrigin(request.headers.origin)) {
    return json(response, 403, { error: "Forbidden origin" });
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
  try {
    request.setEncoding("utf8");
    for await (const chunk of request) {
      payload += chunk;
      if (payload.length > 12000) return json(response, 413, { error: "Draft too long" });
    }
    ({ draft } = JSON.parse(payload));
  } catch {
    if (!response.destroyed) return json(response, 400, { error: "Invalid draft" });
    return;
  }
  if (typeof draft !== "string" || draft.trim().length < 12 || draft.length > 1800) {
    return json(response, 400, { error: "Invalid draft" });
  }

  const controller = new AbortController();
  response.once("close", () => controller.abort());
  try {
    const suffix = await complete(draft, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
    if (!controller.signal.aborted) json(response, 200, { suffix });
  } catch {
    if (!controller.signal.aborted) json(response, 503, { error: "Waiting for the local model" });
  }
});

let runner;
server.listen(4317, "127.0.0.1", async () => {
  console.log(`Sidecar preview: ${origin}`);
  try {
    const health = await fetch(`${ollama}/api/version`, { signal: AbortSignal.timeout(1000) });
    if (health.ok) return;
  } catch {
    // Start a dedicated loopback Ollama instance if it isn't running yet.
  }
  runner = spawn("ollama", ["serve"], {
    env: { ...process.env, OLLAMA_HOST: ollamaAddress, OLLAMA_NO_CLOUD: "1", OLLAMA_NOHISTORY: "1" },
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
