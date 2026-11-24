export const JUNIOR_PERMISSIONS={checkin:'Check-in, pickup & movements',children:'Add/correct children & guardians',support:'Support desks & restricted notes',outings:'Create & manage outings',inventory:'Manage inventory',messages:'Guardian contacts & notification history',volunteers:'Coordinate volunteers & shifts',reconcile:'Resolve previous-day movement records'}
const legacy={scanner:['checkin'],intake:['checkin','children','messages'],support:['checkin','support'],inventory:['inventory'],supervisor:Object.keys(JUNIOR_PERMISSIONS)}
export const juniorPermissions=config=>config?.permissions??legacy[config?.role]??[]
export const juniorCan=(config,key)=>juniorPermissions(config).includes(key)
export const juniorViewChildren=config=>juniorPermissions(config).some(key=>['checkin','children','support','outings','messages','reconcile'].includes(key))
