import {useEffect,useRef,useState} from 'react'
import './JuniorEntryTables.css'
const makeRows=names=>(names.length?names:['']).map(name=>({key:crypto.randomUUID(),name}))
export default function JuniorClassroomSettings({config,call,reload,busy,onDirtyChange}) {
  const [rows,setRows]=useState(()=>makeRows(config.classrooms))
  const [baseline,setBaseline]=useState(()=>config.classrooms)
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('')
  const edited=useRef(false)
  const current=JSON.stringify(config.classrooms)
  useEffect(()=>{if(!edited.current){setRows(makeRows(config.classrooms));setBaseline(config.classrooms)}},[current])
  const entered=rows.map(row=>row.name.trim()).filter(Boolean)
  const rooms=[...new Set(entered)]
  const duplicate=rooms.length!==entered.length
  const changed=JSON.stringify(rooms)!==JSON.stringify(baseline)
  useEffect(()=>{onDirtyChange?.(changed||duplicate)},[changed,duplicate,onDirtyChange])
  const disabled=saving||busy||config.read_only
  function edit(next){edited.current=true;setRows(next);setSaved('');setError('')}
  async function save(e) {
    e.preventDefault();if(disabled||duplicate)return
    setSaving(true);setError('');setSaved('')
    try {
      const result=await call('/classrooms','PUT',{classrooms:rooms,expected_classrooms:baseline})
      setRows(makeRows(result.classrooms));setBaseline(result.classrooms);edited.current=false
      setSaved(`${result.classrooms.length} classroom${result.classrooms.length===1?'':'s'} saved for this event.`)
      try{await reload()}catch{setError('Classrooms were saved. Refresh the page to reload the rest of the workspace.')}
    } catch(err) {setError(err.message)} finally {setSaving(false)}
  }
  return <section className="jp-classroom-settings" aria-label="Classroom settings"><h3>Classrooms</h3><p>{config.practice_mode?'You are editing practice classrooms. Live event classrooms are separate.':'These classrooms belong to the selected event.'} Enter one classroom per row, then save here.</p><form onSubmit={save} className="jp-entry-form"><div className="jp-entry-scroll"><table className="jp-entry-table jp-classroom-entry-table" aria-label="Classrooms"><thead><tr><th scope="col">#</th><th scope="col">Classroom name</th><th scope="col">Remove</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.key}><td>{index+1}</td><td><input aria-label={`Classroom ${index+1} name`} value={row.name} maxLength={100} disabled={disabled} placeholder="e.g. Room A" onChange={e=>edit(rows.map(r=>r.key===row.key?{...r,name:e.target.value}:r))} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault()}}/></td><td><button type="button" disabled={disabled} aria-label={`Remove classroom row ${index+1}`} onClick={()=>edit(rows.length===1?makeRows([]):rows.filter(r=>r.key!==row.key))}>×</button></td></tr>)}</tbody></table></div><button type="button" disabled={disabled||rows.length>=100} onClick={()=>edit([...rows,...makeRows([])])}>+ Add classroom row</button><p aria-live="polite">{changed||duplicate?'Unsaved classroom changes.':`${baseline.length} saved classroom${baseline.length===1?'':'s'}.`}</p>{duplicate&&<p className="jp-error" role="alert">Each classroom needs a unique name. Remove or rename the duplicate row.</p>}{JSON.stringify(baseline)!==current&&edited.current&&<p className="jp-warning">Saved classrooms changed while you were editing. Your draft is retained. Reset to saved to load the latest list.</p>}<div className="jp-row"><button className="jp-primary" type="submit" disabled={disabled||!changed||duplicate}>{saving?'Saving classrooms…':'Save classrooms'}</button>{(changed||duplicate||JSON.stringify(baseline)!==current)&&<button type="button" disabled={disabled} onClick={()=>{edited.current=false;setBaseline(config.classrooms);setRows(makeRows(config.classrooms));setError('');setSaved('')}}>Reset to saved</button>}</div>{error&&<p className="jp-error" role="alert">{error}</p>}{saved&&<p role="status" className="jp-success">{saved}</p>}</form><hr/></section>
}
