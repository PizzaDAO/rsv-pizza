type Token =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; url: string };

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const VALID_SCHEME = /^(https?:|mailto:)/i;

export function isValidLinkUrl(url: string): boolean {
  return VALID_SCHEME.test(url.trim());
}

export function tokenizeMarkdownLinks(body: string): Token[] {
  const tokens: Token[] = [];
  if (!body) return tokens;

  let lastIndex = 0;
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LINK_RE.exec(body)) !== null) {
    const [full, label, url] = match;
    const start = match.index;

    if (start > lastIndex) {
      tokens.push({ kind: 'text', text: body.slice(lastIndex, start) });
    }

    if (isValidLinkUrl(url)) {
      tokens.push({ kind: 'link', label, url: url.trim() });
    } else {
      tokens.push({ kind: 'text', text: full });
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < body.length) {
    tokens.push({ kind: 'text', text: body.slice(lastIndex) });
  }

  return tokens;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render an announcement body to HTML.
 *
 * - Text segments: HTML-escape, then convert newlines to `<br />`.
 * - Link segments (`[label](url)`): valid `http(s):`/`mailto:` schemes
 *   become anchors; anything else is rendered as the literal source.
 */
export function renderAnnouncementBodyHtml(body: string): string {
  const tokens = tokenizeMarkdownLinks(body);
  return tokens
    .map((t) => {
      if (t.kind === 'text') {
        return escapeHtmlText(t.text).replace(/\n/g, '<br />');
      }
      return `<a href="${escapeHtmlAttr(t.url)}" style="color: #ff393a; text-decoration: underline;" target="_blank" rel="noopener noreferrer">${escapeHtmlText(t.label)}</a>`;
    })
    .join('');
}
