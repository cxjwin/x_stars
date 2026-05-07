# Progress and Lessons

Last updated: 2026-05-07.

## Current Status

- The project is a Node.js/TypeScript CLI for the official X API plus DevTools-injection scripts for an agent-driven or manual browser path.
- Playwright was tried and removed. The browser path is now driven by an agent CLI's built-in browser tool (Claude Code `chrome-devtools` MCP, Codex's browser tool) so it inherits the user's already-logged-in browser session. See `AGENTS.md`.
- OAuth authorization is implemented with PKCE:
  - `npm run dev -- auth`
  - Local callback: `http://127.0.0.1:8787/callback`
  - The command updates `.env` without printing token values.
- API live tests pass.
- Latest API export (2026-05-07, `--max-pages 10 --kind all`):
  - Bookmarks: 98 posts, 1 page exhausted, 2023-01-24 → 2026-05-06.
  - Likes: 996 posts, 10 pages (more available), 2023-01-24 → 2026-05-06.
- Latest agent-driven browser export (2026-05-07, 7-day window):
  - Bookmarks: 45 posts.
  - Likes: 171 posts.
  - Files saved under `exports/browser-current/`.
- Real exports are written to `exports/`, which is ignored by git.

## Useful Commands

```bash
npm install
npm run typecheck
npm run build
npm run dev -- help
npm run dev -- auth
npm run test:api
npm run export -- --kind all --max-pages 1
npm run dev -- browser-fallback
```

Browser-path flow (via an agent or manual paste):

```text
agent browser tool -> navigate to bookmarks/likes -> evaluate_script (scripts/*.js) -> JSON download -> move file to exports/browser-current/
```

For OAuth apps that require a secret:

```bash
npm run dev -- auth --client-id your_oauth2_client_id --client-secret your_oauth2_client_secret
```

## X API Lessons

- Do not use the App-Only Bearer Token for bookmarks or likes.
- A 403 error with `Unsupported Authentication` means the token is application-only, not user-context.
- Use OAuth 2.0 Authorization Code Flow with PKCE to generate a user-context access token.
- Required callback URL for this project:

```text
http://127.0.0.1:8787/callback
```

- X may require `Authorization: Basic base64(client_id:client_secret)` during token exchange for Web App / Automated App / Bot clients.
- The CLI supports this with `--client-secret` or `X_CLIENT_SECRET`.
- Shell environment variables take precedence over `.env`; if an old token is exported in the shell, it can override the new `.env` token.
- Bookmarks can request `max_results=1`; liked posts require a minimum request size of 5, so tests request 5 and keep 1.
- API pagination follows `meta.next_token`; the tool records actual newest and oldest tweet timestamps instead of promising a fixed historical range.

## Detailed API Flow

The official API path has two stages: first create a user-context token, then use that token to export bookmarks and likes.

### 1. Configure X Developer Portal

- Open the X Developer Portal app.
- In `User authentication settings`, enable OAuth 2.0 user authentication.
- Set the callback / redirect URL exactly to:

```text
http://127.0.0.1:8787/callback
```

- Configure scopes for read-only export:

```text
tweet.read users.read bookmark.read like.read offline.access
```

- Use the OAuth 2.0 `Client ID`. For some app types, also copy the OAuth 2.0 `Client Secret`.
- The `Website URL` can be a temporary valid URL during local development. It is not the OAuth callback URL.

### 2. Generate Local User Token

Run one of these:

```bash
npm run dev -- auth
npm run dev -- auth --client-id your_oauth2_client_id
npm run dev -- auth --client-id your_oauth2_client_id --client-secret your_oauth2_client_secret
```

If `X_CLIENT_ID` and `X_CLIENT_SECRET` are already in `.env`, the short form is enough:

```bash
npm run dev -- auth
```

The auth command performs this sequence:

1. Generate a random PKCE `code_verifier`.
2. Hash it into a `code_challenge`.
3. Generate a random `state`.
4. Open `https://x.com/i/oauth2/authorize` with:
   - `response_type=code`
   - `client_id`
   - `redirect_uri=http://127.0.0.1:8787/callback`
   - requested scopes
   - `state`
   - `code_challenge`
   - `code_challenge_method=S256`
5. Start a local HTTP server on `127.0.0.1:8787`.
6. Wait for X to redirect back with `code` and `state`.
7. Verify the returned `state` matches the generated one.
8. Exchange the code at `https://api.x.com/2/oauth2/token`.
9. If `X_CLIENT_SECRET` is present, include Basic auth for the token exchange.
10. Verify the token by calling `/2/users/me`.
11. Update `.env` with user-specific values without printing tokens.

After success, `.env` contains:

```env
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_USER_ID=...
X_USER_ACCESS_TOKEN=...
X_REFRESH_TOKEN=...
X_USERNAME=...
```

Only `X_USER_ID` and `X_USER_ACCESS_TOKEN` are required for API export. `X_REFRESH_TOKEN` is saved for future refresh-token support.

### 3. Export Bookmarks and Likes

Run:

```bash
npm run export -- --source api --kind all --max-pages 1
```

The CLI maps `kind` to X API endpoints:

