const editor = document.querySelector(".editor");
const status = document.querySelector(".status");
const examples = [
  "I’ll send over the notes once",
  "Thanks for flagging this. I’ll take a look and",
  "Can we move our check-in to"
];
let example = 0;

globalThis.requestSidecar = async (draft, signal) => {
  status.textContent = "Thinking locally…";
  try {
    const response = await fetch("/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
      signal
    });
    if (!response.ok) throw new Error("Completion unavailable");
    const { suffix } = await response.json();
    if (!signal.aborted) status.textContent = suffix ? "" : "No suggestion this time.";
    return suffix;
  } catch {
    if (!signal.aborted) status.textContent = "Local model unavailable. Check the companion terminal.";
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
