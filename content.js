/**
 * Site-aware main content extractor.
 * Tries specific selectors per domain before falling back to generic heuristics.
 */
function extractContent() {
  const url = window.location.href;
  let text = '';
  let title = document.title.trim();

  // --- GitHub ---
  if (url.includes('github.com')) {
    // Repository root: README
    if (/github\.com\/[^/]+\/[^/]+\/?$/.test(url) || /github\.com\/[^/]+\/[^/]+\/tree\//.test(url)) {
      const el = document.querySelector('#readme .markdown-body, article.markdown-body');
      text = el?.innerText ?? '';
    }
    // Blob / file view
    else if (url.includes('/blob/')) {
      const el = document.querySelector('.markdown-body, .blob-wrapper');
      text = el?.innerText ?? '';
    }
    // Issue / Pull Request
    else if (url.includes('/issues/') || url.includes('/pull/')) {
      const titleEl = document.querySelector('.js-issue-title, h1 bdi');
      if (titleEl) title = titleEl.innerText.trim();
      const bodies = document.querySelectorAll('.comment-body, .js-comment-body, .markdown-body');
      text = Array.from(bodies)
        .map((el) => el.innerText.trim())
        .join('\n\n');
    }
    // Discussions
    else if (url.includes('/discussions/')) {
      const el = document.querySelector('.comment-body');
      text = el?.innerText ?? '';
    }
  }

  // --- arXiv ---
  else if (url.includes('arxiv.org')) {
    const titleEl =
      document.querySelector('h1.title') ??
      document.querySelector('#abs h1') ??
      document.querySelector('.title');
    if (titleEl) title = titleEl.innerText.replace(/^Title:\s*/i, '').trim();

    const abstract =
      document.querySelector('blockquote.abstract') ??
      document.querySelector('#abs .abstract') ??
      document.querySelector('.abstract');
    const abstractText = abstract?.innerText.replace(/^Abstract:\s*/i, '').trim() ?? '';

    // HTML full-paper view
    const fullContent = document.querySelector('#content, article.ltx_document');
    if (fullContent && fullContent.innerText.length > abstractText.length + 500) {
      text = fullContent.innerText;
    } else {
      text = abstractText;
    }
  }

  // --- Hacker News ---
  else if (url.includes('news.ycombinator.com')) {
    const titleEl = document.querySelector('.storylink, .titleline a');
    if (titleEl) title = titleEl.innerText.trim();
    const comments = document.querySelectorAll('.commtext');
    text = Array.from(comments)
      .slice(0, 20)
      .map((el) => el.innerText.trim())
      .join('\n\n');
  }

  // --- Generic article / blog ---
  if (!text || text.length < 200) {
    const candidates = [
      'article',
      '[role="main"] article',
      '.post-content',
      '.article-body',
      '.article-content',
      '.entry-content',
      '.prose',
      '.content-body',
      '.post-body',
      'main article',
      'main',
      '[role="main"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 300) {
        text = el.innerText;
        break;
      }
    }
  }

  // --- Last resort: body ---
  if (!text || text.length < 200) {
    text = document.body.innerText;
  }

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  // Cap at 3,000 chars using head + tail to preserve both intro and conclusion
  const MAX_CHARS = 3000;
  if (text.length > MAX_CHARS) {
    const head = text.slice(0, 2500);
    const tail = text.slice(-500);
    text = head + '\n...\n' + tail;
  }

  return { title, text, url };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_CONTENT') {
    try {
      sendResponse({ ok: true, data: extractContent() });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  }
  return true;
});
