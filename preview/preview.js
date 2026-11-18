const editor = document.querySelector(".editor");
const status = document.querySelector(".status");
const examples = [
  "I’ll send over the notes once",
  "Thanks for flagging this. I’ll take a look and",
  "Can we move our check-in to"
];
let example = 0;
let provider;

async function loadProvider() {
  const label = document.querySelector("#provider");
  try {
    const response = await fetch("/status");
    if (!response.ok) throw new Error();
    ({ provider } = await response.json());
    label.textContent = provider === "openai" ? "OpenAI API" : "Local · Ollama";
    if (provider === "openai") {
      const note = document.querySelector("#provider-note");
      note.textContent = "The current draft is sent to OpenAI using your API key.";
      note.hidden = false;
    }
  } catch {
    label.textContent = "Companion unavailable";
  }
}

loadProvider();

globalThis.requestSidecar = async (draft, signal) => {
  if (!provider) return "";
  status.textContent = provider === "openai" ? "Asking OpenAI…" : "Thinking locally…";
  try {
    const response = await fetch("/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, provider }),
      signal
    });
    const { suffix, error } = await response.json();
    if (!response.ok) throw new Error(error);
    if (!signal.aborted) status.textContent = suffix ? "" : "No suggestion this time.";
    return suffix;
  } catch (error) {
    if (!signal.aborted) status.textContent = error.message || "Prediction unavailable.";
    return "";
  }
};

editor.addEventListener("input", () => { status.textContent = ""; });
editor.addEventListener("focusout", () => { status.textContent = ""; });
editor.addEventListener("keydown", event => {
  if (event.key === "Escape") status.textContent = "";
});

document.querySelector(".example").addEventListener("click", () => {
  editor.focus();
  editor.textContent = examples[example++ % examples.length];
  document.getSelection().collapse(editor.firstChild, editor.firstChild.length);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
});

document.querySelector(".composer").addEventListener("submit", event => {
  event.preventDefault();
  const draft = editor.innerText.trim();
  if (!draft) return;
  const message = document.createElement("li");
  message.textContent = draft;
  document.querySelector(".messages").append(message);
  editor.replaceChildren();
  editor.focus();
});
