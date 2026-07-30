// GENERATED FILE — do not hand-edit.
// Source: docs/api-contract/openapi.json (backend OpenAPI document).
// Regenerate: node scripts/generate-api-types.mjs
// Drift check (CI): ./scripts/check-api-contract-drift.sh
//
// Covers every named request/response schema FastAPI generates from the
// Pydantic models in backend/app/schemas.py. Pull one into a plain .js/.jsx
// file with a JSDoc annotation — no build step, no runtime import (a .d.ts
// has no JS output; editors resolve the type-only import statically):
//   /** @type {import('../types/api').GuestOut[]} */
//   const guests = await api.listGuests(eventId)

export interface AccountMemberOut {
  email: string
  is_active: boolean
  is_platform_superadmin: boolean
  name: string
  role: string
  user_id: string
}

export interface AccountOrgOut {
  created_at: string
  event_count: number
  id: string
  is_active: boolean
  members?: (AccountMemberOut)[]
  name: string
  redesign_cohort?: string
  slug: string
}

export interface ActiveToggle {
  active: boolean
}

export interface AffiliateStoreIn {
  active?: boolean
  domain: string
  label: string
  param_key: string
  param_value: string
  sort_order?: number
}

export interface AffiliateStoreOut {
  active: boolean
  domain: string
  id: string
  label: string
  param_key: string
  param_value: string
  sort_order: number
}

export interface AnnouncementRequest {
  body: string
  escalation_channels?: ('email' | 'sms' | 'mms' | 'whatsapp')[]
  escalation_media_url?: (string) | null
  kind?: string
  title: string
  urgent?: boolean
}

export interface ApiKeyCreate {
  name: string
  scope?: 'read_only' | 'read_write'
}

export interface ApiKeyCreated {
  created_at: string
  id: string
  key: string
  key_prefix: string
  last_used_at?: (string) | null
  name: string
  revoked_at?: (string) | null
  scope: string
}

export interface ApiKeyOut {
  created_at: string
  id: string
  key_prefix: string
  last_used_at?: (string) | null
  name: string
  revoked_at?: (string) | null
  scope: string
}

export interface AssignUserRequest {
  user_id: string
}

export interface Body_import_contacts_csv_api_organizations_me_contact_lists__list_id__contacts_csv_post {
  file: string
}

export interface Body_upload_asset_api_events__event_id__design_assets_post {
  file: string
}

export interface Body_upload_calendar_logo_api_organizations_me_calendars__calendar_id__upload_logo_post {
  file: string
}

export interface Body_upload_cover_image_api_events__event_id__upload_cover_post {
  file: string
}

export interface Body_upload_floor_bg_api_events__event_id__floor_plan_bg_post {
  file: string
}

export interface Body_upload_guests_api_events__event_id__guests_upload_post {
  file: string
}

export interface Body_upload_task_attachment_api_events__event_id__tasks__task_id__attachments_post {
  file: string
}

export interface BroadcastExtraRecipient {
  email?: (string) | null
  name: string
  phone?: (string) | null
}

export interface BroadcastRequest {
  channels?: ('email' | 'sms' | 'whatsapp' | 'mms')[]
  extra_recipients?: (BroadcastExtraRecipient)[]
  guest_ids?: (string)[]
  message: string
  mms_media_url?: (string) | null
  target?: 'all' | 'admitted' | 'not_admitted' | 'confirmed' | 'declined' | 'no_reply' | 'none'
}

export interface BroadcastResult {
  broadcast_log_id?: (string) | null
  queued: number
  skipped_no_consent: number
  skipped_no_contact: number
  skipped_no_credits?: number
}

export interface BulkAssignGroupRequest {
  guest_ids: (string)[]
  table_group_id?: (string) | null
}

export interface BulkAssignHouseholdRequest {
  guest_ids: (string)[]
  household_id?: (string) | null
}

export interface CalendarContactListsUpdate {
  contact_list_ids?: (string)[]
}

export interface CalendarCreate {
  description?: (string) | null
  hide_past_events?: boolean
  title: string
  visibility?: 'public' | 'private'
}

export interface CalendarEventReorder {
  event_ids: (string)[]
}

export interface CalendarOut {
  contact_list_ids?: (string)[]
  created_at: string
  description?: (string) | null
  event_click_counts?: Record<string, number>
  event_ids?: (string)[]
  hide_past_events: boolean
  id: string
  logo_url?: (string) | null
  logo_width?: (number) | null
  share_token?: (string) | null
  title: string
  updated_at: string
  view_count?: number
  visibility: string
}

export interface CalendarUpdate {
  description?: (string) | null
  hide_past_events?: (boolean) | null
  logo_width?: (number) | null
  title?: (string) | null
  visibility?: ('public' | 'private') | null
}

export interface CheckoutOut {
  provider: string
  url: string
}

export interface CheckoutRequest {
  event_id: string
  tier: string
}

export interface ConsentFormOut {
  body: string
  created_at: string
  created_by?: (string) | null
  event_id: string
  id: string
  is_active: boolean
  require_signature: boolean
  title: string
  updated_at: string
  version: number
}

export interface ConsentFormUpsert {
  body: string
  require_signature?: boolean
  title?: string
}

export interface ConsentSignatureCreate {
  signature_text: string
  signer_name: string
}

export interface ConsentSignatureOut {
  created_at: string
  event_id: string
  form_id: string
  guest_id: string
  id: string
  sent_copy_at?: (string) | null
  signature_text: string
  signed_at: string
  signer_name: string
}

export interface ContactCreate {
  email: string
  first_name: string
  last_name?: (string) | null
}

export interface ContactListCreate {
  name: string
}

export interface ContactListOut {
  contact_count?: number
  created_at: string
  id: string
  name: string
}

export interface ContactOut {
  created_at: string
  email: string
  first_name: string
  id: string
  last_name?: (string) | null
}

export interface ContactPaste {
  text: string
}

export interface CreditRateUpsert {
  credits_per_unit: number
}

export interface CurrencyRequest {
  currency: 'USD' | 'NGN'
  event_id: string
}

export interface DashboardBreakdown {
  admitted?: number
  capacity?: (number) | null
  name: string
  pending?: number
  total?: number
}

export interface DashboardChannelDelivery {
  channel: string
  delivered?: number
  failed?: number
  sent?: number
}

export interface DashboardContactStats {
  both_available?: number
  email_available?: number
  invite_failed?: number
  invite_sent?: number
  no_contact?: number
  phone_available?: number
  responses_received?: number
}

export interface DashboardCredits {
  balance?: number
  spent?: number
}

export interface DashboardEmailDelivery {
  bounced?: number
  clicked?: number
  complained?: number
  delayed?: number
  delivered?: number
  failed?: number
  opened?: number
  sent?: number
  suppressed?: number
  tracked?: number
  unknown?: number
}

export interface DashboardInviteDelivery {
  failed?: number
  sent?: number
  unsent?: number
}

