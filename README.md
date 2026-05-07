# X Stars

Export your X/Twitter bookmarks and liked posts for local analysis.

Two paths are supported:

- **Official X API** (CLI) — best for repeatable automation and deep pagination. Requires an OAuth 2.0 user-context token.
- **DevTools-injection scripts** — for ad-hoc local exports through your already-logged-in browser. Driven by an agent CLI's built-in browser tool (Claude Code's `chrome-devtools` MCP, Codex's browser tool) or pasted into Chrome DevTools manually. **No Playwright; no separate browser profile.**

Private exports and tokens are ignored by git by default.

## Quick Start

Install dependencies:

```bash
npm install
```

Copy the environment template:

```bash
cp .env.example .env
```

Configure `.env`:

```env
X_CLIENT_ID=your_oauth2_client_id
X_CLIENT_SECRET=your_oauth2_client_secret
X_USER_ID=your_x_user_id
X_USER_ACCESS_TOKEN=your_oauth2_user_access_token
X_USERNAME=your_username
```

Generate a user-context token (PKCE; opens your browser):

```bash
npm run dev -- auth --client-id your_oauth2_client_id
```

For confidential apps, include the OAuth 2.0 client secret:

```bash
npm run dev -- auth --client-id your_oauth2_client_id --client-secret your_oauth2_client_secret
```

Run an API export:

```bash
npm run export -- --kind all --max-pages 10
```

Browser-path exports are not run by this CLI. See [`docs/browser-profile.md`](docs/browser-profile.md) for the agent-driven and DevTools-paste workflows. The CLI can print the workflow with:

```bash
npm run dev -- browser-fallback
```

Exports land in `exports/` (gitignored).

## Analysis

Exporting is the easy half. See [`docs/analysis-playbook.md`](docs/analysis-playbook.md) for the recipe that turns a raw export into a decision document — turning-point detection, author rotation, viral-noise stripping, and a deep-research ranking for bookmarks.

## Commands

```bash
x-stars auth --client-id YOUR_OAUTH2_CLIENT_ID
x-stars export --kind bookmarks --max-pages 10
x-stars export --kind likes --max-pages 10
x-stars export --kind all --max-pages 10
x-stars test-live --kind all
x-stars browser-fallback     # print the DevTools-injection workflow
```

Options:

- `--kind`: `bookmarks`, `likes`, or `all`.
- `--max-pages`: API pagination limit.
- `--limit`: stop after N normalized tweets.
- `--output-dir`: export directory. Default is `exports`.

## Tests

```bash
npm test
```

API live tests require `X_USER_ID` and `X_USER_ACCESS_TOKEN` in the environment.

## Privacy

The following are ignored by git:

- `.env` and local env variants
- `data/`
- `exports/`
- `twitter-*.json`

Do not paste tokens into issues, docs, fixtures, logs, or exported JSON. If a token is exposed, revoke or rotate it from the X Developer Portal.

## Legacy Scripts

The original browser Console scripts are still present:

- `twitter_bookmarks_export.js`
- `twitter_likes_export.js`
- `scripts/browser-bookmarks-7d.js`
- `scripts/browser-likes-7d.js`

These are the canonical browser-path entry points: paste into Chrome DevTools Console, or have an agent inject them via its browser-debugging tool.
