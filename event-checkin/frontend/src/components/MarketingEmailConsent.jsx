export default function MarketingEmailConsent({ checked, onChange, disabled = false }) {
  return (
    <label className="flex items-start gap-3 text-sm leading-5 text-slate-600 dark:text-slate-300" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
      <input
        type="checkbox"
        name="marketing_email_consent"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-1 h-4 w-4 shrink-0 accent-teal-600"
        style={{ width: 16, height: 16 }}
      />
      <span>Email me Festio product news and offers (optional). I can unsubscribe at any time. This choice does not affect account or demo-request service messages.</span>
    </label>
  )
}