export interface DashboardStats {
  admitted: number
  admitted_guests: (GuestOut)[]
  arrival_timeline?: (DashboardTimelinePoint)[]
  catering_served?: (number) | null
  catering_total?: (number) | null
  checked_out?: number
  checkout_enabled?: boolean
  contact_stats?: DashboardContactStats
  credits?: DashboardCredits
  email_delivery?: DashboardEmailDelivery
  invite_delivery?: DashboardInviteDelivery
  message_delivery?: (DashboardChannelDelivery)[]
  pending: number
  pending_guests?: (GuestOut)[]
  rsvp_confirmed?: number
  rsvp_declined?: number
  rsvp_invited?: number
  rsvp_pending?: number
  table_groups?: (DashboardBreakdown)[]
  tables?: (TableReport)[]
  ticket_types?: (DashboardBreakdown)[]
  total: number
  vip_admitted?: number
  vip_total?: number
  walk_in?: number
  zones?: (ZoneOccupancy)[]
}

export interface DashboardTimelinePoint {
  count: number
  label: string
}

export interface DemoRequestCreate {
  contact_name: string
  email: string
  event_name?: (string) | null
  guest_count?: (number) | null
  message?: (string) | null
  organization?: (string) | null
  phone?: (string) | null
  preferred_time: string
  timezone?: (string) | null
}

export interface DemoRequestOut {
  message: string
  ok?: boolean
}

export interface EventBrief {
  checkout_enabled?: boolean
  couples_name: string
  event_date: string
  experience_enabled?: boolean
  festiome_addon_enabled?: boolean
  festiome_enabled?: boolean
  live_program_enabled?: boolean
  menu_enabled?: boolean
  name: string
  notify_sms?: boolean
  notify_whatsapp?: boolean
  partner_pairing_enabled?: boolean
  registry_enabled?: boolean
  registry_message?: (string) | null
  registry_token?: (string) | null
  seating_enabled?: boolean
  seating_term?: (string) | null
  status: string
}

export interface EventControls {
  blocked_comm_features?: ('guest_hub' | 'guest_chat' | 'host_messages' | 'announcements' | 'festiome')[]
  blocked_messaging_channels?: ('email' | 'sms' | 'whatsapp' | 'mms')[]
}

export interface EventCreate {
  admission_note?: (string) | null
  checkin_base_url: string
  couples_name?: (string) | null
  description?: (string) | null
  event_date: string
  event_end_date?: (string) | null
  event_type?: (string) | null
  hotel_address?: (string) | null
  hotel_name?: (string) | null
  name: string
  notify_sms?: (boolean) | null
  notify_whatsapp?: (boolean) | null
  rsvp_capacity?: (number) | null
  timezone: string
  venue_address?: (string) | null
  venue_name?: (string) | null
}

export interface EventMemberOut {
  access_level?: string
  assigned_at: string
  can_manage_guests?: boolean
  can_manage_menu?: boolean
  can_reassign_seats: boolean
  can_view_dashboard?: boolean
  can_view_guests?: boolean
  event_role?: string
  id: string
  section_group_ids?: (string)[]
  updated_at?: (string) | null
  user: UserOut
}

export interface EventOut {
  admission_note?: (string) | null
  blocked_comm_features?: ((string)[]) | null
  blocked_messaging_channels?: ((string)[]) | null
  channel_policy?: (Record<string, unknown>) | null
  checkin_base_url: string
  checkout_enabled?: boolean
  couples_name: string
  created_at: string
  default_guest_table_group_id?: (string) | null
  description: (string) | null
  enforce_table_groups?: boolean
  event_code?: (string) | null
  event_date: string
  event_end_date?: (string) | null
  event_type?: (string) | null
  experience_enabled?: boolean
  festiome_addon_enabled?: boolean
  festiome_enabled?: boolean
  festiome_id?: (string) | null
  festiome_last_error?: (string) | null
  festiome_last_sync_at?: (string) | null
  festiome_open_url?: (string) | null
  guest_cap?: (number) | null
  hotel_address?: (string) | null
  hotel_name?: (string) | null
  id: string
  invite_cover_image?: (string) | null
  invite_message?: (string) | null
  invite_mode?: string
  invite_theme?: string
  is_paid?: boolean
  live_program_enabled?: boolean
  logistics_enabled?: boolean
  manual_checkin_enabled?: boolean
  menu_enabled: boolean
  message_credits?: number
  my_access_level?: string
  my_access_role?: string
  my_can_manage_event?: boolean
  my_can_manage_guests?: boolean
  my_can_view_guests?: boolean
  my_redesign_accessible?: boolean
  my_redesign_cohort?: string
  name: string
  notify_email?: boolean
  notify_mms?: boolean
  notify_rsvp_responses?: boolean
  notify_sms?: boolean
  notify_whatsapp?: boolean
  paid_channels?: boolean
  partner_pairing_enabled?: boolean
  plan_tier?: string
  post_event_thankyou_audience?: string
  post_event_thankyou_delay_hours?: number
  post_event_thankyou_enabled?: boolean
  post_event_thankyou_sent_at?: (string) | null
  registry_enabled?: boolean
  rsvp_allow_duplicate_emails?: boolean
  rsvp_capacity?: (number) | null
  rsvp_category_seating_rules?: (Record<string, Record<string, (string) | null>>) | null
  rsvp_collect_email?: boolean
  rsvp_collect_phone?: boolean
  rsvp_deadline?: (string) | null
  rsvp_email_required?: boolean
  rsvp_enabled?: boolean
  rsvp_invitee_email_required?: boolean
  rsvp_invitee_phone_required?: boolean
  rsvp_multi_invitee_enabled?: boolean
  rsvp_multi_invitee_limit?: number
  rsvp_multi_invitee_limit_rules?: (Record<string, number>) | null
  rsvp_phone_required?: boolean
  rsvp_require_approval?: boolean
  rsvp_token?: (string) | null
  seating_enabled: boolean
  seating_term?: (string) | null
  section_mode_enabled?: boolean
  self_checkin_enabled?: boolean
  source_last_error?: (string) | null
  source_last_sync_at?: (string) | null
  source_last_warning?: (string) | null
  source_sync_enabled?: boolean
  source_sync_interval_seconds?: number
  source_url?: (string) | null
  status: string
  timezone?: (string) | null
  updated_at?: (string) | null
  venue_access_enabled?: boolean
  venue_address?: (string) | null
  venue_name?: (string) | null
  walk_in_enabled?: boolean
  walk_in_table_group_id?: (string) | null
}

export interface EventResetRequest {
  checkins?: boolean
  group_assignments?: boolean
  guests?: boolean
  seat_assignments?: boolean
  table_groups?: boolean
  tables?: boolean
}

export interface EventSourceUpdate {
  source_sync_enabled?: (boolean) | null
  source_sync_interval_seconds?: (number) | null
  source_url?: (string) | null
}

export interface EventUpdate {
  admission_note?: (string) | null
  checkin_base_url?: (string) | null
  couples_name?: (string) | null
  description?: (string) | null
  event_date?: (string) | null
  event_end_date?: (string) | null
  event_type?: (string) | null
  hotel_address?: (string) | null
  hotel_name?: (string) | null
  name?: (string) | null
  notify_email?: (boolean) | null
  notify_sms?: (boolean) | null
  notify_whatsapp?: (boolean) | null
  timezone?: (string) | null
  venue_address?: (string) | null
  venue_name?: (string) | null
}

