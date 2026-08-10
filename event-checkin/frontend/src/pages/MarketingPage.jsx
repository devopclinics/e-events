import { Component, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import "./MarketingPage.css";
import "./MarketingReadable.css";

const MODULE_TABS = [
  ["segments", "Segments"],
  ["sequences", "Follow-ups"],
  ["campaigns", "Campaigns"],
  ["content", "Content calendar"],
  ["referrals", "Referrals"],
  ["tasks", "Tasks"],
  ["experiments", "Experiments"],
  ["forms", "Lead forms"],
];
const STAGES = [
  "registered",
  "event_created",
  "activated",
  "qualified",
  "demo_booked",
  "paid",
  "customer",
  "inactive",
  "lost",
];
const MODULE_META = {
  segments: [
    "Audience intelligence",
    "Build precise audiences from lifecycle, intent, consent, and event behavior.",
  ],
  sequences: [
    "Journey automation",
    "Design thoughtful follow-ups that move organizers forward without losing the human voice.",
  ],
  campaigns: [
    "Campaign studio",
    "Plan coordinated launches across email, social, partnerships, and product moments.",
  ],
  content: [
    "Editorial calendar",
    "Shape a consistent publishing rhythm for education, product stories, and customer proof.",
  ],
  referrals: [
    "Referral engine",
    "Turn happy organizers and trusted partners into a measurable growth channel.",
  ],
  tasks: [
    "Growth operations",
    "Keep every follow-up, review, and launch commitment visible and owned.",
  ],
  experiments: [
    "Experiment lab",
    "Test positioning, calls to action, and journeys with a clear success metric.",
  ],
  forms: [
    "Lead capture forms",
    "Create CAPTCHA-protected forms for landing pages and partner sites.",
  ],
};

function SectionIntro({
  eyebrow,
  title,
  copy,
  count,
  action,
  actionLabel = "Create new",
}) {
  return (
    <section className="mk-section-intro">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      <div className="mk-section-intro-side">
        {count != null && (
          <b>
            {count}
            <small> total</small>
          </b>
        )}
        {action && <button onClick={action}>＋ {actionLabel}</button>}
      </div>
    </section>
  );
}

const FORM_FIELDS = {
  segments: [
    ["field", "Field"],
    ["operator", "Operator"],
    ["value", "Value"],
  ],
  sequences: [
    ["stage", "Lifecycle stage"],
    ["cadence_days", "Cadence (days)"],
    ["max_touches", "Maximum touches"],
    ["subject", "First email subject"],
    ["body", "Message"],
    ["cta", "Button label"],
    ["cta_url", "Button destination"],
  ],
  campaigns: [
    ["audience", "Saved segment name or ID"],
    ["goal", "Goal"],
    ["channels", "Channels"],
    ["subject", "Email subject"],
    ["body", "Message"],
    ["cta", "Button label"],
    ["cta_url", "Button destination"],
  ],
  content: [
    ["channel", "Channel"],
    ["pillar", "Content pillar"],
    ["format", "Format"],
    ["caption", "Caption"],
    ["link_url", "Link URL"],
    ["image_url", "Public image URL"],
  ],
  referrals: [
    ["reward", "Reward"],
    ["trigger", "Conversion trigger"],
    ["partner", "Partner"],
  ],
  tasks: [
    ["owner", "Owner"],
    ["related_lead_id", "Related lead ID"],
    ["due_date", "Due date"],
    ["target_minutes", "SLA minutes"],
    ["description", "Description"],
  ],
  experiments: [
    ["metric", "Success metric"],
    ["variant_a", "Variant A"],
    ["variant_b", "Variant B"],
  ],
  forms: [
    ["title", "Public title"],
    ["description", "Description"],
    ["fields", "Fields"],
    ["success_message", "Success message"],
  ],
};
function ModuleFields({ module, value, onChange }) {
  const payload = value || {};
  return (
    <div className="mk-form-fields">
      {(FORM_FIELDS[module] || []).map(([key, label]) => (
        <label key={key}>
          {label}
          {["body", "caption", "description"].includes(key) ? (
            <textarea
              value={payload[key] || ""}
              onChange={(e) => onChange({ ...payload, [key]: e.target.value })}
            />
          ) : (
            <input
              type={
                key.includes("days") ||
                key.includes("minutes") ||
                key === "max_touches"
                  ? "number"
                  : key === "due_date"
                    ? "date"
                    : "text"
              }
              value={
                Array.isArray(payload[key])
                  ? payload[key].join(", ")
                  : payload[key] || ""
              }
              onChange={(e) =>
                onChange({
                  ...payload,
                  [key]: ["channels", "fields"].includes(key)
                    ? e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean)
                    : e.target.value,
                })
              }
            />
          )}
        </label>
      ))}
    </div>
  );
}

function previewValue(value) {
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === "object"
          ? Object.values(item).filter(Boolean).join(" · ")
          : String(item),
      )
      .join("; ");
  if (value && typeof value === "object")
    return Object.entries(value)
      .map(
        ([key, item]) =>
          `${key.replaceAll("_", " ")}: ${Array.isArray(item) ? item.join(", ") : item}`,
      )
      .join(" · ");
  return String(value ?? "");
}

function LeadProfileFields({ lead, setLead, save }) {
  const textField = (key, label, type = "text") => (
    <label key={key}>
      {label}
      <input
        type={type}
        value={lead[key] ?? ""}
        onChange={(event) =>
          setLead((current) => ({
            ...current,
            [key]:
              type === "number"
                ? event.target.value === ""
                  ? null
                  : Number(event.target.value)
                : event.target.value,
          }))
        }
        onBlur={() => save({ [key]: lead[key] ?? null })}
      />
    </label>
  );
  return (
    <>
      <div className="mk-profile-grid">
        <label>
          Stage
          <select
            value={lead.stage}
            onChange={(event) => save({ stage: event.target.value })}
          >
            {STAGES.map((stage) => (
              <option key={stage}>{stage}</option>
            ))}
          </select>
        </label>
        {textField("score", "Score", "number")}
        {textField("owner_email", "Owner")}
        <label>
          Email consent
          <input
            type="checkbox"
            checked={lead.consent_email}
            onChange={(event) => save({ consent_email: event.target.checked })}
          />
        </label>
        <label>
          SMS consent
          <input
            type="checkbox"
            checked={lead.consent_sms}
            onChange={(event) => save({ consent_sms: event.target.checked })}
          />
        </label>
        {textField("phone", "Phone")}
        {textField("organization", "Organization")}
        {textField("country", "Country")}
      </div>
      <details className="mk-profile-section">
        <summary>Event intent and opportunity</summary>
        <div className="mk-profile-grid">
          {textField("event_type", "Event type")}
          {textField("event_date", "Event date", "date")}
          {textField("guest_count", "Guest count", "number")}
          {textField("deal_value", "Deal value", "number")}
          {textField("probability", "Probability %", "number")}
          {textField("close_date", "Expected close date", "date")}
        </div>
      </details>
      <details className="mk-profile-section">
        <summary>Campaign attribution</summary>
        <div className="mk-profile-grid">
          {textField("source", "Source")}
          {textField("medium", "Medium")}
          {textField("campaign", "Campaign")}
          {textField("referrer", "Referrer")}
          {textField("landing_page", "Landing page")}
        </div>
      </details>
    </>
  );
}

