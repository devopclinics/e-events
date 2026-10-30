export const OPERATIONS_SECTIONS = [
  { id: 'dashboard', group: 'Workspace', label: 'Overview', description: 'A clear view of organizations, events and platform work.' },
  { id: 'accounts', group: 'Workspace', label: 'Organizations', description: 'Manage organizations, members and account access.' },
  { id: 'overview', group: 'Access', label: 'Event access & credits', description: 'Review event entitlements, apply grants and manage message credits.' },
  { id: 'addon-access', group: 'Access', label: 'Organization add-ons', description: 'Allow, disallow or inherit add-on access across an organization.' },
  { id: 'operators', group: 'Access', label: 'Platform operators', description: 'Manage the people authorized to administer Festio.' },
  { id: 'org-plans', group: 'Billing & plans', label: 'Organization plans', description: 'Manage the plans available to organizations.' },
  { id: 'pricing', group: 'Billing & plans', label: 'Pricing catalog', description: 'Configure event plans, prices and message credit rates.' },
  { id: 'trials', group: 'Billing & plans', label: 'Trial requests', description: 'Review trial requests and resolve access decisions.' },
  { id: 'support', group: 'Support & quality', label: 'Support chat', description: 'Configure the support chat widget shown to organizers.' },
  { id: 'qa', group: 'Support & quality', label: 'QA submissions', description: 'Review submitted test results, notes and evidence.' },
  { id: 'usage', group: 'Usage & growth', label: 'Messaging usage', description: 'Review organization usage across email, SMS, WhatsApp and MMS.' },
  { id: 'referrals', group: 'Usage & growth', label: 'Referrals', description: 'Review referred organizations and conversion records.' },
  { id: 'affiliates', group: 'Usage & growth', label: 'Affiliate stores', description: 'Manage affiliate store destinations and referral parameters.' },
]

export function operationsSection(value) {
  return OPERATIONS_SECTIONS.find(section => section.id === value) || OPERATIONS_SECTIONS[0]
}