export interface ExperienceDashboardOut {
  completed_total?: number
  completion_rate?: number
  event_id: string
  guest_total?: number
  progress_total?: number
  step_count?: number
  steps?: (ExperienceStepDashboardOut)[]
  workflow?: (ExperienceWorkflowOut) | null
}

export interface ExperienceEventOut {
  actor_user_id?: (string) | null
  event_id: string
  event_type: string
  guest_id?: (string) | null
  id: string
  occurred_at: string
  payload?: (Record<string, unknown>) | null
  source: string
  step_id?: (string) | null
  workflow_id: string
}

export interface ExperienceNextStepOut {
  progress?: (GuestExperienceProgressOut) | null
  step: ExperienceStepOut
}

export interface ExperienceProgressUpdate {
  metadata?: (Record<string, unknown>) | null
  override_reason?: (string) | null
  status: 'available' | 'blocked' | 'completed' | 'skipped' | 'failed' | 'overridden'
}

export interface ExperienceStepCreate {
  conditions?: (Record<string, unknown>) | null
  config?: (Record<string, unknown>) | null
  description?: (string) | null
  duration_seconds?: (number) | null
  enabled?: boolean
  is_segment?: boolean
  key: string
  required?: boolean
  sort_order?: number
  starts_offset_seconds?: (number) | null
  title: string
  type: 'rsvp' | 'approval' | 'check_in' | 'consent' | 'souvenir' | 'badge' | 'room_assignment' | 'seating_assignment' | 'meal_selection' | 'session_attendance' | 'certificate' | 'checkout' | 'feedback' | 'custom'
}

export interface ExperienceStepDashboardOut {
  available?: number
  blocked?: number
  completed?: number
  completion_rate?: number
  enabled: boolean
  failed?: number
  key: string
  not_started?: number
  overridden?: number
  required: boolean
  skipped?: number
  sort_order: number
  step_id: string
  title: string
  total?: number
  type: string
}

export interface ExperienceStepOut {
  conditions?: (Record<string, unknown>) | null
  config?: (Record<string, unknown>) | null
  created_at: string
  description?: (string) | null
  duration_seconds?: (number) | null
  enabled: boolean
  id: string
  is_segment?: boolean
  key: string
  required: boolean
  sort_order: number
  starts_offset_seconds?: (number) | null
  title: string
  type: string
  updated_at: string
  workflow_id: string
}

export interface ExperienceStepReorder {
  step_ids?: (string)[]
}

export interface ExperienceStepUpdate {
  conditions?: (Record<string, unknown>) | null
  config?: (Record<string, unknown>) | null
  description?: (string) | null
  duration_seconds?: (number) | null
  enabled?: (boolean) | null
  is_segment?: (boolean) | null
  key?: (string) | null
  required?: (boolean) | null
  sort_order?: (number) | null
  starts_offset_seconds?: (number) | null
  title?: (string) | null
  type?: ('rsvp' | 'approval' | 'check_in' | 'consent' | 'souvenir' | 'badge' | 'room_assignment' | 'seating_assignment' | 'meal_selection' | 'session_attendance' | 'certificate' | 'checkout' | 'feedback' | 'custom') | null
}

export interface ExperienceWorkflowClone {
  name?: (string) | null
}

export interface ExperienceWorkflowCreate {
  name?: string
  steps?: (ExperienceStepCreate)[]
}

export interface ExperienceWorkflowOut {
  created_at: string
  created_by?: (string) | null
  event_id: string
  id: string
  is_default: boolean
  name: string
  status: string
  steps?: (ExperienceStepOut)[]
  updated_at: string
  version: number
}

export interface FestioMeGuestSession {
  expires_at: string
  open_url?: (string) | null
  token: string
}

export interface FestioMeStatus {
  available: boolean
  configured: boolean
  detail?: (string) | null
  enabled: boolean
  festiome_id?: (string) | null
  name?: (string) | null
  open_url?: (string) | null
}

export interface FloorElementIn {
  color?: (string) | null
  height?: number
  id?: (string) | null
  label?: (string) | null
  pos_x?: number
  pos_y?: number
  rotation?: number
  type: string
  width?: number
}

export interface FloorElementOut {
  color?: (string) | null
  event_id: string
  height?: number
  id: string
  label?: (string) | null
  pos_x?: number
  pos_y?: number
  rotation?: number
  type: string
  width?: number
}

export interface FloorPlanOut {
  bg_image_url?: (string) | null
  bg_opacity?: number
  edit_token?: (string) | null
  editable?: boolean
  elements?: (FloorElementOut)[]
  event_id: string
  event_name: string
  height?: number
  seating_term?: string
  share_token?: (string) | null
  tables?: (FloorTableOut)[]
  width?: number
}

export interface FloorPlanSave {
  bg_image_url?: (string) | null
  bg_opacity?: (number) | null
  elements?: (FloorElementIn)[]
  height?: (number) | null
  tables?: (FloorTablePos)[]
  width?: (number) | null
}

export interface FloorTableOut {
  capacity: number
  category?: (string) | null
  id: string
  name: string
  pos_x?: (number) | null
  pos_y?: (number) | null
  rotation?: number
  seated?: number
  shape?: string
  table_group_id?: (string) | null
  table_group_name?: (string) | null
}

export interface FloorTablePos {
  id: string
  pos_x?: (number) | null
  pos_y?: (number) | null
  rotation?: (number) | null
  shape?: (string) | null
}

export interface FlowEdge {
  count: number
  from_zone?: (string) | null
  to_zone: string
}

export interface GateIn {
  direction?: 'in' | 'out'
  name: string
  zone_id: string
}

export interface GateOut {
  direction: string
  event_id: string
  id: string
  is_active?: boolean
  name: string
  zone_id: string
  zone_name?: (string) | null
}

export interface GateScanRequest {
  qr_token: string
}

export interface GateScanResult {
  allowed?: boolean
  direction?: (string) | null
  guest_name?: (string) | null
  matched_tags?: (string)[]
  message: string
  occupancy?: (number) | null
  status: string
  zone_name?: (string) | null
}

export interface GrantRequest {
  add_credits?: (number) | null
  tier?: (string) | null
}

export interface GuestConsentStateOut {
  form?: (ConsentFormOut) | null
  required?: boolean
  signed?: boolean
  signed_at?: (string) | null
}

export interface GuestCreate {
  assigned_table_group_id?: (string) | null
  email?: (string) | null
  first_name: string
  is_vip?: boolean
  is_walk_in?: boolean
  last_name: string
  phone?: (string) | null
}

export interface GuestExperienceOut {
  guest_id: string
  progress: (GuestExperienceProgressOut)[]
  workflow: ExperienceWorkflowOut
}

export interface GuestExperienceProgressOut {
  completed_at?: (string) | null
  completed_by_source?: (string) | null
  completed_by_user_id?: (string) | null
  created_at: string
  event_id: string
  guest_id: string
  id: string
  metadata?: (Record<string, unknown>) | null
  override_reason?: (string) | null
  status: string
  step_id: string
  updated_at: string
  workflow_id: string
}

export interface GuestJourneyGuestOut {
  id: string
  name: string
  rsvp_status?: (string) | null
}

