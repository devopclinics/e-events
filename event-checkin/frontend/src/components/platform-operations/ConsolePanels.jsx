import { cloneElement, useEffect, useId, useRef } from 'react'
import './ConsolePanels.css'

export function Panel({
  title,
  eyebrow,
  description,
  actions,
  children,
  className = '',
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={`co-panel ${className}`}>
      <header className="co-panel-head">
        <div>
          {eyebrow && <span className="co-eyebrow">{eyebrow}</span>}
          <h3 id={id}>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="co-actions">{actions}</div>}
      </header>
      {children && <div className="co-panel-body">{children}</div>}
    </section>
  )
}
export function Field({ label, hint, children }) {
  const generated = useId()
  const id = children?.props?.id || generated
  return (
    <div className="co-field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <span className="co-control">
        {children &&
          cloneElement(children, {
            id,
            'aria-describedby': hint
              ? id + '-hint'
              : children.props['aria-describedby'],
          })}
      </span>
      {hint && <small id={id + '-hint'}>{hint}</small>}
    </div>
  )
}

export function Badge({ children, tone = '' }) {
  return <span className={`co-badge ${tone}`}>{children}</span>
}
export function Notice({ children, error = false }) {
  return children ? (
    <div
      className={`co-notice ${error ? 'error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  ) : null
}
export function Empty({ title, children }) {
  return (
    <div className="co-empty">
      <span aria-hidden="true">◇</span>
      <h4>{title}</h4>
      {children && <p>{children}</p>}
    </div>
  )
}
export function Loading({ error, onRetry }) {
  return (
    <div className="co-state" role={error ? 'alert' : 'status'}>
      {error || 'Loading this workspace…'}
      {onRetry && error && (
        <button className="co-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
export function Metrics({ items }) {
  return (
    <div className="co-metrics">
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}
export function Dialog({ title, children, onClose }) {
  const ref = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  const id = useId()
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.focus()
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
      }
      if (event.key === 'Tab') {
        const nodes = [
          ...ref.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]',
          ),
        ].filter((el) => el.getClientRects().length)
        const first = nodes[0],
          last = nodes.at(-1)
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [])
  return (
    <div className="co-dialog-backdrop" onClick={onClose}>
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="co-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="co-eyebrow">PLATFORM OPERATIONS</span>
            <h3 id={id}>{title}</h3>
          </div>
          <button
            className="co-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="co-dialog-body">{children}</div>
      </section>
    </div>
  )
}
export const number = (value) => Number(value || 0).toLocaleString()
export const money = (minor, currency = 'USD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(minor || 0) / 100)
export const date = (value) =>
  value ? new Date(value).toLocaleDateString() : 'Not recorded'
