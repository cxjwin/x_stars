// ============================================================
// Twitter/X Bookmarks Exporter – 浏览器控制台脚本
// 使用方法：
//   1. 打开 https://x.com/i/bookmarks （或 https://twitter.com/i/bookmarks）
//   2. 等待页面加载，登录状态确认
//   3. 按 F12 打开开发者工具 → Console 标签页
//   4. 粘贴整个脚本，回车运行
//   5. 脚本会自动滚动并收集数据，完成后自动下载 JSON 文件
// ============================================================

(function () {
  'use strict';

  // ---------- 配置 ----------
  const SCROLL_PAUSE_MS = 2000;   // 每次滚动后等待时间（ms），Twitter 需要时间加载
  const MAX_SCROLL_RETRIES = 5;   // 连续多少次没有新内容就停止
  const LOG_PREFIX = '[BM-Export]';

  // ---------- 工具函数 ----------
  function log(msg) {
    console.log(`${LOG_PREFIX} ${msg}`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Twitter 的 DOM 结构经常变化，这里用多种选择器以提高兼容性
  function selectAll(selectors) {
    const results = [];
    for (const sel of selectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length) {
          results.push(...Array.from(nodes));
        }
      } catch (_) { /* ignore */ }
    }
    return results;
  }

  // ---------- 推文数据提取 ----------
  // 核心思路：Twitter 每条推文是一个 <article> 标签
  // 我们需要从 article 内部提取各种信息

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

      // --- 1. 推文链接 & ID ---
      // 推文链接格式: /username/status/1234567890
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

      if (!data.id) return null; // 不是推文卡片

      // --- 2. 作者名称 ---
      // 通常 article 内第一个可见的强/b 标签是名字
      const nameSelectors = [
        'div[data-testid="User-Name"] a div span span',
        'div[data-testid="User-Name"] span span',
        '[data-testid="User-Name"] strong',
        '[data-testid="User-Name"] span[dir="auto"]',
      ];
      for (const sel of nameSelectors) {
        const el = article.querySelector(sel);
        if (el && el.textContent.trim()) {
          const text = el.textContent.trim();
          // 跳过 @handle 格式
          if (!text.startsWith('@') && text.length < 50) {
            data.authorName = text;
            break;
          }
        }
      }

      // 如果上面没拿到，尝试另一种方式
      if (!data.authorName) {
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
      }

      // --- 3. 作者 handle（@xxx） ---
      const handleEl = article.querySelector('div[data-testid="User-Name"] a[role="link"]');
      if (handleEl) {
        const txt = handleEl.textContent.trim();
        if (txt.startsWith('@')) data.authorHandle = txt.replace('@', '');
        // 如果 URL 里没拿到 handle，从这里补
        if (!data.authorHandle || data.authorHandle === '') {
          const match = handleEl.href.match(/\/([^\/]+)\/status/);
          if (match) data.authorHandle = match[1];
        }
      }

      // --- 4. 推文正文 ---
      // Twitter 使用 data-testid="tweetText" 标记正文
      const textEl = article.querySelector('[data-testid="tweetText"]');
      if (textEl) {
        data.content = textEl.innerText.trim();
      } else {
        // 备选：找 dir="auto" 的 div
        const autoDivs = article.querySelectorAll('div[dir="auto"]');
        for (const div of autoDivs) {
          if (div.textContent.length > 20 && div.textContent.length < 2000) {
            // 排除明显不是正文的元素
            if (!div.closest('[data-testid="User-Name"]') && !div.querySelector('a[href*="/status/"]')) {
              data.content = div.innerText.trim();
              break;
            }
          }
        }
      }

      // --- 5. 时间 ---
      const timeEl = article.querySelector('time');
      if (timeEl) {
        data.timestamp = timeEl.getAttribute('datetime');
        data.date = timeEl.getAttribute('datetime');
      }

      // --- 6. 互动数据（点赞、转推、回复） ---
      const actionBar = article.querySelector('[role="group"][aria-label]');
      if (actionBar) {
        // 尝试从 aria-label 提取
        const label = actionBar.getAttribute('aria-label') || '';
        const likeMatch = label.match(/(\d+)\s*(like|点赞)/i);
        const rtMatch = label.match(/(\d+)\s*(retweet|转推)/i);
        const replyMatch = label.match(/(\d+)\s*(reply|回复)/i);
        if (likeMatch) data.likes = likeMatch[1];
        if (rtMatch) data.retweets = rtMatch[1];
        if (replyMatch) data.replies = replyMatch[1];
      }

      // 备选：单独的 action 按钮
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

      // --- 7. 媒体（图片/视频） ---
      const imgs = article.querySelectorAll('img[src*="pbs.twimg.com"]');
      for (const img of imgs) {
        const src = img.getAttribute('src');
        if (src && !src.includes('profile_images') && !src.includes('emoji')) {
          data.mediaUrls.push(src);
        }
      }

      // --- 8. 判断是否转推 ---
      const retweetIndicator = article.querySelector('[data-testid="socialContext"]');
      if (retweetIndicator) {
        data.isRetweet = true;
        data.retweetedBy = retweetIndicator.textContent.trim();
      }

      // --- 9. 引用的推文（quote tweet）---
      const quotedArticles = article.querySelectorAll('article');
      if (quotedArticles.length > 1) {
        // 第二个 article 通常是被引用的推文
        const quoted = quotedArticles[1];
        const qLinks = quoted.querySelectorAll('a[href*="/status/"]');
        for (const link of qLinks) {
          const match = link.href.match(/\/([^\/]+)\/status\/(\d+)/);
          if (match && match[2] !== data.id) {
            data.quotedTweet = {
              id: match[2],
              url: link.href,
              authorHandle: match[1],
            };
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

  // ---------- 主逻辑 ----------

  async function exportBookmarks() {
    log('开始导出书签...');
    log('请确保当前页面是 https://x.com/i/bookmarks');

    const collected = new Map(); // id -> tweet data
    let lastCount = 0;
    let noNewCount = 0;
    let scrollAttempts = 0;
    const MAX_TOTAL_SCROLLS = 500; // 安全上限

    // 提示用户
    log('开始自动滚动加载所有书签，这可能需要几分钟...');
    log('请勿关闭此页面或切换标签页');

    while (noNewCount < MAX_SCROLL_RETRIES && scrollAttempts < MAX_TOTAL_SCROLLS) {
      // 提取当前所有 article
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

      // 滚动到底部
      window.scrollTo(0, document.body.scrollHeight);
      scrollAttempts++;

      // 等待加载
      await sleep(SCROLL_PAUSE_MS);

      // 渐进式增加等待时间（Twitter 有时需要更长时间加载）
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
      log('  3. Twitter 的 DOM 结构可能已变化，需要更新脚本');
      log('  4. 确认当前页面是 bookmarks 页面');
      return;
    }

    // ---------- 导出 ----------
    const tweets = Array.from(collected.values());

    // 按时间倒序排列
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
    a.download = `twitter-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log(`✅ 导出完成！文件已下载: ${a.download}`);
    log(`共 ${tweets.length} 条推文`);

    // 控制台也输出一份方便复制
    console.log(`${LOG_PREFIX} ========== 数据预览 ==========`);
    console.log(JSON.stringify(tweets.slice(0, 3), null, 2));
    console.log(`${LOG_PREFIX} (仅显示前3条，完整数据已下载到文件)`);

    return tweets;
  }

  // 检查是否在 bookmarks 页面
  const isBookmarks = window.location.href.includes('/bookmarks') ||
                      window.location.href.includes('/i/bookmarks');
  if (!isBookmarks) {
    console.warn(`${LOG_PREFIX} ⚠️ 当前页面不是书签页，请先打开 https://x.com/i/bookmarks`);
    console.warn(`${LOG_PREFIX} 脚本已加载，请导航到书签页后重新运行`);
  }

  // 自动开始
  exportBookmarks().catch(err => {
    console.error(`${LOG_PREFIX} 导出失败:`, err);
  });

})();
