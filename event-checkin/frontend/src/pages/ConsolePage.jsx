import { useState, useEffect } from 'react'
import {
  Panel,
  Field,
  Badge,
  Notice,
  Empty,
  Loading,
  Metrics,
  Dialog,
  number,
  money,
  date,
} from '../components/platform-operations/ConsolePanels'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import PlatformOperations from '../components/platform-operations/PlatformOperations'
import { operationsSection } from '../components/platform-operations/sections.mjs'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'usage', label: 'Usage' },
  { id: 'trials', label: 'Trial requests' },
  { id: 'qa', label: 'QA checklist' },
  { id: 'support', label: 'Support chat' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'addon-access', label: 'Add-on Access' },
  { id: 'org-plans', label: 'Org Plans' },
  { id: 'affiliates', label: 'Affiliate stores' },
  { id: 'operators', label: 'Operators' },
]

// ── Accounts summary: aggregated per-org stats for quick assessment ─────────
function AccountsSummaryTable() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    api
      .adminAccountsSummary()
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [])

  if (!rows)
    return (
      <Loading
        error={err}
        onRetry={() =>
          api
            .adminAccountsSummary()
            .then(setRows)
            .catch((e) => setErr(e.message))
        }
      />
    )

  const needle = q.trim().toLowerCase()
  const filtered = needle
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          (r.owner_email || '').toLowerCase().includes(needle) ||
          (r.owner_name || '').toLowerCase().includes(needle),
      )
    : rows

  return (
    <Panel
      title="Account snapshot"
      description={`${filtered.length} of ${rows.length} organizations`}
      actions={
        <input
          className="co-search"
          aria-label="Search account snapshot"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Organization or owner"
        />
      }
    >
      <div className="co-grid">
        {filtered.map((r) => (
          <article className="co-person" key={r.id}>
            <div className="co-toolbar">
              <div className="co-identity">
                <span className="co-avatar">{r.name.slice(0, 1)}</span>
                <div>
                  <strong>{r.name}</strong>
                  <small>{r.owner_name || 'Owner not recorded'}</small>
                </div>
              </div>
              <Badge
                tone={
                  !r.is_active ? 'warn' : r.paid_event_count > 0 ? 'good' : ''
                }
              >
                {!r.is_active
                  ? 'Suspended'
                  : r.paid_event_count > 0
                    ? `${r.paid_event_count} paid events`
                    : 'Free'}
              </Badge>
            </div>
            <p className="co-muted">{r.owner_email || 'Email not recorded'}</p>
            <dl className="co-facts">
              <div>
                <dt>Events</dt>
                <dd>{r.event_count}</dd>
              </div>
              <div>
                <dt>Members</dt>
                <dd>{r.member_count}</dd>
              </div>
              <div>
                <dt>Credits used / left</dt>
                <dd>
                  {number(r.message_credits_spent)} /{' '}
                  {number(r.message_credits_remaining)}
                </dd>
              </div>
            </dl>
            <dl className="co-facts">
              <div>
                <dt>Created</dt>
                <dd>{date(r.created_at)}</dd>
              </div>
              <div>
                <dt>Last event</dt>
                <dd>{date(r.last_event_at)}</dd>
              </div>
              <div>
                <dt>Event types</dt>
                <dd>{r.event_types.join(', ') || 'Not recorded'}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <Empty title="No matching organizations">
          Try another organization or owner name.
        </Empty>
      )}
    </Panel>
  )
}
// ── Usage: messaging usage per org, per channel (email/SMS/WhatsApp/MMS) ────
const USAGE_CHANNELS = ['email', 'sms', 'whatsapp', 'mms']

function UsageTab() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    api
      .adminUsageReport()
      .then(setData)
      .catch((e) => setErr(e.message))
  }, [])

  if (!data)
    return (
      <Loading
        error={err}
        onRetry={() =>
          api
            .adminUsageReport()
            .then(setData)
            .catch((e) => setErr(e.message))
        }
      />
    )

  const needle = q.trim().toLowerCase()
  const orgs = needle
    ? data.orgs.filter((o) => o.org_name.toLowerCase().includes(needle))
    : data.orgs

  return (
    <div className="co-stack">
      <div className="co-toolbar">
        <p className="co-description">
          Messaging activity across {orgs.length} of {data.orgs.length}{' '}
          organizations.
        </p>
        <input
          className="co-search"
          aria-label="Search messaging usage"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an organization"
        />
      </div>
      <Metrics
        items={[
          [
            'Messages sent',
            number(
              orgs.reduce((sum, o) => sum + Number(o.total_sends || 0), 0),
            ),
          ],
          [
            'Credits used',
            number(
              orgs.reduce((sum, o) => sum + Number(o.total_credits || 0), 0),
            ),
          ],
          [
            'Provider cost · USD',
            money(
              orgs.reduce((sum, o) => sum + Number(o.total_cost_cents || 0), 0),
            ),
          ],
        ]}
      />
      <div className="co-grid">
        {orgs.map((o) => (
          <Panel
            key={o.org_id}
            title={o.org_name}
            eyebrow="MESSAGING BREAKDOWN"
            actions={<Badge>{number(o.total_sends)} sends</Badge>}
          >
            <dl className="co-facts">
              <div>
                <dt>Credits spent</dt>
                <dd>{number(o.total_credits)}</dd>
              </div>
              <div>
                <dt>Provider cost · USD</dt>
                <dd>{money(o.total_cost_cents)}</dd>
              </div>
            </dl>
            <div className="co-channels">
              {USAGE_CHANNELS.map((channel) => {
                const count = Number(o.channels[channel]?.sends || 0)
                const peak = Math.max(
                  1,
                  ...USAGE_CHANNELS.map((c) =>
                    Number(o.channels[c]?.sends || 0),
                  ),
                )
                return (
                  <div className="co-channel" key={channel}>
                    <span>
                      {channel === 'whatsapp'
                        ? 'WhatsApp'
                        : channel.toUpperCase()}
                    </span>
                    <span aria-hidden="true" className="co-channel-track">
                      <i style={{ width: `${(count / peak) * 100}%` }} />
                    </span>
                    <strong>{number(count)}</strong>
                  </div>
                )
              })}
            </div>
          </Panel>
        ))}
      </div>
      {!orgs.length && (
        <Empty title="No messaging activity matches">
          Try another organization name.
        </Empty>
      )}
    </div>
  )
}
// ── Overview: all orgs + events, with comp/credit grant ─────────────────────
function OverviewTab() {
  const [orgs, setOrgs] = useState(null)
  const [plans, setPlans] = useState([])
  const [msg, setMsg] = useState('')

  function load() {
    api
      .adminOverview()
      .then(setOrgs)
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
    api
      .adminListPlans()
      .then((p) => setPlans(p.filter((x) => x.kind === 'tier')))
      .catch(() => {})
  }, [])

  async function grant(eventId, body) {
    setMsg('')
    try {
      await api.adminGrant(eventId, body)
      load()
      setMsg('Applied.')
      setTimeout(() => setMsg(''), 2500)
    } catch (e) {
      setMsg(e.message)
    }
  }

  if (!orgs) return <Loading error={msg} onRetry={load} />
  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <div className="co-readiness-note">
        Event plans unlock paid features. Message credits only increase the
        messaging balance. Organization and event add-on overrides remain
        separate.
      </div>
      {orgs.map((o) => (
        <Panel
          key={o.id}
          title={o.name}
          eyebrow={`${o.region} · ${o.currency}`}
          description={`${o.events.length} events`}
          actions={
            <AddonOverrideEditor
              scope="org"
              id={o.id}
              label="Organization add-ons"
            />
          }
        >
          {o.events.map((e) => (
            <EventRow key={e.id} ev={e} plans={plans} onGrant={grant} />
          ))}
          {!o.events.length && <Empty title="No events in this organization" />}
        </Panel>
      ))}
      {!orgs.length && <Empty title="No organizations yet" />}
      <details className="co-editor">
        <summary>
          <div>
            <h3>Account snapshot</h3>
            <p className="co-description">
              Review owner, event and message-credit details.
            </p>
          </div>
        </summary>
        <div className="co-editor-body">
          <AccountsSummaryTable />
        </div>
      </details>
    </div>
  )
}
const MESSAGING_CHANNELS = [
  ['email', 'Email'],
  ['sms', 'SMS'],
  ['whatsapp', 'WhatsApp'],
  ['mms', 'MMS'],
]
const COMM_FEATURES = [
  ['guest_hub', 'FestioHub'],
  ['guest_chat', 'Guest Chat'],
  ['host_messages', 'Message Host'],
  ['announcements', 'Announcements'],
  ['festiome', 'FestioMe'],
]

