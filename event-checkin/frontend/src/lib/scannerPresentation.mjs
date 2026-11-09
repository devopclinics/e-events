// Presentation only: access, seating and attendance remain server decisions.
export function scannerPresentedResult(result,event) {
  if(!result)return result
  const config=event?.setup_preferences?.scanner_presentation
  if(!config?.focused)return result
  const context=result.scanner_context||{mode:'admission'}
  const denied=result.denied||['denied','invalid','guardian_required','group_pass_required'].includes(result.status)
  const exit=context.direction==='out'||context.mode==='checkout'
  const zone=context.zone_id
  const allowed=new Set(zone?(config.zone_step_ids?.[zone]||[]):(config.admission_step_ids||[]))
  // A bound session is completed atomically by the scan itself; no second button.
  const bound=event?.setup_preferences?.session_attendance_steps?.[zone]
  if(bound)allowed.add(bound)
  const steps=(result.experience_next_steps||[]).filter(({step})=>{
    if(step.required&&step.blocks_checkin)return !exit && result.status==='pending_required_step'
    return !denied&&!exit&&allowed.has(step.id)
  })
  return {...result,experience_next_steps:steps}
}