export interface GuestJourneyOut {
  completed_count?: number
  consent?: (GuestConsentStateOut) | null
  experience_enabled?: boolean
  guest?: (GuestJourneyGuestOut) | null
  menu_categories?: (MenuCategoryOut)[]
  menu_enabled?: boolean
  menu_has_choices?: boolean
  menu_locked?: boolean
  menu_selectable?: boolean
  next_steps?: (GuestJourneyStepOut)[]
  program?: (GuestProgramOut) | null
  steps?: (GuestJourneyStepOut)[]
  total_count?: number
  workflow?: (GuestJourneyWorkflowOut) | null
}

export interface GuestJourneyStepOut {
  actionable?: boolean
  completed_at?: (string) | null
  completion_message?: (string) | null
  description?: (string) | null
  guest_message?: (string) | null
  id: string
  key: string
  metadata?: Record<string, unknown>
  required: boolean
  self_service?: boolean
  session?: (Record<string, unknown>) | null
  status: string
  title: string
  type: string
}

export interface GuestJourneyWorkflowOut {
  id: string
  name: string
  version: number
}

export interface GuestMenuSubmit {
  combo?: Record<string, string>
  multi?: Record<string, (string)[]>
  single?: Record<string, string>
}

export interface GuestOut {
  admit_notified: boolean
  admitted: boolean
  admitted_at: (string) | null
  assigned_table_group_id?: (string) | null
  email?: (string) | null
  email_delivery_at?: (string) | null
  email_delivery_event_type?: (string) | null
  email_delivery_kind?: (string) | null
  email_delivery_status?: (string) | null
  event_id: string
  first_name: string
  household_id?: (string) | null
  household_name?: (string) | null
  id: string
  invite_sent_at: (string) | null
  invite_status?: (string) | null
  invite_token?: (string) | null
  is_vip?: boolean
  is_walk_in?: boolean
  last_name: string
  meal_served?: boolean
  mms_delivery_at?: (string) | null
  mms_delivery_status?: (string) | null
  mms_provider?: (string) | null
  phone: (string) | null
  qr_generated_at: (string) | null
  qr_token: string
  rsvp_guest_type?: (string) | null
  rsvp_notes?: (string) | null
  rsvp_relationship?: (string) | null
  rsvp_responded_at?: (string) | null
  rsvp_status?: string
  rsvp_submitter_email?: (string) | null
  rsvp_submitter_guest_id?: (string) | null
  rsvp_submitter_name?: (string) | null
  rsvp_submitter_phone?: (string) | null
  seat_number?: (string) | null
  sms_consent?: boolean
  sms_delivery_at?: (string) | null
  sms_delivery_status?: (string) | null
  sms_provider?: (string) | null
  table_group_name?: (string) | null
  table_id?: (string) | null
  ticket_type_id?: (string) | null
  updated_at?: (string) | null
  whatsapp_consent?: boolean
  whatsapp_delivery_at?: (string) | null
  whatsapp_delivery_status?: (string) | null
  whatsapp_provider?: (string) | null
}

export interface GuestPassExchange {
  pass_token: string
}

export interface GuestProgramDayOut {
  date: string
  label: string
  segments?: (GuestProgramSegmentOut)[]
}

export interface GuestProgramOut {
  current_segments?: (GuestProgramSegmentOut)[]
  days?: (GuestProgramDayOut)[]
  enabled?: boolean
  feedback_open?: (Record<string, unknown>) | null
  next_segments?: (GuestProgramSegmentOut)[]
}

export interface GuestProgramSegmentOut {
  active?: boolean
  category?: (string) | null
  description?: (string) | null
  ends_at: string
  key: string
  starts_at: string
  step_id: string
  title: string
}

export interface GuestShipmentOut {
  email?: (string) | null
  first_name: string
  guest_id: string
  has_address?: boolean
  item?: (string) | null
  last_name: string
  phone?: (string) | null
  quantity?: number
  ship_address1?: (string) | null
  ship_address2?: (string) | null
  ship_city?: (string) | null
  ship_country?: (string) | null
  ship_postal?: (string) | null
  ship_state?: (string) | null
  ship_status?: string
  size?: (string) | null
  tracking_number?: (string) | null
}

export interface GuestShipmentUpdate {
  item?: (string) | null
  quantity?: (number) | null
  ship_status?: ('pending' | 'shipped' | 'delivered') | null
  size?: (string) | null
  tracking_number?: (string) | null
}

export interface GuestTagIn {
  color?: (string) | null
  name: string
  rsvp_question_id?: (string) | null
  rsvp_value?: (string) | null
  sort_order?: number
}

export interface GuestTagOut {
  color?: (string) | null
  event_id: string
  guest_count?: number
  id: string
  name: string
  rsvp_question_id?: (string) | null
  rsvp_value?: (string) | null
  sort_order?: number
}

export interface GuestTicketAssign {
  ticket_type_id?: (string) | null
}

export interface GuestUpdate {
  email?: (string) | null
  first_name?: (string) | null
  is_vip?: (boolean) | null
  last_name?: (string) | null
  phone?: (string) | null
  seat_number?: (string) | null
  sms_consent?: (boolean) | null
  table_id?: (string) | null
  whatsapp_consent?: (boolean) | null
}

export interface HouseholdCreate {
  default_table_group_id?: (string) | null
  default_table_id?: (string) | null
  description?: (string) | null
  name: string
  sort_order?: (number) | null
}

export interface HouseholdOut {
  default_table_group_id?: (string) | null
  default_table_id?: (string) | null
  description?: (string) | null
  event_id: string
  id: string
  member_count?: number
  name: string
  sort_order?: number
}

export interface HTTPValidationError {
  detail?: (ValidationError)[]
}

export interface InviteGuestPrefill {
  email?: (string) | null
  email_locked?: boolean
  first_name: string
  last_name: string
  phone?: (string) | null
  phone_locked?: boolean
  rsvp_status?: string
  sms_consent?: boolean
  whatsapp_consent?: boolean
}

export interface InvitePageOut {
  admission_note?: (string) | null
  couples_name: string
  deadline_passed?: boolean
  description: (string) | null
  event_date: string
  event_end_date?: (string) | null
  experience_enabled?: boolean
  festiome_addon_enabled?: boolean
  festiome_enabled?: boolean
  guest_hub_v2?: boolean
  hotel_address?: (string) | null
  hotel_name?: (string) | null
  id: string
  invite_cover_image?: (string) | null
  invite_message: (string) | null
  invite_mode?: string
  invite_theme: string
  live_program_enabled?: boolean
  name: string
  questions?: (RSVPQuestionOut)[]
  registry_enabled?: boolean
  registry_token?: (string) | null
  rsvp_allow_duplicate_emails?: boolean
  rsvp_capacity: (number) | null
  rsvp_collect_email: boolean
  rsvp_collect_phone: boolean
  rsvp_count?: number
  rsvp_deadline?: (string) | null
  rsvp_email_required?: boolean
  rsvp_enabled: boolean
  rsvp_invitee_email_required?: boolean
  rsvp_invitee_phone_required?: boolean
  rsvp_multi_invitee_enabled?: boolean
  rsvp_multi_invitee_limit?: number
  rsvp_multi_invitee_limit_rules?: (Record<string, number>) | null
  rsvp_phone_required?: boolean
  rsvp_token?: (string) | null
  seating_term?: (string) | null
  shipping?: (InviteShippingOut) | null
  timezone?: (string) | null
  venue_address?: (string) | null
  venue_name?: (string) | null
}