- `bookmarks` -> `GET /2/users/:id/bookmarks`
- `likes` -> `GET /2/users/:id/liked_tweets`

For each request, it sends:

- `Authorization: Bearer $X_USER_ACCESS_TOKEN`
- `max_results`
- `tweet.fields=attachments,author_id,created_at,entities,public_metrics,referenced_tweets,text`
- `expansions=author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id`
- `user.fields=id,name,username`
- `media.fields=media_key,preview_image_url,type,url`
- `pagination_token` when X returns `meta.next_token`

The exporter keeps paging until:

- X returns no `meta.next_token`.
- `--max-pages` is reached.
- `--limit` is reached.
- X returns an HTTP error or rate limit.

Output files are saved under `exports/`:

```text
exports/twitter-bookmarks-YYYY-MM-DD.json
exports/twitter-likes-YYYY-MM-DD.json
```

The output includes:

- `source`
- `kind`
- `exportedAt`
- `totalCount`
- `range.newestTweetAt`
- `range.oldestTweetAt`
- normalized `tweets`
- API metadata such as `pagesFetched`

### 4. Troubleshooting

- `403 Unsupported Authentication`: the token is app-only. Regenerate with `npm run dev -- auth`.
- `401 Missing valid authorization header` during token exchange: add `X_CLIENT_SECRET` or pass `--client-secret`.
- Browser opens but auth never finishes: check that the Developer Portal callback URL exactly matches `http://127.0.0.1:8787/callback`.
- `/2/users/me` fails after auth: the token was not generated as user-context or the app lacks required scopes.
- Test still uses the old token: check for exported shell variables, because shell env overrides `.env`.
- Likes test requests 5 but returns 1 normalized item by design, because the endpoint's minimum `max_results` is 5.

## Browser Path Lessons

- The browser path no longer uses Playwright. An agent CLI's built-in browser tool (Claude Code's `chrome-devtools` MCP, Codex's browser tool) drives the user's already-logged-in browser directly. This avoids maintaining a separate persistent profile and a separate Chromium download just to repeat the user's existing login.
- The agent (or you, in manual mode) controls the real foreground browser. If the user clicks, types, or switches tabs during a scrape, scroll dispatch and DOM observers can break.
- X exposes tweet creation time reliably in the DOM, but not the exact liked-at or bookmarked-at time. "Recent N days" therefore filters by tweet timestamp, not action timestamp.
- If a scrape is interrupted before JSON is saved, console counts are temporary only and should not be treated as exported data. Report saved files and observed counts separately.
- 2026-05-06 (Playwright fallback experiment): inject helper text directly into DevTools Console worked. The CSP on x.com blocks `fetch('http://127.0.0.1:8788/...')` from Console, so loading a helper script over a local HTTP server is not viable; the workaround is to paste the full script text.
- 2026-05-07 (Playwright path retired): the in-repo Playwright provider failed with `Target page, context or browser has been closed`. Same chrome-devtools-MCP injection flow on the user's existing logged-in Chrome produced 45 bookmarks / 171 likes for the 7-day window, matching the API slice in the same window. After that, Playwright + the persistent profile + the postinstall Chromium download were removed from the project.
- Counts from successful agent-driven runs (2026-05-06 / 2026-05-07):
  - `twitter-bookmarks-browser-7d-*.json`: 45–46
  - `twitter-likes-browser-7d-*.json`: 168–171
- DevTools Console focus can be finicky. Driving via the agent's `evaluate_script` is far more reliable than simulating console keystrokes.
- Browser downloads land in `~/Downloads/` (sometimes a `Chrome/` subfolder), so a follow-up `mv` is needed to land them in `exports/browser-current/`.

## Privacy / Open Source Checklist

- Never commit `.env`, tokens, browser profiles, or real exports.
- `.gitignore` currently excludes:
  - `.env`, `.env.*`, except `.env.example`
  - `.profiles/`
  - `data/`
  - `exports/`
  - `twitter-*.json`
  - old local analysis Markdown files
  - `.claude/` and `.codex/`
- Do not paste real tokens into docs, tests, fixtures, logs, issues, or README examples.
- If any token is exposed, revoke or rotate it in the X Developer Portal.
- Use `fixtures/sample-export.json` for public examples; it contains anonymized data only.

## Current Files

- `src/cli.ts`: CLI entry point (`auth`, `export`, `test-live`, `browser-fallback`).
- `src/auth.ts`: OAuth 2.0 PKCE authorization flow.
- `src/providers/api.ts`: official X API exporter (the only exporter shipped from this CLI).
- `src/exportResult.ts`, `src/types.ts`, `src/env.ts`, `src/writer.ts`: shared utilities.
- `tests/live/api.live.test.ts`: live API tests.
- `docs/x-api-setup.md`: OAuth and API setup.
- `docs/browser-profile.md`: agent-driven and DevTools-paste browser flow (no Playwright).
- `docs/analysis-playbook.md`: turn an export into a decision document (jq recipes + LLM prompt template).
- `docs/progress-and-lessons.md`: this progress log.
- `scripts/browser-bookmarks-7d.js`, `scripts/browser-likes-7d.js`: canonical DevTools-injection scripts used by both the agent flow and the manual paste flow.
