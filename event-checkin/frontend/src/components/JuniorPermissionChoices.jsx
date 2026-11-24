import {JUNIOR_PERMISSIONS} from '../utils/juniorPermissions'
export default function JuniorPermissionChoices({role,value,onChange,disabled,prefix='Volunteer'}){
 if(role==='admin')return <p className="jp-notice">Admin has full Festio Juniors access for this event.</p>
 return <fieldset className="jp-permission-choices"><legend>Volunteer permissions</legend>{Object.entries(JUNIOR_PERMISSIONS).map(([key,label])=><label className="jp-check" key={key}><input type="checkbox" aria-label={`${prefix}: ${label}`} checked={value.includes(key)} disabled={disabled} onChange={()=>onChange(value.includes(key)?value.filter(v=>v!==key):[...value,key])}/>{label}</label>)}<p>All volunteers can open the guide and their own shifts. Only checked permissions grant access to other sections.</p></fieldset>
}
