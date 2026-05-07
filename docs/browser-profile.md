# Browser Path (DevTools Injection)

This project does not bundle browser automation. The browser path is meant to be driven by an agent CLI that already has a browser-debugging tool — Claude Code's `chrome-devtools` MCP, or Codex's built-in browser tool. Both of these can take over the user's already-logged-in browser, so there is no need to maintain a separate Playwright profile.

## Files

- `scripts/browser-bookmarks-7d.js`
- `scripts/browser-likes-7d.js`

Each is a self-contained DOM-extraction script: scroll until 7 days of tweets are collected, then trigger a JSON download.

## Recommended Flow (Agent-Driven)

1. List pages via the agent's browser tool to find the user's existing X tab. Open one if missing.
2. Navigate it to `https://x.com/i/bookmarks` or `https://x.com/<username>/likes`.
3. Verify login by checking that `article` elements load and no login form is present.
4. Inject the helper functions and a scroll-and-extract state. Drive the scroll loop from the agent side, calling `evaluate_script` repeatedly so no single call holds the page longer than ~30 s.
5. When the script reports it is past the cutoff and idle, dump the collected tweets, trigger the blob download, and move the resulting file to `exports/browser-current/`.

## Manual Flow (No Agent)

If no agent is available, the same scripts can be pasted into Chrome DevTools Console manually:

1. Open Chrome. Make sure you are logged in to X.
2. Open `https://x.com/i/bookmarks` or `https://x.com/<username>/likes`.
3. DevTools (F12) → Console.
4. Paste the contents of `scripts/browser-bookmarks-7d.js` or `scripts/browser-likes-7d.js`.
5. Wait for the JSON file to download. Move it into `exports/browser-current/`.

The page's CSP blocks `fetch('http://127.0.0.1:...')` from the Console, so loading the script over HTTP is not viable; you must paste the full text.

## Focus Hygiene

The agent (or you, in manual mode) is operating the real foreground browser. Do not click, type, switch tabs, or focus the address bar during a scrape — DOM mutation observers and scroll dispatch are sensitive to focus changes.

## Why Not Playwright

Playwright was tried earlier in this project and removed. The reason: an agent CLI that already has a browser-debugging tool is strictly more capable, because it inherits the user's existing logged-in session and does not need a separate persistent profile or Chromium download. See `AGENTS.md` for the policy.
