import { useEffect, useRef, useState } from 'react';
import './MealMenuView.css';

const options = c => c.selection_type === 'combo' ? c.combinations || [] : c.items || [];
const selectedIds = (c, choices) => c.selection_type === 'multi' ? choices.multi[c.id] || [] : [choices[c.selection_type === 'combo' ? 'combo' : 'single'][c.id]].filter(Boolean);
function Plate({ seed = '', small = false, combination = false }) {
  const tone = [...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;
  return <div className={`vm-art vm-art-${tone} ${small ? 'vm-art-small' : ''}`} aria-hidden="true"><svg viewBox="0 0 280 160"><ellipse cx="143" cy="87" rx="65" ry="57" fill="#173c3012"/><circle cx="140" cy="78" r="59" fill="#fffdf5"/><circle cx="140" cy="78" r="48" fill="#eee9d8"/>{combination ? <><circle cx="126" cy="73" r="22" fill="#d9b577"/><circle cx="158" cy="67" r="15" fill="#9fb58b"/><circle cx="155" cy="98" r="16" fill="#d8a491"/></> : <><circle cx="140" cy="78" r="34" fill={['#d9b577','#9fb58b','#d8a491'][tone]}/><path d="M118 70q22-18 44 0m-47 9q25-18 50 0m-44 9q19-14 38 0" stroke="#ffffff80" strokeWidth="4" fill="none" strokeLinecap="round"/></>}<path d="M53 35v31m6-31v31m6-31v31m-12-5q6 17 12 0m-6 15v45M225 35v86m0-86q-14 9-9 32h9" stroke="#85917d" strokeWidth="3" strokeLinecap="round" fill="none"/></svg></div>;
}
function guidance(c) {
  if (c.display_only) return 'Available on the menu';
  if (c.selection_type === 'multi') return c.max_selections != null ? `Choose ${c.min_selections || 0}–${c.max_selections} options` : c.min_selections ? `Choose at least ${c.min_selections}` : 'Choose your options';
  return c.selection_type === 'combo' ? 'Choose one complete meal combination — all listed items are included.' : 'Choose one meal option';
}
function IncludedItems({ option, compact = false }) {
  if (!option.items?.length) return <p className="vm-includes-empty">The organizer hasn’t listed the included items yet.</p>;
  return <div className={`vm-includes ${compact ? 'vm-includes-compact' : ''}`}><span>Included in this meal</span><ul>{option.items.map((item, index) => <li key={item.menu_item_id || index}><span aria-hidden="true">✓</span><span>{item.quantity > 1 ? `${item.quantity} × ` : ''}{item.name}</span></li>)}</ul></div>;
}
export default function MealMenuView({ categories, menuDay, setMenuDay, choices, initialChoices, onChoose, saving, error, msg, canSubmit, categoryError, submit, hasExistingChoice, allDisplayOnly }) {
  const [view, setView] = useState('menu');
  const [categoryId, setCategoryId] = useState('');
  const [detail, setDetail] = useState(null);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const days = [...new Set(categories.map(c => c.day_label).filter(Boolean))];
  const visible = categories.filter(c => !days.length || !c.day_label || c.day_label === menuDay);
  const active = visible.find(c => c.id === categoryId) || visible[0];
  const selected = c => selectedIds(c, choices);
  const picked = c => options(c).filter(o => selected(c).includes(o.id));
  const saved = c => JSON.stringify(selected(c)) === JSON.stringify(selectedIds(c, {single: {}, multi: {}, combo: {}, ...initialChoices}));
  const pending = categories.filter(c => !c.display_only && categoryError(c));
  const total = categories.filter(c => !c.display_only && selected(c).length).length;
  const dirty = categories.some(c => !c.display_only && !saved(c));
  function showCategory(c) { setMenuDay(c.day_label || menuDay); setCategoryId(c.id); setView('menu'); }
  useEffect(() => {
    if (detail) { trigger.current = document.activeElement; dialog.current?.showModal(); }
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus?.(); }
  }, [detail]);
  const maxed = (c, o) => c.selection_type === 'multi' && c.max_selections != null && selected(c).length >= c.max_selections && !selected(c).includes(o.id);
  function choose(c, o) { if (!saving && !maxed(c, o)) onChoose(c, o.id); }
  function summary(c, editable = true) {
    return <div className="vm-summary-item" key={c.id}><div><small>{c.name}</small>{!c.display_only && selected(c).length > 0 && <span className="vm-state">{saved(c) ? '✓ Saved' : 'Unsaved'}</span>}</div><strong>{picked(c).map(o => o.name).join(', ') || (c.display_only ? 'Browse the menu' : 'No selection yet')}</strong>{c.selection_type === 'combo' && picked(c).map(o => <IncludedItems key={o.id} option={o} compact />)}{editable && <button type="button" disabled={saving} onClick={() => showCategory(c)}>{selected(c).length ? 'Change selection' : 'Explore menu'} →</button>}</div>;
  }
  return <div className="visual-meals">
    <nav className="vm-views" aria-label="Meal view"><button type="button" aria-pressed={view === 'menu'} onClick={() => setView('menu')}>Explore the menu</button>{!allDisplayOnly && <button type="button" aria-pressed={view === 'choices'} onClick={() => setView('choices')}>My selections ({total})</button>}</nav>
    <div className="vm-layout"><div className="vm-main">
      {days.length > 0 && <nav className="vm-days" aria-label="Menu day">{days.map(day => <button type="button" key={day} aria-pressed={day === menuDay} onClick={() => setMenuDay(day)}>{day}</button>)}</nav>}
      {view === 'menu' ? <>
        <nav className="vm-categories" aria-label="Meal category">{visible.map(c => <button type="button" key={c.id} aria-pressed={active?.id === c.id} onClick={() => setCategoryId(c.id)}>{c.name}</button>)}</nav>
        {active && <section aria-label={active.name}>
          <div className="vm-section-title"><div><h2>{active.name}</h2><p>{guidance(active)}</p></div><span className="vm-tag">{active.display_only ? 'Menu only' : active.is_required ? 'Required' : 'Optional'}</span></div>
          {active.selection_type === 'multi' && !active.display_only && <p className="vm-count">{selected(active).length}{active.max_selections != null ? ` of ${active.max_selections}` : ''} selected</p>}
          <div className="vm-grid">{options(active).map(o => {
            const isSelected = selected(active).includes(o.id);
            return <article className={`vm-dish ${isSelected ? 'vm-chosen' : ''}`} key={o.id}>
              <Plate seed={o.id} combination={active.selection_type === 'combo'} /><span className="vm-card-tag">{active.selection_type === 'combo' ? 'Meal combination' : 'Meal option'}</span>{isSelected && <span className="vm-check" aria-hidden="true">✓</span>}
              <div className="vm-dish-body"><h3>{o.name}</h3>{o.description && <p>{o.description}</p>}{active.selection_type === 'combo' && <IncludedItems option={o} />}
                <button type="button" className="vm-details" aria-label={`View details for ${o.name}`} onClick={() => setDetail({category: active, option: o})}>{active.selection_type === 'combo' ? 'View combination details' : 'View meal details'}</button>
                {!active.display_only && <label className={`vm-pick ${maxed(active, o) || saving ? 'vm-disabled' : ''}`}><input type={active.selection_type === 'multi' ? 'checkbox' : 'radio'} name={`visual-${active.id}`} aria-label={o.name} checked={isSelected} disabled={saving || maxed(active, o)} onChange={() => choose(active, o)} /><span>{isSelected ? '✓ Selected' : active.selection_type === 'combo' ? 'Choose this combination' : active.selection_type === 'multi' ? 'Add to my meal' : 'Choose this meal'}</span></label>}
              </div>
            </article>;
          })}</div>
          {!options(active).length && <p className="vm-empty">The organizer hasn’t added options to this category yet.</p>}
        </section>}
      </> : <section><div className="vm-section-title"><div><h2>Your selections</h2><p>{menuDay || 'Your event menu'} · Saving covers all menu days.</p></div></div>{visible.filter(c => !c.display_only).map(c => <div className="vm-choice-row" key={c.id}><Plate seed={picked(c)[0]?.id || c.id} small combination={c.selection_type === 'combo'} /><div>{summary(c)}</div></div>)}{!visible.some(c => !c.display_only) && <p className="vm-empty">No selectable meals on this menu day.</p>}</section>}
      {!allDisplayOnly && <form onSubmit={submit} className="vm-save-form">
        {pending.length > 0 && <div className="vm-required"><p>Complete these choices before saving:</p>{pending.map(c => <button type="button" key={c.id} onClick={() => showCategory(c)}>{c.day_label ? `${c.day_label} · ` : ''}{c.name}: {categoryError(c)}</button>)}</div>}
        <div className="vm-save-bar"><div><strong>{total ? `${total} ${total === 1 ? 'category' : 'categories'} selected` : 'Found your favourite?'}</strong><small>{dirty ? 'Changes not saved yet · All menu days' : total ? 'Your saved meal choices' : 'Choose from the organizer’s menu.'}</small></div><button type="submit" disabled={saving || !canSubmit}>{saving ? 'Saving…' : hasExistingChoice ? 'Update Selection' : 'Save Selection'}</button></div>
        {error && <p role="alert" className="vm-error">{error}</p>}{msg && <p role="status" className="vm-confirm">✓ {msg}</p>}
      </form>}
    </div><aside className="vm-summary" aria-label="Meal summary"><div className="vm-summary-heading"><span>YOUR DAY, SORTED</span><h2>{menuDay || 'Your event menu'}</h2><p>Your choices, all in one place.</p></div>{visible.map(c => summary(c))}<p className="vm-summary-note">Choices stay separate for each authorized attendee. Collection is recorded by event staff.</p></aside></div>
    <dialog className="vm-dialog" ref={dialog} onCancel={() => setDetail(null)} aria-labelledby="vm-detail-title"><div className="vm-dialog-head"><h2 id="vm-detail-title">{detail?.option.name}</h2><button type="button" aria-label="Close menu details" onClick={() => setDetail(null)}>×</button></div>{detail && <div className="vm-dialog-body"><Plate seed={detail.option.id} combination={detail.category.selection_type === 'combo'} />{detail.option.description && <p>{detail.option.description}</p>}{detail.category.selection_type === 'combo' && <IncludedItems option={detail.option} />}<p className="vm-detail-note">For ingredient or dietary questions, contact the organizer.</p>{!detail.category.display_only && <button type="button" className="vm-dialog-choose" disabled={saving || maxed(detail.category, detail.option)} onClick={() => { if (!selected(detail.category).includes(detail.option.id)) choose(detail.category, detail.option); setDetail(null); }}>Choose {detail.category.selection_type === 'combo' ? 'this combination' : 'this meal'}</button>}</div>}</dialog>
  </div>;
}