export interface InviteSettingsUpdate {
  invite_cover_image?: (string) | null
  invite_message?: (string) | null
  invite_mode?: ('open' | 'closed') | null
  invite_theme?: ('default' | 'gold' | 'rose' | 'midnight' | 'forest') | null
  rsvp_allow_duplicate_emails?: (boolean) | null
  rsvp_capacity?: (number) | null
  rsvp_category_seating_rules?: (Record<string, Record<string, (string) | null>>) | null
  rsvp_collect_email?: (boolean) | null
  rsvp_collect_phone?: (boolean) | null
  rsvp_deadline?: (string) | null
  rsvp_email_required?: (boolean) | null
  rsvp_enabled?: (boolean) | null
  rsvp_invitee_email_required?: (boolean) | null
  rsvp_invitee_phone_required?: (boolean) | null
  rsvp_multi_invitee_enabled?: (boolean) | null
  rsvp_multi_invitee_limit?: (number) | null
  rsvp_multi_invitee_limit_rules?: (Record<string, number>) | null
  rsvp_phone_required?: (boolean) | null
  rsvp_require_approval?: (boolean) | null
}

export interface InviteShipmentNeed {
  collect_size?: boolean
  name: string
  shipment_id: string
  size_options?: ((string)[]) | null
}

export interface InviteShippingOut {
  collect_address?: boolean
  shipments?: (InviteShipmentNeed)[]
}

export interface InviteTokenPageOut {
  already_responded?: boolean
  deadline_passed?: boolean
  event: InvitePageOut
  guest: InviteGuestPrefill
}

export interface JoinRequestDecision {
  role?: 'moderator' | 'member' | 'readonly'
}

export interface JourneyStep {
  denied?: boolean
  deny_reason?: (string) | null
  direction: string
  scanned_at: string
  zone_name?: (string) | null
}

export interface ManualInviteRecipient {
  email?: (string) | null
  name: string
  phone?: (string) | null
}

export interface ManualInviteRequest {
  channels?: ('email' | 'sms' | 'whatsapp')[]
  recipients: (ManualInviteRecipient)[]
}

export interface ManualInviteResult {
  errors?: (string)[]
  sent: number
  skipped: number
}

export interface MemberRole {
  role: 'owner' | 'admin' | 'staff'
}

export interface MemberRoleUpdate {
  role: 'owner' | 'admin' | 'staff'
}

export interface MenuCategoryCreate {
  day_label?: (string) | null
  display_only?: boolean
  is_required?: boolean
  max_selections?: (number) | null
  min_selections?: number
  name: string
  selection_type?: string
  sort_order?: number
}

export interface MenuCategoryOut {
  combinations?: (MenuCombinationOut)[]
  day_label?: (string) | null
  display_only?: boolean
  event_id: string
  id: string
  is_required?: boolean
  items?: (MenuItemOut)[]
  max_selections?: (number) | null
  min_selections?: number
  name: string
  selection_type?: string
  sort_order: number
}

export interface MenuCombinationCreate {
  description?: (string) | null
  items?: (MenuCombinationItemIn)[]
  name: string
  sort_order?: number
}

export interface MenuCombinationItemIn {
  menu_item_id: string
  quantity?: number
}

export interface MenuCombinationItemOut {
  menu_item_id: string
  name: string
  quantity: number
}

export interface MenuCombinationOut {
  description?: (string) | null
  id: string
  items?: (MenuCombinationItemOut)[]
  name: string
  sort_order?: number
}

export interface MenuCombinationTotal {
  combination_id: string
  count: number
  name: string
}

export interface MenuDashboardGuest {
  admitted: boolean
  combo?: Record<string, Record<string, unknown>>
  email?: (string) | null
  guest_id: string
  is_vip?: boolean
  meal_served: boolean
  multi?: Record<string, Record<string, unknown>>
  name: string
  seat_number?: (string) | null
  served_categories?: Record<string, boolean>
  single?: Record<string, Record<string, unknown>>
  table_name?: (string) | null
}

export interface MenuDashboardOut {
  combination_totals: (MenuCombinationTotal)[]
  guests: (MenuDashboardGuest)[]
  item_totals: (MenuItemTotal)[]
  multi_category_serving?: boolean
}

export interface MenuEventOut {
  couples_name?: (string) | null
  id: string
  menu_enabled?: boolean
  name: string
}

export interface MenuItemCreate {
  description?: (string) | null
  name: string
}

export interface MenuItemOut {
  category_id: string
  description: (string) | null
  id: string
  name: string
}

export interface MenuItemTotal {
  category_name: string
  count: number
  item_id: string
  name: string
}

export interface MessageTemplateSave {
  email_body?: (string) | null
  mms_body?: (string) | null
  sms_body?: (string) | null
  subject?: (string) | null
  whatsapp_body?: (string) | null
}

export interface MyTaskOut {
  assignee_name?: (string) | null
  assignee_user_id?: (string) | null
  completed_at?: (string) | null
  created_at: string
  due_date?: (string) | null
  event_id: string
  event_name: string
  id: string
  notes?: (string) | null
  overdue?: boolean
  sort_order?: number
  status?: string
  title: string
  updated_at: string
}

export interface OperatorInvite {
  email: string
}

export interface OrgMemberInvite {
  email: string
  name?: (string) | null
  role?: 'admin' | 'staff'
}

export interface OrgMemberOut {
  role: string
  user: UserOut
}

export interface OrgPlanUpsert {
  active?: boolean
  features?: (string)[]
  label: string
  ngn_monthly?: number
  sort_order?: number
  usd_monthly?: number
}

export interface OrgSubscriptionCheckoutRequest {
  plan_key: string
}

export interface OrgSubscriptionOut {
  current_period_end?: (string) | null
  plan: string
  provider?: (string) | null
  status?: (string) | null
}

export interface OutboxStatus {
  delivered?: number
  failed?: number
  pending?: number
  retry?: number
}

export interface PairRequest {
  partner_email: string
  partner_first_name: string
  partner_last_name: string
}

export interface PartnerInfo {
  admitted?: boolean
  email: string
  first_name: string
  last_name: string
}

export interface PeakBucket {
  ins?: number
  outs?: number
  t: string
}

export interface PlanUpsert {
  active?: boolean
  credits?: number
  guest_cap?: (number) | null
  kind: 'tier' | 'pack'
  label: string
  ngn?: number
  sort_order?: number
  usd?: number
}

export interface PlatformSettingsOut {
  support_chat_enabled: boolean
}

export interface PlatformSettingsUpdate {
  support_chat_enabled: boolean
}

export interface ProgramSegmentImport {
  items: (ProgramSegmentImportItem)[]
}

export interface ProgramSegmentImportItem {
  announce?: boolean
  announcement_body?: (string) | null
  announcement_title?: (string) | null
  category?: (string) | null
  description?: (string) | null
  duration_seconds: number
  key: string
  starts_offset_seconds: number
  title: string
}

export interface PublicCalendarContactOut {
  email: string
  first_name: string
}

