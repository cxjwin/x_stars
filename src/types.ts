export type ExportKind = 'bookmarks' | 'likes';
export type ExportSource = 'api';

export interface QuotedTweet {
  id: string;
  url: string;
  authorHandle: string;
}

export interface NormalizedTweet {
  id: string;
  url: string;
  authorName: string;
  authorHandle: string;
  authorUrl: string;
  content: string;
  timestamp: string;
  date: string;
  likes: string;
  retweets: string;
  replies: string;
  mediaUrls: string[];
  quotedTweet: QuotedTweet | null;
  isRetweet: boolean;
  retweetedBy: string;
}

export interface ExportRange {
  newestTweetAt: string | null;
  oldestTweetAt: string | null;
}

export interface ExportResult {
  exportedAt: string;
  source: ExportSource;
  kind: ExportKind;
  totalCount: number;
  range: ExportRange;
  tweets: NormalizedTweet[];
  meta?: Record<string, unknown>;
}

export interface ProgressEvent {
  source: ExportSource;
  kind: ExportKind;
  count: number;
  message: string;
}

export type ProgressHandler = (event: ProgressEvent) => void;
