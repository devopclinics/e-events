// First-party HTML decks use query navigation; external links retain their URL.
const DECK_PAGES = { '/presentations/mumineen-zakat/': 14, '/presentations/mumineen-zakat/index.html': 14 }
export function presentationDeckSource(row, page, origin) {
  const original = row.metadata?.present_url || row.source_url
  try {
    const url = new URL(original, origin)
    const pages = url.origin === origin ? DECK_PAGES[url.pathname] : null
    if (!pages) return { url: original, total_pages: row.metadata?.page_count || null }
    url.searchParams.set('embed', '1')
    url.searchParams.set('page', String(Math.max(1, Math.min(pages, Number(page) || 1))))
    return { url: url.href, total_pages: pages }
  } catch { return { url: original, total_pages: row.metadata?.page_count || null } }
}
