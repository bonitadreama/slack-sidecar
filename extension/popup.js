const status = document.getElementById("status");
const button = document.querySelector("button");
const labels = { ollama: "Ollama", openai: "OpenAI API" };
const descriptions = {
  ollama: "Ollama runs on this computer. Drafts stay here.",
  openai: "The current draft is sent to OpenAI using your API key."
};

async function companionProvider() {
  try {
    const response = await fetch("http://127.0.0.1:4317/status", { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return;
    const { provider } = await response.json();
    if (Object.hasOwn(labels, provider)) return provider;
  } catch {
    // The companion may be stopped.
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await chrome.tabs.sendMessage(tab.id, { type: "sidecar-state" }).catch(() => null);
  if (!state) {
    status.textContent = "Open or refresh Slack Web to enable predictions.";
    return;
  }
  let active = state.provider;
  const available = await companionProvider();

  function render() {
    if (active && active !== available) {
      status.textContent = "The companion mode changed or stopped. Disable this tab before enabling it in the new mode.";
    } else if (available) {
      status.textContent = `${labels[available]} · ${active ? "On" : "Off"}. ${descriptions[available]}`;
    } else {
      status.textContent = "Start the Sidecar companion, then reopen this popup.";
    }
    button.textContent = active ? "Disable in this tab" : "Enable in this tab";
    button.disabled = !active && !available;
  }

  render();
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const { provider } = await chrome.tabs.sendMessage(tab.id, {
        type: "sidecar-set-provider",
        provider: active ? null : available
      });
      active = provider;
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#164c33" });
      await chrome.action.setBadgeText({ tabId: tab.id, text: active === "openai" ? "API" : active ? "ON" : "" });
      await chrome.action.setTitle({ tabId: tab.id, title: active ? `Sidecar · ${labels[active]}` : "Sidecar" });
      render();
    } catch {
      status.textContent = "Refresh Slack Web and reopen Sidecar.";
    }
  });
}

init().catch(() => { status.textContent = "Open or refresh Slack Web to enable predictions."; });
