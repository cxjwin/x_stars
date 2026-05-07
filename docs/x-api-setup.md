# X API Setup

The API source uses OAuth 2.0 user context. Tokens are read from environment variables or local `.env`.

## Required Environment

```env
X_CLIENT_ID=your_oauth2_client_id
X_CLIENT_SECRET=your_oauth2_client_secret
X_USER_ID=your_x_user_id
X_USER_ACCESS_TOKEN=your_oauth2_user_access_token
X_REFRESH_TOKEN=your_oauth2_refresh_token
```

Shell environment variables take precedence over `.env`.

Do not use an app-only bearer token here. X returns `Unsupported Authentication` for bookmarks and liked posts when the token is OAuth 2.0 Application-Only. The token must represent the signed-in user.

## Required Access

Create an app in the X Developer Portal and generate a user access token for the same user ID you export.

The app/token must be able to read:

- Bookmarks: `GET /2/users/:id/bookmarks`
- Likes: `GET /2/users/:id/liked_tweets`
- Tweet/user/media fields needed for export normalization

Common OAuth scopes for this workflow include user and tweet read permissions plus bookmark/like read permissions when available for your access tier. X access tiers and scopes change over time, so verify the latest requirements in the official X docs before publishing a release.

## Generate a User Token

In the X Developer Portal, set the OAuth 2.0 callback URL to:

```text
http://127.0.0.1:8787/callback
```

Then run:

```bash
npm run dev -- auth --client-id your_oauth2_client_id
```

If your app is a Web App, Automated App, or Bot, X may require a client secret during token exchange:

```bash
npm run dev -- auth --client-id your_oauth2_client_id --client-secret your_oauth2_client_secret
```

You can also set `X_CLIENT_ID` and `X_CLIENT_SECRET` in `.env` and run `npm run dev -- auth`.

The CLI opens the X authorization page, waits for the callback, exchanges the authorization code with PKCE, verifies `/2/users/me`, and updates `.env` with:

- `X_USER_ID`
- `X_USER_ACCESS_TOKEN`
- `X_REFRESH_TOKEN` when X returns one
- `X_USERNAME` when available

It does not print token values.

Quick sanity check:

```bash
curl --request GET \
  --url https://api.x.com/2/users/me \
  --header "Authorization: Bearer $X_USER_ACCESS_TOKEN"
```

If the response says `OAuth 2.0 Application-Only is forbidden`, regenerate a user-context token instead of using the app bearer token.

Official docs:

- [Bookmarks introduction](https://docs.x.com/x-api/posts/bookmarks/introduction)
- [Get Bookmarks](https://docs.x.com/x-api/users/get-bookmarks)
- [Likes introduction](https://docs.x.com/x-api/posts/likes/introduction)
- [Get liked Posts](https://docs.x.com/x-api/users/get-liked-posts)
- [Pagination](https://docs.x.com/x-api/fundamentals/pagination)
- [Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)

## Export

```bash
npm run export -- --source api --kind all --max-pages 10
```

The CLI maps `kind` to these endpoints:

- `bookmarks`: `GET /2/users/:id/bookmarks`
- `likes`: `GET /2/users/:id/liked_tweets`

Each API request includes the user-context bearer token and asks X for enough expansions to normalize tweet, author, quoted tweet, and media data:

- `tweet.fields=attachments,author_id,created_at,entities,public_metrics,referenced_tweets,text`
- `expansions=author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id`
- `user.fields=id,name,username`
- `media.fields=media_key,preview_image_url,type,url`

The exporter requests up to 100 posts per page when doing full exports. It follows `meta.next_token` until one of these happens:

- X returns no next token.
- `--max-pages` is reached.
- X returns an error or rate limit.

The output records the actual newest and oldest tweet timestamps. The tool does not promise a fixed historical range because X API availability depends on account access, endpoint behavior, and rate limits.

Real output goes to `exports/`, which is ignored by git:

```text
exports/twitter-bookmarks-YYYY-MM-DD.json
exports/twitter-likes-YYYY-MM-DD.json
```

The saved JSON includes `source`, `kind`, `exportedAt`, `totalCount`, `range`, normalized `tweets`, and API metadata such as `pagesFetched`.

## Troubleshooting

- `403 Unsupported Authentication`: the token is app-only. Run `npm run dev -- auth` to generate a user-context token.
- `401 Missing valid authorization header` during token exchange: provide `X_CLIENT_SECRET` or pass `--client-secret`.
- Callback timeout: confirm the Developer Portal callback URL exactly matches `http://127.0.0.1:8787/callback`.
- Old token keeps being used: remove exported shell env vars or start a fresh shell, because shell env overrides `.env`.

## Live Test

```bash
npm run test:api
```

The bookmarks test requests one result. The likes endpoint requires at least five requested results, so the implementation requests five and keeps one normalized tweet for the assertion.
