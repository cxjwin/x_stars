import { buildExportResult, dedupeTweets } from '../exportResult.js';
import type { ExportKind, ExportResult, NormalizedTweet, ProgressHandler } from '../types.js';

const API_BASE = 'https://api.x.com/2';

interface XApiOptions {
  kind: ExportKind;
  userId: string;
  token: string;
  maxPages?: number;
  maxItems?: number;
  pageSize?: number;
  onProgress?: ProgressHandler;
}

interface XApiTweet {
  id: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
  };
  attachments?: {
    media_keys?: string[];
  };
  referenced_tweets?: Array<{
    type: 'retweeted' | 'quoted' | 'replied_to';
    id: string;
  }>;
}

interface XApiUser {
  id: string;
  name?: string;
  username?: string;
}

interface XApiMedia {
  media_key: string;
  url?: string;
  preview_image_url?: string;
}

interface XApiResponse {
  data?: XApiTweet[];
  includes?: {
    users?: XApiUser[];
    media?: XApiMedia[];
    tweets?: XApiTweet[];
  };
  meta?: {
    next_token?: string;
    result_count?: number;
  };
  errors?: Array<{
    title?: string;
    detail?: string;
    status?: number;
  }>;
}

export async function exportWithApi(options: XApiOptions): Promise<ExportResult> {
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const tweets = new Map<string, NormalizedTweet>();
  let nextToken: string | undefined;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    const response = await fetchApiPage(options, nextToken);
    pagesFetched++;

    for (const tweet of normalizeApiTweets(response)) {
      if (!tweets.has(tweet.id)) {
        tweets.set(tweet.id, tweet);
      }
      if (options.maxItems && tweets.size >= options.maxItems) {
        break;
      }
    }

    options.onProgress?.({
      source: 'api',
      kind: options.kind,
      count: tweets.size,
      message: `Fetched ${tweets.size} ${options.kind} from ${pagesFetched} page(s).`
    });

    if (options.maxItems && tweets.size >= options.maxItems) {
      break;
    }

    nextToken = response.meta?.next_token;
    if (!nextToken) {
      break;
    }
  }

  const normalized = dedupeTweets([...tweets.values()]);
  const limited = options.maxItems ? normalized.slice(0, options.maxItems) : normalized;

  return buildExportResult('api', options.kind, limited, {
    pagesFetched,
    requestedPageSize: getPageSize(options.kind, options.pageSize, options.maxItems),
    exhaustedPagination: !nextToken
  });
}

async function fetchApiPage(options: XApiOptions, paginationToken?: string): Promise<XApiResponse> {
  const endpoint = options.kind === 'bookmarks'
    ? `${API_BASE}/users/${encodeURIComponent(options.userId)}/bookmarks`
    : `${API_BASE}/users/${encodeURIComponent(options.userId)}/liked_tweets`;

  const url = new URL(endpoint);
  url.searchParams.set('max_results', String(getPageSize(options.kind, options.pageSize, options.maxItems)));
  url.searchParams.set('tweet.fields', [
    'attachments',
    'author_id',
    'created_at',
    'entities',
    'public_metrics',
    'referenced_tweets',
    'text'
  ].join(','));
  url.searchParams.set('expansions', [
    'author_id',
    'attachments.media_keys',
    'referenced_tweets.id',
    'referenced_tweets.id.author_id'
  ].join(','));
  url.searchParams.set('user.fields', ['id', 'name', 'username'].join(','));
  url.searchParams.set('media.fields', ['media_key', 'preview_image_url', 'type', 'url'].join(','));

  if (paginationToken) {
    url.searchParams.set('pagination_token', paginationToken);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/json'
    }
  });

  const bodyText = await response.text();
  const body = parseJsonBody(bodyText);

  if (!response.ok) {
    const reset = response.headers.get('x-rate-limit-reset');
    const resetText = reset ? ` Rate limit reset: ${new Date(Number(reset) * 1000).toISOString()}.` : '';
    throw new Error(`X API ${options.kind} request failed with HTTP ${response.status}.${resetText} ${summarizeApiError(body)}`);
  }

  return body as XApiResponse;
}

function normalizeApiTweets(response: XApiResponse): NormalizedTweet[] {
  const users = new Map((response.includes?.users ?? []).map(user => [user.id, user]));
  const media = new Map((response.includes?.media ?? []).map(item => [item.media_key, item]));
  const includedTweets = new Map((response.includes?.tweets ?? []).map(tweet => [tweet.id, tweet]));

  return (response.data ?? []).map(tweet => {
    const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
    const handle = user?.username ?? tweet.author_id ?? '';
    const mediaUrls = (tweet.attachments?.media_keys ?? [])
      .map(key => media.get(key))
      .map(item => item?.url ?? item?.preview_image_url)
      .filter((url): url is string => Boolean(url));

    const quotedRef = tweet.referenced_tweets?.find(ref => ref.type === 'quoted');
    const quoted = quotedRef ? includedTweets.get(quotedRef.id) : undefined;
    const quotedAuthor = quoted?.author_id ? users.get(quoted.author_id) : undefined;

    return {
      id: tweet.id,
      url: handle ? `https://x.com/${handle}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
      authorName: user?.name ?? '',
      authorHandle: user?.username ?? handle,
      authorUrl: user?.username ? `https://x.com/${user.username}` : '',
      content: tweet.text ?? '',
      timestamp: normalizeDate(tweet.created_at),
      date: normalizeDate(tweet.created_at),
      likes: stringifyMetric(tweet.public_metrics?.like_count),
      retweets: stringifyMetric(tweet.public_metrics?.retweet_count),
      replies: stringifyMetric(tweet.public_metrics?.reply_count),
      mediaUrls,
      quotedTweet: quotedRef
        ? {
            id: quotedRef.id,
            url: quotedAuthor?.username
              ? `https://x.com/${quotedAuthor.username}/status/${quotedRef.id}`
              : `https://x.com/i/web/status/${quotedRef.id}`,
            authorHandle: quotedAuthor?.username ?? quoted?.author_id ?? ''
          }
        : null,
      isRetweet: Boolean(tweet.referenced_tweets?.some(ref => ref.type === 'retweeted')),
      retweetedBy: ''
    };
  });
}

function getPageSize(kind: ExportKind, pageSize?: number, maxItems?: number): number {
  const requested = pageSize ?? maxItems ?? 100;
  const min = kind === 'likes' ? 5 : 1;
  return Math.min(100, Math.max(min, requested));
}

function normalizeDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function stringifyMetric(value?: number): string {
  return typeof value === 'number' ? String(value) : '';
}

function parseJsonBody(bodyText: string): unknown {
  if (!bodyText) return {};
  try {
    return JSON.parse(bodyText);
  } catch {
    return { raw: bodyText.slice(0, 300) };
  }
}

function summarizeApiError(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const problem = body as { title?: string; detail?: string; type?: string };
  const topLevel = [problem.title, problem.detail, problem.type].filter(Boolean).join(' ');
  if (topLevel) return topLevel;

  const maybeErrors = (body as { errors?: Array<{ title?: string; detail?: string }> }).errors;
  if (!maybeErrors?.length) return '';
  return maybeErrors
    .map(error => [error.title, error.detail].filter(Boolean).join(': '))
    .join('; ');
}
