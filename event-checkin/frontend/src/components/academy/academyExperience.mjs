export const ACADEMY_EVENT_ID = '74f334fd-ebaa-43dd-a998-2bd00a4564ae'
export const ACADEMY_GIVING_TOKEN = '0a9bae4d-85e5-41dd-9fd8-5acea115b7b3'
export const ACADEMY_ART = '/experiences/mumineen/campus-concept.png'
export const ACADEMY_MODES = [['vision', 'The vision'], ['live', 'Live giving'], ['reveal', 'The reveal']]
export const academyCampaign = (campaign, token) => campaign?.event_id === ACADEMY_EVENT_ID || (
  /^Mumineen Academy(?:\s|$)/i.test(campaign?.event_name || '') && [ACADEMY_GIVING_TOKEN, 'academy'].includes(token || campaign?.token)
)
export const givingMoney = (minor, currency = 'USD') => new Intl.NumberFormat(undefined, {
  style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0,
}).format((minor || 0) / 100)
export function givingProgress(campaign) {
  const confirmed = Math.max(0, campaign.confirmed_minor || 0), goal = Math.max(0, campaign.goal_minor || 0)
  const percent = goal ? Math.min(100, confirmed / goal * 100) : 0
  const milestone = goal ? Math.min(goal, (Math.floor(confirmed / (goal / 4)) + 1) * (goal / 4)) : 0
  return { confirmed, goal, percent, remaining: Math.max(0, goal - confirmed), milestone, milestoneRemaining: Math.max(0, milestone - confirmed) }
}
