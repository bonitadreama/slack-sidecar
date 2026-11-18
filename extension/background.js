const enableTitle = "Sidecar: enable on this Slack tab";

chrome.tabs.onUpdated.addListener((tabId, { status }) => {
  if (status !== "loading") return;
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  chrome.action.setTitle({ tabId, title: enableTitle }).catch(() => {});
});

chrome.action.onClicked.addListener(async ({ id: tabId }) => {
  if (tabId === undefined) return;
  try {
    const { enabled } = await chrome.tabs.sendMessage(tabId, { type: "sidecar-toggle" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#164c33" });
    await chrome.action.setBadgeText({ tabId, text: enabled ? "ON" : "" });
    await chrome.action.setTitle({ tabId, title: enabled ? "Sidecar: disable on this tab" : enableTitle });
  } catch {
    // The current tab does not contain a Slack content script.
  }
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "sidecar" || port.sender?.origin !== "https://app.slack.com") return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async ({ draft }) => {
    if (typeof draft !== "string" || draft.length > 1800) return;
    let suffix = "";
    try {
      const response = await fetch("http://127.0.0.1:4317/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
        signal: controller.signal
      });
      if (response.ok) ({ suffix } = await response.json());
    } catch {
      // An unavailable companion leaves the Slack composer usable.
    }
    if (!controller.signal.aborted) port.postMessage({ suffix });
  });
});
