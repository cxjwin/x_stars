(async function () {
  'use strict';

  const DAYS = 7;
  const SCROLL_PAUSE_MS = 1800;
  const MAX_SCROLLS = 160;
  const MAX_IDLE_ROUNDS = 5;
  const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  const LOG_PREFIX = '[LIKES-7D]';

  function log(message) {
    console.log(`${LOG_PREFIX} ${message}`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function matchMetric(value, pattern) {
    const match = value.match(pattern);
    return match && match[1] ? match[1] : '';
  }

  function topLevelArticles() {
    return Array.from(document.querySelectorAll('article'))
      .filter(article => article.closest('article article') === null);
  }

  function getPrimaryTimeElement(article) {
    const timeElements = Array.from(article.querySelectorAll('time'));
    for (const timeElement of timeElements) {
      if (timeElement.closest('article') === article) {
        return timeElement;
      }
    }

    return null;
  }

  function getPrimaryStatusLink(article, timeElement) {
    if (timeElement) {
      const timeArticle = timeElement.closest('article');
      const timeLink = timeElement.closest('a[href*="/status/"]');
      if (timeArticle === article && timeLink) {
        return timeLink;
      }
    }

    const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));
    for (const link of links) {
      if (link.closest('article') !== article) continue;
      return link;
    }

    return null;
  }

  function getPrimaryUserNameElement(article) {
    const candidates = Array.from(article.querySelectorAll('div[data-testid="User-Name"]'));
    for (const candidate of candidates) {
      if (candidate.closest('article') === article) {
        return candidate;
      }
    }

    return null;
  }

  function extractTweet(article) {
    const data = {
      id: '',
      url: '',
      authorName: '',
      authorHandle: '',
      authorUrl: '',
      content: '',
      timestamp: '',
      date: '',
      likes: '',
      retweets: '',
      replies: '',
      mediaUrls: [],
      quotedTweet: null,
      isRetweet: false,
      retweetedBy: ''
    };

    const timeElement = getPrimaryTimeElement(article);
    const primaryStatusLink = getPrimaryStatusLink(article, timeElement);
    const match = primaryStatusLink && primaryStatusLink.href
      ? primaryStatusLink.href.match(/\/([^/]+)\/status\/(\d+)/)
      : null;
    if (match) {
      data.authorHandle = match[1] || '';
      data.id = match[2] || '';
      data.url = primaryStatusLink.href;
    }

    if (!data.id) return null;

    const userName = getPrimaryUserNameElement(article);
    if (userName) {
      const spans = Array.from(userName.querySelectorAll('span'));
      for (const span of spans) {
        const value = (span.textContent || '').trim();
        if (value && !value.startsWith('@') && value.length > 1 && value.length < 50 && !/\d{4}$/.test(value)) {
          data.authorName = value;
          break;
        }
      }

      const handleLink = userName.querySelector('a[role="link"]');
      const handleText = ((handleLink && handleLink.textContent) || '').trim();
      if (handleText.startsWith('@')) {
        data.authorHandle = handleText.slice(1);
      }
    }

    if (data.authorHandle) {
      data.authorUrl = `https://x.com/${data.authorHandle}`;
    }

    const textElement = article.querySelector('[data-testid="tweetText"]');
    if (textElement) {
      data.content = (textElement.innerText || textElement.textContent || '').trim();
    }

    const timestamp = timeElement ? timeElement.getAttribute('datetime') || '' : '';
    data.timestamp = timestamp;
    data.date = timestamp;

    const actionBar = article.querySelector('[role="group"][aria-label]');
    const label = actionBar ? actionBar.getAttribute('aria-label') || '' : '';
    data.likes = matchMetric(label, /(\d+)\s*(like|likes|点赞)/i);
    data.retweets = matchMetric(label, /(\d+)\s*(retweet|retweets|转发|转推)/i);
    data.replies = matchMetric(label, /(\d+)\s*(reply|replies|回复)/i);

    data.mediaUrls = Array.from(article.querySelectorAll('img[src*="pbs.twimg.com"]'))
      .map(image => image.getAttribute('src') || '')
      .filter(src => src && !src.includes('profile_images') && !src.includes('emoji'));

    const socialContext = article.querySelector('[data-testid="socialContext"]');
    if (socialContext) {
      data.isRetweet = true;
      data.retweetedBy = (socialContext.textContent || '').trim();
    }

    return data;
  }

  function isRecent(tweet) {
    if (!tweet.timestamp) return false;
    const time = new Date(tweet.timestamp).getTime();
    return !Number.isNaN(time) && time >= cutoff;
  }

  const collected = new Map();
  let idleRounds = 0;
  let previousCount = 0;
  let scrolls = 0;

  log('start');

  while (scrolls < MAX_SCROLLS && idleRounds < MAX_IDLE_ROUNDS) {
    const articles = topLevelArticles();
    for (const article of articles) {
      const tweet = extractTweet(article);
      if (tweet && tweet.id && isRecent(tweet) && !collected.has(tweet.id)) {
        collected.set(tweet.id, tweet);
      }
    }

    const count = collected.size;
    log(`count=${count} scrolls=${scrolls}`);

    if (count === previousCount) {
      idleRounds += 1;
    } else {
      previousCount = count;
      idleRounds = 0;
    }

    const times = articles
      .map(article => extractTweet(article))
      .filter(Boolean)
      .map(tweet => new Date(tweet.timestamp).getTime())
      .filter(value => !Number.isNaN(value));

    const oldestVisible = times.length ? Math.min.apply(null, times) : null;
    if (oldestVisible && oldestVisible < cutoff && idleRounds >= 2) {
      break;
    }

    window.scrollTo(0, document.body.scrollHeight);
    scrolls += 1;
    await sleep(SCROLL_PAUSE_MS);
  }

  const tweets = Array.from(collected.values()).sort((left, right) => {
    return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    source: 'browser-current',
    kind: 'likes',
    days: DAYS,
    totalCount: tweets.length,
    tweets
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `twitter-likes-browser-7d-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  log(`done count=${tweets.length} file=${link.download}`);
})();
