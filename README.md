# Sidecar for Slack

Codex-style draft predictions in Slack Web. Pause while typing, then press **Tab** to accept the gray suggestion or **Esc** to dismiss it.

Inspired by [Fede Sarquis](https://x.com/fedesarquis) asking who was building this. Sidecar is an independent project.

![Sidecar suggests “I’ve got them ready.” after “I’ll send over the notes once” in the practice composer.](docs/preview.png)

## Try it

Install [Node.js 22+](https://nodejs.org/) and [Ollama](https://ollama.com/download) for your OS, then run these commands from the project folder. The first command downloads the local model.

```sh
ollama pull qwen3:4b
npm start
```

Leave the companion running, then open [the practice composer](http://127.0.0.1:4317/) and click **Try an example draft**. The first prediction can take a few seconds while the model loads.

## Use it in Slack Web

1. In Edge or Chrome, open `edge://extensions` or `chrome://extensions`. Enable **Developer mode**, choose **Load unpacked**, and select the `extension` folder.
2. Open or refresh Slack at `https://app.slack.com`. Click the Sidecar toolbar icon and look for the **ON** badge.
3. Type an unfinished draft such as `I’ll send over the notes once`. Pause, then press **Tab** to insert the suggestion. Send the draft through Slack as usual.

Sidecar starts off in every Slack tab. Click the toolbar icon again to turn it off. Reloading the tab also turns it off.

## What the extension sees

While enabled, Sidecar sends the text of the current draft to the companion on `127.0.0.1:4317`. The companion passes it to the local Qwen model. It keeps no draft log, reads no message history, and needs no Slack token or OpenAI API key. For a managed browser or workspace, check whether unpacked extensions are allowed.

The first version targets English-language Slack Web in Chromium browsers. The extension has been tested in Edge against a simulated Slack composer. Compatibility in a signed-in workspace and on other operating systems still needs testing.

## License

[MIT](LICENSE) covers Sidecar’s source. Ollama and Qwen have their own licenses.
