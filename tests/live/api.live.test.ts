import { describe, expect, it } from 'vitest';
import { loadEnv, requiredEnv } from '../../src/env.js';
import { exportWithApi } from '../../src/providers/api.js';

loadEnv();

describe('X API live exports', () => {
  it('fetches one bookmarked post', async () => {
    const result = await exportWithApi({
      kind: 'bookmarks',
      userId: requiredEnv('X_USER_ID'),
      token: requiredEnv('X_USER_ACCESS_TOKEN'),
      maxPages: 1,
      maxItems: 1
    });

    expect(result.source).toBe('api');
    expect(result.kind).toBe('bookmarks');
    expect(result.tweets.length).toBe(1);
    expect(result.tweets[0]?.id).toMatch(/^\d+$/);
  });

  it('fetches at least one liked post', async () => {
    const result = await exportWithApi({
      kind: 'likes',
      userId: requiredEnv('X_USER_ID'),
      token: requiredEnv('X_USER_ACCESS_TOKEN'),
      maxPages: 1,
      maxItems: 1
    });

    expect(result.source).toBe('api');
    expect(result.kind).toBe('likes');
    expect(result.tweets.length).toBe(1);
    expect(result.tweets[0]?.id).toMatch(/^\d+$/);
  });
});
