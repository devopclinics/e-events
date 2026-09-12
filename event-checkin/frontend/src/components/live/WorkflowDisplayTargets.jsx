import { useEffect, useState } from 'react'

export default function WorkflowDisplayTargets({ run, displays = [], busy, onAssign }) {
  const assignment = (run?.display_ids || []).slice().sort().join(',')
  const [selected, setSelected] = useState([])
  useEffect(() => { setSelected(assignment ? assignment.split(',') : []) }, [run?.id, assignment])
  if (!run) return null
  const active = ['ready', 'live', 'paused'].includes(run.status)
  const changed = selected.slice().sort().join(',') !== assignment
  return <fieldset className="wf-output-targets" disabled={busy || !active}>
    <legend>Displays for this experience</legend>
    <div>{displays.map((display) => <label key={display.id}>
      <input type="checkbox" checked={selected.includes(display.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, display.id] : current.filter((id) => id !== display.id))}/>
      <span>{display.name}</span>
    </label>)}</div>
    {!displays.length && <p>Create a display in Festio Live to send this experience to a screen.</p>}
    <div><button type="button" disabled={!changed} onClick={() => onAssign(selected)}>Apply display selection</button>
      <button type="button" disabled={!assignment} onClick={() => onAssign([])}>Detach all displays</button></div>
    <small>{assignment ? `${assignment.split(',').length} display channel(s) assigned.` : 'No display assigned.'} Changing outputs keeps the current scene, timer and audience answers.</small>
  </fieldset>
}