export interface PublicCalendarEventOut {
  admitted?: (boolean) | null
  event_date: string
  id: string
  invite_cover_image?: (string) | null
  invite_message?: (string) | null
  name: string
  register_url: string
  rsvp_status?: (string) | null
}

export interface PublicCalendarOut {
  contact?: (PublicCalendarContactOut) | null
  description?: (string) | null
  events?: (PublicCalendarEventOut)[]
  logo_url?: (string) | null
  logo_width?: (number) | null
  mode: 'public' | 'private'
  title: string
}

export interface PublicConsentFormOut {
  body: string
  created_at: string
  event_id: string
  id: string
  is_active: boolean
  require_signature: boolean
  title: string
  updated_at: string
  version: number
}

export interface PublicConsentFormUpsert {
  body: string
  require_signature?: boolean
  title?: string
}

export interface PublicConsentOut {
  form?: (ConsentFormOut) | null
  signature?: (ConsentSignatureOut) | null
  status: 'none' | 'available' | 'signed' | 'invalid' | 'not_admitted'
}

export interface PublicConsentSignatureOut {
  guest_id: string
  id: string
  signed_at: string
  signer_name: string
}

export interface PublicEventOut {
  event_date: string
  event_end_date?: (string) | null
  id: string
  name: string
  status: string
  timezone?: (string) | null
}

export interface PublicExperienceStepIn {
  conditions?: (Record<string, unknown>) | null
  config?: (Record<string, unknown>) | null
  description?: (string) | null
  duration_seconds?: (number) | null
  enabled?: boolean
  key: string
  required?: boolean
  sort_order?: number
  starts_offset_seconds?: (number) | null
  title: string
  type: 'rsvp' | 'approval' | 'check_in' | 'consent' | 'souvenir' | 'badge' | 'room_assignment' | 'seating_assignment' | 'meal_selection' | 'session_attendance' | 'certificate' | 'checkout' | 'feedback' | 'custom'
}

export interface PublicExperienceStepOut {
  conditions?: (Record<string, unknown>) | null
  config?: (Record<string, unknown>) | null
  created_at: string
  description?: (string) | null
  duration_seconds?: (number) | null
  enabled: boolean
  id: string
  is_segment?: boolean
  key: string
  required: boolean
  sort_order: number
  starts_offset_seconds?: (number) | null
  title: string
  type: string
  updated_at: string
  workflow_id: string
}

export interface PublicExperienceStepReorder {
  step_ids?: (string)[]
}

export interface PublicExperienceStepUpdate {
  conditions?: (Record<string, unknown>) | null
  config?: (Record<string, unknown>) | null
  description?: (string) | null
  duration_seconds?: (number) | null
  enabled?: (boolean) | null
  key?: (string) | null
  required?: (boolean) | null
  sort_order?: (number) | null
  starts_offset_seconds?: (number) | null
  title?: (string) | null
  type?: ('rsvp' | 'approval' | 'check_in' | 'consent' | 'souvenir' | 'badge' | 'room_assignment' | 'seating_assignment' | 'meal_selection' | 'session_attendance' | 'certificate' | 'checkout' | 'feedback' | 'custom') | null
}

export interface PublicExperienceWorkflowCreate {
  name?: string
  steps?: (PublicExperienceStepIn)[]
}

export interface PublicExperienceWorkflowOut {
  created_at: string
  event_id: string
  id: string
  is_default: boolean
  name: string
  status: string
  steps?: (PublicExperienceStepOut)[]
  updated_at: string
  version: number
}

export interface PublicFeedbackReminderRequest {
  channels?: (string)[]
  message?: (string) | null
  subject?: (string) | null
}

export interface PublicGuestCreate {
  email?: (string) | null
  first_name: string
  is_vip?: boolean
  last_name: string
  phone?: (string) | null
}

export interface PublicGuestOut {
  admitted: boolean
  admitted_at?: (string) | null
  email?: (string) | null
  first_name: string
  id: string
  last_name: string
  phone?: (string) | null
  rsvp_status: string
}

export interface PublicGuestUpdate {
  email?: (string) | null
  first_name?: (string) | null
  is_vip?: (boolean) | null
  last_name?: (string) | null
  phone?: (string) | null
  sms_consent?: (boolean) | null
  whatsapp_consent?: (boolean) | null
}

export interface PublicSeatingTableCreate {
  capacity: number
  category?: (string) | null
  name: string
  sort_order?: (number) | null
}

export interface PublicSeatingTableOut {
  assigned_count?: number
  capacity: number
  category?: (string) | null
  event_id: string
  id: string
  name: string
  sort_order?: number
}

export interface PublicSeatingTableUpdate {
  capacity?: (number) | null
  category?: (string) | null
  name?: (string) | null
  sort_order?: (number) | null
}

export interface PublicStepsBulkCreate {
  steps: (PublicExperienceStepIn)[]
}

export interface PublicTableGroupCreate {
  description?: (string) | null
  name: string
  sort_order?: (number) | null
  table_ids?: ((string)[]) | null
  tag?: (string) | null
}

export interface PublicTableGroupOut {
  assigned_guest_count?: number
  description?: (string) | null
  event_id: string
  id: string
  name: string
  over_capacity?: boolean
  remaining_seats?: number
  sort_order?: number
  table_ids?: (string)[]
  tag: string
  total_seats?: number
}

export interface PublicTableGroupTablesUpdate {
  table_ids?: (string)[]
}

export interface PublicTableGroupUpdate {
  description?: (string) | null
  name?: (string) | null
  sort_order?: (number) | null
  table_ids?: ((string)[]) | null
  tag?: (string) | null
}

export interface QaChecklistResultItem {
  case_id: string
  case_title?: (string) | null
  evidence?: (string) | null
  note?: (string) | null
  priority?: (string) | null
  section_id: string
  section_title?: (string) | null
  status: 'pass' | 'issue' | 'blocked' | 'na'
}

export interface QaChecklistSubmissionCreate {
  results?: (QaChecklistResultItem)[]
  summary?: (string) | null
  tester_name: string
  user_agent?: (string) | null
}

export interface QaChecklistSubmissionDetail {
  blocked_count: number
  created_at: string
  id: string
  issue_count: number
  na_count: number
  pass_count: number
  results?: (QaChecklistResultItem)[]
  summary?: (string) | null
  tested_count: number
  tester_name: string
  user_agent?: (string) | null
}

export interface QaChecklistSubmissionOut {
  blocked_count: number
  created_at: string
  id: string
  issue_count: number
  na_count: number
  pass_count: number
  summary?: (string) | null
  tested_count: number
  tester_name: string
  user_agent?: (string) | null
}

export interface RedesignCohortUpdate {
  redesign_cohort: 'legacy_only' | 'redesign_opt_in' | 'redesign_internal' | 'redesign_cohort' | 'redesign_default' | 'legacy_retired'
}

export interface RedesignTelemetryEvent {
  action?: (string) | null
  duration_ms?: (number) | null
  endpoint?: (string) | null
  event_id?: (string) | null
  event_type: 'render_error' | 'api_error' | 'validation_error' | 'mutation_duration' | 'abandoned_workflow' | 'feature_flag_cohort' | 'sse_or_poll_mode' | 'edit_conflict' | 'fallback_to_legacy'
  feature_flag_cohort?: (string) | null
  mode?: (string) | null
  module?: (string) | null
  org_id?: (string) | null
  reason?: (string) | null
  release_version?: (string) | null
  route: string
  status?: (number) | null
  success?: (boolean) | null
}

