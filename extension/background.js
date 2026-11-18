chrome.tabs.onUpdated.addListener((tabId, { status }) => {
  if (status !== "loading") return;
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  chrome.action.setTitle({ tabId, title: "Sidecar" }).catch(() => {});
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "sidecar" || port.sender?.origin !== "https://app.slack.com") return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async ({ draft, provider }) => {
    if (typeof draft !== "string" || draft.length > 1800 ||
        !["ollama", "openai"].includes(provider)) return;
    let suffix = "";
    try {
      const response = await fetch("http://127.0.0.1:4317/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, provider }),
        signal: controller.signal
      });
      if (response.ok) ({ suffix } = await response.json());
    } catch {
      // An unavailable companion leaves the Slack composer usable.
    }
    if (!controller.signal.aborted) port.postMessage({ suffix });
  });
});
