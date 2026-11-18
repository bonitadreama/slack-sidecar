globalThis.sidecarEnabled = false;
let activeProvider = null;
chrome.runtime.onMessage.addListener(({ type, provider }, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (type === "sidecar-set-provider" && [null, "ollama", "openai"].includes(provider)) {
    globalThis.clearSidecar?.();
    activeProvider = provider;
    globalThis.sidecarEnabled = Boolean(provider);
  }
  if (type === "sidecar-state" || type === "sidecar-set-provider") respond({ provider: activeProvider });
});

globalThis.requestSidecar = (draft, signal) => new Promise(resolve => {
  if (!globalThis.sidecarEnabled || signal.aborted) return resolve("");
  try {
    const port = chrome.runtime.connect({ name: "sidecar" });
    const close = () => {
      port.disconnect();
      resolve("");
    };
    signal.addEventListener("abort", close, { once: true });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      signal.removeEventListener("abort", close);
      resolve("");
    });
    port.onMessage.addListener(({ suffix }) => {
      signal.removeEventListener("abort", close);
      resolve(suffix);
      port.disconnect();
    });
    port.postMessage({ draft, provider: activeProvider });
  } catch {
    // Slack tabs opened before an extension reload may need a refresh.
    resolve("");
  }
});