export interface ReferralClaim {
  code: string
}

export interface ReferralInfoOut {
  converted_count: number
  referral_code: string
  referral_link: string
  referred_count: number
  referred_orgs: (ReferredOrgOut)[]
}

export interface ReferredOrgOut {
  converted: boolean
  created_at: string
  name: string
}

export interface RegistryClaimCreate {
  amount_minor?: (number) | null
  claimer_email?: (string) | null
  claimer_name: string
  message?: (string) | null
  quantity?: number
}

export interface RegistryClaimOut {
  amount_minor?: (number) | null
  claimer_email?: (string) | null
  claimer_name: string
  created_at?: (string) | null
  id: string
  item_id: string
  item_title: string
  message?: (string) | null
  quantity: number
}

export interface RegistryItemCreate {
  amount_minor?: (number) | null
  currency?: (string) | null
  description?: (string) | null
  external_url?: (string) | null
  image_url?: (string) | null
  kind?: 'item' | 'fund' | 'link'
  payment_instructions?: (string) | null
  quantity_wanted?: number
  sort_order?: number
  title: string
}

export interface RegistryItemOut {
  amount_minor?: (number) | null
  buy_url?: (string) | null
  claim_count?: number
  currency: string
  description?: (string) | null
  event_id: string
  external_url?: (string) | null
  id: string
  image_url?: (string) | null
  is_active: boolean
  kind: string
  payment_instructions?: (string) | null
  quantity_wanted: number
  raised_minor?: number
  remaining?: (number) | null
  reserved_qty?: number
  sort_order: number
  title: string
}

export interface RegistryItemUpdate {
  amount_minor?: (number) | null
  currency?: (string) | null
  description?: (string) | null
  external_url?: (string) | null
  image_url?: (string) | null
  is_active?: (boolean) | null
  kind?: ('item' | 'fund' | 'link') | null
  payment_instructions?: (string) | null
  quantity_wanted?: (number) | null
  sort_order?: (number) | null
  title?: (string) | null
}

export interface RegistryPageOut {
  couples_name?: (string) | null
  event_name: string
  items?: (RegistryItemOut)[]
  registry_message?: (string) | null
}

export interface RegistrySettingsOut {
  registry_message?: (string) | null
  registry_token?: (string) | null
}

export interface RegistrySettingsUpdate {
  registry_message?: (string) | null
}

export interface RegistryUnfurlOut {
  amount_minor?: (number) | null
  currency?: (string) | null
  image_url?: (string) | null
  site_name?: (string) | null
  title?: (string) | null
}

export interface RegistryUnfurlRequest {
  url: string
}

export interface RSVPConfirm {
  first_name: string
  id: string
  invite_token?: (string) | null
  last_name: string
  message?: string
  qr_token: string
  rsvp_status?: string
}

export interface RSVPInviteeSubmit {
  email?: (string) | null
  first_name?: string
  full_name?: string
  guest_type?: (string) | null
  last_name?: string
  notes?: (string) | null
  phone?: (string) | null
  relationship?: (string) | null
}

export interface RSVPQuestionCreate {
  is_required?: boolean
  options?: (string) | null
  question: string
  question_type?: 'text' | 'select' | 'boolean'
  sort_order?: number
}

export interface RSVPQuestionOut {
  id: string
  is_required: boolean
  options?: (string) | null
  question: string
  question_type: string
  sort_order: number
}

export interface RSVPQuestionUpdate {
  is_required?: (boolean) | null
  options?: (string) | null
  question?: (string) | null
  question_type?: ('text' | 'select' | 'boolean') | null
  sort_order?: (number) | null
}

export interface RSVPSubmit {
  answers?: Record<string, string>
  email?: (string) | null
  first_name: string
  invitees?: (RSVPInviteeSubmit)[]
  last_name: string
  phone?: (string) | null
  shipping_address?: (ShippingAddressUpdate) | null
  sizes?: Record<string, string>
  sms_consent?: boolean
  whatsapp_consent?: boolean
}

export interface RSVPTokenSubmit {
  answers?: Record<string, string>
  first_name?: (string) | null
  last_name?: (string) | null
  phone?: (string) | null
  shipping_address?: (ShippingAddressUpdate) | null
  sizes?: Record<string, string>
  sms_consent?: boolean
  status?: 'confirmed' | 'declined'
  whatsapp_consent?: boolean
}

export interface ScanResult {
  eligibilities?: (Record<string, string>)[]
  experience_next_steps?: (ExperienceNextStepOut)[]
  guest?: (GuestOut) | null
  guest_summary?: Record<string, (string) | null>
  message: string
  remaining_action_count?: number
  seat_number?: (string) | null
  station_action?: (Record<string, unknown>) | null
  status: string
  table_name?: (string) | null
}

export interface ScanZoneRequest {
  direction?: ('in' | 'out') | null
  zone_id: string
}

export interface ScanZoneResult {
  denied?: boolean
  deny_reason?: (string) | null
  direction: string
  guest_name: string
  journey_count?: number
  occupancy?: number
  seat_number?: (string) | null
  status: string
  table_name?: (string) | null
  ticket_type?: (string) | null
  zone_name: string
}

export interface SeatAssignRequest {
  seat_number?: (string) | null
  table_id?: (string) | null
}

export interface SeatingTableCreate {
  capacity: number
  category?: (string) | null
  name: string
  sort_order?: (number) | null
}

export interface SeatingTableOut {
  assigned_count?: number
  capacity: number
  category?: (string) | null
  event_id: string
  id: string
  name: string
  pos_x?: (number) | null
  pos_y?: (number) | null
  rotation?: number
  shape?: string
  sort_order?: number
  updated_at?: (string) | null
}

export interface SelfCheckinGuest {
  id: string
  name: string
}

export interface SelfCheckinResult {
  admitted_at?: (string) | null
  admitted_guest?: (string) | null
  guests?: (SelfCheckinGuest)[]
  message?: (string) | null
  name?: (string) | null
  seat_number?: (string) | null
  seating_term?: (string) | null
  status: string
  table_name?: (string) | null
}

export interface SelfCheckinSearch {
  query: string
}

export interface SendConsentCopyOut {
  ok: boolean
  sent_to: string
}

export interface ShipmentCreate {
  auto_add?: (boolean) | null
  collect_size?: boolean
  name: string
  notes?: (string) | null
  phase?: 'pre' | 'post'
  size_options?: ((string)[]) | null
  vendor_email?: (string) | null
  vendor_name?: (string) | null
  vendor_phone?: (string) | null
}

export interface ShipmentOut {
  auto_add?: boolean
  collect_size: boolean
  created_at?: (string) | null
  event_id: string
  id: string
  line_count?: number
  name: string
  notes?: (string) | null
  phase: string
  sent_at?: (string) | null
  share_token: string
  size_options?: ((string)[]) | null
  vendor_email?: (string) | null
  vendor_name?: (string) | null
  vendor_phone?: (string) | null
  viewed_at?: (string) | null
}

