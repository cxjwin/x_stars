// ============================================================
// Twitter/X Likes Exporter – 浏览器控制台脚本
// 使用方法：
//   1. 打开 https://x.com/i/likes （或 https://twitter.com/i/likes）
//   2. 等待页面加载，登录状态确认
//   3. 按 F12 打开开发者工具 → Console 标签页
//   4. 粘贴整个脚本，回车运行
//   5. 脚本会自动滚动并收集数据，完成后自动下载 JSON 文件
// ============================================================

(function () {
  'use strict';

  const SCROLL_PAUSE_MS = 2000;
  const MAX_SCROLL_RETRIES = 5;
  const LOG_PREFIX = '[LIKES-Export]';

  function log(msg) {
    console.log(`${LOG_PREFIX} ${msg}`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function extractTweetData(article) {
    try {
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
        retweetedBy: '',
      };

      // --- 推文链接 & ID ---
      const allLinks = article.querySelectorAll('a[href*="/status/"]');
      for (const link of allLinks) {
        const match = link.href.match(/\/([^\/]+)\/status\/(\d+)/);
        if (match) {
          data.authorHandle = match[1];
          data.id = match[2];
          data.url = link.href;
          break;
        }
      }

      if (!data.id) return null;

      // --- 作者名称 ---
      const userNameDiv = article.querySelector('div[data-testid="User-Name"]');
      if (userNameDiv) {
        const spans = userNameDiv.querySelectorAll('span');
        for (const s of spans) {
          const t = s.textContent.trim();
          if (t && !t.startsWith('@') && t.length > 1 && t.length < 30 && !/\d{4}$/.test(t)) {
            data.authorName = t;
            break;
          }
        }
      }

      // --- 作者 handle ---
      if (userNameDiv) {
        const handleEl = userNameDiv.querySelector('a[role="link"]');
        if (handleEl) {
          const txt = handleEl.textContent.trim();
          if (txt.startsWith('@')) data.authorHandle = txt.replace('@', '');
          if (!data.authorHandle || data.authorHandle === '') {
            const match = handleEl.href.match(/\/([^\/]+)\/status/);
            if (match) data.authorHandle = match[1];
          }
        }
      }

      // --- 推文正文 ---
      const textEl = article.querySelector('[data-testid="tweetText"]');
      if (textEl) {
        data.content = textEl.innerText.trim();
      } else {
        const autoDivs = article.querySelectorAll('div[dir="auto"]');
        for (const div of autoDivs) {
          if (div.textContent.length > 20 && div.textContent.length < 2000) {
            if (!div.closest('[data-testid="User-Name"]') && !div.querySelector('a[href*="/status/"]')) {
              data.content = div.innerText.trim();
              break;
            }
          }
        }
      }

      // --- 时间 ---
      const timeEl = article.querySelector('time');
      if (timeEl) {
        data.timestamp = timeEl.getAttribute('datetime');
        data.date = timeEl.getAttribute('datetime');
      }

      // --- 互动数据 ---
      const actionBar = article.querySelector('[role="group"][aria-label]');
      if (actionBar) {
        const label = actionBar.getAttribute('aria-label') || '';
        const likeMatch = label.match(/(\d+)\s*(like|点赞)/i);
        const rtMatch = label.match(/(\d+)\s*(retweet|转推)/i);
        const replyMatch = label.match(/(\d+)\s*(reply|回复)/i);
        if (likeMatch) data.likes = likeMatch[1];
        if (rtMatch) data.retweets = rtMatch[1];
        if (replyMatch) data.replies = replyMatch[1];
      }

      const actionBtns = article.querySelectorAll('[data-testid$="Action"]');
      for (const btn of actionBtns) {
        const aria = btn.getAttribute('aria-label') || '';
        const numMatch = aria.match(/(\d+)/);
        if (aria.toLowerCase().includes('like') || aria.toLowerCase().includes('点赞')) {
          if (numMatch) data.likes = numMatch[1];
        } else if (aria.toLowerCase().includes('retweet') || aria.toLowerCase().includes('转推')) {
          if (numMatch) data.retweets = numMatch[1];
        } else if (aria.toLowerCase().includes('reply') || aria.toLowerCase().includes('回复')) {
          if (numMatch) data.replies = numMatch[1];
        }
      }

      // --- 媒体 ---
      const imgs = article.querySelectorAll('img[src*="pbs.twimg.com"]');
      for (const img of imgs) {
        const src = img.getAttribute('src');
        if (src && !src.includes('profile_images') && !src.includes('emoji')) {
          data.mediaUrls.push(src);
        }
      }

      // --- 转推 ---
      const retweetIndicator = article.querySelector('[data-testid="socialContext"]');
      if (retweetIndicator) {
        data.isRetweet = true;
        data.retweetedBy = retweetIndicator.textContent.trim();
      }

      // --- 引用推文 ---
      const quotedArticles = article.querySelectorAll('article');
      if (quotedArticles.length > 1) {
        const quoted = quotedArticles[1];
        const qLinks = quoted.querySelectorAll('a[href*="/status/"]');
        for (const link of qLinks) {
          const match = link.href.match(/\/([^\/]+)\/status\/(\d+)/);
          if (match && match[2] !== data.id) {
            data.quotedTweet = { id: match[2], url: link.href, authorHandle: match[1] };
            break;
          }
        }
      }

      return data;

    } catch (e) {
      console.warn(`${LOG_PREFIX} 提取单条推文时出错:`, e);
      return null;
    }
  }

  async function exportLikes() {
    log('开始导出点赞推文...');
    log('请确保当前页面是 https://x.com/i/likes');

    const collected = new Map();
    let lastCount = 0;
    let noNewCount = 0;
    let scrollAttempts = 0;
    const MAX_TOTAL_SCROLLS = 800;

    log('开始自动滚动加载所有点赞，这可能需要较长时间...');
    log('请勿关闭此页面或切换标签页');

    while (noNewCount < MAX_SCROLL_RETRIES && scrollAttempts < MAX_TOTAL_SCROLLS) {
      const articles = document.querySelectorAll('article');
      let newThisRound = 0;

      for (const article of articles) {
        const tweet = extractTweetData(article);
        if (tweet && tweet.id && !collected.has(tweet.id)) {
          collected.set(tweet.id, tweet);
          newThisRound++;
        }
      }

      const currentTotal = collected.size;
      log(`已收集 ${currentTotal} 条推文 (本轮新增 ${newThisRound})`);

      if (currentTotal === lastCount) {
        noNewCount++;
        log(`没有新内容 (${noNewCount}/${MAX_SCROLL_RETRIES})`);
      } else {
        noNewCount = 0;
        lastCount = currentTotal;
      }

      window.scrollTo(0, document.body.scrollHeight);
      scrollAttempts++;

      await sleep(SCROLL_PAUSE_MS);

      if (noNewCount >= 2) {
        log('检测到加载变慢，增加等待时间...');
        await sleep(2000);
      }
    }

    log(`滚动完成，共尝试 ${scrollAttempts} 次`);
    log(`共收集到 ${collected.size} 条唯一推文`);

    if (collected.size === 0) {
      log('⚠️ 没有收集到任何推文，可能的原因：');
      log('  1. 页面还没加载完，请等几秒再试');
      log('  2. 你需要先登录 Twitter/X');
      log('  3. Twitter 的 DOM 结构可能已变化');
      log('  4. 确认当前页面是 likes 页面');
      return;
    }

    const tweets = Array.from(collected.values());
    tweets.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp) : new Date(0);
      const tb = b.timestamp ? new Date(b.timestamp) : new Date(0);
      return tb - ta;
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      totalCount: tweets.length,
      tweets: tweets,
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `twitter-likes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log(`✅ 导出完成！文件已下载: ${a.download}`);
    log(`共 ${tweets.length} 条推文`);

    console.log(`${LOG_PREFIX} ========== 数据预览 ==========`);
    console.log(JSON.stringify(tweets.slice(0, 3), null, 2));
    console.log(`${LOG_PREFIX} (仅显示前3条，完整数据已下载到文件)`);

    return tweets;
  }

  const isLikes = window.location.href.includes('/likes') ||
                  window.location.href.includes('/i/likes');
  if (!isLikes) {
    console.warn(`${LOG_PREFIX} ⚠️ 当前页面不是点赞页，请先打开 https://x.com/i/likes`);
    console.warn(`${LOG_PREFIX} 脚本已加载，请导航到点赞页后重新运行`);
  }

  exportLikes().catch(err => {
    console.error(`${LOG_PREFIX} 导出失败:`, err);
  });

})();
