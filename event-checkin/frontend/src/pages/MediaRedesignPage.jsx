import RedesignShell from './redesign/RedesignShell'
import {
  INTERNAL_DOCS, PDFS, HTML_ASSETS, SCREENSHOTS,
  AssetCard, ScreenshotCard, InternalDocCard, MediaReviewComments,
} from './MediaPage'

// Real redesign home for the operator Media Library — previously this tab
// intentionally punted to legacy /media-library because no redesign version
// existed. Reuses MediaPage's actual data/components (not a mock rebuild)
// so this stays in sync with the legacy page automatically; only the outer
// chrome changes to RedesignShell.
export default function MediaRedesignPage() {
  return (
    <RedesignShell topActive="media" withEventSidebar={false}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Media Library</h1><span className="rr-pill locked">Platform staff only</span></div>
          <div className="rr-meta">Operator-only links for viewing and downloading Festio PDFs, HTML tours, and product screenshots</div>
        </div>
      </div>
      <p className="rd-hint" style={{ margin: '-10px 0 4px' }}>
        Screenshots resynced 2026-08-12 with guideContent.mjs (Help guide) — 17 screenshots added covering
        onboarding paths, Design Studio, message templates, Venue Access, section scanning, Experience
        workflows, Ticket sales, Guest Hub/FestioMe, guest communication, Tasks, Planner, the public API,
        and Event Calendars.
      </p>

      <div className="rr-section-title"><div><h2>Knowledge base</h2></div></div>
      <div className="rr-panel" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--accent)' }}>Live in-app guide</div>
          <strong style={{ fontSize: 14 }}>Customer Help Guide</strong>
          <p className="rd-hint" style={{ marginTop: 4 }}>The live, browsable version of the guide content below — what customers actually see.</p>
        </div>
        <a href="/help-redesign" target="_blank" rel="noreferrer" className="rr-btn primary">Open Help Guide</a>
      </div>

      <div className="rr-section-title"><div><h2>Internal documentation</h2></div></div>
      <div className="rr-grid3">
        {INTERNAL_DOCS.map((asset) => <InternalDocCard key={asset.filename} asset={asset} />)}
      </div>

      <div className="rr-section-title"><div><h2>Competitor pricing review comments</h2></div></div>
      <MediaReviewComments />

      <div className="rr-section-title"><div><h2>PDF downloads</h2></div></div>
      <div className="rr-grid3">
        {PDFS.map((asset) => <AssetCard key={asset.href} asset={asset} />)}
      </div>

      <div className="rr-section-title"><div><h2>HTML media</h2></div></div>
      <div className="rr-grid2">
        {HTML_ASSETS.map((asset) => <AssetCard key={asset.href} asset={asset} />)}
      </div>

      <div className="rr-section-title"><div><h2>Product screenshots</h2></div></div>
      <div className="rr-grid3">
        {SCREENSHOTS.map((asset) => <ScreenshotCard key={asset.href} asset={asset} />)}
      </div>
    </RedesignShell>
  )
}
