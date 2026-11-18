globalThis.sidecarEnabled = false;
chrome.runtime.onMessage.addListener(({ type }, sender, respond) => {
  if (type !== "sidecar-toggle" || sender.id !== chrome.runtime.id) return;
  globalThis.sidecarEnabled = !globalThis.sidecarEnabled;
  if (!globalThis.sidecarEnabled) globalThis.clearSidecar?.();
  respond({ enabled: globalThis.sidecarEnabled });
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
    port.postMessage({ draft });
  } catch {
    // Slack tabs opened before an extension reload may need a refresh.
    resolve("");
  }
});
