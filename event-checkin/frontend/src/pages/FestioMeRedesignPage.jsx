import { useEffect, useState } from 'react'
import RedesignShell, { Icon, ConfirmDialog, Modal } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import './FestioMeRedesignPage.css'

const HOME_SECTIONS = ['Feed', 'Guest Chat', 'Groups', 'Messages', 'Profile']

const TYPE_ICON = { discussion: '#', announcement: '📣', staff: '🔒' }

function listResponse(value) {
  if (Array.isArray(value)) return value
  return value?.items || value?.results || []
}

function adaptMessage(message, members = []) {
  const reaction = (message.reactions || []).find((item) => item.emoji === '❤️')
  const author = members.find((member) => member.id === message.author_member_id)
  return {
    ...message,
    from: message.author_name || message.author?.display_name || 'Member',
    text: message.body || '',
    time: message.created_at ? new Date(message.created_at).toLocaleString() : '',
    likes: reaction?.count || 0,
    liked: !!reaction?.reacted_by_me,
    mine: !!author?.is_me,
    staff: ['owner', 'admin', 'moderator'].includes(author?.role),
  }
}

export default function FestioMeRedesignPage() {
  const [eventId] = useCurrentEvent()
  const [homeSection, setHomeSection] = useState('Groups')
  const [activeGroup, setActiveGroup] = useState('')
  const [active, setActive] = useState('')
  const [messages, setMessages] = useState([])
  const [groups, setGroups] = useState([])
  const [channelsByGroup, setChannelsByGroup] = useState({})
  const [members, setMembers] = useState([])
  const [reports, setReports] = useState([])
  const [joinRequests, setJoinRequests] = useState([])
  const [hostInbox, setHostInbox] = useState([])
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupJoinPolicy, setGroupJoinPolicy] = useState('open')
  const [staffOnlyGroup, setStaffOnlyGroup] = useState(false)
  const [channelName, setChannelName] = useState('')
  const [channelKind, setChannelKind] = useState('discussion')
  const [channelPrivate, setChannelPrivate] = useState(false)
  const [channelMemberIds, setChannelMemberIds] = useState([])
  const [editDraft, setEditDraft] = useState('')
  const [poll, setPoll] = useState({ question: '', first: '', second: '' })
  const [preferences, setPreferences] = useState({ in_app: true, email: true, digest: 'daily', muted_channel_ids: [] })
  const [messageCursor, setMessageCursor] = useState('')
  const [attachments, setAttachments] = useState([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [createChannelOpen, setCreateChannelOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [manageMembersOpen, setManageMembersOpen] = useState(false)
  const [channelRosterOpen, setChannelRosterOpen] = useState(false)
  const [channelRoster, setChannelRoster] = useState([])
  const [channelRosterBusy, setChannelRosterBusy] = useState('')
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false)
  const [groupSettings, setGroupSettings] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [toast, setToast] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteQuery, setInviteQuery] = useState('')
  const [teamCandidates, setTeamCandidates] = useState([])
  const [profileName, setProfileName] = useState('')

  function notify(msg) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  async function loadGroups(preferredId) {
    if (!eventId) return
    const listed = await api.festiomeManageGroups(eventId)
    setGroups(listed)
    const requested = preferredId || activeGroup
    const nextId = listed.some((group) => group.id === requested) ? requested : listed[0]?.id || ''
    setActiveGroup(nextId)
    setError('')
    return nextId
  }

  useEffect(() => {
    if (!eventId) { setLoading(false); return }
    setLoading(true)
    Promise.all([api.eventFestioMeStatus(eventId), api.festiomeManageGroups(eventId), api.messageInbox(eventId).catch(() => []), api.listMembers(eventId).catch(() => [])])
      .then(([nextStatus, listed, inbox, eventMembers]) => {
        setStatus(nextStatus)
        setGroups(listed)
        setHostInbox(inbox)
        setTeamCandidates(eventMembers.map((item) => item.user).filter(Boolean))
        setActiveGroup(listed[0]?.id || '')
        setError('')
      })
      .catch((e) => setError(e.message || 'FestioMe could not be loaded'))
      .finally(() => setLoading(false))
  }, [eventId])

  useEffect(() => {
    if (!activeGroup || !status?.enabled) return
    Promise.all([
      api.festiomeChannels(activeGroup),
      api.festiomeMembers(activeGroup),
      api.festiomeReports(activeGroup).catch(() => []),
      api.festiomeManageJoinRequests(eventId, activeGroup).catch(() => []),
    ]).then(([channelList, memberList, reportList, requestList]) => {
      setChannelsByGroup((current) => ({ ...current, [activeGroup]: channelList }))
      setMembers(memberList)
      setReports(listResponse(reportList))
      setJoinRequests(listResponse(requestList))
      setActive((current) => channelList.some((channel) => channel.id === current) ? current : channelList[0]?.id || '')
      setError('')
    }).catch((e) => setError(e.message || 'FestioMe group details could not be loaded'))
  }, [eventId, activeGroup, status?.enabled])

  useEffect(() => {
    if (!active) { setMessages([]); return }
    api.festiomeMessages(active)
      .then((result) => {
        setMessageCursor(result?.next_cursor || '')
        const listed = result.items || result.messages || result || []
        setMessages(listed.map((message) => adaptMessage(message, members)))
        const newest = listed[0]
        if (newest?.id) api.festiomeRead(active, newest.id).catch(() => {})
      })
      .catch((e) => setError(e.message || 'Channel messages could not be loaded'))
  }, [active, members])

  async function toggleLike(id) {
    const message = messages.find((item) => item.id === id)
    try {
      if (message?.liked) await api.festiomeUnlike(id)
      else await api.festiomeLike(id)
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, liked: !m.liked, likes: m.likes + (m.liked ? -1 : 1) } : m)))
    } catch (e) { setError(e.message || 'Reaction could not be saved') }
  }

  async function refreshChannels(groupId = activeGroup) {
    if (!groupId) return []
    const list = await api.festiomeChannels(groupId)
    setChannelsByGroup((current) => ({ ...current, [groupId]: list }))
    return list
  }

  async function openChannelRoster() {
    if (!activeChannel || activeChannel.is_dm) return
    if (!activeChannel.is_private) {
      setChannelRoster(members)
      setChannelRosterOpen(true)
      return
    }
    try {
      setChannelRoster(await api.festiomeChannelMembers(activeChannel.id))
      setChannelRosterOpen(true)
    } catch (e) { setError(e.message || 'Private-channel members could not be loaded') }
  }

  async function toggleChannelMember(member) {
    if (!activeChannel || channelRosterBusy || member.is_me) return
    const enrolled = channelRoster.some((item) => item.id === member.id)
    setChannelRosterBusy(member.id)
    try {
      if (enrolled) await api.festiomeRemoveChannelMember(activeChannel.id, member.id)
      else await api.festiomeAddChannelMembers(activeChannel.id, [member.id])
      setChannelRoster(await api.festiomeChannelMembers(activeChannel.id))
      await refreshChannels()
      notify(`${member.display_name} ${enrolled ? 'removed from' : 'added to'} #${activeChannel.name}`)
    } catch (e) { setError(e.message || 'Channel access could not be updated') }
    finally { setChannelRosterBusy('') }
  }

  async function sendMessage() {
    if (!draft.trim() && !attachments.length) return
    if (!active) {
      setError('Select a channel before sending a message.')
      return
    }
    try {
      await api.festiomeSend(active, { body: draft.trim() || `Shared ${attachments[0]?.filename || 'an attachment'}`, ...(attachments.length ? { attachments } : {}) })
      setDraft('')
      setAttachments([])
      const result = await api.festiomeMessages(active)
      setMessages((result.items || result.messages || result || []).map((message) => adaptMessage(message, members)))
      setError('')
      notify('Message posted')
    } catch (e) { setError(e.message || 'Message could not be posted') }
  }

  const groupChannels = channelsByGroup[activeGroup] || []
  const activeChannel = groupChannels.find((c) => c.id === active) || groupChannels[0]
  const activeGroupRecord = groups.find((group) => group.id === activeGroup)
  const isPrimaryGroup = !!activeGroupRecord?.is_primary
  const canTransferOwnership = members.some((member) => member.is_me && member.role === 'owner')
  const me = members.find((member) => member.is_me)
  const visibleChannelMembers = activeChannel?.is_private ? channelRoster : members

  useEffect(() => {
    if (me?.display_name) setProfileName(me.display_name)
  }, [me?.display_name])

  useEffect(() => {
    if (!activeChannel || activeChannel.is_dm) {
      setChannelRoster([])
      return
    }
    if (!activeChannel.is_private) {
      setChannelRoster(members)
      return
    }
    api.festiomeChannelMembers(activeChannel.id)
      .then(setChannelRoster)
      .catch(() => setChannelRoster([]))
  }, [activeChannel?.id, activeChannel?.is_private, activeChannel?.is_dm, members])

  async function createInvitation(email) {
    if (!email?.trim() || !activeGroup) return
    try {
      const invitation = await api.festiomeInvite(activeGroup, { email: email.trim(), role: 'member' })
      const url = `${window.location.origin}/festiome?invite=${encodeURIComponent(invitation.token)}`
      let copied = false
      try { await navigator.clipboard?.writeText(url); copied = true } catch { /* optional */ }
      setInviteOpen(false)
      setInviteQuery('')
      notify(copied ? `Invitation for ${email.trim()} created and link copied` : `Invitation for ${email.trim()} created`)
      if (!copied) window.prompt('Copy invitation link', url)
    } catch (e) { setError(e.message || 'Member invitation could not be created') }
  }

  return (
    <RedesignShell topActive="festiome" withEventSidebar={false} eventScoped>
      {loading && <div className="rd-hint">Loading FestioMe…</div>}
      {error && <div className="rd-banner-err"><Icon name="warning" /> {error}</div>}
      {!loading && status && !status.enabled && (
        <div className="rd-panel" style={{ marginBottom: 14 }}>
          <div className="rd-panel-body">
            <strong>FestioMe is not enabled for this event.</strong>
            <p className="rd-rowlink">{status.detail}</p>
            <button className="rr-btn primary" disabled={!status.available && !status.configured} onClick={async () => {
              try {
                const enabled = await api.enableEventFestioMe(eventId)
                setStatus(enabled)
                await loadGroups()
                notify('FestioMe enabled')
              } catch (e) { setError(e.message || 'FestioMe could not be enabled') }
            }}>Enable FestioMe</button>
          </div>
        </div>
      )}
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>FestioMe</h1></div>
          <div className="rr-meta">Community chat for {status?.name || 'the selected event'}</div>
        </div>
      </div>

      <div className="rr-tabs">
        {HOME_SECTIONS.map((s) => <button key={s} className={homeSection === s ? 'active' : ''} onClick={() => setHomeSection(s)}>{s}</button>)}
      </div>

      {homeSection === 'Feed' && (
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Organizer feed</h3><p>Announcements posted from Guest Communication</p></div>
          <div className="rd-panel-body">
            <p className="rd-rowlink">Organizer-feed announcements are managed in Guest Communication. FestioMe has no separate organizer feed admin contract.</p>
          </div>
        </div>
      )}

      {homeSection === 'Guest Chat' && (
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Guest Chat</h3><p>Shared chat tied to Guest Communication settings — separate from FestioMe channels</p></div>
          <div className="rd-panel-body">
            <p className="rd-rowlink">This is the same Guest Chat moderated from Communications → Guest Communication. Open it there to moderate messages.</p>
            <a className="rr-link-btn" href="/communications-redesign?tab=hub">Open Guest Chat moderation <Icon name="arrow" size={12} /></a>
          </div>
        </div>
      )}

      {homeSection === 'Profile' && (
        <div className="rd-panel" style={{ maxWidth: 420 }}>
          <div className="rd-panel-head"><h3>Your profile</h3></div>
          <div className="rd-panel-body">
            <div className="fm-profile-row"><span className="fm-dm-avatar">{(me?.display_name || '?')[0].toUpperCase()}</span><div><strong>{me?.display_name || 'Event administrator'}</strong><span className="rd-rowlink">{groups.length} managed groups</span></div></div>
            <label className="rd-field-label" style={{ marginTop: 14 }}>Display name</label>
            <input className="rd-field" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Your community display name" />
            <button className="rr-btn primary" disabled={!activeGroup || !profileName.trim() || profileName.trim() === me?.display_name} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={async () => {
              try {
                await api.festiomeUpdateProfile(activeGroup, { display_name: profileName.trim() })
                setMembers(await api.festiomeMembers(activeGroup))
                notify('Profile updated')
              } catch (e) { setError(e.message || 'Profile could not be updated') }
            }}>Save profile</button>
            <button className="rr-btn secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={async () => {
              if (!activeGroup) { setError('Select a group first.'); return }
              try { setPreferences(await api.festiomeNotificationPreferences(activeGroup)); setNotifOpen(true) }
              catch (e) { setError(e.message || 'Notification preferences could not be loaded') }
            }}>Notification preferences</button>
          </div>
        </div>
      )}

      {homeSection === 'Messages' && (
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Guest Questions Inbox</h3><p>Private guest conversations from FestioHub</p></div>
          <div className="rd-panel-body">
            {hostInbox.map((thread) => (
              <a key={thread.thread_id} className="fm-profile-row" href="/communications-redesign?tab=hub">
                <span className="fm-dm-avatar">{(thread.guest_name || '?')[0].toUpperCase()}</span>
                <div>
                  <strong>{thread.guest_name || 'Guest question'}</strong>
                  <span className="rd-rowlink">{thread.last_message || 'Open the organizer inbox to read and reply'}</span>
                </div>
              </a>
            ))}
            {!hostInbox.length && <p className="rd-rowlink">No private guest questions yet.</p>}
            <a className="rr-link-btn" href="/communications-redesign?tab=hub" style={{ marginTop: 10 }}>Open organizer inbox to reply <Icon name="arrow" size={12} /></a>
          </div>
        </div>
      )}

      {homeSection === 'Groups' && (
        <>
          <div className="fm-group-switcher">
            {groups.map((g) => (
              <button key={g.id} className={`fm-group-chip ${activeGroup === g.id ? 'active' : ''}`} onClick={() => { setActiveGroup(g.id); setActive(channelsByGroup[g.id]?.[0]?.id || '') }}>
                {g.name}
              </button>
            ))}
            <button className="rr-link-btn" onClick={() => setCreateGroupOpen((v) => !v)}><Icon name="plus" size={12} /> Create group</button>
            {joinRequests.length > 0 && <button className="rr-link-btn" onClick={() => notify(`${joinRequests.length} join request pending review`)}>Join requests ({joinRequests.length})</button>}
          </div>

          {createGroupOpen && (
            <div className="rr-panel ci-form-inset" style={{ marginBottom: 14 }}>
              <label className="rd-field-label">Group name</label>
              <input className="rd-field" placeholder="e.g. Photography Team" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
              <label className="rd-field-label">Join policy</label>
              <select className="rr-select" disabled={staffOnlyGroup} value={staffOnlyGroup ? 'closed' : groupJoinPolicy} onChange={(e) => setGroupJoinPolicy(e.target.value)}><option value="open">Open</option><option value="request">Requires approval</option><option value="closed">Invite only</option></select>
              <label className="gr-required-check" style={{ marginTop: 10 }}><input type="checkbox" checked={staffOnlyGroup} onChange={(e) => setStaffOnlyGroup(e.target.checked)} /> Event-team support group</label>
              {staffOnlyGroup && <p className="rd-hint">Private and unlisted. Current event-team members are added automatically; guests cannot discover it.</p>}
              <div className="rd-row2" style={{ marginTop: 8 }}>
                <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setCreateGroupOpen(false)}>Cancel</button>
                <button className="rr-btn primary" disabled={!groupName.trim()} style={{ flex: 1, justifyContent: 'center' }} onClick={async () => {
                  try {
                    const created = await api.festiomeManageCreateGroup(eventId, { name: groupName.trim(), description: '', join_policy: staffOnlyGroup ? 'closed' : groupJoinPolicy, visibility: staffOnlyGroup ? 'unlisted' : 'listed', staff_only: staffOnlyGroup, rules: '' })
                    await loadGroups(created.id)
                    setGroupName('')
                    setStaffOnlyGroup(false)
                    setCreateGroupOpen(false)
                    notify('Group created')
                  } catch (e) { setError(e.message || 'Group could not be created') }
                }}>Create</button>
              </div>
            </div>
          )}

          <div className="rr-panel fm-discover-panel">
            <div className="rd-panel-head"><h3>Discover public groups</h3></div>
            <div className="rd-panel-body">
              <p className="rd-rowlink">Organizer view lists event-managed groups above. Group discovery and self-join are guest/member flows and are intentionally not presented as admin actions.</p>
              {joinRequests.map((r) => (
                <div className="fm-discover-row" key={r.id}>
                  <div><strong>{r.display_name || r.name}</strong><span className="rd-rowlink"> requested to join</span></div>
                  <div className="gr-actions">
                    <button className="rr-link-btn" onClick={async () => { await api.festiomeManageApproveJoin(eventId, activeGroup, r.id, { role: 'member' }); setJoinRequests((items) => items.filter((item) => item.id !== r.id)); notify('Join request approved') }}>Approve</button>
                    <button className="rr-link-btn gr-danger-link" onClick={async () => { await api.festiomeManageDenyJoin(eventId, activeGroup, r.id); setJoinRequests((items) => items.filter((item) => item.id !== r.id)); notify('Join request denied') }}>Deny</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="fm-layout">
            <aside className="rr-panel fm-rail">
              <div className="fm-rail-head-row">
                <span className="fm-rail-head">Channels</span>
                <button className="fm-add-btn" disabled={!activeGroup} onClick={() => setCreateChannelOpen((v) => !v)} title={activeGroup ? 'Create channel' : 'Select a group first'}><Icon name="plus" size={12} /></button>
              </div>
              {createChannelOpen && (
                <div className="fm-create-channel">
                  <input className="rd-field" placeholder="channel-name" value={channelName} onChange={(e) => setChannelName(e.target.value)} style={{ marginBottom: 6 }} />
                  <select className="rr-select gr-inline-select" value={channelKind} onChange={(e) => setChannelKind(e.target.value)} style={{ marginBottom: 6, width: '100%' }}>
                    <option value="discussion">Discussion</option><option value="announcement">Announcement</option><option value="staff">Staff</option>
                  </select>
                  <label className="gr-required-check" style={{ marginBottom: 6 }}><input type="checkbox" checked={channelPrivate} onChange={(e) => setChannelPrivate(e.target.checked)} /> Private (choose members)</label>
                  {channelPrivate && <div className="fm-channel-member-picker">
                    {members.map((member) => <label className="gr-required-check" key={member.id}><input type="checkbox" checked={channelMemberIds.includes(member.id)} onChange={(event) => setChannelMemberIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))}/> {member.display_name || member.name}</label>)}
                  </div>}
                  <button className="rr-btn primary" disabled={!activeGroup || !channelName.trim()} style={{ width: '100%', justifyContent: 'center' }} onClick={async () => {
                    try {
                      if (!activeGroup) throw new Error('Select a group before creating a channel.')
                      const created = await api.festiomeCreateChannel(activeGroup, { name: channelName.trim(), kind: channelKind, is_private: channelPrivate, member_ids: channelPrivate ? channelMemberIds : [] })
                      await refreshChannels()
                      setActive(created.id)
                      setChannelName('')
                      setChannelMemberIds([])
                      setCreateChannelOpen(false)
                      notify('Channel created')
                    } catch (e) { setError(e.message || 'Channel could not be created') }
                  }}>Create</button>
                </div>
              )}
              {groupChannels.map((c) => (
                <button key={c.id} className={`fm-channel ${active === c.id ? 'active' : ''}`} onClick={() => { setActive(c.id); setChannelRosterOpen(false) }}>
                  <span className="fm-channel-icon">{TYPE_ICON[c.kind] || '#'}</span>
                  <span>{c.name}</span>
                  {c.is_private && <Icon name="lock" size={10} />}
                  {c.unread_count > 0 && <b>{c.unread_count}</b>}
                </button>
              ))}
              {!activeGroup && <p className="rd-rowlink" style={{ padding: 10 }}>Create or select a group to add channels.</p>}
            </aside>

            <div className="rr-panel fm-thread">
              <div className="fm-thread-head">
                <span>{TYPE_ICON[activeChannel?.kind] || '#'} {activeChannel?.name}</span>
                <div className="gr-actions">
                  <button className="rr-link-btn" onClick={() => setSearchOpen((v) => !v)}><Icon name="search" size={12} /> Search</button>
                  <span className="fm-connection"><i /> Live</span>
                  <button className="rr-link-btn" onClick={() => setManageMembersOpen((v) => !v)}>Manage group</button>
                  {!activeChannel?.is_dm && <button className="rr-link-btn" onClick={openChannelRoster}>Channel members ({visibleChannelMembers.length})</button>}
                  <span className="rd-rowlink">Channel settings are read-only (no update-channel contract).</span>
                </div>
              </div>
              {searchOpen && (
                <div className="fm-search-row">
                  <div className="rd-search" style={{ margin: '8px 14px 0' }}>
                    <Icon name="search" size={13} />
                    <input placeholder="Search messages in this channel…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                </div>
              )}
              {manageMembersOpen && (
                <div className="fm-manage-members">
                  {members.map((m) => (
                    <div className="fm-manage-row" key={m.id}>
                      <span className="fm-dm-avatar">{(m.display_name || m.name || '?')[0]}</span><span>{m.display_name || m.name}</span>
                      <select className="rr-select gr-inline-select" value={m.role} disabled={m.role === 'owner'} onChange={async (e) => {
                        try { await api.festiomeUpdateMember(activeGroup, m.id, { role: e.target.value }); setMembers(await api.festiomeMembers(activeGroup)); notify('Member role updated') }
                        catch (err) { setError(err.message || 'Member role could not be updated') }
                      }}>
                        {m.role === 'owner' && <option value="owner">Owner</option>}
                        <option value="admin">Admin</option><option value="moderator">Moderator</option><option value="member">Member</option><option value="readonly">Read only</option>
                      </select>
                      {!m.is_me && <button className="rr-link-btn" onClick={async () => {
                        try {
                          const channel = await api.festiomeOpenDirectMessage(activeGroup, m.id)
                          await refreshChannels()
                          setActive(channel.id)
                          setManageMembersOpen(false)
                        } catch (e) { setError(e.message || 'Direct message could not be opened') }
                      }}>Message</button>}
                      {canTransferOwnership && !m.is_me && <button className="rr-link-btn" onClick={() => setConfirmAction({
                        title: 'Transfer group ownership',
                        message: `Make ${m.display_name || m.name} the owner of this group? Your role will become administrator.`,
                        label: 'Transfer ownership',
                        action: async () => { await api.festiomeTransferOwner(activeGroup, m.id); setMembers(await api.festiomeMembers(activeGroup)); notify('Group ownership transferred') },
                      })}>Make owner</button>}
                      {m.role !== 'owner' && <button className="rr-link-btn gr-danger-link" onClick={() => setConfirmAction({
                        title: 'Remove member', message: `Remove ${m.display_name || m.name} from this group?`, label: 'Remove',
                        action: async () => { await api.festiomeRemoveMember(activeGroup, m.id); setMembers(await api.festiomeMembers(activeGroup)); notify('Member removed') },
                      })}>Remove</button>}
                    </div>
                  ))}
                </div>
              )}
              {channelRosterOpen && (
                <div className="fm-manage-members">
                  <div className="fm-rail-head">{activeChannel?.is_private ? 'Private channel access' : 'Channel members · open to the full group'}</div>
                  {members.map((member) => {
                    const enrolled = channelRoster.some((item) => item.id === member.id)
                    return <label className="fm-manage-row" key={member.id}>
                      <input type="checkbox" checked={enrolled} disabled={!activeChannel?.is_private || member.is_me || !!channelRosterBusy} onChange={() => toggleChannelMember(member)} />
                      <span>{member.display_name}</span>
                      <small>{member.is_me ? 'Your access' : member.role}</small>
                    </label>
                  })}
                  <button className="rr-link-btn" onClick={() => setChannelRosterOpen(false)}>Close channel access</button>
                </div>
              )}
              {messageCursor && <button className="rr-link-btn fm-load-older" onClick={async () => {
                try {
                  const result = await api.festiomeMessages(active, messageCursor)
                  const older = (result.items || result.messages || []).map((message) => adaptMessage(message, members))
                  setMessages((current) => [...older, ...current])
                  setMessageCursor(result.next_cursor || '')
                } catch (e) { setError(e.message || 'Older messages could not be loaded') }
              }}>Load older messages</button>}
              <div className="fm-thread-body">
                {messages
                  .filter((m) => !search.trim() || m.text.toLowerCase().includes(search.trim().toLowerCase()))
                  .map((m) => (
                  <div className="fm-msg" key={m.id}>
                    <span className="fm-msg-avatar">{m.from[0]}</span>
                    <div style={{ flex: 1 }}>
                      <div className="fm-msg-head"><strong>{m.from}</strong>{m.staff && <span className="fm-staff-tag">Staff</span>}<small>{m.time}</small></div>
                      {editingId === m.id ? (
                        <div className="rd-row2" style={{ marginTop: 4 }}>
                          <input className="rr-input" value={editDraft} onChange={(e) => setEditDraft(e.target.value)} style={{ marginBottom: 0 }} />
                          <button className="rr-btn secondary" onClick={async () => {
                            try { await api.festiomeEditMessage(m.id, { body: editDraft }); setMessages((items) => items.map((item) => item.id === m.id ? { ...item, text: editDraft } : item)); setEditingId(null); notify('Message updated') }
                            catch (e) { setError(e.message || 'Message could not be updated') }
                          }}>Save</button>
                        </div>
                      ) : <p>{m.text}</p>}
                      {!!m.attachments?.length && (
                        <div className="fm-message-files">
                          {m.attachments.map((file) => (
                            <button
                              type="button"
                              className="fm-message-file"
                              key={file.id || file.url}
                              onClick={() => api.festiomeDownloadAttachment(file.url, file.filename).catch((e) => setError(e.message || 'Attachment could not be downloaded'))}
                            >
                              <Icon name="download" size={13} />
                              <span>{file.filename || 'Attachment'}</span>
                              <small>{file.size_bytes > 0 ? `${Math.ceil(file.size_bytes / 1024)} KB` : ''}</small>
                            </button>
                          ))}
                        </div>
                      )}
                      {m.poll && (
                        <div className="fm-message-poll">
                          <strong>{m.poll.question}</strong>
                          {m.poll.options?.map((option) => (
                            <button
                              type="button"
                              className={option.voted_by_me ? 'selected' : ''}
                              key={option.id}
                              onClick={async () => {
                                try {
                                  await api.festiomeVotePoll(m.poll.id, option.id)
                                  const result = await api.festiomeMessages(active)
                                  setMessageCursor(result?.next_cursor || '')
                                  setMessages(listResponse(result).map((message) => adaptMessage(message, members)))
                                  notify('Vote recorded')
                                } catch (e) { setError(e.message || 'Vote could not be recorded') }
                              }}
                            >
                              <span>{option.label || option.text}</span>
                              <small>{option.votes || 0}</small>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="fm-msg-actions">
                        <button className={`fm-like-btn ${m.liked ? 'liked' : ''}`} onClick={() => toggleLike(m.id)}>👍 {m.likes > 0 ? m.likes : ''}</button>
                        {m.mine ? (
                          <>
                            <button className="fm-msg-action" onClick={() => { setEditingId(m.id); setEditDraft(m.text) }}>Edit</button>
                            <button className="fm-msg-action" onClick={() => setConfirmAction({
                              title: 'Delete message', message: 'Permanently delete this message?', label: 'Delete',
                              action: async () => { await api.festiomeDeleteMessage(m.id); setMessages((prev) => prev.filter((x) => x.id !== m.id)); notify('Message deleted') },
                            })}>Delete</button>
                          </>
                        ) : (
                          <button className="fm-msg-action" onClick={async () => {
                            try { await api.festiomeReportMessage(m.id, { reason: 'Reported by event administrator' }); notify(`Message from ${m.from} reported for review`) }
                            catch (e) { setError(e.message || 'Message could not be reported') }
                          }}>Report</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="fm-composer">
                <label className={`fm-attach-btn ${!active ? 'disabled' : ''}`} title={active ? 'Attach file' : 'Select a channel first'}><Icon name="upload" size={14} /><input type="file" hidden disabled={!active} onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  try { const uploaded = await api.festiomeUpload(active, file); setAttachments((current) => [...current, uploaded]); notify('Attachment uploaded') }
                  catch (err) { setError(err.message || 'Attachment could not be uploaded') }
                  e.target.value = ''
                }} /></label>
                <input className="rr-input" disabled={!active} style={{ marginBottom: 0 }} placeholder={activeChannel ? `Message #${activeChannel.name} — try @ to mention someone` : 'Select a channel to send a message'}
                  value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} />
                <button className="rr-link-btn" disabled={!active} onClick={() => setPollOpen((v) => !v)}>Poll</button>
                <button className="rr-btn primary" disabled={!active || (!draft.trim() && !attachments.length)} onClick={sendMessage}>Send</button>
              </div>
              {attachments.map((file) => <span key={file.id || file.filename} className="rd-chip">{file.filename || 'Attachment'}</span>)}
              {pollOpen && (
                <div className="fm-poll-form">
                  <input className="rd-field" placeholder="Poll question" value={poll.question} onChange={(e) => setPoll((v) => ({ ...v, question: e.target.value }))} style={{ marginBottom: 6 }} />
                  <input className="rd-field" placeholder="Option 1" value={poll.first} onChange={(e) => setPoll((v) => ({ ...v, first: e.target.value }))} style={{ marginBottom: 6 }} />
                  <input className="rd-field" placeholder="Option 2" value={poll.second} onChange={(e) => setPoll((v) => ({ ...v, second: e.target.value }))} style={{ marginBottom: 6 }} />
                  <div className="rd-row2">
                    <button className="rr-btn primary" disabled={!poll.question.trim() || !poll.first.trim() || !poll.second.trim()} onClick={async () => {
                      try { await api.festiomeCreatePoll(active, { question: poll.question.trim(), options: [poll.first.trim(), poll.second.trim()] }); setPoll({ question: '', first: '', second: '' }); setPollOpen(false); notify('Poll posted') }
                      catch (e) { setError(e.message || 'Poll could not be posted') }
                    }}>Post poll</button>
                  </div>
                </div>
              )}
            </div>

            <aside className="rr-panel fm-members">
              <div className="fm-member-section-head"><div><span>Channel members</span><strong>#{activeChannel?.name || 'channel'} · {visibleChannelMembers.length}</strong></div><span>{activeChannel?.is_private ? 'Private' : 'All group'}</span></div>
              {visibleChannelMembers.map((m) => (
                <div className="fm-member" key={`channel-${m.id}`}>
                  <span className="fm-dm-avatar">{(m.display_name || m.name || '?')[0]}</span>
                  <span>{m.display_name || m.name}</span>
                  <small>{m.role}</small>
                </div>
              ))}
              {!visibleChannelMembers.length && <p className="rd-rowlink" style={{ padding: '2px 8px 10px' }}>No members have access to this channel.</p>}
              <div className="fm-member-divider"/>
              <div className="fm-member-section-head"><div><span>Group directory</span><strong>{activeGroupRecord?.name || 'Group'} · {members.length}</strong></div></div>
              {members.map((m) => (
                <div className="fm-member" key={`group-${m.id}`}>
                  <span className="fm-dm-avatar">{(m.display_name || m.name || '?')[0]}</span>
                  <span>{m.display_name || m.name}</span>
                  <small>{m.role}</small>
                </div>
              ))}
              {!isPrimaryGroup && <button className="rr-btn secondary" disabled={!activeGroup} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={async () => {
                const current = groups.find((group) => group.id === activeGroup)
                const name = window.prompt('Group name', current?.name || '')
                if (!name?.trim()) return
                try { await api.festiomeManageUpdateGroup(eventId, activeGroup, { name: name.trim() }); await loadGroups(activeGroup); notify('Group renamed') }
                catch (e) { setError(e.message || 'Group could not be renamed') }
              }}>
                Rename group
              </button>}
              {!isPrimaryGroup && <button className="rr-btn secondary" disabled={!activeGroup} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => {
                const group = groups.find((item) => item.id === activeGroup)
                setGroupSettings({
                  description: group?.description || '',
                  join_policy: group?.join_policy || 'request',
                  visibility: group?.visibility || 'listed',
                  rules: group?.rules || '',
                })
                setGroupSettingsOpen(true)
              }}>Group settings</button>}
              <button className="rr-btn secondary" disabled={!activeGroup} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => setInviteOpen(true)}>Invite member</button>
              <button className="rr-link-btn" style={{ marginTop: 8 }} onClick={() => setReportsOpen((v) => !v)}>Moderation reports ({reports.length})</button>
              <span className="rd-rowlink" style={{ marginTop: 6 }}>Event administrators cannot leave managed event groups.</span>

              {reportsOpen && (
                <div className="fm-reports">
                  {reports.map((r) => (
                    <div className="fm-report-row" key={r.id}>
                      <p>"{r.message?.body || r.text || r.message || ''}"</p>
                      <span className="rd-rowlink">{r.reason} · {r.status}</span>
                      <div className="gr-actions" style={{ marginTop: 6 }}>
                        <button className="rr-link-btn" onClick={async () => { await api.festiomeUpdateReport(activeGroup, r.id, { status: 'dismissed' }); setReports(listResponse(await api.festiomeReports(activeGroup))); notify('Report dismissed') }}>Dismiss</button>
                        <button className="rr-link-btn gr-danger-link" disabled={!r.message_id && !r.message?.id} onClick={() => setConfirmAction({
                          title: 'Remove message', message: 'Remove this reported message from the channel?', label: 'Remove',
                          action: async () => { await api.festiomeDeleteMessage(r.message_id || r.message.id); await api.festiomeUpdateReport(activeGroup, r.id, { status: 'resolved' }); setReports(listResponse(await api.festiomeReports(activeGroup))); notify('Reported message removed') },
                        })}>Remove message</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      {notifOpen && (
        <div className="fm-modal-backdrop" onClick={() => setNotifOpen(false)}>
          <div className="rr-panel fm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rd-panel-head"><h3>Notification preferences</h3></div>
            <div className="rd-panel-body">
              {[['in_app', 'In-app notifications'], ['email', 'Email notifications']].map(([key, label]) => (
                <label key={key} className="gr-required-check" style={{ marginBottom: 8 }}><input type="checkbox" checked={!!preferences[key]} onChange={(e) => setPreferences((value) => ({ ...value, [key]: e.target.checked }))} /> {label}</label>
              ))}
              <label className="rd-field-label">Digest frequency</label>
              <select className="rd-field" value={preferences.digest || 'daily'} onChange={(event) => setPreferences((value) => ({ ...value, digest: event.target.value }))}><option value="immediate">Immediate</option><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option><option value="none">No digest</option></select>
              <label className="gr-required-check" style={{ marginBottom: 8 }}><input type="checkbox" checked={groupChannels.length > 0 && groupChannels.every((channel) => preferences.muted_channel_ids?.includes(channel.id))} onChange={(event) => setPreferences((value) => ({ ...value, muted_channel_ids: event.target.checked ? groupChannels.map((channel) => channel.id) : [] }))} /> Mute all channels in this group</label>
              <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={async () => {
                try {
                  setPreferences(await api.festiomeSaveNotificationPreferences(activeGroup, {
                    in_app: !!preferences.in_app,
                    email: !!preferences.email,
                    digest: preferences.digest || 'daily',
                    muted_channel_ids: preferences.muted_channel_ids || [],
                  }))
                  notify('Preferences saved'); setNotifOpen(false)
                }
                catch (e) { setError(e.message || 'Preferences could not be saved') }
              }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {inviteOpen && (
        <Modal title="Invite a member" onClose={() => { setInviteOpen(false); setInviteQuery('') }} width={480}>
          <label className="rd-field-label">Search event team or enter an email</label>
          <div className="rd-search" style={{ marginBottom: 10 }}><Icon name="search" size={13}/><input autoFocus value={inviteQuery} onChange={(event) => setInviteQuery(event.target.value)} placeholder="Name or email…" /></div>
          <div className="fm-invite-results">
            {teamCandidates.filter((candidate) => {
              const query = inviteQuery.trim().toLowerCase()
              return !query || `${candidate.name || ''} ${candidate.email || ''}`.toLowerCase().includes(query)
            }).filter((candidate) => !members.some((member) => member.display_name === candidate.name)).slice(0, 8).map((candidate) => (
              <button key={candidate.id} className="fm-invite-result" onClick={() => createInvitation(candidate.email)}>
                <span className="fm-dm-avatar">{(candidate.name || candidate.email || '?')[0].toUpperCase()}</span>
                <span><strong>{candidate.name || candidate.email}</strong><small>{candidate.email}</small></span>
                <Icon name="plus" size={13}/>
              </button>
            ))}
            {inviteQuery.includes('@') && <button className="fm-invite-result" onClick={() => createInvitation(inviteQuery)}><Icon name="mail" size={14}/><span><strong>Invite {inviteQuery.trim()}</strong><small>Send invitation to this address</small></span><Icon name="arrow" size={13}/></button>}
          </div>
        </Modal>
      )}

      {groupSettingsOpen && groupSettings && (
        <div className="fm-modal-backdrop" onClick={() => setGroupSettingsOpen(false)}>
          <div className="rr-panel fm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rd-panel-head"><h3>Group settings</h3></div>
            <div className="rd-panel-body">
              <label className="rd-field-label">Description</label>
              <textarea className="rr-textarea" value={groupSettings.description} onChange={(event) => setGroupSettings((value) => ({ ...value, description: event.target.value }))}/>
              <div className="rd-row2">
                <div><label className="rd-field-label">Join policy</label><select className="rd-field" value={groupSettings.join_policy} onChange={(event) => setGroupSettings((value) => ({ ...value, join_policy: event.target.value }))}><option value="open">Open</option><option value="request">Requires approval</option><option value="closed">Invite only</option></select></div>
                <div><label className="rd-field-label">Visibility</label><select className="rd-field" value={groupSettings.visibility} onChange={(event) => setGroupSettings((value) => ({ ...value, visibility: event.target.value }))}><option value="listed">Listed</option><option value="unlisted">Unlisted</option></select></div>
              </div>
              <label className="rd-field-label">Community rules</label>
              <textarea className="rr-textarea" value={groupSettings.rules} onChange={(event) => setGroupSettings((value) => ({ ...value, rules: event.target.value }))}/>
              <div className="rd-row2">
                <button className="rr-btn secondary" onClick={() => setGroupSettingsOpen(false)}>Cancel</button>
                <button className="rr-btn primary" onClick={async () => {
                  try {
                    await api.festiomeManageUpdateGroup(eventId, activeGroup, groupSettings)
                    await loadGroups(activeGroup)
                    setGroupSettingsOpen(false)
                    notify('Group settings saved')
                  } catch (e) { setError(e.message || 'Group settings could not be saved') }
                }}>Save settings</button>
              </div>
              <button className="rr-link-btn gr-danger-link" style={{ marginTop: 12 }} onClick={() => setConfirmAction({
                title: 'Archive group',
                message: `Archive ${groups.find((item) => item.id === activeGroup)?.name || 'this group'}? Members will no longer see it.`,
                label: 'Archive',
                action: async () => {
                  await api.festiomeManageUpdateGroup(eventId, activeGroup, { archived: true })
                  setGroupSettingsOpen(false)
                  const listed = await api.festiomeManageGroups(eventId)
                  setGroups(listed)
                  setActiveGroup(listed[0]?.id || '')
                  notify('Group archived')
                },
              })}>Archive group</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.label}
          danger
          onConfirm={async () => {
            try { await confirmAction.action?.(); if (confirmAction.result) notify(confirmAction.result) }
            catch (e) { setError(e.message || 'Action could not be completed') }
            finally { setConfirmAction(null) }
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </RedesignShell>
  )
}
