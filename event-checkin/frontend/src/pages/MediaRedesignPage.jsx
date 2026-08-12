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