export interface ShipmentUpdate {
  auto_add?: (boolean) | null
  collect_size?: (boolean) | null
  name?: (string) | null
  notes?: (string) | null
  phase?: ('pre' | 'post') | null
  size_options?: ((string)[]) | null
  vendor_email?: (string) | null
  vendor_name?: (string) | null
  vendor_phone?: (string) | null
}

export interface ShippingAddressUpdate {
  ship_address1?: (string) | null
  ship_address2?: (string) | null
  ship_city?: (string) | null
  ship_country?: (string) | null
  ship_postal?: (string) | null
  ship_state?: (string) | null
}

export interface SubGroupCreate {
  description?: string
  join_policy?: 'closed' | 'request' | 'open'
  name: string
  rules?: string
  visibility?: 'listed' | 'unlisted'
}

export interface SubGroupUpdate {
  archived?: (boolean) | null
  description?: (string) | null
  join_policy?: ('closed' | 'request' | 'open') | null
  name?: (string) | null
  rules?: (string) | null
  visibility?: ('listed' | 'unlisted') | null
}

export interface SubtaskCreate {
  title: string
}

export interface SubtaskOut {
  created_at: string
  id: string
  sort_order?: number
  status?: string
  task_id: string
  title: string
}

export interface SubtaskUpdate {
  status?: (string) | null
  title?: (string) | null
}

export interface TableGroupCreate {
  description?: (string) | null
  name: string
  sort_order?: (number) | null
  table_ids?: ((string)[]) | null
  table_orders?: (Record<string, number>) | null
  tag?: (string) | null
}

export interface TableGroupOut {
  assigned_guest_count?: number
  description?: (string) | null
  event_id: string
  id: string
  name: string
  over_capacity?: boolean
  remaining_seats?: number
  sort_order?: number
  table_ids?: (string)[]
  tag: string
  total_seats?: number
}

export interface TableGroupTablesUpdate {
  table_ids?: (string)[]
}

export interface TableReport {
  capacity?: (number) | null
  checked_in?: number
  name: string
  seated?: number
  served?: number
}

export interface TagIdList {
  tag_ids?: (string)[]
}

export interface TaskActivityOut {
  body: string
  created_at: string
  id: string
  kind: string
  user_name?: (string) | null
}

export interface TaskAttachmentOut {
  content_type: string
  created_at: string
  filename: string
  id: string
  size_bytes: number
  task_id: string
  uploaded_by_name?: (string) | null
  url: string
}

export interface TaskCommentCreate {
  body: string
}

export interface TaskCreate {
  assignee_user_id?: (string) | null
  due_date?: (string) | null
  notes?: (string) | null
  sort_order?: (number) | null
  title: string
}

export interface TaskOut {
  assignee_name?: (string) | null
  assignee_user_id?: (string) | null
  completed_at?: (string) | null
  created_at: string
  due_date?: (string) | null
  event_id: string
  id: string
  notes?: (string) | null
  overdue?: boolean
  sort_order?: number
  status?: string
  title: string
  updated_at: string
}

export interface TemplatePreviewRequest {
  email_body?: (string) | null
  mms_body?: (string) | null
  sms_body?: (string) | null
  subject?: (string) | null
  whatsapp_body?: (string) | null
}

export interface TemplateTestSendRequest {
  channel: string
  email_body?: (string) | null
  mms_body?: (string) | null
  sms_body?: (string) | null
  subject?: (string) | null
  to: string
  whatsapp_body?: (string) | null
}

export interface TicketTypeCreate {
  allowed_zone_ids?: ((string)[]) | null
  capacity?: (number) | null
  color?: (string) | null
  description?: (string) | null
  name: string
  sort_order?: number
}

export interface TicketTypeOut {
  allowed_zone_ids?: ((string)[]) | null
  assigned_count?: number
  capacity?: (number) | null
  color?: (string) | null
  description?: (string) | null
  event_id: string
  id: string
  is_active: boolean
  name: string
  sort_order: number
}

export interface TicketTypeUpdate {
  allowed_zone_ids?: ((string)[]) | null
  capacity?: (number) | null
  color?: (string) | null
  description?: (string) | null
  is_active?: (boolean) | null
  name?: (string) | null
  sort_order?: (number) | null
}

export interface TicketView {
  event?: (EventBrief) | null
  guest?: (GuestOut) | null
  guest_choices?: Record<string, Record<string, unknown>>
  menu_categories?: (MenuCategoryOut)[]
  menu_locked?: boolean
  partner?: (PartnerInfo) | null
  seat_number?: (string) | null
  status: string
  table_name?: (string) | null
}

export interface TrialRequestCreate {
  contact_name: string
  event_name?: (string) | null
  guest_count?: (number) | null
  phone?: (string) | null
  use_case?: (string) | null
}

export interface TrialRequestOut {
  contact_name: string
  created_at: string
  event_name?: (string) | null
  guest_count?: (number) | null
  id: string
  org_id: string
  org_name?: (string) | null
  phone?: (string) | null
  requester_email?: (string) | null
  resolution_note?: (string) | null
  resolved_at?: (string) | null
  status: string
  use_case?: (string) | null
}

export interface TrialResolve {
  action: 'approve' | 'decline'
  add_credits?: (number) | null
  event_id?: (string) | null
  note?: (string) | null
  tier?: (string) | null
}

export interface UserOut {
  created_at: string
  email: string
  id: string
  is_org_admin?: boolean
  is_platform_superadmin?: boolean
  name: string
  role: string
}

export interface ValidationError {
  ctx?: Record<string, unknown>
  input?: unknown
  loc: (string | number)[]
  msg: string
  type: string
}

export interface VendorPageOut {
  collect_size?: boolean
  event_name: string
  lines?: (GuestShipmentOut)[]
  notes?: (string) | null
  phase: string
  shipment_name: string
  vendor_name?: (string) | null
}

export interface WalkInRegister {
  email?: (string) | null
  first_name: string
  last_name?: (string) | null
  phone?: (string) | null
  table_group_id?: (string) | null
}

export interface WebhookDeliveryOut {
  attempt_count: number
  created_at: string
  delivered_at?: (string) | null
  event_type: string
  id: string
  last_error?: (string) | null
  status: string
}

export interface WebhookEndpointCreate {
  event_types: (string)[]
  url: string
}

export interface WebhookEndpointCreated {
  created_at: string
  event_types: (string)[]
  id: string
  is_active: boolean
  secret: string
  url: string
}

export interface WebhookEndpointOut {
  created_at: string
  event_types: (string)[]
  id: string
  is_active: boolean
  url: string
}

export interface ZoneCreate {
  capacity?: (number) | null
  description?: (string) | null
  direction_mode?: 'both' | 'entry' | 'exit'
  name: string
  sort_order?: number
}

export interface ZoneOccupancy {
  capacity?: (number) | null
  inside: number
  name: string
}

export interface ZoneOut {
  capacity?: (number) | null
  description?: (string) | null
  direction_mode: string
  event_id: string
  id: string
  is_active: boolean
  name: string
  occupancy?: number
  sort_order: number
}

export interface ZoneUpdate {
  capacity?: (number) | null
  description?: (string) | null
  direction_mode?: ('both' | 'entry' | 'exit') | null
  is_active?: (boolean) | null
  name?: (string) | null
  sort_order?: (number) | null
}
