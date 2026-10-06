import { useState } from 'react'
import { api } from '../api'

function multiBoundsLabel(min, max) {
  if (min > 0 && max != null) return `Pick ${min} to ${max}`
  if ((min === 0 || min == null) && max != null) return `Pick up to ${max}`
  if (min > 0 && max == null) return `Pick at least ${min}`
  return `Pick as many as you'd like`
}

function CategoryHeader({ name, required, helper }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wide">{name}</p>
      <div className="flex items-center gap-2">
        {helper && <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{helper}</span>}
        {required && (
          <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-200 text-amber-800 dark:bg-amber-700 dark:text-amber-50 px-1.5 py-0.5 rounded">
            Required
          </span>
        )}
      </div>
    </div>
  )
}

function SingleCategory({ category, value, onChange }) {
  return (
    <div>
      <CategoryHeader
        name={category.name}
        required={category.is_required}
        helper={category.is_required ? 'Pick one' : 'Pick one (optional)'}
      />
      <div className="space-y-2">
        {category.items.map((item) => {
          const selected = value === item.id
          return (
            <label
              data-meal-option="" data-selected={selected}
              key={item.id}
              className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                selected
                  ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-300'
                  : 'border-slate-300 dark:border-slate-600 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10'
              }`}
            >
              <input
                type="radio"
                name={`cat-${category.id}`}
                value={item.id}
                checked={selected}
                onChange={() => onChange(item.id)}
                className="mt-1 w-5 h-5 accent-amber-500"
              />
              <div className="flex-1">
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                {item.description && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.description}</div>
                )}
              </div>
              {selected && (
                <svg className="w-5 h-5 text-amber-600 mt-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function MultiCategory({ category, value, onChange }) {
  const min = category.min_selections || 0
  const max = category.max_selections
  const selectedIds = value || []
  const count = selectedIds.length
  const maxForCheck = max == null ? Infinity : max
  const inBounds = count >= min && count <= maxForCheck
  const required = !!category.is_required || min > 0
  const countLabel = max != null ? `${count} of ${max} selected` : `${count} selected`

  function toggle(itemId) {
    const has = selectedIds.includes(itemId)
    if (has) {
      onChange(selectedIds.filter((id) => id !== itemId))
    } else {
      if (max != null && count >= max) return
      onChange([...selectedIds, itemId])
    }
  }

  return (
    <div>
      <CategoryHeader name={category.name} required={required} helper={multiBoundsLabel(min, max)} />
      <p className={`text-xs mb-2 font-semibold ${inBounds ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
        {countLabel}
      </p>
      <div className="space-y-2">
        {category.items.map((item) => {
          const selected = selectedIds.includes(item.id)
          const atMax = max != null && count >= max && !selected
          return (
            <label
              data-meal-option="" data-selected={selected}
              key={item.id}
              className={`flex items-start gap-3 p-3 rounded-lg border-2 transition-all ${
                selected
                  ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-300 cursor-pointer'
                  : atMax
                    ? 'border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed'
                    : 'border-slate-300 dark:border-slate-600 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={selected}
                disabled={atMax}
                onChange={() => toggle(item.id)}
                className="mt-1 w-5 h-5 accent-amber-500"
              />
              <div className="flex-1">
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                {item.description && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.description}</div>
                )}
              </div>
              {selected && (
                <svg className="w-5 h-5 text-amber-600 mt-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function ComboCategory({ category, value, onChange }) {
  const combos = category.combinations || []
  if (combos.length === 0) {
    return (
      <div>
        <CategoryHeader name={category.name} helper="Combinations coming soon" />
        <div className="text-xs italic text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-3 text-center">
          The host hasn't added any combinations to this section yet.
        </div>
      </div>
    )
  }
  function pick(comboId) {
    // Required combos can't be cleared by re-tap; optional ones can.
    if (category.is_required) onChange(comboId)
    else onChange(value === comboId ? null : comboId)
  }
  return (
    <div>
      <CategoryHeader
        name={category.name}
        required={category.is_required}
        helper={category.is_required ? 'Pick one' : 'Pick one (optional)'}
      />
      <div className="space-y-3">
        {combos.map((combo) => {
          const selected = value === combo.id
          return (
            <label
              data-meal-option="" data-selected={selected}
              key={combo.id}
              className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${
                selected
                  ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-300 scale-[1.01] shadow-md'
                  : 'border-slate-300 dark:border-slate-600 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name={`combo-${category.id}`}
                  value={combo.id}
                  checked={selected}
                  onChange={() => pick(combo.id)}
                  onClick={() => selected && pick(combo.id)}
                  className="mt-1 w-5 h-5 accent-amber-500 shrink-0"
                />
                <div className="flex-1">
                  <div className="text-base font-bold text-slate-900 dark:text-slate-100">{combo.name}</div>
                  {combo.items && combo.items.length > 0 && (
                    <div className="text-sm text-amber-800 dark:text-amber-200 font-medium mt-1">
                      {combo.items.map((it) => it.name).join(', ')}
                    </div>
                  )}
                  {combo.description && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">{combo.description}</div>
                  )}
                </div>
                {selected && (
                  <svg className="w-5 h-5 text-amber-600 mt-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function DisplayCategory({ category }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{category.name}</h4>
      <ul className="mt-2 space-y-1.5">
        {category.items.map((i) => (
          <li key={i.id} className="text-sm text-slate-700 dark:text-slate-300">
            <span className="font-medium">{i.name}</span>
            {i.description && <span className="text-xs text-slate-500 dark:text-slate-400"> — {i.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function MenuSelection({ token, categories, initialChoices, mealServed, embedded = false, onSaved, onSavingChange }) {
  // Multi-day menus: categories may carry a day_label; render one day at a time
  // behind tabs. Label-less categories stay visible on every tab.
  const dayLabels = [...new Set(categories.filter((c) => c.day_label).map((c) => c.day_label))]
  const [menuDay, setMenuDay] = useState(dayLabels[0] || '')
  const selectable = categories.filter((c) => !c.display_only)
  const allDisplayOnly = selectable.length === 0
  const visibleCategories = dayLabels.length
    ? categories.filter((c) => !c.day_label || c.day_label === menuDay)
    : categories
  const [single, setSingle] = useState(initialChoices?.single || {})
  const [multi, setMulti] = useState(initialChoices?.multi || {})
  const [combo, setCombo] = useState(initialChoices?.combo || {})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const hasExistingChoice = saved ||
    Object.keys(initialChoices?.single || {}).length > 0 ||
    Object.keys(initialChoices?.multi || {}).length > 0 ||
    Object.keys(initialChoices?.combo || {}).length > 0

  // Required gating respects each category's is_required flag.
  // For multi: max is always enforced; min is enforced when required OR when
  // the guest has already started picking from this category.
  function categoryError(cat) {
    if (cat.selection_type === 'single') {
      if (cat.is_required && !single[cat.id]) return 'Please pick one option.'
      return null
    }
    if (cat.selection_type === 'combo') {
      if (cat.is_required && !combo[cat.id]) return 'Please pick a combination.'
      return null
    }
    if (cat.selection_type === 'multi') {
      const arr = multi[cat.id] || []
      const min = cat.min_selections || 0
      const max = cat.max_selections == null ? Infinity : cat.max_selections
      if (arr.length > max) return `Pick at most ${cat.max_selections}.`
      const needMin = cat.is_required || arr.length > 0
      if (needMin && arr.length < min) return `Pick at least ${min}.`
      return null
    }
    return null
  }

  const canSubmit = selectable.every((cat) => categoryError(cat) === null)

  async function submit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    onSavingChange?.(true)
    setMsg('')
    setError('')
    try {
      await api.submitMenuChoice(token, { single, multi, combo })
      setSaved(true)
      setMsg(embedded ? 'Meal selection saved.' : hasExistingChoice ? 'Selection updated!' : 'Order selection saved!')
      onSaved?.({ single, multi, combo })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
      onSavingChange?.(false)
    }
  }

  if (mealServed && !allDisplayOnly) {
    return (
      <div className="border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 text-center">
        <p className="text-sm text-amber-700 dark:text-amber-200 font-semibold">Your order has been served — selection is locked</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">You're all set.</p>
      </div>
    )
  }

  return (
    <div className="meal-picker border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 rounded-xl overflow-hidden shadow-md">
      <div className="meal-picker-heading bg-amber-400 dark:bg-amber-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🍽️</span>
          <div>
            <h3 className="text-base font-bold">{allDisplayOnly ? 'Food menu' : 'Pick your items'}</h3>
            <p className="text-xs text-amber-50">
              {allDisplayOnly ? 'What is being served at this event.' : hasExistingChoice ? 'Tap any option to change your choice.' : 'Tap to choose what you want.'}
            </p>
          </div>
        </div>
      </div>
      <form onSubmit={submit} onChange={() => { setMsg(''); setError(''); }} className="p-4 space-y-5 bg-white dark:bg-slate-900">
        <fieldset disabled={saving} className="space-y-5 min-w-0">
        {dayLabels.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Menu day">
            {dayLabels.map((day) => (
              <button key={day} type="button" aria-pressed={menuDay === day} onClick={() => setMenuDay(day)}
                className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition-colors ${menuDay === day ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'}`}>
                {day}
              </button>
            ))}
          </div>
        )}
        {visibleCategories.map((cat) => {
          if (cat.display_only) {
            return <DisplayCategory key={cat.id} category={cat} />
          }
          const err = categoryError(cat)
          return (
            <div key={cat.id}>
              {cat.selection_type === 'single' && (
                <SingleCategory
                  category={cat}
                  value={single[cat.id]}
                  onChange={(itemId) => setSingle((prev) => ({ ...prev, [cat.id]: itemId }))}
                />
              )}
              {cat.selection_type === 'multi' && (
                <MultiCategory
                  category={cat}
                  value={multi[cat.id]}
                  onChange={(ids) => setMulti((prev) => ({ ...prev, [cat.id]: ids }))}
                />
              )}
              {cat.selection_type === 'combo' && (
                <ComboCategory
                  category={cat}
                  value={combo[cat.id]}
                  onChange={(comboId) => setCombo((prev) => ({ ...prev, [cat.id]: comboId }))}
                />
              )}
              {err && <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-2">{err}</p>}
            </div>
          )
        })}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>}
        {msg && <p role="status" className="text-sm text-green-600 dark:text-green-400 font-bold text-center">✓ {msg}</p>}
        {!allDisplayOnly && (
        <button
          type="submit"
          disabled={saving || !canSubmit}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-lg text-base font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : hasExistingChoice ? 'Update Selection' : 'Save Selection'}
        </button>
        )}
        </fieldset>
      </form>
    </div>
  )
}

