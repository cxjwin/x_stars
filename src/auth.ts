import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_CALLBACK_URL = 'http://127.0.0.1:8787/callback';
const DEFAULT_SCOPES = ['tweet.read', 'users.read', 'bookmark.read', 'like.read', 'offline.access'];

interface AuthOptions {
  clientId: string;
  clientSecret?: string;
  callbackUrl?: string;
  scopes?: string[];
  envPath?: string;
  openBrowser?: boolean;
}

interface TokenResponse {
  token_type?: string;
  expires_in?: number;
  access_token?: string;
  scope?: string;
  refresh_token?: string;
}

interface UserMeResponse {
  data?: {
    id?: string;
    username?: string;
    name?: string;
  };
}

export async function authorizeWithPkce(options: AuthOptions): Promise<void> {
  const callbackUrl = options.callbackUrl ?? DEFAULT_CALLBACK_URL;
  const scopes = options.scopes ?? DEFAULT_SCOPES;
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(24));

  const authorizeUrl = new URL('https://x.com/i/oauth2/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', options.clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizeUrl.searchParams.set('scope', scopes.join(' '));
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('Open this URL to authorize X Stars:');
  console.log(authorizeUrl.toString());
  console.log('');
  console.log(`Waiting for callback on ${callbackUrl}`);

  if (options.openBrowser ?? true) {
    await openUrl(authorizeUrl.toString());
  }

  const callback = await waitForCallback(callbackUrl, state);
  const token = await exchangeCode({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    code: callback.code,
    verifier,
    callbackUrl
  });

  if (!token.access_token) {
    throw new Error('X did not return an access token.');
  }

  const user = await getCurrentUser(token.access_token);
  if (!user.data?.id) {
    throw new Error('Could not resolve the authenticated user id from /2/users/me.');
  }

  await updateEnv(resolve(options.envPath ?? '.env'), {
    X_USER_ID: user.data.id,
    X_USER_ACCESS_TOKEN: token.access_token,
    ...(token.refresh_token ? { X_REFRESH_TOKEN: token.refresh_token } : {}),
    ...(user.data.username ? { X_USERNAME: user.data.username } : {})
  });

  console.log(`Authorized @${user.data.username ?? user.data.id}. Updated ${options.envPath ?? '.env'} without printing tokens.`);
}

async function waitForCallback(callbackUrl: string, expectedState: string): Promise<{ code: string }> {
  const url = new URL(callbackUrl);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const path = url.pathname;

  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const requestUrl = new URL(request.url ?? '/', callbackUrl);
      if (requestUrl.pathname !== path) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      const error = requestUrl.searchParams.get('error');
      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');

      if (error) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end(`Authorization failed: ${error}`);
        cleanup();
        rejectPromise(new Error(`X authorization failed: ${error}`));
        return;
      }

      if (!code || state !== expectedState) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Invalid authorization callback.');
        cleanup();
        rejectPromise(new Error('Invalid authorization callback: missing code or mismatched state.'));
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<h1>X Stars authorized</h1><p>You can close this tab and return to the terminal.</p>');
      cleanup();
      resolvePromise({ code });
    });

    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error('Timed out waiting for OAuth callback.'));
    }, 180_000);

    function cleanup(): void {
      clearTimeout(timeout);
      server.close();
    }

    server.on('error', rejectPromise);
    server.listen(port, url.hostname);
  });
}

async function exchangeCode(input: {
  clientId: string;
  clientSecret?: string;
  code: string;
  verifier: string;
  callbackUrl: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set('code', input.code);
  body.set('grant_type', 'authorization_code');
  body.set('client_id', input.clientId);
  body.set('redirect_uri', input.callbackUrl);
  body.set('code_verifier', input.verifier);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  if (input.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`;
  }

  const response = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const hint = response.status === 401 && !input.clientSecret
      ? ' This app likely requires --client-secret or X_CLIENT_SECRET for token exchange.'
      : '';
    throw new Error(`Token exchange failed with HTTP ${response.status}: ${summarize(json)}${hint}`);
  }

  return json as TokenResponse;
}

async function getCurrentUser(accessToken: string): Promise<UserMeResponse> {
  const response = await fetch('https://api.x.com/2/users/me?user.fields=username,name', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Could not verify user token with /2/users/me. HTTP ${response.status}: ${summarize(json)}`);
  }
  return json as UserMeResponse;
}

async function updateEnv(envPath: string, values: Record<string, string>): Promise<void> {
  const current = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const lines = current ? current.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const updated = lines.map(line => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;
    const key = match[1] ?? '';
    if (!(key in values)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      updated.push(`${key}=${value}`);
    }
  }

  await writeFile(envPath, `${updated.filter((line, index, array) => line || index < array.length - 1).join('\n')}\n`, 'utf8');
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function openUrl(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.unref();
}

function summarize(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  return String(object.error_description ?? object.error ?? object.detail ?? object.title ?? JSON.stringify(object));
}
