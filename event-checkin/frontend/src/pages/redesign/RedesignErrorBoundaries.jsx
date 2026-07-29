import { Component } from 'react'
import './RedesignErrorBoundaries.css'

// ── redesign error-boundary hierarchy ───────────────────────────────────
// Part of the real production migration (see governing plan): pages get
// wired to real data module-by-module, and every module needs a blast
// radius smaller than "the whole page went white". Five boundaries, each
// wrapping a different slice of the tree:
//
//   RedesignAppBoundary    (outermost — whole app, last resort)
//     RedesignShellBoundary  (top bar + sidebar + content region)
//       RedesignRouteBoundary  (one route/module's content)
//         RedesignWidgetBoundary  (one widget/chart/panel within a page)
//       RedesignModalBoundary   (a modal/drawer's content — used wherever
//                                 a modal is open, not strictly nested
//                                 under Route/Widget)
//
// React only supports catching render/lifecycle errors from class
// components (getDerivedStateFromError / componentDidCatch — no hook
// equivalent exists), so these five are deliberately classes even though
// the rest of this codebase is hooks-only. That's expected here.
//
// Every fallback below renders at least one actionable button (retry,
// close, back, or reload) — never a dead end with no way forward.
//
// `onError` is an optional prop on every boundary, forwarded to
// componentDidCatch so a telemetry util (being built separately) can be
// wired in later without touching this file. Nothing here imports or
// assumes anything about that util.
//
// This file intentionally does not import anything from RedesignShell.jsx
// (or any *RedesignPage.jsx) — those are being edited concurrently, and
// RedesignAppBoundary in particular must not assume any other part of the
// app is safe to reuse in its fallback UI.

export class RedesignAppBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      // `admin-redesign` is added here defensively: if the app-level crash
      // happened before the real shell ever rendered its own
      // `div.admin-redesign` wrapper, this fallback would otherwise sit
      // outside the scope that defines the --ink/--surface/etc. tokens (and
      // outside `.dark .admin-redesign`, which is how dark mode overrides
      // apply). Re-declaring the class here keeps tokens + dark mode
      // working regardless of where in the tree this boundary sits.
      return (
        <div className="rr-eb-app admin-redesign">
          <div className="rr-eb-app-card">
            <div className="rr-eb-app-icon" aria-hidden="true">!</div>
            <h1>Something went wrong loading Festio</h1>
            <p>An unexpected error stopped the page from loading. Reloading usually fixes this.</p>
            <div className="rr-eb-actions">
              <button type="button" className="rr-eb-btn primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export class RedesignShellBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      // Conceptually this should keep the top bar + sidebar chrome alive
      // and only replace the content region, so a crash here doesn't also
      // take global navigation with it — that's the point of having this
      // boundary sit between RedesignAppBoundary and the route content.
      // This file has no access to the real shell's top bar/sidebar
      // markup (it's being edited elsewhere right now, and this file is
      // deliberately independent of it), so the fallback below is a
      // simple centered message + explicit way back rather than a partial
      // re-render of chrome it doesn't own. Once the real shell exists
      // where this boundary is actually wired in, it can render inside/
      // around the persistent chrome so only the content region is
      // replaced.
      return (
        <div className="rr-eb-shell admin-redesign">
          <div className="rr-eb-shell-card">
            <div className="rr-eb-app-icon" aria-hidden="true">!</div>
            <h2>{this.props.fallbackTitle || 'Something went wrong'}</h2>
            <p>This part of Festio hit an error. Your event data is safe — head back to Event Setup or reload.</p>
            <div className="rr-eb-actions">
              <a className="rr-eb-btn secondary" href="/admin-redesign">Return to Event Setup</a>
              <button type="button" className="rr-eb-btn primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export class RedesignRouteBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = () => {
    this.props.onRetry?.()
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      const { onRetry, onBack } = this.props
      return (
        <div className="rr-eb-route" role="alert">
          <div className="rr-eb-route-icon" aria-hidden="true">!</div>
          <h3>This page hit a snag</h3>
          <p>Something went wrong loading this section.</p>
          <div className="rr-eb-actions">
            {onBack && (
              <button type="button" className="rr-eb-btn secondary" onClick={onBack}>Back</button>
            )}
            {onRetry ? (
              <button type="button" className="rr-eb-btn primary" onClick={this.handleRetry}>Try again</button>
            ) : (
              <button type="button" className="rr-eb-btn primary" onClick={() => window.location.reload()}>
                Reload page
              </button>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export class RedesignWidgetBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = () => {
    this.props.onRetry?.()
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      // Sized to sit inside a card/panel, not the whole layout — no forced
      // width/height so it drops into whatever container already exists.
      return (
        <div className="rr-eb-widget" role="alert">
          <span className="rr-eb-widget-msg">This section failed to load</span>
          <button type="button" className="rr-eb-widget-retry" onClick={this.handleRetry}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

export class RedesignModalBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      // Replaces the modal's own body area only — the caller owns the
      // backdrop/frame. A failed modal must still be closeable, so this
      // always renders a Close button wired to the onClose prop the
      // caller passes in.
      return (
        <div className="rr-eb-modal" role="alert">
          <p>This dialog ran into a problem and couldn&apos;t finish loading.</p>
          <div className="rr-eb-actions">
            <button type="button" className="rr-eb-btn secondary" onClick={() => this.props.onClose?.()}>
              Close
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
