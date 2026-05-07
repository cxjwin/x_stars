# Analysis Playbook

How to turn a raw `exports/twitter-*.json` file into a decision document. This playbook is the missing second half of x-stars: the CLI gives you data, this doc tells you what to do with it.

The recipe here is the one used to produce the report at `exports/analysis-2026-05-06.md`. It is opinionated and copy-pasteable — `jq` for shape, an LLM for synthesis, your own judgement for the final ranking.

## How to actually use this playbook

Three modes, by how much you've internalized the recipe:

**1. First run — walk through manually (~20 min).** Goal isn't the report; it's recognizing your own data shape. Run the `jq` commands by hand, see the field-type gotchas (`likes` is a string), eyeball your monthly histogram, notice what 🔴 looks like in your account. You only do this once.

**2. Steady state — let an agent drive Steps 1–7, you do Step 6 triage.** Open Claude Code or Codex and prompt it:

> Read `docs/analysis-playbook.md`. Run Steps 1–7 against the latest pair of exports under `exports/`. Show me the intermediate outputs, then produce `exports/analysis-YYYY-MM-DD.md` using the Step 8 skeleton. Leave the 🟢/🟡/🔴 triage in Step 6 empty — I will fill it in.

The agent runs jq, expands t.co, drafts the prose. It stops at Step 6 because that triage is the only step a model cannot do reliably (it over-promotes anything with a GitHub link). You spend ~2 min labeling 20 bookmarks, the agent finishes the report. This is the intended steady-state loop.

**3. Promote to a command.** If you run mode 2 weekly, save the prompt as `.claude/commands/analyze.md` so `/analyze` triggers it. Not required; only worth it once the manual prompt feels repetitive.

### The output is not the point

The report is a side effect. The two real outputs of every run are:

1. **First-hand URLs from 🟢 land in your notes system** (Obsidian, Notion, plain `links.md` — anywhere outside X). This is the action that converts a like into an asset.
2. **The next time you scroll X, you adjust what you ❤️.** Author rotation and the 🔴 bucket are calibration data for your own future taps.

If three consecutive runs don't move either of these, the playbook has degenerated into a data-viz toy and you should stop running it.

### Non-obvious uses

- **Month-over-month diff of 🟢** — the directions you went deeper on / the ones you dropped. More informative than raw like counts.
- **Don't delete the 🔴 list.** Keep it as a recognition sample so next time a similar post hits your feed, your hand pauses.
- **The "完全消失" check in Step 4 is itself the use.** It forces you to reconcile your follow-list edits against perceived feed changes, which is a thing the X UI never makes you do.

## When to run this

After every full export (`npm run export -- --kind all --max-pages 10`), or weekly on the 7-day browser-path slice.

Two things you are looking for:

1. **Behavior signals you can't see in the X feed**: turning points, author rotation, drift in your own taste.
2. **A short list of links worth a deep read**, separated from the long tail of "looks useful, never opened again."

## Input schema

Each export file has this shape (see `fixtures/sample-export.json`):

```json
{
  "source": "api" | "browser",
  "kind": "bookmarks" | "likes",
  "exportedAt": "ISO-8601",
  "totalCount": 98,
  "range": { "newestTweetAt": "...", "oldestTweetAt": "..." },
  "tweets": [
    {
      "id": "...",
      "url": "https://x.com/<handle>/status/<id>",
      "authorName": "...",
      "authorHandle": "...",
      "content": "...",
      "timestamp": "ISO-8601",
      "likes": "1234",
      "retweets": "12",
      "replies": "3",
      "mediaUrls": [],
      "quotedTweet": null,
      "isRetweet": false
    }
  ]
}
```

Note: `likes` / `retweets` / `replies` are **strings**, not numbers. Convert with `tonumber` in jq or `Number()` in JS.

## Step 1 — Scale and overlap

First question: how much data do you have, and is `bookmarks` actually distinct from `likes`?

```bash
B=exports/twitter-bookmarks-YYYY-MM-DD.json
L=exports/twitter-likes-YYYY-MM-DD.json

jq '{kind, totalCount, oldest: .range.oldestTweetAt, newest: .range.newestTweetAt}' "$B"
jq '{kind, totalCount, oldest: .range.oldestTweetAt, newest: .range.newestTweetAt}' "$L"

# Overlap: how many bookmarks are also liked?
jq -r '.tweets[].id' "$B" | sort > /tmp/b.ids
jq -r '.tweets[].id' "$L" | sort > /tmp/l.ids
echo "bookmarks ∩ likes: $(comm -12 /tmp/b.ids /tmp/l.ids | wc -l)"
```

