import { CERTIFICATE_TYPES, CERTIFICATE_LAYOUTS, applyCertificateType } from './certificateDesigns.mjs'
import './CertificateDesignChoices.css'
export default function CertificateDesignChoices({design,onChange,disabled}) {
  return <fieldset className="lc-design-choices" disabled={disabled}><legend>Certificate type and style</legend>
    <label className="lc-field"><span>Certificate type</span><select aria-label="Certificate type" value={CERTIFICATE_TYPES.some(type=>type.id===design.kind)?design.kind:'custom'} onChange={e=>onChange(applyCertificateType(design,e.target.value))}><option value="custom">Keep current wording</option>{CERTIFICATE_TYPES.map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
    <p>Choose wording and a style, then save. Create a new template to keep another version.</p>
    <div className="lc-design-layouts" role="group" aria-label="Certificate visual style">{CERTIFICATE_LAYOUTS.map(layout=><button key={layout.id} type="button" aria-pressed={(design.layout||'classic')===layout.id} onClick={()=>onChange({...design,layout:layout.id})}><span className={`lc-design-mini ${layout.id}`} aria-hidden="true"><i/><b/><em/></span><span>{layout.name}</span></button>)}</div>
  </fieldset>
}
