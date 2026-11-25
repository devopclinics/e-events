// Display-only NCNMO branding. Event identities, schedules and access stay unchanged.
const NCNMO_EVENTS=new Set(['cefc5699-da7e-4610-9598-74a9423f0ea0','9f0326d7-bcac-4cb1-a273-4115abc4983d'])
export const isNCNMO=id=>NCNMO_EVENTS.has(id)
export function juniorEventName(event){return isNCNMO(event?.id)?'NCNMO Junior Platform 2026'+(event.id==='9f0326d7-bcac-4cb1-a273-4115abc4983d'?' · Practice':''):event?.name||'Festio Juniors'}
