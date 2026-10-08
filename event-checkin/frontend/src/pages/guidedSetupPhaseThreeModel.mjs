import { finalizeReadiness } from './guideReadiness.mjs'
export const PHASE_THREE_PROGRESS_PREFIX = 'phase3_'

export const PHASE_THREE_RECIPES = [
  { id: 'design', number: '3.1', title: 'Choose event design', outcomes: ['website', 'guesthub', 'community', 'rsvp', 'tickets'], route: '/design-studio-redesign', action: 'Open Design Studio', description: 'Choose the template, brand, typography and media that all guest-facing surfaces will reuse.' },
  { id: 'website', number: '3.2', title: 'Publish an event website', outcome: 'website', route: '/design-studio-redesign/website', action: 'Open Website Studio', description: 'Use synchronized event, venue, programme and registration data, then preview, publish and retain rollback history.' },
  { id: 'invitation', number: '3.3', title: 'Publish the invitation experience', outcome: 'rsvp', route: '/guests-redesign?tab=invite', action: 'Open invitation setup', description: 'Apply the event design to RSVP, review the inherited details and verify the public form and confirmation.' },
  { id: 'materials', number: '3.4', title: 'Create event materials', outcomes: ['website', 'rsvp', 'tickets'], route: '/design-studio-redesign?tab=Flyer', action: 'Create event materials', description: 'Generate the flyer, email presentation, Festio Pass and share assets from the same event design.' },
  { id: 'guesthub', number: '3.5', title: 'Launch GuestHub', outcome: 'guesthub', route: '/design-studio-redesign?tab=GuestHub', action: 'Configure GuestHub', description: 'Select guest modules, access rules and event information, then preview the result as a registered guest.' },
  { id: 'community', number: '3.6', title: 'Launch the guest community', outcome: 'community', route: '/festiome-redesign', action: 'Configure FestioMe', description: 'Set audience, privacy, groups, channels, moderation and notifications before opening the community.' },
  { id: 'speakers', number: '3.7', title: 'Publish speakers', outcomes: ['website', 'speakers'], route: '/addons-redesign?tab=speakers', action: 'Manage speakers', description: 'Reuse speaker profiles, photos and session relationships across the website and GuestHub.' },
  { id: 'partners', number: '3.8', title: 'Publish partners', outcomes: ['website', 'partners'], route: '/addons-redesign?tab=partners', action: 'Manage partners', description: 'Reuse partner and sponsor records, categories, logos and links across public surfaces.' },
]

const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : [])
const tested = (progress, key) => progress?.[`${PHASE_THREE_PROGRESS_PREFIX}${key}`] === 'completed'

export function selectedPhaseThreeRecipes(selectedOutcomes = []) {
  return PHASE_THREE_RECIPES.filter((recipe) => recipe.outcome
    ? selectedOutcomes.includes(recipe.outcome)
    : recipe.outcomes.some((outcome) => selectedOutcomes.includes(outcome)))
}

export function phaseThreeReadiness({ event = {}, progress = {}, selectedOutcomes = [], design = null, outputs = [], website = null, releases = [], guestHubSettings = null, festiomeStatus = null, festiomeGroups = [], speakers = [], speakerSettings = null, partners = [], partnerSettings = null, dataFailures = [] }) {
  const recipes = selectedPhaseThreeRecipes(selectedOutcomes)
  const outputRows = rows(outputs)
  const releaseRows = rows(releases)
  const groupRows = rows(festiomeGroups)
  const speakerRows = rows(speakers)
  const partnerRows = rows(partners)
  const designChosen = !!design?.selected_template_id
  const designReviewed = tested(progress, 'design_review')
  const websitePublished = !!website?.published_release_id && !website?.live_release_outdated && !website?.draft_is_newer
  const invitationReady = !!event.rsvp_enabled && !!event.rsvp_token
  const invitationTested = tested(progress, 'invitation_test')
  const materialsTested = tested(progress, 'materials_review')
  const guestHubEnabled = guestHubSettings?.guest_hub_enabled === true
  const guestHubTested = tested(progress, 'guesthub_test')
  const communityEnabled = festiomeStatus?.enabled === true && groupRows.length > 0
  const communityTested = tested(progress, 'community_test')
  const speakersPublished = speakerRows.length > 0 && !!speakerSettings?.speaker_token
  const partnersPublished = partnerRows.length > 0 && !!partnerSettings?.partner_token

  const stateById = {
    design: { complete: designChosen && designReviewed, blocked: false, evidence: `${designChosen ? 'Template selected' : 'No template selected'} · ${designReviewed ? 'responsive review verified' : 'responsive review pending'}` },
    website: { complete: websitePublished, blocked: !designChosen, evidence: websitePublished ? `Published · ${releaseRows.length} release${releaseRows.length === 1 ? '' : 's'} available` : website?.published_release_id ? 'Draft changes need publishing' : 'No published website release' },
    invitation: { complete: invitationReady && invitationTested, blocked: !invitationReady, evidence: `${invitationReady ? 'Public RSVP link ready' : 'RSVP link unavailable'} · ${invitationTested ? 'guest flow verified' : 'guest flow test pending'}` },
    materials: { complete: outputRows.length > 0 && materialsTested, blocked: !designChosen, evidence: `${outputRows.length} generated output${outputRows.length === 1 ? '' : 's'} · ${materialsTested ? 'review verified' : 'review pending'}` },
    guesthub: { complete: guestHubEnabled && guestHubTested, blocked: !guestHubEnabled, evidence: `${guestHubEnabled ? 'GuestHub enabled' : 'GuestHub disabled'} · ${guestHubTested ? 'registered-guest preview verified' : 'guest preview pending'}` },
    community: { complete: communityEnabled && communityTested, blocked: !festiomeStatus?.enabled, evidence: `${festiomeStatus?.enabled ? `${groupRows.length} community group${groupRows.length === 1 ? '' : 's'}` : 'FestioMe disabled'} · ${communityTested ? 'guest and moderator preview verified' : 'preview pending'}` },
    speakers: { complete: speakersPublished, blocked: speakerRows.length === 0, evidence: `${speakerRows.length} speaker profile${speakerRows.length === 1 ? '' : 's'} · ${speakerSettings?.speaker_token ? 'public page ready' : 'public page unavailable'}` },
    partners: { complete: partnersPublished, blocked: partnerRows.length === 0, evidence: `${partnerRows.length} partner profile${partnerRows.length === 1 ? '' : 's'} · ${partnerSettings?.partner_token ? 'public page ready' : 'public page unavailable'}` },
  }
  const visible = recipes.map((recipe) => ({ ...recipe, ...stateById[recipe.id] }))
  const complete = visible.filter((recipe) => recipe.complete).length
  const blocked = visible.filter((recipe) => recipe.blocked).length
  return { ...finalizeReadiness(3, visible, dataFailures) }
}
