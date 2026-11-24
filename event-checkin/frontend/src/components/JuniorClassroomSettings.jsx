import {useEffect,useRef,useState} from 'react'

export default function JuniorClassroomSettings({config,call,reload,busy,onDirtyChange}) {
  const [draft,setDraft]=useState(()=>config.classrooms.join('\n'))
  const [baseline,setBaseline]=useState(()=>config.classrooms)
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('')
  const edited=useRef(false)
  const current=JSON.stringify(config.classrooms)
  useEffect(()=>{if(!edited.current){setDraft(config.classrooms.join('\n'));setBaseline(config.classrooms)}},[current])
  const rooms=[...new Set(draft.split(/\r?\n/).map(v=>v.trim()).filter(Boolean))]
  const changed=JSON.stringify(rooms)!==JSON.stringify(baseline)
  useEffect(()=>{onDirtyChange?.(changed)},[changed,onDirtyChange])
  async function save(e) {
    e.preventDefault();if(saving||busy||config.read_only)return
    setSaving(true);setError('');setSaved('')
    try {
      const result=await call('/classrooms','PUT',{classrooms:rooms,expected_classrooms:baseline})
      setDraft(result.classrooms.join('\n'));setBaseline(result.classrooms);edited.current=false
      setSaved(`${result.classrooms.length} classroom${result.classrooms.length===1?'':'s'} saved for this event.`)
      try{await reload()}catch{setError('Classrooms were saved. Refresh the page to reload the rest of the workspace.')}
    } catch(err) {setError(err.message)} finally {setSaving(false)}
  }
  return <section className="jp-classroom-settings" aria-label="Classroom settings"><h3>Classrooms</h3><p>{config.practice_mode?'You are editing practice classrooms. Live event classrooms are separate.':'These classrooms belong to the selected event.'} Add one room per line, then save here.</p><form onSubmit={save}><label>Classrooms (one per line)<textarea aria-label="Classrooms (one per line)" name="classrooms" rows={6} value={draft} onChange={e=>{edited.current=true;setDraft(e.target.value);setSaved('')}} disabled={saving||config.read_only}/></label><p aria-live="polite">{changed?'Unsaved classroom changes.':`${baseline.length} saved classroom${baseline.length===1?'':'s'}.`}</p>{JSON.stringify(baseline)!==current&&edited.current&&<p className="jp-warning">Saved classrooms changed while you were editing. Copy your new names before reloading the saved list.</p>}<div className="jp-row"><button className="jp-primary" type="submit" disabled={saving||busy||!changed||config.read_only}>{saving?'Saving classrooms…':'Save classrooms'}</button>{JSON.stringify(baseline)!==current&&<button type="button" disabled={saving||busy} onClick={()=>{edited.current=false;setBaseline(config.classrooms);setDraft(config.classrooms.join('\n'));setError('');setSaved('')}}>Reload saved classrooms</button>}</div>{error&&<p className="jp-error" role="alert">{error}</p>}{saved&&<p role="status" className="jp-success">{saved}</p>}</form><hr/></section>
}