**Interpretation rule of thumb:** if `bookmarks ∩ likes / |bookmarks| > 0.9`, your bookmark behavior is "second-tap on things I already liked" — bookmarks is a precision subset, not a separate channel. Do most analysis on `likes`; treat `bookmarks` as a curated highlights view.

## Step 2 — Time series and turning points

A monthly histogram exposes behavior shifts you can't feel in the feed.

```bash
jq -r '.tweets[].timestamp[0:7]' "$L" | sort | uniq -c
```

Look for:

- **Order-of-magnitude jumps** between adjacent months (e.g. 5 → 652). That is when your usage pattern actually changed; everything before it is a different person's data.
- **A floor at 2023-01-24**. That is X's 3-year hard wall on bookmarks/likes endpoints. Anything older is unreachable; do not try to fix it.
- **A trailing partial month**. The newest month is incomplete by definition — note it, don't compare its raw count to a complete month.

**Decision:** pick an analysis window starting at the most recent turning point. Everything after this section operates on that window.

## Step 3 — Content profile

What are you actually saving? Two cheap measures:

```bash
# Media share
jq '[.tweets[] | select((.mediaUrls|length)>0 or (.quotedTweet!=null))] | length as $n
    | { withMedia: ([.tweets[] | select((.mediaUrls|length)>0)] | length),
        withQuote: ([.tweets[] | select(.quotedTweet!=null)] | length),
        total: (.tweets|length) }' "$L"

# Keyword frequency (lowercase, alpha-numeric tokens, length≥3)
jq -r '.tweets[].content' "$L" \
  | tr '[:upper:]' '[:lower:]' \
  | grep -oE '[a-z0-9]{3,}' \
  | sort | uniq -c | sort -nr | head -40
```

For a Chinese-heavy feed, supplement with Chinese token regex (`grep -oE '[一-龥]{2,}'`) since the alpha regex misses CJK.

**What you're looking for:** topical concentration. If your top-20 keywords cluster into 2–3 themes (e.g. AI models, agent tooling, coding), your taste is focused — useful confirmation before Step 5.

## Step 4 — Author rotation

The single most underused signal. The X feed shows you who is posting *now*; it never shows you who used to dominate and went quiet.

```bash
# Top authors by month
jq -r '.tweets[] | "\(.timestamp[0:7])\t@\(.authorHandle)"' "$L" \
  | sort | uniq -c | sort -k2,2 -k1,1nr \
  | awk '{print $2"\t"$3"\t"$1}'
```

Then diff month-over-month. The interesting buckets:

- **新冒头** (was 0 or 1 last month, ≥5 this month) → who just earned your attention
- **下降期** (was top-10 last month, dropped to ≤3) → who fell out of favor or slowed posting
- **完全消失** (was active, now 0) → either you unfollowed, or they went silent

> **Critical disambiguation:** "完全消失" looks like algorithmic suppression but is often you actively unfollowing. **Ask the user / check follow list before claiming algorithm bias.** This single check decides whether the data needs cleaning or can be used as-is.

## Step 5 — Strip viral noise

If 1% of posts have 1000× the engagement of the median, they will skew any keyword/topic analysis. Check the like-count distribution:

```bash
jq -r '.tweets[].likes | tonumber' "$L" \
  | awk '{
      if ($1<100) b1++; else if ($1<1000) b2++;
      else if ($1<10000) b3++; else if ($1<100000) b4++; else b5++;
    } END {
      print "0–99:    " b1+0
      print "100–999: " b2+0
      print "1k–10k:  " b3+0
      print "10k–100k:" b4+0
      print "≥100k:   " b5+0
    }'
```

**Rule:** if the `≥10k` bucket is >5% of total, recompute Step 3 with those tweets excluded. If it stays ≤5% and the keyword ranking is stable when you drop them, you can report this as "your taste is not algorithm-polluted" — a meaningful and counterintuitive finding.

## Step 6 — Deep-research ranking for bookmarks

Bookmarks are too few to brute-force read but too many to leave unsorted. Score each on three axes:

| Axis | Signal | Weight |
|---|---|---|
| **Length** | `content.length` | scales linearly, capped at ~500 |
| **First-hand link** | regex hit on `github\.com`, `docs\.`, `developers?\.`, `arxiv\.org`, `tutorial`, `course` | +50 each, max +150 |
| **Engagement** | `log10(likes+1)` | secondary tiebreaker only |