const NAV_ICONS = {
  dashboard: "⌂",
  leads: "◎",
  segments: "◈",
  sequences: "↗",
  campaigns: "◇",
  content: "▦",
  referrals: "⌁",
  tasks: "✓",
  experiments: "⚗",
  forms: "▤",
  tags: "#",
  access: "♙",
};

const HELP_GUIDES = [
  [
    "Start with your leads",
    "Open Leads to search, filter, assign an owner, change lifecycle stage, add notes, import a CSV, or export your list. Open any person to see their full relationship timeline.",
  ],
  [
    "Respect communication consent",
    "Email and SMS are sent only when the person has opted in. Use Preferences for your own account. In a lead profile, record consent only when the person has explicitly provided it.",
  ],
  [
    "Build an audience",
    "Use Segments to group people by lifecycle, source, campaign, consent, or behavior. Give each segment a clear name so campaigns can reuse it.",
  ],
  [
    "Create follow-up journeys",
    "Use Follow-ups to choose a lifecycle stage, cadence, subjects, and messages. Active journeys are checked every 15 minutes. Resend is the default email provider.",
  ],
  [
    "Plan a campaign",
    "Campaigns connect an audience, goal, and channels. Draft the campaign first, confirm consent and ownership, then activate it when the content is ready.",
  ],
  [
    "Publish social content",
    "In Content calendar, create the caption, channel, link, and public image URL. LinkedIn, Facebook, or Instagram must show Connected under Analytics before Publish now can send the post.",
  ],
  [
    "Send an SMS safely",
    "A lead needs a phone number and explicit SMS consent. Festio uses Bird and automatically adds opt-out language. If either requirement is missing, the send is blocked.",
  ],
  [
    "Measure results",
    "Analytics shows registration trends, acquisition sources, campaign attribution, delivery events, and provider readiness. Change the date range to compare recent activity.",
  ],
  [
    "Work as a team",
    "Tasks hold ownership and response deadlines. Staff access is controlled by a platform super-admin. Viewer, marketer, and manager roles limit what each teammate can change.",
  ],
  [
    "Review important changes",
    "Audit history records access grants, consent updates, imports, bulk operations, content publishing, and other significant changes.",
  ],
];

