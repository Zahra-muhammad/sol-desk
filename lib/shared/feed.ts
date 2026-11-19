/** Substack's own categories (ids from substack.com/api/v1/categories) offered as topic chips in feed.app. */
export const TOPICS: readonly { id: number; name: string }[] = [
  { id: 96, name: 'Culture' },
  { id: 4, name: 'Tech' },
  { id: 62, name: 'Business' },
  { id: 134, name: 'Science' },
  { id: 18, name: 'History' },
  { id: 114, name: 'Philosophy' },
  { id: 339, name: 'Books' },
  { id: 284, name: 'Fiction' },
  { id: 13645, name: 'Food' },
  { id: 61, name: 'Design' },
  { id: 15417, name: 'Art' },
  { id: 11, name: 'Music' },
  { id: 76782, name: 'Film & TV' },
  { id: 109, name: 'Travel' },
  { id: 355, name: 'Health' },
  { id: 153, name: 'Finance' },
  { id: 15414, name: 'Climate' },
  { id: 76739, name: 'Politics' },
  { id: 76740, name: 'World' },
  { id: 49692, name: 'Humor' },
  { id: 49715, name: 'Fashion' },
  { id: 94, name: 'Sports' },
  { id: 1796, name: 'Parenting' },
  { id: 34, name: 'Education' },
  { id: 223, name: 'Faith' },
  { id: 76747, name: 'Photography' },
];

export const isTopic = (id: number) => TOPICS.some((t) => t.id === id);

/**
 * A small square thumbnail for a Substack image. Substack's raw uploads can be multi-megabyte PNGs or
 * iPhone .heic files browsers can't show, so they go through Substack's own resizing CDN instead.
 */
export function thumbUrl(url: string, px: number): string {
  if (!/^https:\/\/substack-post-media\.s3\.amazonaws\.com\//.test(url)) return url;
  return `https://substackcdn.com/image/fetch/w_${px},h_${px},c_fill,f_auto,q_auto:good,fl_progressive:steep/${encodeURIComponent(url)}`;
}

/** A file name for a downloaded article. */
export function articleFileName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return (slug || 'article') + '.html';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * A self-contained page for a downloaded article: readable offline in any browser, light or dark.
 * `html` must already be cleaned on the server (sanitize-html); everything else is escaped here.
 */
export function articleDocument(a: { title: string; subtitle: string; author: string; sourceTitle: string; date: string; link: string; html: string }): string {
  const day = a.date ? new Date(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const meta = [a.sourceTitle, a.author, day].filter(Boolean).map(esc).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf7;--ink:#1d1b18;--mut:#6b665e;--line:#e4e0d8;--link:#2f5fd0}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--ink:#ecebe8;--mut:#9a968f;--line:#2c2c2c;--link:#8fb0ff}}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.7 Georgia,'Times New Roman',serif}
main{max-width:680px;margin:0 auto;padding:48px 20px 80px}
.meta{font:13px/1.4 system-ui,sans-serif;color:var(--mut);margin:0 0 10px}
h1{font:700 34px/1.15 system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 10px}
.sub{font-size:20px;color:var(--mut);margin:0 0 14px}
.src{font:13px system-ui,sans-serif;margin:0 0 28px;padding-bottom:20px;border-bottom:1px solid var(--line)}
a{color:var(--link)}
img,picture,video{max-width:100%;height:auto;border-radius:6px}
figure{margin:24px 0}figcaption{font-size:14px;color:var(--mut)}
blockquote{margin:16px 0;padding-left:16px;border-left:3px solid var(--line);color:var(--mut)}
pre{overflow:auto;padding:12px;border-radius:6px;background:color-mix(in srgb,var(--ink) 6%,transparent);font-size:14px}
table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid var(--line);padding:4px 8px}
hr{border:0;border-top:1px solid var(--line);margin:28px 0}
</style>
</head>
<body>
<main>
<article>
<p class="meta">${meta}</p>
<h1>${esc(a.title)}</h1>
${a.subtitle ? `<p class="sub">${esc(a.subtitle)}</p>` : ''}
<p class="src"><a href="${esc(a.link)}">Read it on Substack</a></p>
${a.html}
</article>
</main>
</body>
</html>
`;
}
