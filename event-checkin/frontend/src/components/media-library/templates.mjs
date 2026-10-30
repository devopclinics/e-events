export const MEDIA_TEMPLATES = [
  {
    id: 'overview',
    title: 'The introduction',
    kind: 'One-page overview',
    tone: 'mint',
    description: 'A concise, visual introduction for a new client or partner.',
    pages: '1 page',
  },
  {
    id: 'presentation',
    title: 'The conversation',
    kind: 'Presentation',
    tone: 'lavender',
    description: 'A six-slide story, from the opportunity to the next step.',
    pages: '6 slides',
  },
  {
    id: 'brief',
    title: 'The event brief',
    kind: 'Planning brief',
    tone: 'sand',
    description:
      'Bring the occasion, guest journey and team priorities together.',
    pages: '1 page',
  },
]
export const DEFAULT_BRIEF = {
  client: '',
  title: 'An event worth coming together for.',
  subtitle:
    'A connected experience, from the first invitation to the last goodbye.',
  audience: 'Guests, organizers and the people behind the occasion.',
  goal: 'Make every guest feel expected. Give the team a clear, shared plan.',
  experience:
    'A thoughtful invitation, a simple response and a personal guest pass.',
  operations: 'One place for guest information, team preparation and arrival.',
  next: 'Let’s explore the occasion, the audience and the experience you want to create.',
  contact: 'events@festio.events',
  url: 'https://festio.events',
  palette: 'midnight',
}
export function escapeMediaText(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  )
}
export function mediaLink(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}
export function buildMediaDocument(templateId, input = {}) {
  const raw = { ...DEFAULT_BRIEF, ...input }
  const data = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, escapeMediaText(value)]),
  )
  const link = mediaLink(raw.url)
  const section = (label, title, body, cls = '') =>
    `<section class="sheet ${cls}"><header><b class="brand">F / FESTIO</b><span>${data.client || 'Your next occasion'}</span></header><div class="story"><p class="eyebrow">${label}</p><h1>${title}</h1><p class="lede">${body}</p></div><footer><span>${data.contact}</span><span>Made for ${data.client || 'your next occasion'}</span></footer></section>`
  const block = (n, title, text) =>
    `<article><span class="number">${n}</span><h2>${title}</h2><p>${text}</p></article>`
  let content
  if (templateId === 'presentation') {
    content =
      section('An invitation to connect', data.title, data.subtitle, 'cover') +
      section('01 / The opportunity', 'A clear purpose.', data.goal) +
      section(
        '02 / The people',
        'Start with your guests.',
        data.audience,
        'soft',
      ) +
      section(
        '03 / The experience',
        'Every step, considered.',
        data.experience,
      ) +
      section(
        '04 / The preparation',
        'A team with a shared view.',
        data.operations,
        'soft',
      ) +
      section(
        '05 / The next step',
        'Let’s make it happen.',
        `${data.next}${link ? `<br><a href="${escapeMediaText(link)}">Explore Festio ↗</a>` : ''}`,
        'cover',
      )
  } else {
    const brief = templateId === 'brief'
    content = `<section class="sheet document"><header><b class="brand">F / FESTIO</b><span>${brief ? 'EVENT BRIEF' : 'INTRODUCTION'} / ${data.client || 'Your next occasion'}</span></header><div class="story"><p class="eyebrow">${brief ? 'A shared starting point' : 'People. Purpose. Possibility.'}</p><h1>${data.title}</h1><p class="lede">${data.subtitle}</p><div class="blocks">${block('01', brief ? 'Purpose' : 'The opportunity', data.goal)}${block('02', 'The people', data.audience)}${block('03', 'The guest experience', data.experience)}${block('04', 'Behind the occasion', data.operations)}</div><aside><p class="eyebrow">The next step</p><h2>${data.next}</h2>${link ? `<a href="${escapeMediaText(link)}">Explore Festio ↗</a>` : ''}</aside></div><footer><span>${data.contact}</span><span>Made for ${data.client || 'your next occasion'}</span></footer></section>`
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${data.title} — ${data.client || 'Festio'}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#e9e7e2;color:#192b32;font:16px/1.65 Arial,sans-serif;--ink:#172733;--accent:#cfc3f5;--soft:#e6f4ed}body.emerald{--ink:#153f35;--accent:#e8ca81;--soft:#eef3df}body.terracotta{--ink:#422a29;--accent:#f0bda6;--soft:#f8e9df}.sheet{max-width:1120px;min-height:630px;background:#fffdf7;margin:24px auto;padding:38px 54px;display:flex;flex-direction:column;position:relative;overflow:hidden}.sheet:before{content:'';position:absolute;border:1px solid currentColor;opacity:.1;width:440px;height:440px;border-radius:50%;right:-180px;top:-210px;pointer-events:none}header,footer{display:flex;justify-content:space-between;gap:20px;font-size:11px;letter-spacing:.09em;position:relative}.brand{letter-spacing:.15em}.story{flex:1;padding:48px 0;position:relative}.eyebrow{font-size:11px;font-weight:bold;letter-spacing:.2em;text-transform:uppercase;color:inherit;opacity:.75}h1{font:normal clamp(32px,5vw,66px)/1.08 Georgia,serif;letter-spacing:-.035em;max-width:850px;margin:20px 0 26px;overflow-wrap:anywhere}.lede{max-width:720px;font-size:20px;white-space:pre-wrap}p{white-space:pre-wrap;overflow-wrap:anywhere}h2{font:normal 25px/1.3 Georgia,serif;margin:8px 0}a{display:inline-block;color:inherit;margin-top:18px;text-underline-offset:6px}.cover{background:var(--ink);color:#fffdf7}.cover .eyebrow,.cover a{color:var(--accent)}.soft{background:var(--soft)}footer{padding-top:18px;border-top:1px solid #8885;overflow-wrap:anywhere}.blocks{display:grid;grid-template-columns:1fr 1fr;gap:28px 40px;margin:40px 0}.blocks article{border-top:1px solid #b7b6ad;padding-top:16px}.blocks p{font-size:14px;margin:8px 0}.number{font-size:11px;letter-spacing:.12em;color:#5c6c69}aside{background:var(--soft);padding:22px 28px;border-radius:2px}aside h2{font-size:22px}.document{max-width:850px;min-height:1100px}.document .story{padding:25px 0}.document h1{font-size:50px}.document .lede{font-size:17px}@media(max-width:600px){.sheet{margin:0;padding:28px 24px;min-height:580px}.document h1{font-size:36px}.blocks{grid-template-columns:1fr}.lede{font-size:17px}header,footer{flex-wrap:wrap}.document{min-height:0}}@media print{@page{size:${templateId === 'presentation' ? 'landscape' : 'A4 portrait'};margin:0}body{background:white;print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet{margin:0;max-width:none;width:100%;min-height:100vh;break-after:page}.document{min-height:100vh}.sheet:last-child{break-after:auto}}
  </style></head><body class="${['midnight', 'emerald', 'terracotta'].includes(raw.palette) ? raw.palette : 'midnight'}">${content}</body></html>`
}
export function mediaPlainText(input) {
  return [
    'title',
    'subtitle',
    'client',
    'goal',
    'audience',
    'experience',
    'operations',
    'next',
    'contact',
    'url',
  ]
    .map((key) => String(input[key] || '').trim())
    .filter(Boolean)
    .join('\n\n')
}
