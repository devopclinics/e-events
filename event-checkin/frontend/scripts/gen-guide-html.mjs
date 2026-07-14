// Build-time generator: emits a static, JS-free /guide.html from the SAME
// CONTENT the SPA uses, so search engines / curl / AI fetch tools can read the
// guide without executing JavaScript. Run after `vite build` (see package.json).
import { writeFileSync } from 'node:fs'
import { CONTENT } from '../src/guideContent.mjs'

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const ROLES = ['organizer', 'staff', 'guest']  // operator guide stays internal

function topicHtml(t) {
  const imgs = t.imgs || (t.img ? [t.img] : [])
  const steps = t.steps.map((s) => `<li>${esc(s)}</li>`).join('\n')
  const figs = imgs.map((src) =>
    `<img src="${esc(src)}" alt="${esc(t.title)}" loading="lazy" />`).join('\n')
  return `<section id="${esc(t.id)}">
  <h3>${esc(t.icon || '')} ${esc(t.title)}</h3>
  <ol>${steps}</ol>
  ${figs}
</section>`
}

function roleHtml(key) {
  const r = CONTENT[key]
  if (!r) return ''
  return `<section class="role">
  <h2>${esc(r.icon || '')} ${esc(r.label)}</h2>
  <p class="blurb">${esc(r.blurb || '')}</p>
  ${r.topics.map(topicHtml).join('\n')}
</section>`
}

const body = ROLES.map(roleHtml).join('\n')

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>Festio — Guide</title>
<meta name="description" content="Festio guide: create events, import guests, RSVP, entry areas, orders, deliveries, gift list, and check-in." />
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:0 auto;padding:24px;color:#0f172a;line-height:1.55}
  header{background:linear-gradient(135deg,#0d9488,#0e7490);color:#fff;padding:24px;border-radius:16px;margin-bottom:24px}
  header a{color:#fff;text-decoration:underline}
  h2{margin-top:32px;border-bottom:2px solid #ccfbf1;padding-bottom:6px}
  h3{margin-top:22px;color:#0f766e}
  .blurb{color:#475569}
  ol{padding-left:22px} li{margin:4px 0}
  img{max-width:100%;border:1px solid #e2e8f0;border-radius:10px;margin:10px 0;display:block}
  .note{color:#64748b;font-size:14px;margin-top:8px}
  video{max-width:100%;border-radius:12px;margin:12px 0}
</style>
</head>
<body>
<header>
  <h1>Festio — Help &amp; How-To</h1>
  <p>A plain, printable copy of the guide. For the interactive version, open
     <a href="/guide">/guide</a> · <a href="/register">Get started free</a></p>
</header>
${body}
<p class="note">Festio · this page is intentionally unlisted (noindex).</p>
</body>
</html>`

writeFileSync(new URL('../dist/guide.html', import.meta.url), html)
console.log('Wrote dist/guide.html (%d bytes)', html.length)
