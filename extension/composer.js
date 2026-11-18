(() => {
  const selector = [
    '[data-qa="message_input"][contenteditable="true"]',
    '[data-qa="message_input"] .ql-editor[contenteditable="true"]',
    '.ql-editor[contenteditable="true"][data-placeholder^="Message "]',
    '.ql-editor[contenteditable="true"][data-placeholder^="Reply"]'
  ].join(",");

  const ghost = document.createElement("span");
  ghost.className = "sidecar-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.hidden = true;
  document.body.append(ghost);

  let pending;
  let timer;
  let suggestion;
  let composing = false;

  function clear() {
    clearTimeout(timer);
    pending?.abort();
    pending = undefined;
    suggestion = undefined;
    ghost.hidden = true;
  }
  globalThis.clearSidecar = clear;

  function snapshot(editor) {
    if (globalThis.sidecarEnabled === false) return;
    const selection = document.getSelection();
    if (!editor?.matches(selector) || document.activeElement !== editor ||
        !selection?.rangeCount || !selection.isCollapsed ||
        !editor.contains(selection.anchorNode) ||
        editor.closest('[data-qa="message_editor"], [data-qa="message_edit"]') ||
        editor.getAttribute("aria-expanded") === "true" || composing) return;

    const caret = selection.getRangeAt(0);
    const after = caret.cloneRange();
    after.setEnd(editor, editor.childNodes.length);
    if (after.toString().length || after.cloneContents().querySelector("br, img, [contenteditable=false]")) return;
    const draft = editor.innerText.replace(/\n$/, "");
    if (draft.trim().length < 12 || draft.length > 1800 ||
        /^\s*\//.test(draft) || /(?:^|\s)[@#:/]\S*$/.test(draft) || /\n\s*$/.test(draft)) return;
    return { draft, caret };
  }

  function position(caret, editor) {
    const rect = caret.getBoundingClientRect();
    const bounds = editor.getBoundingClientRect();
    const style = getComputedStyle(editor);
    const width = Math.min(bounds.right - (parseFloat(style.paddingRight) || 0), innerWidth) - rect.right;
    if (width < 75 || !rect.height || rect.bottom < bounds.top || rect.top >= Math.min(bounds.bottom, innerHeight)) {
      ghost.hidden = true;
      return;
    }
    ghost.style.font = style.font;
    ghost.style.letterSpacing = style.letterSpacing;
    ghost.style.left = `${rect.right}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.maxWidth = `${width}px`;
    ghost.style.lineHeight = `${rect.height}px`;
    ghost.style.color = style.color;
    ghost.hidden = false;
  }

  function sameDraft(editor, draft) {
    const current = snapshot(editor);
    if (current?.draft === draft) return current;
  }

  function refresh() {
    if (!suggestion) return;
    const current = sameDraft(suggestion.editor, suggestion.draft);
    if (current) position(current.caret, suggestion.editor);
    else clear();
  }

  function schedule(editor) {
    clear();
    const current = snapshot(editor);
    if (!current) return;
    const { draft } = current;
    timer = setTimeout(async () => {
      if (!sameDraft(editor, draft)) return;
      const controller = new AbortController();
      pending = controller;
      let suffix;
      try {
        suffix = await globalThis.requestSidecar(draft, controller.signal);
      } catch {
        return;
      } finally {
        if (pending === controller) pending = undefined;
      }
      if (controller.signal.aborted || typeof suffix !== "string" || !suffix.trim()) return;
      const latest = sameDraft(editor, draft);
      if (!latest) return;
      ghost.textContent = suffix;
      suggestion = { editor, draft, suffix };
      position(latest.caret, editor);
    }, 420);
  }

  document.addEventListener("input", event => {
    if (event.target.matches?.(selector)) schedule(event.target);
  });
  document.addEventListener("compositionstart", () => {
    composing = true;
    clear();
  });
  document.addEventListener("compositionend", event => {
    composing = false;
    if (event.target.matches?.(selector)) schedule(event.target);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") clear();
    if (event.key !== "Tab" || event.shiftKey || event.altKey || event.metaKey ||
        event.ctrlKey || event.isComposing || ghost.hidden || !suggestion ||
        event.target !== suggestion.editor || !sameDraft(suggestion.editor, suggestion.draft)) return;

    const { suffix } = suggestion;
    clear();
    if (document.execCommand("insertText", false, suffix)) {
      clear();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener("selectionchange", refresh);
  document.addEventListener("focusout", clear);
  document.addEventListener("visibilitychange", clear);
  document.addEventListener("scroll", refresh, true);
  window.addEventListener("resize", refresh);
})();