function MarketingHelp() {
  return (
    <div className="mk-workspace mk-help">
      <SectionIntro
        eyebrow="MARKETING HELP"
        title="From registration to a real relationship."
        copy="A practical guide to following up thoughtfully, publishing consistently, and understanding what converts."
      />
      <section className="mk-help-quick">
        <div>
          <span>QUICK START</span>
          <h3>Your first useful workflow</h3>
          <p>Follow these four steps when a new organizer registers.</p>
        </div>
        <ol>
          <li>
            <b>1</b>
            <span>
              <strong>Review the lead</strong>Confirm source, registration date,
              and consent.
            </span>
          </li>
          <li>
            <b>2</b>
            <span>
              <strong>Assign ownership</strong>Choose who will make the human
              follow-up.
            </span>
          </li>
          <li>
            <b>3</b>
            <span>
              <strong>Add the right journey</strong>Use their lifecycle stage
              and intent.
            </span>
          </li>
          <li>
            <b>4</b>
            <span>
              <strong>Measure the result</strong>Watch event creation and paid
              conversion.
            </span>
          </li>
        </ol>
      </section>
      <div className="mk-help-grid">
        {HELP_GUIDES.map(([title, copy], index) => (
          <article key={title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          </article>
        ))}
      </div>
      <section className="mk-help-safety">
        <div>
          <b>Before sending anything</b>
          <p>
            Confirm the audience, consent, sender, destination link, and
            provider readiness. Use a test recipient before activating a large
            campaign.
          </p>
        </div>
        <button
          onClick={() =>
            window.open("mailto:support@festio.events?subject=Marketing%20help")
          }
        >
          Contact Festio support
        </button>
      </section>
    </div>
  );
}

function Metric({ label, value, detail, tone = "teal" }) {
  return (
    <article className={`mk-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
      <small>{detail}</small>
      <i />
    </article>
  );
}

function Dashboard({ data, run, message, navigate }) {
  const total = data?.conversion?.registered || 0,
    created = data?.conversion?.event_created || 0,
    paid = data?.conversion?.paid || 0;
  const stages = [
    ["Registered", total, "#22c3ae"],
    ["Event created", created, "#f1b45b"],
    ["Paid customer", paid, "#8b7bd8"],
  ];
  return (
    <div className="space-y-5">
      <section className="mk-hero">
        <div>
          <span className="mk-eyebrow">MARKETING COMMAND CENTER</span>
          <h2>
            Turn interest into
            <br />
            <em>events people remember.</em>
          </h2>
          <p>
            Track every organizer from first visit to paid event. Build
            campaigns, automate thoughtful follow-ups, and keep the team focused
            on what moves next.
          </p>
          <div className="mk-hero-actions">
            <button onClick={run}>
              Run automation <b>↗</b>
            </button>
            <span>
              <i /> Resend delivery active
            </span>
          </div>
        </div>
        <div className="mk-orbit">
          <div className="mk-orbit-ring one" />
          <div className="mk-orbit-ring two" />
          <div className="mk-orbit-core">
            <small>PIPELINE</small>
            <strong>{data?.total_leads || 0}</strong>
            <span>people</span>
          </div>
          <b className="mk-orbit-dot a">{created}</b>
          <b className="mk-orbit-dot b">{paid}</b>
        </div>
      </section>
      <div className="mk-metrics">
        <Metric
          label="Total leads"
          value={data?.total_leads}
          detail="All captured organizers"
        />
        <Metric
          label="Email ready"
          value={data?.email_marketable}
          detail="Explicitly opted in"
          tone="violet"
        />
        <Metric
          label="Actions due"
          value={data?.follow_ups_due}
          detail="Automation queue"
          tone="gold"
        />
        <Metric
          label="Needs attention"
          value={data?.sla_overdue}
          detail="Outside response SLA"
          tone="coral"
        />
      </div>
      <div className="mk-dashboard-grid">
        <section className="mk-panel mk-funnel">
          <div className="mk-panel-head">
            <div>
              <span>LIVE FUNNEL</span>
              <h3>Organizer journey</h3>
            </div>
            <b>All time</b>
          </div>
          <div className="mk-funnel-body">
            {stages.map(([label, count, color], i) => (
              <div className="mk-funnel-row" key={label}>
                <div>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
                <div className="mk-funnel-track">
                  <i
                    style={{
                      width: `${Math.max(4, total ? (count / total) * 100 : 0)}%`,
                      background: color,
                    }}
                  />
                </div>
                <small>
                  {i === 0
                    ? "100"
                    : total
                      ? Math.round((count / total) * 100)
                      : 0}
                  %
                </small>
              </div>
            ))}
          </div>
          <div className="mk-funnel-foot">
            <div>
              <strong>{data?.conversion?.event_creation_rate || 0}%</strong>
              <span>create an event</span>
            </div>
            <div>
              <strong>{data?.conversion?.paid_rate || 0}%</strong>
              <span>become paid</span>
            </div>
          </div>
        </section>
        <section className="mk-panel mk-pipeline">
          <div className="mk-panel-head">
            <div>
              <span>PIPELINE HEALTH</span>
              <h3>Lead stages</h3>
            </div>
            <button onClick={() => navigate("leads")}>View leads →</button>
          </div>
          <div className="mk-stage-list">
            {Object.entries(data?.stages || {}).map(([stage, count], i) => (
              <div key={stage}>
                <i className={`c${i % 4}`} />
                <span>{stage.replaceAll("_", " ")}</span>
                <b>{count}</b>
                <small>
                  {data?.total_leads
                    ? Math.round((count / data.total_leads) * 100)
                    : 0}
                  %
                </small>
              </div>
            ))}
          </div>
          {!Object.keys(data?.stages || {}).length && (
            <p className="mk-empty">Your lead stages will appear here.</p>
          )}
        </section>
        <aside className="mk-action-card">
          <span className="mk-eyebrow">NEXT BEST ACTION</span>
          <div className="mk-action-icon">↗</div>
          <h3>{data?.sla_overdue || 0} leads need a human touch</h3>
          <p>
            Review older registrations, add context, and choose who is ready for
            a personal follow-up.
          </p>
          <button onClick={() => navigate("leads")}>
            Open lead queue <b>→</b>
          </button>
          <footer>
            <span>
              <i /> Automation checks every 15 min
            </span>
            {message && <strong>{message}</strong>}
          </footer>
        </aside>
      </div>
    </div>
  );
}

function LegacyLeads() {
  const [rows, setRows] = useState([]),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState(null),
    [note, setNote] = useState(""),
    [creating, setCreating] = useState(false),
    [draft, setDraft] = useState({
      name: "",
      email: "",
      organization: "",
      source: "website",
      consent_email: false,
    });
  const load = () =>
    api.marketingLeads(q ? `q=${encodeURIComponent(q)}` : "").then(setRows);
  useEffect(() => {
    load();
  }, []);
  async function add() {
    setCreating(true);
  }
  async function createLead(e) {
    e.preventDefault();
    await api.marketingCreateLead(draft);
    setCreating(false);
    setDraft({
      name: "",
      email: "",
      organization: "",
      source: "website",
      consent_email: false,
    });
    load();
  }
  async function update(id, body) {
    const row = await api.marketingUpdateLead(id, body);
    setRows((v) => v.map((x) => (x.id === id ? row : x)));
    setSelected(row);
  }
  async function addNote() {
    if (!note.trim()) return;
    await api.marketingAddActivity(selected.id, {
      kind: "note",
      summary: note,
    });
    setNote("");
  }
  return (
    <div className="mk-workspace mk-leads space-y-4">
      <SectionIntro
        eyebrow="RELATIONSHIP PIPELINE"
        title="People, not rows."
        copy="See when every organizer arrived, what brought them here, and the most useful next conversation."
        count={rows.length}
        action={add}
        actionLabel="Add lead"
      />
      <div className="mk-toolbar flex flex-wrap gap-2">
        <input
          className="min-w-64 flex-1 rounded-lg border px-3 py-2 text-sm"
          placeholder="Search by name, email, or organization"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button
          className="rounded-lg border px-4 text-sm font-bold"
          onClick={load}
        >
          Search
        </button>
      </div>
      <div className="mk-table-shell overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">Lead</th>
              <th>Date registered</th>
              <th>Stage</th>
              <th>Source</th>
              <th>Score</th>
              <th>Consent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                className="cursor-pointer border-t hover:bg-slate-50"
                key={r.id}
                onClick={() => setSelected(r)}
              >
                <td className="p-3">
                  <b>{r.name || r.email}</b>
                  <small className="block text-slate-400">{r.email}</small>
                </td>
                <td>
                  {new Date(r.registered_at || r.created_at).toLocaleString()}
                </td>
                <td>
                  <span className="mk-stage-pill">
                    {r.stage.replaceAll("_", " ")}
                  </span>
                </td>
                <td>{r.source}</td>
                <td>
                  <b className="mk-score">{r.score}</b>
                </td>
                <td>
                  <span
                    className={`mk-consent ${r.consent_email && !r.unsubscribed ? "yes" : ""}`}
                  >
                    {r.consent_email && !r.unsubscribed
                      ? "● Email ready"
                      : "○ Not opted in"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div
          className="mk-drawer-backdrop fixed inset-0 z-50 bg-black/30 p-4"
          onClick={() => setSelected(null)}
        >
          <aside
            className="mk-drawer ml-auto h-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between">
              <div>
                <span className="mk-drawer-eyebrow">LEAD PROFILE</span>
                <h2 className="text-xl font-bold">
                  {selected.name || selected.email}
                </h2>
                <p className="text-sm text-slate-500">{selected.email}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Registered{" "}
                  {new Date(
                    selected.registered_at || selected.created_at,
                  ).toLocaleString()}
                </p>
              </div>
              <button onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <label className="text-xs">
                Stage
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={selected.stage}
                  onChange={(e) =>
                    update(selected.id, { stage: e.target.value })
                  }
                >
                  {STAGES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Score
                <input
                  className="mt-1 w-full rounded border p-2"
                  type="number"
                  value={selected.score}
                  onChange={(e) =>
                    update(selected.id, { score: Number(e.target.value) })
                  }
                />
              </label>
              <label className="text-xs">
                Owner
                <input
                  className="mt-1 w-full rounded border p-2"
                  value={selected.owner_email || ""}
                  onChange={(e) =>
                    setSelected((v) => ({ ...v, owner_email: e.target.value }))
                  }
                  onBlur={() =>
                    update(selected.id, { owner_email: selected.owner_email })
                  }
                />
              </label>
              <label className="flex items-end gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selected.consent_email}
                  onChange={(e) =>
                    update(selected.id, { consent_email: e.target.checked })
                  }
                />{" "}
                Email consent
              </label>
            </div>
            <textarea
              className="mt-5 w-full rounded border p-3 text-sm"
              placeholder="Add call, email, or follow-up note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="mt-2 rounded bg-teal-700 px-3 py-2 text-sm font-bold text-white"
              onClick={addNote}
            >
              Save note
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}

function Leads() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]),
    [filters, setFilters] = useState({
      q: searchParams.get("q") || "",
      stage: searchParams.get("stage") || "",
      owner: searchParams.get("owner") || "",
      source: searchParams.get("source") || "",
      consent: searchParams.get("consent") || "",
    }),
    [viewMode, setViewMode] = useState(searchParams.get("view") || "table"),
    [selected, setSelected] = useState(null),
    [checked, setChecked] = useState([]),
    [activity, setActivity] = useState([]),
    [creating, setCreating] = useState(false),
    [draft, setDraft] = useState({
      name: "",
      email: "",
      organization: "",
      source: "website",
      consent_email: false,
    }),
    [note, setNote] = useState(""),
    [bulkEdit, setBulkEdit] = useState(null),
    [views, setViews] = useState([]),
    [notice, setNotice] = useState("");
  const query = () =>
    Object.entries(filters)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
  const load = () => api.marketingLeads(query()).then(setRows);
  function applyFilters() {
    const next = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== ""),
    );
    if (viewMode !== "table") next.view = viewMode;
    setSearchParams(next);
    load();
  }
  useEffect(() => {
    load();
    api.marketingSavedViews().then(setViews);
  }, []);
  async function open(row) {
    setSelected(row);
    setActivity(await api.marketingLeadActivity(row.id));
  }
  async function update(body) {
    const row = await api.marketingUpdateLead(selected.id, body);
    setSelected(row);
    load();
  }
  async function bulk(e) {
    e.preventDefault();
    if (!bulkEdit?.value) return;
    await api.marketingBulkLeads({
      ids: checked,
      action: bulkEdit.action,
      value: bulkEdit.value,
    });
    setChecked([]);
    setBulkEdit(null);
    load();
  }
  async function saveView() {
    const name = `View ${views.length + 1}`;
    const row = await api.marketingCreateSavedView({ name, filters });
    setViews((v) => [...v, row]);
    setNotice(`${name} saved`);
  }
  async function importCsv(file) {
    if (!file) return;
    const result = await api.marketingImportLeads(file);
    setNotice(`${result.created} created, ${result.updated} matched`);
    load();
  }
  async function create(e) {
    e.preventDefault();
    await api.marketingCreateLead(draft);
    setCreating(false);
    setDraft({
      name: "",
      email: "",
      organization: "",
      source: "website",
      consent_email: false,
    });
    load();
  }
  async function addNote() {
    if (!note.trim()) return;
    await api.marketingAddActivity(selected.id, {
      kind: "note",
      summary: note,
    });
    setNote("");
    setActivity(await api.marketingLeadActivity(selected.id));
  }
  return (
    <div className="mk-workspace mk-leads">
      <SectionIntro
        eyebrow="RELATIONSHIP PIPELINE"
        title="People, not rows."
        copy="Filter, understand, assign, and follow every organizer from first touch to paid event."
        count={rows.length}
        action={() => setCreating(true)}
        actionLabel="Add lead"
      />
      {notice && <div className="mk-notice">{notice}</div>}
      <div className="mk-filterbar">
        <input
          placeholder="Search people or organizations"
          value={filters.q}
          onChange={(e) => setFilters((v) => ({ ...v, q: e.target.value }))}
        />
        <select
          value={filters.stage}
          onChange={(e) => setFilters((v) => ({ ...v, stage: e.target.value }))}
        >
          <option value="">All stages</option>
          {STAGES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <input
          placeholder="Owner"
          value={filters.owner}
          onChange={(e) => setFilters((v) => ({ ...v, owner: e.target.value }))}
        />
        <input
          placeholder="Source"
          value={filters.source}
          onChange={(e) =>
            setFilters((v) => ({ ...v, source: e.target.value }))
          }
        />
        <select
          value={filters.consent}
          onChange={(e) =>
            setFilters((v) => ({ ...v, consent: e.target.value }))
          }
        >
          <option value="">Any consent</option>
          <option value="true">Email ready</option>
          <option value="false">Not opted in</option>
        </select>
        <button onClick={applyFilters}>Apply</button>
        <button
          onClick={() => {
            const next = viewMode === "table" ? "kanban" : "table";
            setViewMode(next);
            setSearchParams({
              ...Object.fromEntries(searchParams),
              view: next,
            });
          }}
        >
          {viewMode === "table" ? "Kanban view" : "Table view"}
        </button>
        <button onClick={saveView}>Save view</button>
        <select
          onChange={(e) => {
            const view = views.find((v) => v.id === e.target.value);
            if (view) setFilters(view.filters);
          }}
          defaultValue=""
        >
          <option value="">Saved views</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <label className="mk-file-button">
          Import CSV
          <input
            hidden
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => importCsv(e.target.files?.[0])}
          />
        </label>
        <button onClick={() => api.marketingExportLeads()}>Export CSV</button>
      </div>
      {checked.length > 0 && (
        <div className="mk-bulkbar">
          <b>{checked.length} selected</b>
          <button onClick={() => setBulkEdit({ action: "assign", value: "" })}>
            Assign owner
          </button>
          <button
            onClick={() =>
              setBulkEdit({ action: "stage", value: "registered" })
            }
          >
            Change stage
          </button>
          <button onClick={() => setBulkEdit({ action: "tag", value: "" })}>
            Add tag
          </button>
        </div>
      )}
      {viewMode === "kanban" ? (
        <div className="mk-kanban">
          {STAGES.map((stage) => (
            <section
              key={stage}
              onDragOver={(event) => event.preventDefault()}
              onDrop={async (event) => {
                const id = event.dataTransfer.getData("text/lead-id");
                if (id) {
                  await api.marketingUpdateLead(id, { stage });
                  load();
                }
              }}
            >
              <header>
                <b>{stage.replaceAll("_", " ")}</b>
                <span>
                  {rows.filter((lead) => lead.stage === stage).length}
                </span>
              </header>
              {rows
                .filter((lead) => lead.stage === stage)
                .map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/lead-id", lead.id)
                    }
                    onClick={() => open(lead)}
                  >
                    <b>{lead.name || lead.email}</b>
                    <small>{lead.organization || lead.email}</small>
                    <span>Score {lead.score}</span>
                  </article>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="mk-table-shell">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={checked.length === rows.length && rows.length > 0}
                    onChange={(e) =>
                      setChecked(e.target.checked ? rows.map((r) => r.id) : [])
                    }
                  />
                </th>
                <th>Lead</th>
                <th>Date registered</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>Source</th>
                <th>Score</th>
                <th>Consent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked.includes(r.id)}
                      onChange={(e) =>
                        setChecked((v) =>
                          e.target.checked
                            ? [...v, r.id]
                            : v.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </td>
                  <td onClick={() => open(r)}>
                    <b>{r.name || r.email}</b>
                    <small>{r.email}</small>
                  </td>
                  <td>
                    {new Date(r.registered_at || r.created_at).toLocaleString()}
                  </td>
                  <td>
                    <span className="mk-stage-pill">
                      {r.stage.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>{r.owner_email || "Unassigned"}</td>
                  <td>{r.source}</td>
                  <td>
                    <b className="mk-score">{r.score}</b>
                  </td>
                  <td>
                    <span
                      className={`mk-consent ${r.consent_email && !r.unsubscribed ? "yes" : ""}`}
                    >
                      {r.consent_email && !r.unsubscribed
                        ? "● Email ready"
                        : "○ Not opted in"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <div className="mk-drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="mk-drawer" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="mk-drawer-eyebrow">LEAD PROFILE</span>
                <h2>{selected.name || selected.email}</h2>
                <p>{selected.email}</p>
              </div>
              <button onClick={() => setSelected(null)}>Close</button>
            </header>
            <LeadProfileFields
              lead={selected}
              setLead={setSelected}
              save={update}
            />
            <section className="mk-timeline">
              <h3>Relationship history</h3>
              {activity.map((a) => (
                <article key={a.id}>
                  <i />
                  <div>
                    <b>{a.summary}</b>
                    <span>
                      {a.actor} · {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                </article>
              ))}
            </section>
            <div className="mk-note">
              <textarea
                placeholder="Add a call, email, or follow-up note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button onClick={addNote}>Save note</button>
            </div>
            <div className="mk-drawer-actions">
              <button
                onClick={async () => {
                  const email = prompt(
                    "Email of the duplicate lead to merge into this profile",
                  );
                  const source = rows.find(
                    (lead) =>
                      lead.email.toLowerCase() ===
                      String(email || "").toLowerCase(),
                  );
                  if (!source)
                    return setNotice(
                      "Duplicate lead not found in the current view",
                    );
                  const merged = await api.marketingMergeLeads({
                    target_id: selected.id,
                    source_id: source.id,
                  });
                  setSelected(merged);
                  setNotice("Duplicate merged");
                  load();
                }}
              >
                Merge duplicate
              </button>
              <button
                onClick={async () => {
                  const startsAt = prompt("Demo start time (YYYY-MM-DD HH:MM)");
                  if (!startsAt) return;
                  const result = await api.marketingScheduleDemo(selected.id, {
                    starts_at: new Date(startsAt).toISOString(),
                    duration_minutes: 30,
                  });
                  window.open(result.calendar_url, "_blank", "noopener");
                  setNotice("Demo booked and calendar opened");
                  load();
                }}
              >
                Book demo
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (
                    confirm("Schedule this lead for permanent GDPR deletion?")
                  ) {
                    const result = await api.marketingGdprDelete(selected.id);
                    setNotice(
                      `Deletion scheduled after ${result.purge_after_days} days`,
                    );
                    setSelected(null);
                    load();
                  }
                }}
              >
                GDPR deletion
              </button>
            </div>
          </aside>
        </div>
      )}
      {creating && (
        <div className="mk-modal-backdrop">
          <form className="mk-studio-modal" onSubmit={create}>
            <span className="mk-drawer-eyebrow">NEW RELATIONSHIP</span>
            <h3>Add a lead</h3>
            <div className="mk-form-fields">
              <label>
                Full name
                <input
                  required
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, name: e.target.value }))
                  }
                />
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  value={draft.email}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, email: e.target.value }))
                  }
                />
              </label>
              <label>
                Organization
                <input
                  value={draft.organization}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, organization: e.target.value }))
                  }
                />
              </label>
              <label>
                Source
                <input
                  value={draft.source}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, source: e.target.value }))
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.consent_email}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, consent_email: e.target.checked }))
                  }
                />{" "}
                Explicit email consent received
              </label>
            </div>
            <div className="mk-modal-actions">
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button>Save lead</button>
            </div>
          </form>
        </div>
      )}
      {bulkEdit && (
        <div className="mk-modal-backdrop">
          <form className="mk-studio-modal" onSubmit={bulk}>
            <h3>
              {bulkEdit.action === "assign"
                ? "Assign owner"
                : bulkEdit.action === "stage"
                  ? "Change stage"
                  : "Add tag"}
            </h3>
            {bulkEdit.action === "stage" ? (
              <select
                value={bulkEdit.value}
                onChange={(e) =>
                  setBulkEdit((v) => ({ ...v, value: e.target.value }))
                }
              >
                {STAGES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            ) : (
              <input
                autoFocus
                required
                placeholder={
                  bulkEdit.action === "assign" ? "owner@festio.events" : "Tag"
                }
                value={bulkEdit.value}
                onChange={(e) =>
                  setBulkEdit((v) => ({ ...v, value: e.target.value }))
                }
              />
            )}
            <div className="mk-modal-actions">
              <button type="button" onClick={() => setBulkEdit(null)}>
                Cancel
              </button>
              <button>Apply to {checked.length}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function LegacyModule({ module }) {
  const [rows, setRows] = useState([]),
    [editing, setEditing] = useState(null);
  const meta = MODULE_META[module] || [
    "Growth module",
    "Manage this part of the marketing workspace.",
  ];
  const load = () => api.marketingModule(module).then(setRows);
  useEffect(() => {
    load();
  }, [module]);
  async function add() {
    const name = prompt(`New ${module.slice(0, -1)} name`);
    if (!name) return;
    await api.marketingCreateRecord(module, {
      name,
      status: "draft",
      payload:
        module === "sequences"
          ? { stage: "registered", cadence_days: 3, steps: [] }
          : {},
    });
    load();
  }
  async function save(row) {
    await api.marketingUpdateRecord(module, row.id, {
      name: row.name,
      status: row.status,
      owner_email: row.owner_email,
      payload: row.payload,
    });
    setEditing(null);
    load();
  }
  return (
    <div className="mk-workspace mk-module space-y-4">
      <SectionIntro
        eyebrow={module.toUpperCase()}
        title={meta[0]}
        copy={meta[1]}
        count={rows.length}
        action={add}
      />
      <div className="mk-module-grid grid gap-3">
        {rows.map((r, index) => (
          <article
            key={r.id}
            className="mk-module-card rounded-xl border bg-white p-4"
          >
            <div className="mk-card-index">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="mk-card-type">{module.slice(0, -1)}</span>
                <h3 className="font-bold">{r.name}</h3>
                <p className="text-xs text-slate-400">
                  {r.owner_email || "Unassigned"} · Updated{" "}
                  {new Date(r.updated_at).toLocaleDateString()}
                </p>
              </div>
              <span className={`mk-status ${r.status}`}>{r.status}</span>
            </div>
            <div className="mk-card-preview">
              {Object.entries(r.payload || {})
                .slice(0, 3)
                .map(([key, value]) => (
                  <span key={key}>
                    <small>{key.replaceAll("_", " ")}</small>
                    <b>
                      {Array.isArray(value)
                        ? value.length
                        : typeof value === "object"
                          ? "Configured"
                          : String(value)}
                    </b>
                  </span>
                ))}
            </div>
            <div className="mk-card-actions mt-3 flex gap-2">
              <button
                className="text-xs font-bold text-teal-700"
                onClick={() =>
                  setEditing({
                    ...r,
                    payloadText: JSON.stringify(r.payload, null, 2),
                  })
                }
              >
                Open studio →
              </button>
              <button
                className="text-xs text-red-600"
                onClick={async () => {
                  if (confirm("Delete this item?")) {
                    await api.marketingDeleteRecord(module, r.id);
                    load();
                  }
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="mk-module-empty">
          <i>{NAV_ICONS[module]}</i>
          <h3>No {module} yet</h3>
          <p>{meta[1]}</p>
          <button onClick={add}>Create the first one</button>
        </div>
      )}
      {editing && (
        <div className="mk-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div className="mk-studio-modal w-full max-w-xl rounded-xl bg-white p-5">
            <span className="mk-drawer-eyebrow">
              {module.toUpperCase()} STUDIO
            </span>
            <h3 className="font-bold">Edit {module.slice(0, -1)}</h3>
            <input
              className="mt-4 w-full rounded border p-2"
              value={editing.name}
              onChange={(e) =>
                setEditing((v) => ({ ...v, name: e.target.value }))
              }
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <select
                className="rounded border p-2"
                value={editing.status}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, status: e.target.value }))
                }
              >
                {["draft", "scheduled", "active", "paused", "complete"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
              <input
                className="rounded border p-2"
                placeholder="Owner email"
                value={editing.owner_email || ""}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, owner_email: e.target.value }))
                }
              />
            </div>
            <label className="mt-3 block text-xs font-bold">
              Configuration
            </label>
            <textarea
              className="mt-1 h-56 w-full rounded border p-2 font-mono text-xs"
              value={editing.payloadText}
              onChange={(e) =>
                setEditing((v) => ({ ...v, payloadText: e.target.value }))
              }
            />
            <div className="mk-modal-actions mt-3 flex justify-end gap-2">
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="rounded bg-teal-700 px-4 py-2 text-sm font-bold text-white"
                onClick={() => {
                  try {
                    save({
                      ...editing,
                      payload: JSON.parse(editing.payloadText),
                    });
                  } catch {
                    alert("Configuration must be valid JSON");
                  }
                }}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Module({ module }) {
  const [rows, setRows] = useState([]),
    [editing, setEditing] = useState(null),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  const meta = MODULE_META[module] || [
    "Growth module",
    "Manage this workspace.",
  ];
  const load = () => {
    setLoading(true);
    return api
      .marketingModule(module)
      .then(setRows)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [module]);
  function create() {
    setEditing({
      name: "",
      status: "draft",
      owner_email: "",
      payload: {},
      isNew: true,
    });
  }
  async function save(e) {
    e.preventDefault();
    const body = {
      name: editing.name,
      status: editing.status,
      owner_email: editing.owner_email || null,
      payload: editing.payload,
      scheduled_at: editing.scheduled_at || null,
    };
    if (editing.isNew) await api.marketingCreateRecord(module, body);
    else await api.marketingUpdateRecord(module, editing.id, body);
    setEditing(null);
    load();
  }
  async function campaignAction(row, action) {
    if (action === "audience") {
      const result = await api.marketingExecuteCampaign(row.id, true);
      setNotice(
        `${result.eligible} consented recipient(s) match this campaign`,
      );
    }
    if (action === "preview") {
      const result = await api.marketingPreviewCampaign(row.id);
      setNotice(`Preview ${result.status} to your email`);
    }
    if (
      action === "launch" &&
      confirm(`Send ${row.name} to its consented audience?`)
    ) {
      const result = await api.marketingExecuteCampaign(row.id);
      setNotice(`${result.sent} sent, ${result.failed} failed`);
      load();
    }
  }
  return (
    <div className="mk-workspace mk-module">
      <SectionIntro
        eyebrow={module.toUpperCase()}
        title={meta[0]}
        copy={meta[1]}
        count={rows.length}
        action={create}
      />
      {notice && <div className="mk-notice">{notice}</div>}
      {loading && (
        <div className="mk-loading-grid">
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      <div className="mk-module-grid">
        {rows.map((r, index) => (
          <article className="mk-module-card" key={r.id}>
            <div className="mk-card-index">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div>
              <span className="mk-card-type">{module.slice(0, -1)}</span>
              <h3>{r.name}</h3>
              <p>
                {r.owner_email || "Unassigned"} · Updated{" "}
                {new Date(r.updated_at).toLocaleDateString()}
              </p>
            </div>
            <span className={`mk-status ${r.status}`}>{r.status}</span>
            <div className="mk-card-preview">
              {Object.entries(r.payload || {})
                .slice(0, 3)
                .map(([key, value]) => (
                  <span key={key}>
                    <small>{key.replaceAll("_", " ")}</small>
                    <b title={previewValue(value)}>{previewValue(value)}</b>
                  </span>
                ))}
            </div>
            <div className="mk-card-actions">
              <button onClick={() => setEditing({ ...r })}>
                Open studio →
              </button>
              {module === "campaigns" && (
                <>
                  <button onClick={() => campaignAction(r, "audience")}>
                    Check audience
                  </button>
                  <button onClick={() => campaignAction(r, "preview")}>
                    Send preview
                  </button>
                  <button onClick={() => campaignAction(r, "launch")}>
                    Launch campaign
                  </button>
                </>
              )}
              {module === "content" && (
                <>
                  <button
                    onClick={async () => {
                      const result = await api.marketingPublishSocial({
                        platform: r.payload.channel,
                        message: r.payload.caption || r.name,
                        link_url: r.payload.link_url,
                        image_url: r.payload.image_url,
                      });
                      setNotice(`${result.platform} post published`);
                    }}
                  >
                    Publish now
                  </button>
                  {r.status === "scheduled" && (
                    <small>
                      Scheduled{" "}
                      {r.scheduled_at
                        ? new Date(r.scheduled_at).toLocaleString()
                        : "time not set"}
                    </small>
                  )}
                </>
              )}
              {module === "forms" && r.payload.public_token && (
                <>
                  <button
                    onClick={async () => {
                      const url = `${window.location.origin}/lead-form/${r.payload.public_token}`;
                      await navigator.clipboard.writeText(url);
                      setNotice("Public form link copied");
                    }}
                  >
                    Copy form link
                  </button>
                  <button
                    onClick={async () => {
                      const url = `${window.location.origin}/lead-form/${r.payload.public_token}`;
                      await navigator.clipboard.writeText(
                        `<iframe src="${url}" title="${r.name}" width="100%" height="760" style="border:0"></iframe>`,
                      );
                      setNotice("Embed code copied");
                    }}
                  >
                    Copy embed code
                  </button>
                </>
              )}
              <button
                onClick={async () => {
                  if (confirm("Delete this item?")) {
                    await api.marketingDeleteRecord(module, r.id);
                    load();
                  }
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="mk-module-empty">
          <i>{NAV_ICONS[module]}</i>
          <h3>No {module} yet</h3>
          <p>{meta[1]}</p>
          <button onClick={create}>Create the first one</button>
        </div>
      )}
      {editing && (
        <div className="mk-modal-backdrop">
          <form className="mk-studio-modal" onSubmit={save}>
            <span className="mk-drawer-eyebrow">
              {module.toUpperCase()} STUDIO
            </span>
            <h3>
              {editing.isNew ? "Create" : "Edit"} {module.slice(0, -1)}
            </h3>
            <div className="mk-form-fields">
              <label>
                Name
                <input
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing((v) => ({ ...v, name: e.target.value }))
                  }
                />
              </label>
              <label>
                Status
                <select
                  value={editing.status}
                  onChange={(e) =>
                    setEditing((v) => ({ ...v, status: e.target.value }))
                  }
                >
                  {["draft", "scheduled", "active", "paused", "complete"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Owner
                <input
                  value={editing.owner_email || ""}
                  onChange={(e) =>
                    setEditing((v) => ({ ...v, owner_email: e.target.value }))
                  }
                />
              </label>
            </div>
            <ModuleFields
              module={module}
              value={editing.payload}
              onChange={(payload) => setEditing((v) => ({ ...v, payload }))}
            />
            {module === "content" && (
              <label className="mk-schedule-field">
                Publish date and time
                <input
                  type="datetime-local"
                  value={
                    editing.scheduled_at
                      ? String(editing.scheduled_at).slice(0, 16)
                      : ""
                  }
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      scheduled_at: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                      status: event.target.value ? "scheduled" : value.status,
                    }))
                  }
                />
              </label>
            )}
            <div className="mk-modal-actions">
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button>Save changes</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Tags() {
  const [rows, setRows] = useState([]),
    [notice, setNotice] = useState("");
  const load = () => api.marketingTags().then(setRows);
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="mk-workspace">
      <SectionIntro
        eyebrow="TAG TAXONOMY"
        title="One shared language for every lead."
        copy="Review usage, rename inconsistent tags, and remove tags that no longer belong."
        count={rows.length}
      />
      {notice && <div className="mk-notice">{notice}</div>}
      <div className="mk-tag-grid">
        {rows.map((tag) => (
          <article key={tag.name}>
            <div>
              <b>{tag.name}</b>
              <small>{tag.count} lead(s)</small>
            </div>
            <button
              onClick={async () => {
                const name = prompt("New tag name", tag.name);
                if (name && name !== tag.name) {
                  const result = await api.marketingRenameTag(tag.name, {
                    name,
                  });
                  setNotice(`${result.updated} lead(s) updated`);
                  load();
                }
              }}
            >
              Rename
            </button>
            <button
              className="danger"
              onClick={async () => {
                if (confirm(`Remove ${tag.name} from every lead?`)) {
                  const result = await api.marketingDeleteTag(tag.name);
                  setNotice(`${result.updated} lead(s) updated`);
                  load();
                }
              }}
            >
              Delete
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function Analytics() {
  const [days, setDays] = useState(30),
    [data, setData] = useState(null),
    [providers, setProviders] = useState(null);
  useEffect(() => {
    api.marketingAnalytics(days).then(setData);
    api.marketingProviders().then(setProviders);
  }, [days]);
  return (
    <div className="mk-workspace">
      <SectionIntro
        eyebrow="ATTRIBUTION & DELIVERY"
        title="Know what creates momentum."
        copy="Measure registrations, acquisition sources, campaigns, and provider health over the period that matters."
      />
      <div className="mk-filterbar">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>
      <div className="mk-analytics-grid">
        <section>
          <h3>Registration trend</h3>
          <div className="mk-bars">
            {Object.entries(data?.daily || {}).map(([day, count]) => (
              <span key={day}>
                <i style={{ height: `${Math.max(8, count * 18)}px` }} />
                <small>{day.slice(5)}</small>
                <b>{count}</b>
              </span>
            ))}
          </div>
        </section>
        <section>
          <h3>Acquisition sources</h3>
          {Object.entries(data?.sources || {}).map(([name, count]) => (
            <div className="mk-data-row" key={name}>
              <span>{name}</span>
              <b>{count}</b>
            </div>
          ))}
        </section>
        <section>
          <h3>Campaign attribution</h3>
          {Object.entries(data?.campaigns || {}).map(([name, count]) => (
            <div className="mk-data-row" key={name}>
              <span>{name}</span>
              <b>{count}</b>
            </div>
          ))}
        </section>
        <section>
          <h3>Connected providers</h3>
          <div className="mk-provider-list">
            <span className={providers?.email?.configured ? "ready" : ""}>
              Email · Resend{" "}
              <b>{providers?.email?.configured ? "Ready" : "Setup needed"}</b>
            </span>
            <span className={providers?.sms?.configured ? "ready" : ""}>
              SMS · SignalHouse{" "}
              <b>{providers?.sms?.configured ? "Ready" : "Setup needed"}</b>
            </span>
            <span className={providers?.whatsapp?.configured ? "ready" : ""}>
              WhatsApp · Bird{" "}
              <b>
                {providers?.whatsapp?.configured ? "Ready" : "Setup needed"}
              </b>
            </span>
            {Object.entries(providers?.social || {}).map(([name, ready]) => (
              <span className={ready ? "ready" : ""} key={name}>
                {name}
                <b>{ready ? "Connected" : "Connect account"}</b>
                {ready && providers?.oauth_refresh?.[name] ? (
                  <button
                    onClick={async () => {
                      await api.marketingRefreshProvider(name);
                      setProviders(await api.marketingProviders());
                    }}
                  >
                    Refresh OAuth
                  </button>
                ) : ready ? (
                  <small>Static token</small>
                ) : null}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.marketingAudit().then(setRows);
  }, []);
  return (
    <div className="mk-workspace">
      <SectionIntro
        eyebrow="TRUST & CONTROL"
        title="A record of every important change."
        copy="Review staff grants, consent decisions, bulk operations, imports, and campaign changes."
        count={rows.length}
      />
      <div className="mk-audit-list">
        {rows.map((r) => (
          <article key={r.id}>
            <span>{r.action}</span>
            <div>
              <b>{r.target_type}</b>
              <small>{r.actor}</small>
            </div>
            <time>{new Date(r.created_at).toLocaleString()}</time>
          </article>
        ))}
      </div>
    </div>
  );
}

function Preferences() {
  const [value, setValue] = useState(null),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    api.marketingPreferences().then(setValue);
  }, []);
  if (!value) return <div className="mk-workspace">Loading preferences...</div>;
  return (
    <div className="mk-workspace">
      <SectionIntro
        eyebrow="YOUR PRIVACY"
        title="Choose how Festio follows up."
        copy="These choices belong to your account and apply across marketing campaigns."
      />
      <form
        className="mk-access-grant"
        onSubmit={async (e) => {
          e.preventDefault();
          await api.marketingSavePreferences(value);
          setSaved(true);
        }}
      >
        <div>
          <h3>Communication preferences</h3>
          <p>You can change these choices at any time.</p>
        </div>
        <div className="mk-form-fields">
          <label>
            <input
              type="checkbox"
              checked={value.consent_email}
              onChange={(e) =>
                setValue((v) => ({ ...v, consent_email: e.target.checked }))
              }
            />{" "}
            Product education and event planning email
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.consent_sms}
              onChange={(e) =>
                setValue((v) => ({ ...v, consent_sms: e.target.checked }))
              }
            />{" "}
            Helpful SMS follow-ups
          </label>
          <button>Save preferences</button>
          {saved && <small>Preferences saved.</small>}
        </div>
      </form>
    </div>
  );
}

function Access() {
  const [rows, setRows] = useState([]),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("marketer"),
    [ownerScoped, setOwnerScoped] = useState(false);
  const load = () => api.marketingAccess().then(setRows);
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="mk-workspace mk-access space-y-4">
      <SectionIntro
        eyebrow="GOVERNANCE"
        title="The growth team"
        copy="Grant focused Marketing access without exposing the Operator Console, organizations, or event administration."
        count={rows.filter((r) => r.active).length}
      />
      <section className="mk-access-grant">
        <div>
          <span>INVITE A TEAM MEMBER</span>
          <h3>Give the right people the right reach.</h3>
          <p>Choose a role now. You can revoke access instantly at any time.</p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await api.marketingGrantAccess({
              email,
              role,
              owner_scoped: ownerScoped,
            });
            setEmail("");
            load();
          }}
        >
          <input
            className="flex-1 rounded border p-2"
            placeholder="name@company.com"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="rounded border p-2"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option>viewer</option>
            <option>marketer</option>
            <option>manager</option>
          </select>
          <label className="mk-owner-scope">
            <input
              type="checkbox"
              checked={ownerScoped}
              onChange={(event) => setOwnerScoped(event.target.checked)}
            />{" "}
            Only assigned leads
          </label>
          <button>Grant access →</button>
        </form>
      </section>
      <div className="mk-access-grid">
        {rows
          .filter((r) => r.active)
          .map((r) => (
            <article key={r.id}>
              <span className="mk-member-avatar">
                {(r.name || r.email)
                  .split(/\s|@/)
                  .slice(0, 2)
                  .map((v) => v[0])
                  .join("")
                  .toUpperCase()}
              </span>
              <div>
                <b>{r.name || r.email}</b>
                <small>{r.email}</small>
              </div>
              <em>
                {r.role}
                {r.owner_scoped ? " · assigned only" : ""}
              </em>
              <button
                onClick={async () => {
                  await api.marketingRevokeAccess(r.id);
                  load();
                }}
              >
                Revoke
              </button>
            </article>
          ))}
      </div>
      {!rows.some((r) => r.active) && (
        <div className="mk-module-empty">
          <i>♙</i>
          <h3>No staff access granted</h3>
          <p>
            Only platform super-admins can see Marketing until you add someone
            here.
          </p>
        </div>
      )}
    </div>
  );
}

class MarketingErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="mk-module-empty">
        <h3>This section could not load</h3>
        <p>{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function MarketingPage() {
  const [pageParams, setPageParams] = useSearchParams();
  const [tab, setTabState] = useState(pageParams.get("tab") || "dashboard"),
    [me, setMe] = useState(null),
    [dash, setDash] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    api
      .marketingMe()
      .then(setMe)
      .catch((e) => setError(e.message));
    api
      .marketingDashboard()
      .then(setDash)
      .catch(() => {});
  }, []);
  const tabs = useMemo(
    () => [
      ["dashboard", "Dashboard"],
      ["leads", "Leads"],
      ["tags", "Tags"],
      ...MODULE_TABS,
      ["analytics", "Analytics"],
      ["preferences", "Preferences"],
      ["help", "Help"],
      ...(me?.role === "superadmin"
        ? [
            ["access", "Staff access"],
            ["audit", "Audit history"],
          ]
        : []),
    ],
    [me],
  );
  const setTab = (next) => {
    setTabState(next);
    setPageParams({ tab: next });
  };
  if (error)
    return (
      <div className="mx-auto mt-20 max-w-lg rounded-xl border bg-white p-8 text-center">
        <h1 className="text-xl font-bold">Marketing workspace</h1>
        <p className="mt-3 text-slate-500">{error}</p>
        <Link className="mt-5 inline-block text-teal-700" to="/">
          Return to Festio
        </Link>
      </div>
    );
  if (!me) return <div className="p-10 text-center">Loading Marketing...</div>;
  return (
    <div className="mk-app">
      <aside className="mk-sidebar">
        <Link className="mk-brand" to="/admin-redesign">
          <b>F</b>
          <span>
            Festio<small>Growth studio</small>
          </span>
        </Link>
        <nav>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={tab === id ? "active" : ""}
            >
              <i>{NAV_ICONS[id] || "◫"}</i>
              <span>{label}</span>
              {tab === id && <b>›</b>}
            </button>
          ))}
        </nav>
        <div className="mk-sidebar-foot">
          <span>FG</span>
          <div>
            <b>{me.name || me.email}</b>
            <small>{me.role}</small>
          </div>
        </div>
      </aside>
      <main className="mk-main">
        <header className="mk-topbar">
          <div>
            <span>Workspace</span>
            <h1>{tabs.find(([id]) => id === tab)?.[1] || "Marketing"}</h1>
          </div>
          <div className="mk-top-actions">
            <button title="Search">⌕</button>
            <button title="Notifications">◌</button>
            <span>
              {new Date().toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </header>
        <div className="mk-content">
          <MarketingErrorBoundary key={tab}>
            {tab === "dashboard" ? (
              <Dashboard
                data={dash}
                message={message}
                navigate={setTab}
                run={async () => {
                  const r = await api.marketingRunAutomation();
                  setMessage(`${r.queued} follow-up(s) queued`);
                  setDash(await api.marketingDashboard());
                }}
              />
            ) : tab === "leads" ? (
              <Leads />
            ) : tab === "access" ? (
              <Access />
            ) : tab === "tags" ? (
              <Tags />
            ) : tab === "analytics" ? (
              <Analytics />
            ) : tab === "audit" ? (
              <Audit />
            ) : tab === "preferences" ? (
              <Preferences />
            ) : tab === "help" ? (
              <MarketingHelp />
            ) : (
              <Module module={tab} />
            )}
          </MarketingErrorBoundary>
        </div>
      </main>
    </div>
  );
}
