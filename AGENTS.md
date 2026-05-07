# Agent Notes

## Browser Automation Policy

- **Do not introduce Playwright, Puppeteer, or any other independent browser automation framework into this project.**
- The browser path uses the agent CLI's built-in browser tooling, which already drives the user's logged-in real browser:
  - **Claude Code**: `chrome-devtools` MCP (`list_pages`, `navigate_page`, `evaluate_script`, ...)
  - **Codex**: built-in browser tool
- This avoids rebuilding a separate login session, separate Chromium download, and separate profile directory just to do the same thing.

## Workflow for X/Twitter Browser Export

1. Make sure the user is already logged in to X in their normal browser.
2. Use the agent's browser tool to navigate to the bookmarks or likes page.
3. Inject `scripts/browser-bookmarks-7d.js` or `scripts/browser-likes-7d.js` (or the inline equivalent) via the agent's `evaluate_script` capability.
4. Drive the scroll loop from the agent side; do not run scroll loops longer than ~30 s inside a single `evaluate_script` call.
5. When done, trigger the script's blob download (or return the JSON directly) and move the file to `exports/browser-current/`.

## Focus Hygiene

- The agent controls the user's real foreground browser. Ask the user to avoid using the browser during a scrape.
- If a scrape is interrupted before the JSON is saved, **do not report the in-page count as exported data**. Report saved files and observed counts separately.

## Other

- API export requires OAuth 2.0 User Context (PKCE), not App-Only Bearer Token. Run `npm run dev -- auth`.
- For recent likes, X exposes tweet/post timestamps reliably in the DOM, but not the time the user clicked Like.
- Real exports are written to `exports/`, which is gitignored.
- See `docs/progress-and-lessons.md` for context before continuing auth/export work.