const ADDON_LABELS = {
  addon_registry: 'Registry',
  addon_menu: 'Menu & Orders',
  addon_planner: 'Event Planner',
  addon_logistics: 'Logistics',
  addon_festiome: 'FestioMe Community',
  addon_seating: 'Seating & Floor Plans',
  addon_experience: 'Experience Workflows',
  addon_venue_access: 'Venue Access Intelligence',
  addon_engagement: 'Festio Live',
  addon_speakers: 'Speakers',
  addon_partners: 'Partners',
  addon_reminders: 'Automated Reminders',
}

function AddonOverrideEditor({ scope, id, label }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = async () =>
    setData(
      scope === 'org'
        ? await api.adminOrgAddonOverrides(id)
        : await api.adminEventAddonOverrides(id),
    )
  async function toggle() {
    setError('')
    setNotice('')
    if (!open && !data) {
      try {
        await load()
      } catch (e) {
        setError(e.message)
        return
      }
    }
    setOpen((value) => !value)
  }
  function setValue(key, value) {
    setData((current) => {
      const overrides = { ...(current?.overrides || {}) }
      if (value === null) delete overrides[key]
      else overrides[key] = value
      return { ...current, overrides }
    })
  }
  async function saveAll(value) {
    const overrides = Object.fromEntries(
      (data?.addons || Object.keys(ADDON_LABELS)).map((key) => [key, value]),
    )
    setData((current) => ({ ...current, overrides }))
    await save(overrides)
  }
  async function save(overrides = data?.overrides || {}) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const next =
        scope === 'org'
          ? await api.adminSetOrgAddonOverrides(id, overrides)
          : await api.adminSetEventAddonOverrides(id, overrides)
      setData(next)
      setNotice('Add-on rules saved.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="co-stack">
      <div>
        <button className="co-button" aria-expanded={open} onClick={toggle}>
          {open ? 'Close add-on editor' : label}
        </button>
      </div>
      <Notice error>{error}</Notice>
      {open && data && (
        <div className="co-inset co-stack" role="region" aria-label={label}>
          <div className="co-toolbar">
            <div>
              <h4>{label}</h4>
              <p className="co-description">
                Inherit follows billing rules. Allow grants access; Disallow
                blocks it.
              </p>
            </div>
            <div className="co-actions">
              <button
                className="co-button"
                disabled={saving}
                onClick={() => saveAll(true)}
              >
                Allow all
              </button>
              <button
                className="co-button danger"
                disabled={saving}
                onClick={() => saveAll(false)}
              >
                Disallow all
              </button>
            </div>
          </div>
          <Notice>{notice}</Notice>
          <div className="co-addons">
            {(data.addons || Object.keys(ADDON_LABELS)).map((key) => (
              <fieldset key={key} className="co-addon">
                <legend>{ADDON_LABELS[key] || key}</legend>
                <div className="co-segments">
                  {[
                    [null, 'Inherit'],
                    [true, 'Allow'],
                    [false, 'Disallow'],
                  ].map(([value, text]) => {
                    const selected =
                      value === null
                        ? !(key in (data.overrides || {}))
                        : data.overrides?.[key] === value
                    return (
                      <button
                        key={text}
                        disabled={saving}
                        aria-pressed={selected}
                        onClick={() => setValue(key, value)}
                      >
                        {text}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="co-actions">
            <button
              className="co-button primary"
              disabled={saving}
              onClick={() => save()}
            >
              {saving ? 'Saving…' : 'Save add-on rules'}
            </button>
            <button className="co-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
function OrgAddonAccessTab() {
  const [orgs, setOrgs] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .adminOverview()
      .then(setOrgs)
      .catch((e) => setError(e.message))
  }, [])

  if (!orgs)
    return (
      <Loading
        error={error}
        onRetry={() =>
          api
            .adminOverview()
            .then(setOrgs)
            .catch((e) => setError(e.message))
        }
      />
    )

  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? orgs.filter(
        (org) =>
          org.name.toLowerCase().includes(needle) ||
          org.events.some((event) => event.name.toLowerCase().includes(needle)),
      )
    : orgs

  return (
    <div className="co-stack">
      <div className="co-toolbar">
        <p className="co-description">
          Organization rules apply to all current and future events.
        </p>
        <input
          className="co-search"
          aria-label="Search add-on access"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Organization or event"
        />
      </div>
      <div className="co-readiness-note">
        <strong>Inherit</strong> follows normal billing rules.{' '}
        <strong>Allow</strong> grants access; <strong>Disallow</strong> blocks
        it.
      </div>
      {filtered.map((org) => (
        <Panel
          key={org.id}
          title={org.name}
          eyebrow={`${org.region} · ${org.currency}`}
          description={`${org.events.length} events share these access rules.`}
        >
          <AddonOverrideEditor scope="org" id={org.id} label="Manage add-ons" />
        </Panel>
      ))}
      {!filtered.length && <Empty title="No matching organizations" />}
    </div>
  )
}
function EventRow({ ev, plans, onGrant }) {
  const [tier, setTier] = useState('')
  const [credits, setCredits] = useState('')
  const [reportBusy, setReportBusy] = useState('')
  const [controls, setControls] = useState(null) // { blocked_messaging_channels, blocked_comm_features }
  const [savingCtl, setSavingCtl] = useState(false)

  async function openControls() {
    if (controls) {
      setControls(null)
      return
    }
    try {
      setControls(await api.adminEventControls(ev.id))
    } catch (e) {
      window.alert(e.message)
    }
  }
  function toggleBlock(kind, key) {
    setControls((c) => {
      const set = new Set(c[kind] || [])
      set.has(key) ? set.delete(key) : set.add(key)
      return { ...c, [kind]: [...set] }
    })
  }
  async function saveControls() {
    setSavingCtl(true)
    try {
      setControls(await api.adminSetEventControls(ev.id, controls))
    } catch (e) {
      window.alert(e.message)
    } finally {
      setSavingCtl(false)
    }
  }

  async function previewReport() {
    setReportBusy('preview')
    try {
      await api.adminPreviewReadinessReport(ev.id)
    } catch (e) {
      window.alert(e.message)
    } finally {
      setReportBusy('')
    }
  }

  async function sendReport() {
    const custom = window.prompt(
      'Send to the organization owner by default.\n\nOptionally enter a different recipient email, or leave blank for the owner:',
    )
    if (custom === null) return
    setReportBusy('send')
    try {
      const result = await api.adminSendReadinessReport(ev.id, custom.trim())
      window.alert(`Readiness report queued for ${result.email}.`)
    } catch (e) {
      window.alert(e.message)
    } finally {
      setReportBusy('')
    }
  }
  return (
    <article className="co-event" aria-label={ev.name}>
      <div className="co-toolbar">
        <div>
          <h4>{ev.name}</h4>
          <div className="co-actions">
            <Badge tone={ev.is_paid ? 'good' : ''}>
              {ev.is_paid ? `Paid · ${ev.plan_tier}` : 'Free'}
            </Badge>
            <Badge>{ev.status}</Badge>
            <span className="co-muted">
              {number(ev.message_credits)} message credits
            </span>
          </div>
        </div>
        <AddonOverrideEditor scope="event" id={ev.id} label="Event add-ons" />
      </div>
      <details className="co-disclosure">
        <summary>Adjust event access &amp; credits</summary>
        <div className="co-stack">
          <div className="co-fields">
            <Field
              label="Comp a plan"
              hint="Unlocks paid features for this event."
            >
              <select value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">No change</option>
                {plans.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label || p.key}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Add message credits"
              hint="Increases the messaging balance only."
            >
              <input
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                placeholder="0"
                type="number"
              />
            </Field>
          </div>
          <div>
            <button
              className="co-button primary"
              disabled={!tier && !credits}
              onClick={() => {
                onGrant(ev.id, {
                  tier: tier || undefined,
                  add_credits: credits ? Number(credits) : undefined,
                })
                setTier('')
                setCredits('')
              }}
            >
              Apply grant
            </button>
          </div>
        </div>
      </details>
      <details className="co-disclosure">
        <summary>Readiness &amp; communication controls</summary>
        <div className="co-stack">
          <div className="co-actions">
            <button
              className="co-button"
              onClick={previewReport}
              disabled={!!reportBusy}
            >
              {reportBusy === 'preview' ? 'Generating…' : 'Readiness report'}
            </button>
            <button
              className="co-button"
              onClick={sendReport}
              disabled={!!reportBusy}
            >
              {reportBusy === 'send' ? 'Sending…' : 'Send to owner'}
            </button>
            <button className="co-button" onClick={openControls}>
              {controls ? 'Close channel controls' : 'Channel controls'}
            </button>
          </div>
          {controls && (
            <div className="co-inset co-stack">
              <p className="co-description">
                Blocked channels and features cannot be re-enabled by
                organizers.
              </p>
              <div>
                <h5 className="co-eyebrow">Messaging channels</h5>
                <div className="co-actions">
                  {MESSAGING_CHANNELS.map(([key, label]) => {
                    const blocked = (
                      controls.blocked_messaging_channels || []
                    ).includes(key)
                    return (
                      <button
                        key={key}
                        className={`co-button ${blocked ? 'danger' : ''}`}
                        aria-pressed={blocked}
                        onClick={() =>
                          toggleBlock('blocked_messaging_channels', key)
                        }
                      >
                        {label} · {blocked ? 'Blocked' : 'Allowed'}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <h5 className="co-eyebrow">Communication features</h5>
                <div className="co-actions">
                  {COMM_FEATURES.map(([key, label]) => {
                    const blocked = (
                      controls.blocked_comm_features || []
                    ).includes(key)
                    return (
                      <button
                        key={key}
                        className={`co-button ${blocked ? 'danger' : ''}`}
                        aria-pressed={blocked}
                        onClick={() =>
                          toggleBlock('blocked_comm_features', key)
                        }
                      >
                        {label} · {blocked ? 'Blocked' : 'Allowed'}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <button
                  className="co-button danger"
                  disabled={savingCtl}
                  onClick={saveControls}
                >
                  {savingCtl ? 'Saving…' : 'Save blocks'}
                </button>
              </div>
            </div>
          )}
        </div>
      </details>
    </article>
  )
}
// ── Accounts: suspend/delete orgs, manage members, suspend/delete users ─────
function AccountsTab({ me }) {
  const [orgs, setOrgs] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [query, setQuery] = useState('')
  const [passEditor, setPassEditor] = useState(null)
  const [passBusy, setPassBusy] = useState(false)
  const [passLoading, setPassLoading] = useState('')

  function load() {
    api
      .adminListAccounts()
      .then(setOrgs)
      .catch((e) => setErr(e.message))
  }
  useEffect(load, [])

  async function run(fn, ok) {
    setMsg('')
    setErr('')
    try {
      await fn()
      load()
      if (ok) {
        setMsg(ok)
        setTimeout(() => setMsg(''), 2500)
      }
    } catch (e) {
      setErr(e.message)
    }
  }

  async function managePass(o) {
    setErr('')
    setMsg('')
    setPassLoading(o.id)
    try {
      const current = await api.adminGetOrgEventPass(o.id)
      setPassEditor({
        org: o,
        tier: current.tier || '',
        extend: '',
        promo: '',
        credits: '',
        reason: '',
      })
    } catch (e) {
      setErr(e.message)
    } finally {
      setPassLoading('')
    }
  }
  async function savePass(event) {
    event.preventDefault()
    if (passBusy || !passEditor.reason.trim()) return
    setPassBusy(true)
    setErr('')
    const body = { reason: passEditor.reason }
    if (passEditor.tier.trim()) body.tier = passEditor.tier.trim()
    if (passEditor.extend.trim())
      body.extend_pass_days = Number(passEditor.extend)
    if (passEditor.promo.trim())
      body.extend_addon_promo_days = Number(passEditor.promo)
    if (passEditor.credits.trim())
      body.credit_delta_units = Number(passEditor.credits)
    try {
      await api.adminUpdateOrgEventPass(passEditor.org.id, body)
      setPassEditor(null)
      load()
      setMsg('Event Pass updated and audited.')
    } catch (e) {
      setErr(e.message)
    } finally {
      setPassBusy(false)
    }
  }

  if (!orgs) return <Loading error={err} onRetry={load} />
  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <Notice error>{err}</Notice>
      <div className="co-toolbar">
        <p className="co-description">
          {orgs.length} organizations · account access and membership
        </p>
        <input
          className="co-search"
          aria-label="Search organizations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Organization, member or email"
        />
      </div>
      {orgs
        .filter(
          (o) =>
            !query.trim() ||
            [o.name, ...o.members.flatMap((m) => [m.name, m.email])]
              .join(' ')
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .map((o) => (
          <Panel
            key={o.id}
            title={o.name}
            eyebrow="ORGANIZATION"
            actions={
              <Badge tone={o.is_active ? 'good' : 'warn'}>
                {o.is_active ? 'Active' : 'Suspended'}
              </Badge>
            }
          >
            <div className="co-stack">
              <Metrics
                items={[
                  ['Events', o.event_count],
                  ['Team members', o.members.length],
                  ['Account access', o.is_active ? 'Enabled' : 'Paused'],
                ]}
              />
              <div className="co-fields">
                <Field label="Interface rollout">
                  <select
                    value={o.redesign_cohort}
                    onChange={(e) =>
                      run(
                        () =>
                          api.adminSetOrgRedesignCohort(o.id, e.target.value),
                        'Redesign cohort updated.',
                      )
                    }
                  >
                    {[
                      ['legacy_only', 'Legacy only'],
                      ['redesign_opt_in', 'Redesign opt-in'],
                      ['redesign_internal', 'Internal preview'],
                      ['redesign_default', 'Redesign default'],
                      ['legacy_retired', 'Legacy retired'],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="co-actions">
                  <button
                    className="co-button"
                    disabled={!!passLoading}
                    onClick={() => managePass(o)}
                  >
                    {passLoading === o.id ? 'Opening…' : 'Manage Event Pass'}
                  </button>
                </div>
              </div>
              <details className="co-disclosure">
                <summary>Team members · {o.members.length}</summary>
                <div className="co-grid">
                  {o.members.map((m) => (
                    <article className="co-person" key={m.user_id}>
                      <div className="co-identity">
                        <span className="co-avatar">
                          {(m.name || m.email || '?').slice(0, 1)}
                        </span>
                        <div>
                          <strong>{m.name}</strong>
                          <small>{m.email}</small>
                        </div>
                      </div>
                      <div className="co-actions">
                        {!m.is_active && <Badge tone="warn">Suspended</Badge>}
                        {m.is_platform_superadmin && (
                          <Badge tone="purple">Platform operator</Badge>
                        )}
                      </div>
                      <Field
                        label="Organization role"
                        hint="Role changes save immediately."
                      >
                        <select
                          value={m.role}
                          onChange={(e) =>
                            run(() =>
                              api.adminSetMemberRole(
                                o.id,
                                m.user_id,
                                e.target.value,
                              ),
                            )
                          }
                        >
                          {['owner', 'admin', 'staff'].map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <details className="co-disclosure">
                        <summary>Member access actions</summary>
                        <div className="co-actions">
                          <button
                            className="co-button"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Remove ${m.email} from ${o.name}?`,
                                )
                              )
                                return
                              run(
                                () => api.adminRemoveMember(o.id, m.user_id),
                                'Removed from org.',
                              )
                            }}
                          >
                            Remove from organization
                          </button>
                          {m.user_id !== me.id && (
                            <>
                              <button
                                className="co-button"
                                onClick={() => {
                                  if (
                                    m.is_active &&
                                    !window.confirm(
                                      `Suspend ${m.email}? They will be unable to sign in.`,
                                    )
                                  )
                                    return
                                  run(
                                    () =>
                                      api.adminSetUserActive(
                                        m.user_id,
                                        !m.is_active,
                                      ),
                                    'Updated.',
                                  )
                                }}
                              >
                                {m.is_active
                                  ? 'Suspend user'
                                  : 'Reactivate user'}
                              </button>
                              <button
                                className="co-button danger"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Permanently delete ${m.email}? This disables their sign-in.`,
                                    )
                                  )
                                    run(
                                      () => api.adminDeleteUser(m.user_id),
                                      'User deleted.',
                                    )
                                }}
                              >
                                Delete user
                              </button>
                            </>
                          )}
                        </div>
                      </details>
                    </article>
                  ))}
                </div>
                {!o.members.length && <Empty title="No members" />}
              </details>
              <details className="co-disclosure">
                <summary>Organization access actions</summary>
                <div className="co-stack">
                  <p className="co-description">
                    Suspension is reversible. Deleting an organization
                    permanently removes its events and data.
                  </p>
                  <div className="co-actions">
                    <button
                      className="co-button"
                      onClick={() => {
                        if (
                          o.is_active &&
                          !window.confirm(
                            `Suspend ${o.name}? Members will lose access until it is reactivated.`,
                          )
                        )
                          return
                        run(
                          () => api.adminSetOrgActive(o.id, !o.is_active),
                          o.is_active ? 'Org suspended.' : 'Org reactivated.',
                        )
                      }}
                    >
                      {o.is_active
                        ? 'Suspend organization'
                        : 'Reactivate organization'}
                    </button>
                    <button
                      className="co-button danger"
                      onClick={() => {
                        if (
                          window.prompt(
                            `Type the org name to permanently DELETE it and all its data:\n\n${o.name}`,
                          ) === o.name
                        )
                          run(() => api.adminDeleteOrg(o.id), 'Org deleted.')
                      }}
                    >
                      Delete organization
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </Panel>
        ))}
      {!orgs.length && <Empty title="No organizations yet" />}
      {passEditor && (
        <Dialog
          title={`Event Pass · ${passEditor.org.name}`}
          onClose={() => {
            if (!passBusy) setPassEditor(null)
          }}
        >
          <form className="co-stack" onSubmit={savePass}>
            <Notice error>{err}</Notice>
            <p className="co-description">
              Adjust this organization’s pass and messaging allowance. Every
              update is audited.
            </p>
            <div className="co-fields">
              {[
                [
                  'tier',
                  'Event Pass tier',
                  'Leave blank to keep the current tier.',
                ],
                ['extend', 'Additional pass days', 'Blank means no extension.'],
                [
                  'promo',
                  'Additional add-on promo days',
                  'Blank means no extension.',
                ],
                [
                  'credits',
                  'Credit adjustment · units',
                  'Email costs 1 unit. Negative adjustments are supported.',
                ],
              ].map(([key, label, hint]) => (
                <Field label={label} hint={hint} key={key}>
                  <input
                    value={passEditor[key]}
                    type={key === 'tier' ? 'text' : 'number'}
                    onChange={(e) =>
                      setPassEditor((current) => ({
                        ...current,
                        [key]: e.target.value,
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="Audit reason">
              <textarea
                required
                value={passEditor.reason}
                onChange={(e) =>
                  setPassEditor((current) => ({
                    ...current,
                    reason: e.target.value,
                  }))
                }
              />
            </Field>
            <div className="co-actions">
              <button
                className="co-button primary"
                disabled={passBusy || !passEditor.reason.trim()}
              >
                {passBusy ? 'Saving…' : 'Save Event Pass'}
              </button>
              <button
                type="button"
                className="co-button"
                disabled={passBusy}
                onClick={() => setPassEditor(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  )
}
// ── Trial requests: approve (comp an event) / decline ───────────────────────
function TrialsTab() {
  const [reqs, setReqs] = useState(null)
  const [orgs, setOrgs] = useState([])
  const [plans, setPlans] = useState([])
  const [msg, setMsg] = useState('')

  function load() {
    api
      .adminListTrials()
      .then(setReqs)
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
    api
      .adminOverview()
      .then(setOrgs)
      .catch(() => {})
    api
      .adminListPlans()
      .then((p) => setPlans(p.filter((x) => x.kind === 'tier')))
      .catch(() => {})
  }, [])

  async function resolve(id, body) {
    setMsg('')
    try {
      await api.adminResolveTrial(id, body)
      load()
      setMsg('Done.')
      setTimeout(() => setMsg(''), 2500)
    } catch (e) {
      setMsg(e.message)
    }
  }

  if (!reqs) return <Loading error={msg} onRetry={load} />
  const pending = reqs.filter((r) => r.status === 'pending')
  const resolved = reqs.filter((r) => r.status !== 'pending')

  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <Metrics
        items={[
          ['Awaiting review', pending.length],
          ['Approved', resolved.filter((r) => r.status === 'approved').length],
          ['Declined', resolved.filter((r) => r.status === 'declined').length],
        ]}
      />
      <p className="co-description">
        Approve access for an organization’s event, add message credits, or
        record a declined request.
      </p>
      <h3 className="co-section-title">Needs a decision</h3>
      {!pending.length && (
        <Empty title="No pending requests">
          New trial requests will appear here.
        </Empty>
      )}
      {pending.map((r) => {
        const org = orgs.find((o) => o.id === r.org_id)
        return (
          <TrialRow
            key={r.id}
            req={r}
            events={org?.events || []}
            plans={plans}
            onResolve={resolve}
          />
        )
      })}
      <Panel
        title="Decision history"
        description={`${resolved.length} resolved requests`}
      >
        <div className="co-timeline">
          {resolved.map((r) => (
            <article className="co-timeline-entry" key={r.id}>
              <div>
                <h4>{r.org_name}</h4>
                <p>
                  {r.event_name || 'Event not specified'} · {r.contact_name}
                </p>
                {r.resolution_note && <p>“{r.resolution_note}”</p>}
              </div>
              <Badge tone={r.status === 'approved' ? 'good' : ''}>
                {r.status}
              </Badge>
            </article>
          ))}
        </div>
        {!resolved.length && (
          <p className="co-muted">Resolved requests will appear here.</p>
        )}
      </Panel>
    </div>
  )
}
function TrialRow({ req, events, plans, onResolve }) {
  const [eventId, setEventId] = useState('')
  const [tier, setTier] = useState('')
  const [credits, setCredits] = useState('')
  const [note, setNote] = useState('')
  return (
    <Panel
      title={req.org_name}
      eyebrow="TRIAL REQUEST"
      description={req.requester_email}
      actions={<Badge tone="warn">Awaiting review</Badge>}
    >
      <div className="co-stack">
        <dl className="co-facts">
          <div>
            <dt>Contact</dt>
            <dd>{req.contact_name}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{req.phone || 'Not provided'}</dd>
          </div>
          <div>
            <dt>Expected guests</dt>
            <dd>{req.guest_count ?? 'Not provided'}</dd>
          </div>
        </dl>
        <div className="co-inset">
          <strong>{req.event_name || 'Event not specified'}</strong>
          <p className="co-description">
            {req.use_case || 'No additional requirements provided.'}
          </p>
        </div>
        <div className="co-fields">
          <Field label="Apply to event">
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">
                {events.length ? 'Their next event' : 'No events yet'}
              </option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.is_paid ? ' (paid)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Event plan">
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">No plan grant</option>
              {plans.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label || p.key}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Additional credits">
            <input
              type="number"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>
        <Field label="Decision note">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context for this decision"
          />
        </Field>
        <div className="co-actions">
          <button
            className="co-button primary"
            onClick={() =>
              onResolve(req.id, {
                action: 'approve',
                event_id: eventId || undefined,
                tier: tier || undefined,
                add_credits: credits ? Number(credits) : undefined,
                note: note || undefined,
              })
            }
          >
            Approve trial
          </button>
          <button
            className="co-button"
            onClick={() =>
              onResolve(req.id, { action: 'decline', note: note || undefined })
            }
          >
            Decline request
          </button>
        </div>
      </div>
    </Panel>
  )
}
// ── QA checklist: submissions from the standalone staging checklist page ────
const QA_STATUS_STYLE = {
  pass: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  issue: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  blocked:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  na: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300',
}
const QA_STATUS_LABEL = {
  pass: 'Pass',
  issue: 'Issue',
  blocked: 'Blocked',
  na: 'N/A',
}

function QaChecklistCounts({ row }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {row.pass_count > 0 && (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${QA_STATUS_STYLE.pass}`}
        >
          {row.pass_count} pass
        </span>
      )}
      {row.issue_count > 0 && (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${QA_STATUS_STYLE.issue}`}
        >
          {row.issue_count} issue
        </span>
      )}
      {row.blocked_count > 0 && (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${QA_STATUS_STYLE.blocked}`}
        >
          {row.blocked_count} blocked
        </span>
      )}
      {row.na_count > 0 && (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${QA_STATUS_STYLE.na}`}
        >
          {row.na_count} n/a
        </span>
      )}
    </div>
  )
}

function QaChecklistDetail({ id, onClose }) {
  const [detail, setDetail] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let active = true
    setDetail(null)
    setErr('')
    api
      .qaChecklistSubmission(id)
      .then((data) => {
        if (active) setDetail(data)
      })
      .catch((e) => {
        if (active) setErr(e.message)
      })
    return () => {
      active = false
    }
  }, [id])
  if (err || !detail)
    return (
      <Dialog title="Review QA submission" onClose={onClose}>
        <Loading
          error={err}
          onRetry={() => {
            setErr('')
            api
              .qaChecklistSubmission(id)
              .then(setDetail)
              .catch((e) => setErr(e.message))
          }}
        />
      </Dialog>
    )

  const bySection = []
  const seen = new Map()
  for (const item of detail.results) {
    let group = seen.get(item.section_id)
    if (!group) {
      group = {
        section_id: item.section_id,
        section_title: item.section_title || item.section_id,
        items: [],
      }
      seen.set(item.section_id, group)
      bySection.push(group)
    }
    group.items.push(item)
  }

  return (
    <Dialog title={detail.tester_name} onClose={onClose}>
      <p className="co-description">
        {new Date(detail.created_at).toLocaleString()} · {detail.summary}
      </p>
      {bySection.map((group) => (
        <Panel title={group.section_title} key={group.section_id}>
          <div className="co-stack">
            {group.items.map((it) => (
              <article className="co-person" key={it.case_id}>
                <div className="co-toolbar">
                  <strong>{it.case_title || it.case_id}</strong>
                  <Badge
                    tone={
                      it.status === 'issue'
                        ? 'danger'
                        : it.status === 'blocked'
                          ? 'warn'
                          : it.status === 'pass'
                            ? 'good'
                            : ''
                    }
                  >
                    {QA_STATUS_LABEL[it.status] || it.status}
                  </Badge>
                </div>
                {it.note && (
                  <p
                    className="co-description"
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {it.note}
                  </p>
                )}
                {it.evidence && (
                  <p className="co-muted" style={{ overflowWrap: 'anywhere' }}>
                    {it.evidence}
                  </p>
                )}
              </article>
            ))}
          </div>
        </Panel>
      ))}
    </Dialog>
  )
}
function QaChecklistTab() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    api
      .qaChecklistSubmissions()
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [])

  if (!rows)
    return (
      <Loading
        error={err}
        onRetry={() =>
          api
            .qaChecklistSubmissions()
            .then(setRows)
            .catch((e) => setErr(e.message))
        }
      />
    )

  return (
    <div className="co-stack">
      <Metrics
        items={[
          ['Submissions', rows.length],
          [
            'Issues reported',
            rows.reduce((n, r) => n + (r.issue_count || 0), 0),
          ],
          [
            'Blocked checks',
            rows.reduce((n, r) => n + (r.blocked_count || 0), 0),
          ],
        ]}
      />
      <p className="co-description">
        Open a submission to review its test cases, notes and evidence.
        Submissions come from the shared QA checklist.
      </p>
      <div className="co-grid">
        {rows.map((r) => (
          <button
            className="co-quality-card"
            key={r.id}
            onClick={() => setOpenId(r.id)}
          >
            <div className="co-toolbar">
              <h4>{r.tester_name}</h4>
              <Badge
                tone={
                  r.issue_count ? 'danger' : r.blocked_count ? 'warn' : 'good'
                }
              >
                {r.issue_count
                  ? 'Issues reported'
                  : r.blocked_count
                    ? 'Checks blocked'
                    : 'Reviewed'}
              </Badge>
            </div>
            <p>
              {date(r.created_at)} · {r.tested_count} checks completed
            </p>
            <QaChecklistCounts row={r} />
            <small>Review submission ↗</small>
          </button>
        ))}
      </div>
      {!rows.length && (
        <Empty title="No QA submissions yet">
          Completed checklist submissions will appear here for review.
        </Empty>
      )}
      {openId && (
        <QaChecklistDetail id={openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}
// ── Pricing: edit plans ─────────────────────────────────────────────────────
// Channel weight editor shared by the global-default and per-org-override
// panels below. `rows` = [{channel, credits_per_unit, is_override, effective_rate?}].
// `onSave(channel, value)` / `onClear(channel)` (onClear omitted for the
// global panel — there's nothing to "clear" back to, it IS the default).
function CreditRateTable({ rows, onSave, onClear, msg }) {
  const [drafts, setDrafts] = useState({})
  function draftFor(row) {
    return drafts[row.channel] ?? row.credits_per_unit ?? ''
  }
  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <div className="co-grid">
        {rows.map((row) => (
          <section
            className="co-rate"
            key={row.channel}
            aria-label={`${row.channel} credit rate`}
          >
            <div className="co-toolbar">
              <h4>
                {row.channel === 'whatsapp'
                  ? 'WhatsApp'
                  : row.channel.toUpperCase()}
              </h4>
              <Badge tone={row.is_override ? 'purple' : ''}>
                {onClear
                  ? row.is_override
                    ? 'Organization override'
                    : 'Global rate'
                  : 'Platform default'}
              </Badge>
            </div>
            <Field
              label="Credits per unit"
              hint={
                onClear
                  ? `Effective rate: ${row.effective_rate}${row.is_override ? '' : ' · inherited'}`
                  : 'Positive values only. Fractions are supported.'
              }
            >
              <input
                inputMode="decimal"
                value={draftFor(row)}
                placeholder={onClear ? 'Inherits global' : ''}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [row.channel]: e.target.value,
                  }))
                }
              />
            </Field>
            <div className="co-actions">
              <button
                className="co-button primary"
                disabled={!draftFor(row) || Number(draftFor(row)) <= 0}
                onClick={() => onSave(row.channel, Number(draftFor(row)))}
              >
                Save rate
              </button>
              {onClear && row.is_override && (
                <button
                  className="co-button"
                  onClick={() => onClear(row.channel)}
                >
                  Use global rate
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      {!rows.length && <Empty title="No rates configured" />}
    </div>
  )
}
// Global default credit weight per messaging channel — what every org pays
// unless it has its own override (see OrgCreditRatesPanel below). Replaces
// the old MESSAGE_CREDIT_WEIGHTS env var, which needed a redeploy to change.
function GlobalCreditRatesPanel() {
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState('')
  function load() {
    api
      .adminListGlobalCreditRates()
      .then(setRows)
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
  }, [])

  async function save(channel, value) {
    setMsg('')
    try {
      await api.adminSaveGlobalCreditRate(channel, value)
      setMsg(`Saved ${channel}.`)
      setTimeout(() => setMsg(''), 2500)
      load()
    } catch (e) {
      setMsg(e.message)
    }
  }

  if (!rows) return <Loading error={msg} onRetry={load} />
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Credits charged per send, by channel — applies to every org unless
        overridden below. Can be a fraction (e.g. 0.1 = 10 emails per credit) or
        1+ (e.g. 3 = 3 credits per MMS). Organization overrides take precedence
        over these default rates.
      </p>
      <CreditRateTable rows={rows} onSave={save} msg={msg} />
    </div>
  )
}

// Per-org negotiated credit rate override — for deals struck outside the
// standard pricing. Only channels with an explicit override row differ from
// the global default; everything else falls through automatically.
function OrgCreditRatesPanel() {
  const [orgs, setOrgs] = useState(null)
  const [orgId, setOrgId] = useState('')
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api
      .adminListAccounts()
      .then(setOrgs)
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!orgId) {
      setRows(null)
      return
    }
    api
      .adminListOrgCreditRates(orgId)
      .then(setRows)
      .catch((e) => setMsg(e.message))
  }, [orgId])

  async function save(channel, value) {
    setMsg('')
    try {
      await api.adminSaveOrgCreditRate(orgId, channel, value)
      setMsg(`Saved ${channel} override.`)
      setTimeout(() => setMsg(''), 2500)
      api.adminListOrgCreditRates(orgId).then(setRows)
    } catch (e) {
      setMsg(e.message)
    }
  }

  async function clear(channel) {
    setMsg('')
    try {
      await api.adminDeleteOrgCreditRate(orgId, channel)
      setMsg(`Cleared ${channel} override — back to global default.`)
      setTimeout(() => setMsg(''), 2500)
      api.adminListOrgCreditRates(orgId).then(setRows)
    } catch (e) {
      setMsg(e.message)
    }
  }

  return (
    <div className="co-stack">
      <Field label="Organization for negotiated rates">
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">Choose an organization</option>
          {(orgs || []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      {orgId ? (
        rows ? (
          <CreditRateTable
            rows={rows}
            onSave={save}
            onClear={clear}
            msg={msg}
          />
        ) : (
          <Loading error={msg} />
        )
      ) : (
        <p className="co-muted">
          Select an organization to review its effective rates and overrides.
        </p>
      )}
    </div>
  )
}
function PricingTab() {
  const [plans, setPlans] = useState(null)
  const [platformSettings, setPlatformSettings] = useState(null)
  const [msg, setMsg] = useState('')
  function load() {
    api
      .adminListPlans()
      .then(setPlans)
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
    api
      .platformSettings()
      .then(setPlatformSettings)
      .catch((e) => setMsg(e.message))
  }, [])

  async function save(p) {
    setMsg('')
    try {
      await api.adminSavePlan(p.key, {
        kind: p.kind,
        label: p.label,
        guest_cap:
          p.guest_cap === '' || p.guest_cap == null
            ? null
            : Number(p.guest_cap),
        credits: Number(p.credits),
        usd: Number(p.usd),
        ngn: Number(p.ngn),
        active: !!p.active,
        sort_order: Number(p.sort_order),
      })
      setMsg(`Saved ${p.key}.`)
      setTimeout(() => setMsg(''), 2500)
    } catch (e) {
      setMsg(e.message)
    }
  }
  async function setAllAddons(active) {
    setMsg('')
    try {
      const addons = plans.filter((plan) => plan.kind === 'addon')
      await api.adminSetAddonPolicy(
        Object.fromEntries(addons.map((plan) => [plan.key, active])),
      )
      setPlans((current) =>
        current.map((plan) =>
          plan.kind === 'addon' ? { ...plan, active } : plan,
        ),
      )
      setMsg(`All add-ons ${active ? 'allowed' : 'disallowed'} globally.`)
    } catch (e) {
      setMsg(e.message)
    }
  }
  async function openAddonPromotion() {
    setMsg('')
    try {
      const until = new Date()
      until.setMonth(until.getMonth() + 6)
      const updated = await api.updatePlatformSettings({
        addon_promo_until: until.toISOString(),
      })
      setPlatformSettings(updated)
      setMsg(
        `All add-ons are open for paid events until ${new Date(updated.addon_promo_until).toLocaleString()}.`,
      )
    } catch (e) {
      setMsg(e.message)
    }
  }
  async function endAddonPromotion() {
    setMsg('')
    try {
      const updated = await api.updatePlatformSettings({
        clear_addon_promo: true,
      })
      setPlatformSettings(updated)
      setMsg('The global add-on promotion has ended.')
    } catch (e) {
      setMsg(e.message)
    }
  }
  function edit(i, k, v) {
    setPlans((prev) => prev.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)))
  }

  if (!plans) return <Loading error={msg} onRetry={load} />
  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <Panel
        title="Plan catalog"
        eyebrow="EVENT PRICING"
        description="Choose a plan to edit its pricing and entitlement settings. Amounts are saved in USD cents and NGN kobo."
      >
        <div className="co-grid">
          {plans.map((p, i) => (
            <details className="co-editor" key={p.key}>
              <summary>
                <div>
                  <div className="co-actions">
                    <Badge tone={p.kind === 'addon' ? 'purple' : ''}>
                      {p.kind}
                    </Badge>
                    <Badge tone={p.active ? 'good' : ''}>
                      {p.active ? 'Available' : 'Hidden'}
                    </Badge>
                  </div>
                  <h3>{p.label || p.key}</h3>
                  <span className="co-editor-key">{p.key}</span>
                  <p className="co-editor-price">
                    {money(p.usd)}{' '}
                    <small className="co-muted">/ {money(p.ngn, 'NGN')}</small>
                  </p>
                  <span className="co-muted">
                    {p.guest_cap == null
                      ? 'No guest cap'
                      : `${number(p.guest_cap)} guests`}{' '}
                    · {number(p.credits)} credits
                  </span>
                </div>
              </summary>
              <div className="co-editor-body">
                <div className="co-fields">
                  <Field label="Display name">
                    <input
                      value={p.label}
                      onChange={(e) => edit(i, 'label', e.target.value)}
                    />
                  </Field>
                  <Field label="Guest cap" hint="Leave blank for no cap.">
                    <input
                      type="number"
                      value={p.guest_cap ?? ''}
                      onChange={(e) => edit(i, 'guest_cap', e.target.value)}
                    />
                  </Field>
                  <Field label="Included credits">
                    <input
                      type="number"
                      value={p.credits}
                      onChange={(e) => edit(i, 'credits', e.target.value)}
                    />
                  </Field>
                  <Field label="Display order">
                    <input
                      type="number"
                      value={p.sort_order}
                      onChange={(e) => edit(i, 'sort_order', e.target.value)}
                    />
                  </Field>
                  <Field label="USD price · cents">
                    <input
                      type="number"
                      value={p.usd}
                      onChange={(e) => edit(i, 'usd', e.target.value)}
                    />
                  </Field>
                  <Field label="NGN price · kobo">
                    <input
                      type="number"
                      value={p.ngn}
                      onChange={(e) => edit(i, 'ngn', e.target.value)}
                    />
                  </Field>
                </div>
                <label className="co-check">
                  <input
                    type="checkbox"
                    checked={!!p.active}
                    onChange={(e) => edit(i, 'active', e.target.checked)}
                  />
                  Available for purchase
                </label>
                <div className="co-actions">
                  <button className="co-button primary" onClick={() => save(p)}>
                    Save plan
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
        {!plans.length && <Empty title="No event plans configured" />}
      </Panel>
      <Panel
        title="Add-on availability"
        description="These controls affect all organizations. Explicit organization and event disallows continue to take precedence."
        className="co-accent"
      >
        <div className="co-actions">
          <button className="co-button" onClick={() => setAllAddons(true)}>
            Allow all add-ons globally
          </button>
          <button
            className="co-button danger"
            onClick={() => setAllAddons(false)}
          >
            Disallow all add-ons globally
          </button>
        </div>
        <details className="co-disclosure">
          <summary>Paid-event promotion</summary>
          <div className="co-stack">
            <p className="co-description">
              Open every add-on at no charge for current and future paid events.
              Free events remain excluded.
            </p>
            <Badge
              tone={
                platformSettings?.addon_promo_until &&
                new Date(platformSettings.addon_promo_until) > new Date()
                  ? 'good'
                  : ''
              }
            >
              {platformSettings?.addon_promo_until &&
              new Date(platformSettings.addon_promo_until) > new Date()
                ? `Active until ${new Date(platformSettings.addon_promo_until).toLocaleString()}`
                : 'Not active'}
            </Badge>
            <div className="co-actions">
              <button
                className="co-button primary"
                onClick={openAddonPromotion}
              >
                Open paid-event add-ons for 6 months
              </button>
              <button className="co-button danger" onClick={endAddonPromotion}>
                End promotion now
              </button>
            </div>
          </div>
        </details>
      </Panel>
      <Panel
        title="Platform messaging rates"
        description="Default credits charged for each messaging channel."
      >
        <GlobalCreditRatesPanel />
      </Panel>
      <Panel
        title="Organization messaging rates"
        description="Set negotiated rates for an organization. Other channels continue to use platform defaults."
      >
        <OrgCreditRatesPanel />
      </Panel>
    </div>
  )
}
// ── Org Plans: org-level recurring subscription catalog (gates org-wide paid
// features, e.g. read-write API access) — separate from the per-event Pricing
// tab above. Mirrors its shape; adds a "+ Add plan" button since there's no
// other way to create the first row through the UI.
function OrgPlansTab() {
  const [plans, setPlans] = useState(null)
  const [msg, setMsg] = useState('')
  const [newKey, setNewKey] = useState('')
  function load() {
    api
      .adminListOrgPlans()
      .then(setPlans)
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
  }, [])

  async function save(p) {
    setMsg('')
    try {
      await api.adminSaveOrgPlan(p.key, {
        label: p.label,
        usd_monthly: Number(p.usd_monthly),
        ngn_monthly: Number(p.ngn_monthly),
        features:
          typeof p.features === 'string'
            ? p.features
                .split(',')
                .map((f) => f.trim())
                .filter(Boolean)
            : p.features,
        active: !!p.active,
        sort_order: Number(p.sort_order),
      })
      setMsg(`Saved ${p.key}.`)
      setTimeout(() => setMsg(''), 2500)
      load()
    } catch (e) {
      setMsg(e.message)
    }
  }

  async function remove(key) {
    if (
      !confirm(
        `Delete plan "${key}"? Orgs currently on it keep their status, but it won't be offered again.`,
      )
    )
      return
    setMsg('')
    try {
      await api.adminDeleteOrgPlan(key)
      load()
    } catch (e) {
      setMsg(e.message)
    }
  }

  function edit(i, k, v) {
    setPlans((prev) => prev.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)))
  }

  function addPlan() {
    const key = newKey
    if (!key || !key.trim()) return
    if (plans.some((plan) => plan.key === key.trim())) {
      setMsg('A plan with this key is already listed.')
      return
    }
    setNewKey('')
    setPlans((prev) => [
      ...(prev || []),
      {
        key: key.trim(),
        label: 'New plan',
        usd_monthly: 0,
        ngn_monthly: 0,
        features: [],
        active: true,
        sort_order: (prev?.length || 0) + 1,
      },
    ])
  }

  if (!plans) return <Loading error={msg} onRetry={load} />
  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <Panel
        title="Create an organization plan"
        description="Recurring organization subscriptions are separate from per-event plans."
      >
        <div className="co-fields">
          <Field
            label="New plan key"
            hint="A unique identifier, for example api_access."
          >
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="api_access"
            />
          </Field>
          <div className="co-actions">
            <button
              className="co-button primary"
              disabled={!newKey.trim()}
              onClick={addPlan}
            >
              Create plan draft
            </button>
          </div>
        </div>
      </Panel>
      <div className="co-grid">
        {plans.map((p, i) => (
          <details key={p.key} className="co-editor">
            <summary>
              <div>
                <Badge tone={p.active ? 'good' : ''}>
                  {p.active ? 'Available' : 'Hidden'}
                </Badge>
                <h3>{p.label || p.key}</h3>
                <span className="co-editor-key">{p.key}</span>
                <p className="co-editor-price">
                  {money(p.usd_monthly)}{' '}
                  <small className="co-muted">/ month</small>
                </p>
                <p className="co-muted">
                  {money(p.ngn_monthly, 'NGN')} / month
                </p>
                <div className="co-actions">
                  {(Array.isArray(p.features)
                    ? p.features
                    : String(p.features || '')
                        .split(',')
                        .filter(Boolean)
                  ).map((feature) => (
                    <Badge key={feature}>{feature}</Badge>
                  ))}
                </div>
              </div>
            </summary>
            <div className="co-editor-body">
              <div className="co-fields">
                <Field label="Plan name">
                  <input
                    value={p.label}
                    onChange={(e) => edit(i, 'label', e.target.value)}
                  />
                </Field>
                <Field label="Display order">
                  <input
                    type="number"
                    value={p.sort_order}
                    onChange={(e) => edit(i, 'sort_order', e.target.value)}
                  />
                </Field>
                <Field label="Monthly USD · cents">
                  <input
                    type="number"
                    value={p.usd_monthly}
                    onChange={(e) => edit(i, 'usd_monthly', e.target.value)}
                  />
                </Field>
                <Field label="Monthly NGN · kobo">
                  <input
                    type="number"
                    value={p.ngn_monthly}
                    onChange={(e) => edit(i, 'ngn_monthly', e.target.value)}
                  />
                </Field>
              </div>
              <Field
                label="Feature keys"
                hint="Comma-separated keys used by feature gates, for example api_write."
              >
                <textarea
                  value={
                    Array.isArray(p.features)
                      ? p.features.join(', ')
                      : p.features
                  }
                  onChange={(e) => edit(i, 'features', e.target.value)}
                />
              </Field>
              <label className="co-check">
                <input
                  type="checkbox"
                  checked={!!p.active}
                  onChange={(e) => edit(i, 'active', e.target.checked)}
                />
                Available to organizations
              </label>
              <div className="co-actions">
                <button className="co-button primary" onClick={() => save(p)}>
                  Save organization plan
                </button>
                <button
                  className="co-button danger"
                  onClick={() => remove(p.key)}
                >
                  Delete plan
                </button>
              </div>
            </div>
          </details>
        ))}
      </div>
      {!plans.length && (
        <Empty title="Build your first organization plan">
          Create a draft above, configure its prices and features, then save.
        </Empty>
      )}
    </div>
  )
}
// ── Affiliate stores: rewrite registry Buy links with your affiliate tag ──────
function AffiliateStoresTab() {
  const [stores, setStores] = useState(null)
  const [draft, setDraft] = useState({
    domain: '',
    label: '',
    param_key: '',
    param_value: '',
    active: true,
    sort_order: 0,
  })
  const [msg, setMsg] = useState('')
  function load() {
    api
      .adminListAffiliateStores()
      .then(setStores)
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
  }, [])

  const inp =
    'border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white'

  async function save(s) {
    setMsg('')
    try {
      await api.adminUpdateAffiliateStore(s.id, {
        domain: s.domain,
        label: s.label,
        param_key: s.param_key,
        param_value: s.param_value,
        active: !!s.active,
        sort_order: Number(s.sort_order) || 0,
      })
      setMsg(`Saved ${s.domain}.`)
      setTimeout(() => setMsg(''), 2500)
    } catch (e) {
      setMsg(e.message)
    }
  }
  async function add() {
    if (!draft.domain.trim() || !draft.param_key.trim()) {
      setMsg('Domain and param key are required.')
      return
    }
    setMsg('')
    try {
      await api.adminCreateAffiliateStore({
        ...draft,
        sort_order: Number(draft.sort_order) || 0,
      })
      setDraft({
        domain: '',
        label: '',
        param_key: '',
        param_value: '',
        active: true,
        sort_order: 0,
      })
      load()
    } catch (e) {
      setMsg(e.message)
    }
  }
  async function remove(id) {
    if (!confirm('Delete this affiliate store?')) return
    try {
      await api.adminDeleteAffiliateStore(id)
      load()
    } catch (e) {
      setMsg(e.message)
    }
  }
  function edit(i, k, v) {
    setStores((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)),
    )
  }

  if (!stores) return <Loading error={msg} onRetry={load} />
  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <div className="co-grid">
        {stores.map((s, i) => (
          <details className="co-editor" key={s.id}>
            <summary>
              <div>
                <Badge tone={s.active ? 'good' : ''}>
                  {s.active ? 'Enabled' : 'Disabled'}
                </Badge>
                <h3>{s.label || s.domain}</h3>
                <p className="co-description">{s.domain}</p>
                <span className="co-editor-key">
                  {s.param_key}={s.param_value}
                </span>
              </div>
            </summary>
            <div className="co-editor-body">
              <div className="co-fields">
                {[
                  ['domain', 'Store domain'],
                  ['label', 'Display name'],
                  ['param_key', 'Tracking parameter'],
                  ['param_value', 'Affiliate tag'],
                ].map(([key, label]) => (
                  <Field label={label} key={key}>
                    <input
                      value={s[key]}
                      onChange={(e) => edit(i, key, e.target.value)}
                    />
                  </Field>
                ))}
                <Field label="Display order">
                  <input
                    type="number"
                    value={s.sort_order}
                    onChange={(e) => edit(i, 'sort_order', e.target.value)}
                  />
                </Field>
              </div>
              <label className="co-check">
                <input
                  type="checkbox"
                  checked={!!s.active}
                  onChange={(e) => edit(i, 'active', e.target.checked)}
                />
                Apply affiliate tag to matching Buy links
              </label>
              <div className="co-actions">
                <button className="co-button primary" onClick={() => save(s)}>
                  Save store
                </button>
                <button
                  className="co-button danger"
                  onClick={() => remove(s.id)}
                >
                  Delete store
                </button>
              </div>
            </div>
          </details>
        ))}
      </div>
      {!stores.length && (
        <Empty title="No affiliate stores yet">
          Add a store to apply your affiliate tag to matching registry Buy
          links.
        </Empty>
      )}
      <Panel
        title="Add an affiliate store"
        description="Matching registry Buy links receive the tracking parameter and tag configured here."
        eyebrow="NEW CONNECTION"
      >
        <div className="co-stack">
          <div className="co-fields">
            {[
              ['domain', 'Store domain', 'amazon.com'],
              ['label', 'Display name', 'Amazon US'],
              ['param_key', 'Tracking parameter', 'tag'],
              ['param_value', 'Affiliate tag', 'yourtag-20'],
            ].map(([key, label, placeholder]) => (
              <Field key={key} label={label}>
                <input
                  value={draft[key]}
                  placeholder={placeholder}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [key]: e.target.value }))
                  }
                />
              </Field>
            ))}
            <Field label="Display order">
              <input
                type="number"
                value={draft.sort_order}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, sort_order: e.target.value }))
                }
              />
            </Field>
          </div>
          <label className="co-check">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) =>
                setDraft((d) => ({ ...d, active: e.target.checked }))
              }
            />
            Enable this store
          </label>
          <div>
            <button className="co-button primary" onClick={add}>
              Add store
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
// ── Operators ───────────────────────────────────────────────────────────────
// ── Support chat: kill switch for the Chatwoot widget across the whole app ──
function SupportChatTab() {
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  function load() {
    api
      .platformSettings()
      .then(setSettings)
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
  }, [])

  async function toggle() {
    if (!settings) return
    const next = !settings.support_chat_enabled
    setBusy(true)
    setMsg('')
    try {
      const updated = await api.updatePlatformSettings({
        support_chat_enabled: next,
      })
      setSettings(updated)
      setMsg(
        next
          ? 'Support chat is now visible to organizers.'
          : 'Support chat is now hidden.',
      )
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <Loading error={msg} onRetry={load} />
  const on = settings.support_chat_enabled

  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <div className="co-grid">
        <Panel
          title="Organizer support"
          eyebrow="CHAT VISIBILITY"
          description="Choose whether the support widget appears for logged-in organizers."
          actions={
            <Badge tone={on ? 'good' : ''}>{on ? 'Visible' : 'Hidden'}</Badge>
          }
        >
          <div className="co-stack">
            <div className="co-toolbar">
              <div>
                <strong>Show support chat</strong>
                <p className="co-description">
                  Applies across organizer workspaces.
                </p>
              </div>
              <button
                className="co-switch"
                role="switch"
                aria-label="Show organizer support chat"
                aria-checked={on}
                disabled={busy}
                onClick={toggle}
              >
                <span />
              </button>
            </div>
            <div className="co-inset">
              <p className="co-description">
                This controls widget visibility. The connected Chatwoot inbox
                and website token must also be configured before organizers can
                start a conversation.
              </p>
            </div>
          </div>
        </Panel>
        <div className="co-support-preview">
          <div>
            <span className="co-eyebrow">WIDGET PREVIEW</span>
            <h4>
              A little help.
              <br />
              Right where it’s needed.
            </h4>
            <p>
              {on
                ? 'The support entry point is enabled for organizers.'
                : 'The support entry point is currently hidden.'}
            </p>
          </div>
          <span className="co-support-bubble">
            {on ? '◌ Support' : 'Support is hidden'}
          </span>
        </div>
      </div>
    </div>
  )
}
// ── Referrals: platform-wide view of the partner referral program ──────────
function ReferralsTab() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api
      .adminAllReferrals()
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [])

  if (!rows)
    return (
      <Loading
        error={err}
        onRetry={() =>
          api
            .adminAllReferrals()
            .then(setRows)
            .catch((e) => setErr(e.message))
        }
      />
    )

  const byReferrer = {}
  for (const r of rows) {
    const key = r.referrer_code || '—'
    byReferrer[key] = byReferrer[key] || {
      name: r.referrer_name,
      referred: 0,
      converted: 0,
    }
    byReferrer[key].referred += 1
    if (r.converted) byReferrer[key].converted += 1
  }

  return (
    <div className="co-stack">
      <Metrics
        items={[
          ['Referral partners', Object.keys(byReferrer).length],
          ['Organizations referred', rows.length],
          ['Converted', rows.filter((r) => r.converted).length],
        ]}
      />
      <Panel
        title="Partner contribution"
        description="Referrals grouped by the partner who introduced each organization."
      >
        <div className="co-grid">
          {Object.entries(byReferrer).map(([code, v]) => (
            <article className="co-person" key={code}>
              <div className="co-toolbar">
                <div className="co-identity">
                  <span className="co-avatar">
                    {v.name?.slice(0, 1) || 'P'}
                  </span>
                  <div>
                    <strong>{v.name}</strong>
                    <small>{code}</small>
                  </div>
                </div>
                <Badge tone="good">{v.converted} converted</Badge>
              </div>
              <div className="co-channel">
                <span>{v.referred} referred</span>
                <span aria-hidden="true" className="co-channel-track">
                  <i
                    style={{
                      width: `${(v.converted / Math.max(v.referred, 1)) * 100}%`,
                    }}
                  />
                </span>
                <strong>
                  {Math.round((v.converted / Math.max(v.referred, 1)) * 100)}%
                </strong>
              </div>
            </article>
          ))}
        </div>
        {!rows.length && <Empty title="No referrals recorded" />}
      </Panel>
      <Panel
        title="Referred organizations"
        description="The organizations behind your referral activity."
      >
        <div className="co-timeline">
          {rows.map((r, i) => (
            <article className="co-timeline-entry" key={i}>
              <span className="co-avatar">{r.org_name.slice(0, 1)}</span>
              <div>
                <h4>{r.org_name}</h4>
                <p>Joined {date(r.org_created_at)}</p>
                <p>
                  Referred by {r.referrer_name} · {r.referrer_code}
                </p>
              </div>
              <Badge tone={r.converted ? 'good' : ''}>
                {r.converted ? 'Converted' : 'Signed up'}
              </Badge>
            </article>
          ))}
        </div>
        {!rows.length && (
          <p className="co-muted">
            New referred organizations will appear here.
          </p>
        )}
      </Panel>
    </div>
  )
}
function OperatorsTab({ me }) {
  const [ops, setOps] = useState(null)
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  function load() {
    api
      .adminListOperators()
      .then(setOps)
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
  }, [])

  async function add() {
    if (!email.trim()) return
    setMsg('')
    try {
      await api.adminAddOperator(email.trim())
      setEmail('')
      load()
      setMsg('Operator added.')
    } catch (e) {
      setMsg(e.message)
    }
  }
  async function remove(id) {
    if (!confirm('Revoke operator access?')) return
    try {
      await api.adminRemoveOperator(id)
      load()
    } catch (e) {
      setMsg(e.message)
    }
  }

  if (!ops) return <Loading error={msg} onRetry={load} />
  return (
    <div className="co-stack">
      <Notice>{msg}</Notice>
      <Panel
        title="Grant platform access"
        description="Platform operators can administer organizations across Festio. Add the email address of the account you want to authorize."
      >
        <div className="co-fields">
          <Field label="Operator email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@example.com"
            />
          </Field>
          <div className="co-actions">
            <button
              className="co-button primary"
              disabled={!email.trim()}
              onClick={add}
            >
              Grant operator access
            </button>
          </div>
        </div>
      </Panel>
      <div className="co-grid">
        {ops.map((u) => (
          <Panel
            key={u.id}
            title={u.name}
            eyebrow="PLATFORM OPERATOR"
            actions={
              <Badge tone="purple">
                {u.id === me?.id ? 'Your account' : 'Operator'}
              </Badge>
            }
          >
            <div className="co-stack">
              <div className="co-identity">
                <span className="co-avatar">
                  {(u.name || u.email || '?').slice(0, 1)}
                </span>
                <div>
                  <strong>{u.name}</strong>
                  <small>{u.email}</small>
                </div>
              </div>
              {u.id !== me?.id ? (
                <div>
                  <button
                    className="co-button danger"
                    onClick={() => remove(u.id)}
                  >
                    Revoke operator access
                  </button>
                </div>
              ) : (
                <p className="co-muted">
                  You cannot revoke your own operator access here.
                </p>
              )}
            </div>
          </Panel>
        ))}
      </div>
      {!ops.length && <Empty title="No platform operators listed" />}
    </div>
  )
}
export default function ConsolePage({ operations = false }) {
  const { user } = useAuth()
  const [legacyTab, setTab] = useState('overview')
  const [params] = useSearchParams()
  const tab = operations
    ? operationsSection(params.get('section')).id
    : legacyTab
  if (user === undefined) return null
  if (!user?.is_platform_superadmin) return <Navigate to="/" replace />

  const content = (
    <>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'accounts' && <AccountsTab me={user} />}
      {tab === 'usage' && <UsageTab />}
      {tab === 'trials' && <TrialsTab />}
      {tab === 'qa' && <QaChecklistTab />}
      {tab === 'support' && <SupportChatTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'pricing' && <PricingTab />}
      {tab === 'addon-access' && <OrgAddonAccessTab />}
      {tab === 'org-plans' && <OrgPlansTab />}
      {tab === 'affiliates' && <AffiliateStoresTab />}
      {tab === 'operators' && <OperatorsTab me={user} />}
    </>
  )
  if (operations)
    return <PlatformOperations active={tab}>{content}</PlatformOperations>
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold dark:text-white">Operator Console</h1>
        <Link
          to="/marketing"
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white"
        >
          Open Marketing
        </Link>
      </div>
      <div className="flex gap-2 border-b dark:border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === t.id ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-transparent text-slate-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {content}
    </div>
  )
}
