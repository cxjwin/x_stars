import type { ExportKind, ExportResult, ExportSource, NormalizedTweet } from './types.js';

export function buildExportResult(
  source: ExportSource,
  kind: ExportKind,
  tweets: NormalizedTweet[],
  meta?: Record<string, unknown>
): ExportResult {
  const sorted = [...tweets].sort((a, b) => {
    const left = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const right = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return right - left;
  });

  const timestamps = sorted
    .map(tweet => tweet.timestamp)
    .filter(Boolean)
    .map(value => new Date(value).toISOString());

  return {
    exportedAt: new Date().toISOString(),
    source,
    kind,
    totalCount: sorted.length,
    range: {
      newestTweetAt: timestamps[0] ?? null,
      oldestTweetAt: timestamps[timestamps.length - 1] ?? null
    },
    tweets: sorted,
    ...(meta ? { meta } : {})
  };
}

export function dedupeTweets(tweets: NormalizedTweet[]): NormalizedTweet[] {
  const byId = new Map<string, NormalizedTweet>();
  for (const tweet of tweets) {
    if (tweet.id && !byId.has(tweet.id)) {
      byId.set(tweet.id, tweet);
    }
  }
  return [...byId.values()];
}