```bash
jq -r '.tweets[] |
  [
    (.content | length),
    ([.content | scan("github\\.com|docs\\.|developers?\\.|arxiv\\.org|tutorial|course")] | length),
    (.likes | tonumber),
    .url, .authorHandle, (.content | gsub("\n";" ") | .[0:80])
  ] | @tsv' "$B" \
  | awk -F'\t' '{score = $1 + 50*$2 + 5*log($3+1); print score"\t"$0}' \
  | sort -k1,1nr | head -20
```

Then **manually triage** the top 20 into three buckets — this is the step that AI cannot reliably do for you:

- 🟢 **Worth a deep read** (course material, framework explainer, one-off reference doc)
- 🟡 **Tool/resource** (link-collection posts; bookmark the link, skip the read)
- 🔴 **Make-money narrative** (geographically-locked tricks, side-hustle blueprints — feel productive, are not)

The 🔴 bucket is the one that fools you. It is consistently long-form, often has GitHub links, and feels actionable in the moment. Read your own list and you'll recognize it.

## Step 7 — Expand t.co

Top-tier bookmarks point to first-hand sources via X's `t.co` shortener. Resolve them so future-you can paste them into Obsidian / a notebook without re-opening X:

```bash
# Extract t.co from the tweets you flagged 🟢
jq -r '.tweets[] | select(.id == "TWEET_ID") | .content' "$B" \
  | grep -oE 'https://t\.co/[A-Za-z0-9]+' \
  | while read url; do
      curl -sIL "$url" | awk -F': ' 'tolower($1)=="location"{print $2}' | tr -d '\r' | tail -1
    done
```

`curl -sIL` follows redirects; the last `Location:` header is the real URL. Stick the resolved URLs in your final report under a "一手资源原始 URL" section.

## Step 8 — Hand it to an LLM

Once you have the per-step outputs above, an LLM can stitch the report. Prompt template:

```text
你拿到的是 x-stars 导出的两个 JSON:bookmarks 和 likes。已知:
- 总数 / 时间跨度 / 重叠率(Step 1)
- 月度直方图 + 行为转折点(Step 2)
- 媒体形态 + 关键词 Top 20(Step 3)
- 作者月度轮换三个分组(Step 4)
- like 分布 + 是否破圈污染(Step 5)
- bookmarks 打分 Top 20 + 我的人工三档分类(Step 6)
- 🟢 那一档展开后的一手 URL(Step 7)

请按这个骨架生成 Markdown 报告:
一、数据规模(含重叠率与解读)
二、行为转折点(给出窗口决定)
三、内容画像(关键词 + 媒体)
四、作者活跃度变化(三个分组,标注是否用户主动取关)
五、破圈帖占比(给出"是否被算法污染"的判断)
六、Bookmarks 深度研究 Top 10(三档分类 + 一手 URL)
七、可继续挖的方向
八、元数据(导出时间、文件名、是否分页耗尽)

要求:
- 数字必须来自我给的输入,不要编造
- 关键发现要有"反直觉度"标注
- 🔴 一档明确说明 ROI 低的原因
```

## Output template

The final artifact lives in `exports/analysis-YYYY-MM-DD.md` (gitignored). Recommended top-of-file frontmatter:

```markdown
- 生成时间:YYYY-MM-DD
- 数据来源:exports/twitter-bookmarks-YYYY-MM-DD.json + exports/twitter-likes-YYYY-MM-DD.json
- 用户:@handle
- 分析窗口:YYYY-MM-DD → YYYY-MM-DD(理由:Step 2 转折点)
```

Keep older reports — diffing this month's 🟢 bucket against last month's is itself a useful signal.

## Common pitfalls

- **Treating in-page console counts as data.** If a browser-path scrape was interrupted before JSON download, the number you saw in DevTools is not what's on disk. Always re-derive counts from the saved file.
- **Comparing `bookmarks` directly to `likes` totals.** With ~97% overlap, comparing them as independent channels overcounts. Treat bookmarks as a subset.
- **Forgetting `likes` is the string `"1234"`, not a number.** `jq` will fail silently on `select(.likes > 1000)`; use `(.likes | tonumber) > 1000`.
- **Reading the newest partial month as a trend.** Always note the export date and exclude the trailing partial month from month-over-month comparisons.
- **Letting the LLM rank 🟢/🟡/🔴.** It will over-promote anything with a GitHub link. The triage is the human step; the LLM only assists with scoring inputs and final prose.
- **Trying to go past 2023-01-24.** That is X's hard wall, not a bug. Don't burn pages chasing older data.

## Reference report

The first analysis run that produced this playbook: `exports/analysis-2026-05-06.md` (gitignored, on the maintainer's machine). It is the worked example for every section here.
