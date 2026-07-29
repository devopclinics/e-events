import { useEffect, useState } from 'react'
import { Icon } from './RedesignShell'
import './RedesignPrimitives.css'

// ── generic, reusable UI primitives for the redesign pages ─────────────
// Companion file to RedesignShell.jsx (Modal / ConfirmDialog / ChannelPreviewFrame).
// Kept in its own file/CSS pair on purpose: no page-specific business logic,
// no API calls, everything driven by props. Only depends on the shared
// design-token system (--ink, --muted, --line, --surface, --teal, etc.)
// and on the shared Icon component + rr-btn button class already used
// throughout the redesign pages.

export function Drawer({ title, children, onClose, side = 'right', width = 420 }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={`rp-drawer-backdrop rp-drawer-backdrop-${side}`} onClick={onClose}>
      <div
        className={`rp-drawer rp-drawer-${side}`}
        style={{ width: `min(${width}px, 92vw)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rp-drawer-head">
          <h3>{title}</h3>
          <button className="rp-drawer-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="rp-drawer-body">{children}</div>
      </div>
    </div>
  )
}

export function FieldError({ message }) {
  if (!message) return null
  return <p className="rp-field-error">{message}</p>
}

export function FormField({ label, error, required, children }) {
  return (
    <div className="rp-field">
      {label && (
        <label className="rp-field-label">
          {label}{required && <span className="rp-field-required"> *</span>}
        </label>
      )}
      {children}
      <FieldError message={error} />
    </div>
  )
}

export function LoadingSkeleton({ rows = 3, variant = 'list' }) {
  if (variant === 'table') {
    return (
      <div className="rp-skel rp-skel-table" aria-hidden="true">
        {Array.from({ length: rows }).map((_, r) => (
          <div className="rp-skel-row" key={r}>
            {Array.from({ length: 4 }).map((__, c) => <span className="rp-skel-cell" key={c} />)}
          </div>
        ))}
      </div>
    )
  }
  if (variant === 'card') {
    return (
      <div className="rp-skel rp-skel-cards" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="rp-skel-card" key={i}>
            <span className="rp-skel-bar rp-skel-bar-sm" />
            <span className="rp-skel-bar rp-skel-bar-lg" />
            <span className="rp-skel-bar rp-skel-bar-md" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="rp-skel rp-skel-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <span className="rp-skel-bar" key={i} style={{ width: `${78 - (i % 3) * 14}%` }} />
      ))}
    </div>
  )
}

export function EmptyState({ icon = 'info', title, message, action }) {
  return (
    <div className="rp-state rp-empty-state">
      <div className="rp-state-icon"><Icon name={icon} size={22} /></div>
      {title && <h3>{title}</h3>}
      {message && <p>{message}</p>}
      {action && <div className="rp-state-action">{action}</div>}
    </div>
  )
}

export function ErrorRetryState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="rp-state rp-error-state">
      <div className="rp-state-icon rp-state-icon-danger"><Icon name="info" size={22} /></div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {onRetry && (
        <button className="rr-btn secondary rp-state-action" onClick={onRetry}>
          <Icon name="arrow" size={13} className="rp-arrow-left" /> Try again
        </button>
      )}
    </div>
  )
}

export function PermissionDeniedState({ message = 'You do not have access to this.' }) {
  return (
    <div className="rp-state rp-permission-state">
      <div className="rp-state-icon rp-state-icon-muted"><Icon name="lock" size={22} /></div>
      <h3>Access restricted</h3>
      <p>{message}</p>
    </div>
  )
}

export function FeatureLockedState({ featureName, planName, onUpgrade }) {
  return (
    <div className="rp-state rp-locked-state">
      <div className="rp-state-icon rp-state-icon-accent"><Icon name="lock" size={22} /></div>
      <h3>{featureName ? `${featureName} is locked` : 'Feature locked'}</h3>
      <p>{planName ? `Requires the ${planName} plan.` : 'This feature is not included in your current plan.'}</p>
      {onUpgrade && (
        <button className="rr-btn primary rp-state-action" onClick={onUpgrade}>
          <Icon name="external" size={13} /> Upgrade plan
        </button>
      )}
    </div>
  )
}

export function OfflineBanner({ reconnecting = false }) {
  return (
    <div className={`rp-banner ${reconnecting ? 'rp-banner-warn' : 'rp-banner-danger'}`} role="status">
      <Icon name="cloud" size={14} />
      <div>
        <strong>{reconnecting ? 'Reconnecting…' : 'You are offline'}</strong>
        <span>{reconnecting ? 'Trying to restore your connection.' : 'Changes will sync once your connection is back.'}</span>
      </div>
      <button className="rp-banner-dismiss" aria-label="Dismiss">×</button>
    </div>
  )
}

export function PartialSuccessSummary({ succeeded, failed, total, failedItems = [] }) {
  const [open, setOpen] = useState(false)
  const hasFailures = failed > 0
  return (
    <div className="rp-partial">
      <div className="rp-partial-head">
        <Icon name={hasFailures ? 'info' : 'check'} size={15} className={hasFailures ? 'rp-partial-icon-warn' : 'rp-partial-icon-ok'} />
        <div>
          <strong>{succeeded} of {total} succeeded</strong>
          {hasFailures && <span> — {failed} failed</span>}
        </div>
        {failedItems.length > 0 && (
          <button className="rp-link-btn" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide details' : 'View details'}
            <Icon name="chevrondown" size={12} className={open ? 'rp-chev-open' : ''} />
          </button>
        )}
      </div>
      {open && failedItems.length > 0 && (
        <ul className="rp-partial-list">
          {failedItems.map((item, i) => (
            <li key={item.label ? `${item.label}-${i}` : i}>
              <b>{item.label}</b>
              <span>{item.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPageChange }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return (
    <div className="rp-pagination">
      <span className="rp-pagination-range">{start}–{end} of {total}</span>
      <div className="rp-pagination-controls">
        <button className="rr-btn secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <Icon name="arrow" size={12} className="rp-arrow-left" /> Prev
        </button>
        <span className="rp-pagination-page">Page {page} of {pageCount}</span>
        <button className="rr-btn secondary" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next <Icon name="arrow" size={12} />
        </button>
      </div>
    </div>
  )
}

export function MobileTableAlternative({ columns = [], rows = [], renderCard }) {
  if (!rows.length) return null
  return (
    <div className="rp-mobile-cards">
      {rows.map((row, i) => (
        <div className="rp-mobile-card" key={row.id ?? i}>
          {renderCard
            ? renderCard(row)
            : columns.map((col) => (
              <div className="rp-mobile-card-row" key={col.key}>
                <span className="rp-mobile-card-label">{col.label}</span>
                <span className="rp-mobile-card-value">{row[col.key]}</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}
