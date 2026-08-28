import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useGuestPush } from "../hooks/useGuestPush";
import "./FestioMePage.css";

const KINDS = { discussion: "#", announcement: "📣", staff: "🔒" };
const STAFF_ROLES = ["owner", "admin", "moderator"];
// A DM shows as an envelope, a private (non-DM) channel as a lock, otherwise the
// kind icon. Private topic channels reuse the discussion/announcement kind for
// posting rules, so the lock takes precedence for the label.
const channelIcon = (channel) =>
  channel?.is_dm ? "✉️" : channel?.is_private ? "🔒" : KINDS[channel?.kind] || "#";
const list = (value) =>
  Array.isArray(value)
    ? value
    : value?.items ||
      value?.results ||
      value?.groups ||
      value?.channels ||
      value?.messages ||
      value?.members ||
      [];
const text = (message) =>
  message?.body ?? message?.content ?? message?.text ?? "";
const name = (value) =>
  value?.sender_name ||
  value?.author_name ||
  value?.display_name ||
  value?.name ||
  "Festio member";
const initials = (value = "F") =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
const time = (value) =>
  value && !Number.isNaN(new Date(value).valueOf())
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
const errorText = (error) =>
  !error || error.status >= 500
    ? "FestioMe is temporarily unavailable. Your other Festio features are unaffected."
    : error.message || "FestioMe could not complete that request.";
const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "👏"];

function Dialog({ title, children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function FestioMePage() {
  const { user } = useAuth();
  const guestMode = typeof window !== "undefined" && window.location.pathname === "/festiome/guest";
  // Web Push is guest-only today (organizer/staff push isn't wired yet) and
  // reuses the same Guest Hub session token FestioMe already stores on entry.
  const guestPushContext = guestMode ? api.festiomeGuestContext() : null;
  const { pushConfig, pushState, pushBusy, pushError, enablePush, disablePush } =
    useGuestPush(guestPushContext?.eventId, guestPushContext?.passToken, { skip: !guestPushContext });
  // "Back to FestioHub" used to rely purely on browser history, which
  // silently no-ops when the guest arrived here fresh (new tab, QR code,
  // bookmark) — there's no history entry to go back to. The guest's Guest
  // Hub pass token is the same token FestioMe's own session was opened
  // with, so we can always build a real return URL instead of guessing.
  function openFestioHub() {
    if (guestPushContext?.passToken) {
      window.location.href = `/r/${encodeURIComponent(guestPushContext.passToken)}#guest-hub`;
    } else {
      history.back();
    }
  }
  const [showHome, setShowHome] = useState(true);
  const [groups, setGroups] = useState([]),
    [groupId, setGroupId] = useState("");
  const [channels, setChannels] = useState([]),
    [channelId, setChannelId] = useState("");
  const [messages, setMessages] = useState([]),
    [members, setMembers] = useState([]);
  const [cursor, setCursor] = useState(""),
    [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true),
    [threadLoading, setThreadLoading] = useState(false),
    [serviceDown, setServiceDown] = useState(false);
  const [notice, setNotice] = useState(""),
    [draft, setDraft] = useState(""),
    [reply, setReply] = useState(null),
    [sending, setSending] = useState(false);
  const [panel, setPanel] = useState(""),
    [dialog, setDialog] = useState(""),
    [formValue, setFormValue] = useState("");
  const [channelKind, setChannelKind] = useState("discussion"),
    [inviteEmail, setInviteEmail] = useState("");
  // Create-channel dialog: private toggle + selected member ids.
  const [channelPrivate, setChannelPrivate] = useState(false),
    [channelPickIds, setChannelPickIds] = useState([]);
  // Manage-members dialog for an existing private channel.
  const [channelMembers, setChannelMembers] = useState([]),
    [channelAddIds, setChannelAddIds] = useState([]);
  const [editing, setEditing] = useState(null),
    [attachments, setAttachments] = useState([]),
    [uploading, setUploading] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [typingMember, setTypingMember] = useState(null);
  const typingClearRef = useRef(null);
  const lastTypingPingRef = useRef(0);
  const [search, setSearch] = useState(""),
    [searchResults, setSearchResults] = useState([]),
    [searchAllGroups, setSearchAllGroups] = useState(false),
    [peopleSearch, setPeopleSearch] = useState(""),
    [reports, setReports] = useState([]);
  const [leaderboard, setLeaderboard] = useState({ items: [], me: null }),
    [matches, setMatches] = useState([]),
    [profileForm, setProfileForm] = useState({ display_name: "", bio: "", tags: "", discoverable: true });
  const [connections, setConnections] = useState([]),
    [meetups, setMeetups] = useState([]),
    [journey, setJourney] = useState(null),
    [meetupDraft, setMeetupDraft] = useState({ title: "", location: "", starts_at: "", description: "" });
  const [scheduleAt, setScheduleAt] = useState(""),
    [showComposerTools, setShowComposerTools] = useState(false);
  const [pollQuestion, setPollQuestion] = useState(""),
    [pollOptions, setPollOptions] = useState(["", ""]);
  const [preferences, setPreferences] = useState({
    in_app: true,
    email: true,
    push: true,
    digest: "daily",
    muted: false,
  });
  const [connection, setConnection] = useState("polling");
  const [homeSection, setHomeSection] = useState("home"),
    [communication, setCommunication] = useState(null),
    [communicationLoading, setCommunicationLoading] = useState(false),
    [communicationError, setCommunicationError] = useState(""),
    [homeDraft, setHomeDraft] = useState("");
  const [discover, setDiscover] = useState([]),
    [joinReqs, setJoinReqs] = useState([]),
    [subForm, setSubForm] = useState({ name: "", join_policy: "request", visibility: "listed", rules: "" }),
    [settingsForm, setSettingsForm] = useState({ join_policy: "request", visibility: "listed", rules: "" });
  const bottomRef = useRef(null),
    fileRef = useRef(null),
    initialLoad = useRef(true);
  const activeGroup = groups.find((item) => item.id === groupId),
    activeChannel = channels.find((item) => item.id === channelId);
  const eventRef = activeGroup?.external_event_ref;
  const me = members.find(
    (member) =>
      member.is_me ||
      (member.user_id && user?.id && member.user_id === user.id) ||
      (member.email && user?.email && member.email === user.email),
  );
  const canManage =
    ["owner", "admin"].includes(me?.role) ||
    ["owner", "admin"].includes(activeGroup?.viewer_role) ||
    activeGroup?.can_manage;
  const canModerate =
    canManage ||
    me?.role === "moderator" ||
    activeGroup?.viewer_role === "moderator";
  const isOwner =
    me?.role === "owner" || activeGroup?.viewer_role === "owner";

  const loadGroups = useCallback(async (preferred = "") => {
    try {
      const next = list(await api.festiomeSpaces());
      setGroups(next);
      setServiceDown(false);
      setGroupId((current) =>
        next.some((g) => g.id === (preferred || current))
          ? preferred || current
          : next[0]?.id || "",
      );
    } catch (error) {
      setServiceDown(true);
      setNotice(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search),
      token = params.get("invite"),
      guestEvent = params.get("event"),
      guestPass = params.get("pass");
    if (guestEvent && guestPass) {
      api
        .startFestioMeGuestSession(guestEvent, guestPass)
        .then(() => {
          history.replaceState({}, "", "/festiome/guest");
          loadGroups();
        })
        .catch((error) => {
          setNotice(errorText(error));
          setServiceDown(true);
          setLoading(false);
        });
      return;
    }
    if (!token) {
      loadGroups(params.get("group") || "");
      return;
    }
    api
      .acceptFestioMeInvite(token)
      .then((member) => {
        history.replaceState({}, "", "/festiome");
        setNotice("You joined the FestioMe group.");
        loadGroups(member.group_id);
      })
      .catch((error) => {
        setNotice(errorText(error));
        loadGroups();
      });
  }, [loadGroups]);

  const loadGroupData = useCallback(async () => {
    if (!groupId) return;
    try {
      const [channelData, memberData] = await Promise.all([
        api.festiomeChannels(groupId),
        api.festiomeMembers(groupId),
      ]);
      const next = list(channelData);
      setChannels(next);
      setMembers(list(memberData));
      setChannelId((current) =>
        next.some((item) => item.id === current)
          ? current
          : next.find((item) => Number(item.unread_count || 0) > 0)?.id || next[0]?.id || "",
      );
    } catch (error) {
      setNotice(errorText(error));
    }
  }, [groupId]);
  useEffect(() => {
    setChannels([]);
    setMembers([]);
    setChannelId("");
    if (groupId) loadGroupData();
  }, [groupId, loadGroupData]);

  const loadCommunityNetwork = useCallback(async () => {
    if (!groupId) return;
    const guestContext = guestMode ? api.festiomeGuestContext() : null;
    const results = await Promise.allSettled([
      api.festiomeMatches(groupId),
      api.festiomeConnections(groupId),
      api.festiomeMeetups(groupId),
      guestMode && guestContext?.eventId && guestContext?.passToken
        ? api.guestExperience(guestContext.eventId, guestContext.passToken)
        : Promise.resolve(null),
    ]);
    if (results[0].status === "fulfilled") setMatches(list(results[0].value));
    if (results[1].status === "fulfilled") setConnections(list(results[1].value));
    if (results[2].status === "fulfilled") setMeetups(list(results[2].value));
    if (results[3].status === "fulfilled") setJourney(results[3].value);
  }, [groupId, guestMode]);

  useEffect(() => { loadCommunityNetwork(); }, [loadCommunityNetwork]);

  const loadCommunication = useCallback(async () => {
    if (!eventRef) return;
    setCommunicationLoading(true);
    setCommunicationError("");
    try {
      const guestContext = guestMode ? api.festiomeGuestContext() : null;
      if (guestMode) {
        if (!guestContext?.passToken) {
          setCommunication(null);
          setCommunicationError("Open FestioMe from your FestioHub link to see event communication here.");
          return;
        }
        const hub = await api.guestHub(guestContext.eventId || eventRef, guestContext.passToken);
        setCommunication({
          mode: "guest",
          event: hub.event,
          guest: hub.guest,
          capabilities: hub.capabilities || {},
          announcements: hub.announcements || [],
          chat: hub.chat_messages || [],
          direct: hub.direct_messages || [],
          inbox: [],
        });
      } else {
        const results = await Promise.allSettled([
          api.messagingSettings(eventRef),
          api.listAnnouncements(eventRef),
          api.guestChatMessages(eventRef),
          api.messageInbox(eventRef),
        ]);
        const value = (index, fallback) => results[index].status === "fulfilled" ? results[index].value : fallback;
        const settings = value(0, {});
        setCommunication({
          mode: "organizer",
          event: { id: eventRef, name: activeGroup?.name },
          capabilities: {
            announcements: !!settings.announcements_enabled,
            direct_host_messages: !!settings.direct_host_messages_enabled,
            guest_chat: !!settings.guest_chat_enabled,
            guest_chat_posting: !!settings.guest_chat_posting_enabled,
          },
          announcements: list(value(1, [])),
          chat: list(value(2, [])),
          direct: [],
          inbox: list(value(3, [])),
        });
        if (results.every((result) => result.status === "rejected")) {
          setCommunicationError("Guest Communication is temporarily unavailable. FestioMe groups still work.");
        }
      }
    } catch (error) {
      setCommunicationError(error?.message || "Guest Communication is temporarily unavailable.");
    } finally {
      setCommunicationLoading(false);
    }
  }, [activeGroup?.name, eventRef, guestMode]);

  useEffect(() => {
    if (showHome && eventRef) loadCommunication();
  }, [eventRef, loadCommunication, showHome]);

  const mergeMessages = useCallback((incoming, prepend = false) => {
    setMessages((current) => {
      const map = new Map(
        (prepend ? [...incoming, ...current] : [...current, ...incoming]).map(
          (item) => [item.id, item],
        ),
      );
      return [...map.values()].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at),
      );
    });
  }, []);
  const loadMessages = useCallback(
    async (quiet = false) => {
      if (!channelId) return;
      if (!quiet) setThreadLoading(true);
      try {
        const result = await api.festiomeMessages(channelId),
          next = list(result).reverse();
      setMessages(next);
      setCursor(result?.next_cursor || result?.cursor || "");
      if (!showHome && next.at(-1)?.id) {
        api.festiomeRead(channelId, next.at(-1).id).catch(() => {});
        setChannels((current) =>
          current.map((item) =>
            item.id === channelId ? { ...item, unread_count: 0 } : item,
          ),
        );
      }
      } catch (error) {
        if (!quiet) setNotice(errorText(error));
      } finally {
        if (!quiet) setThreadLoading(false);
      }
    },
    [channelId, showHome],
  );

  useEffect(() => {
    setMessages([]);
    setReply(null);
    setCursor("");
    initialLoad.current = true;
    loadMessages();
    if (!channelId) return undefined;
    let timer,
      source,
      stopped = false;
    const polling = () => {
      setConnection("polling");
      timer = setInterval(() => loadMessages(true), 5000);
    };
    api
      .festiomeRealtimeTicket(channelId)
      .then(({ ticket }) => {
        if (stopped) return;
        source = new EventSource(
          `/api/festiome/v1/channels/${encodeURIComponent(channelId)}/events?ticket=${encodeURIComponent(ticket)}`,
        );
        source.onopen = () => {
          setConnection("live");
          if (timer) clearInterval(timer);
        };
        const refreshFromEvent = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload?.id && payload?.body !== undefined)
              mergeMessages([payload]);
            else loadMessages(true);
          } catch {
            loadMessages(true);
          }
        };
        source.onmessage = refreshFromEvent;
        [
          "message.created",
          "message.updated",
          "message.deleted",
          "reaction.updated",
          "poll.created",
          "poll.voted",
        ].forEach((eventName) =>
          source.addEventListener(eventName, refreshFromEvent),
        );
        source.addEventListener("typing.started", (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.member_id === me?.id) return;
            setTypingMember(payload);
            clearTimeout(typingClearRef.current);
            typingClearRef.current = setTimeout(() => setTypingMember(null), 4000);
          } catch {
            /* ignore malformed typing events */
          }
        });
        source.onerror = () => {
          source?.close();
          if (!timer) polling();
        };
      })
      .catch(polling);
    return () => {
      stopped = true;
      source?.close();
      if (timer) clearInterval(timer);
      clearTimeout(typingClearRef.current);
      setTypingMember(null);
    };
  }, [channelId, loadMessages, mergeMessages]);
  useEffect(() => {
    if (initialLoad.current && messages.length) {
      bottomRef.current?.scrollIntoView();
      initialLoad.current = false;
    }
  }, [messages.length]);

  async function older() {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await api.festiomeMessages(channelId, cursor),
        next = list(result).reverse();
      mergeMessages(next, true);
      setCursor(result?.next_cursor || "");
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setLoadingOlder(false);
    }
  }
  async function createGroup(event) {
    event.preventDefault();
    if (!formValue.trim()) return;
    try {
      const created = await api.festiomeCreateSpace({ name: formValue.trim() });
      setDialog("");
      setFormValue("");
      await loadGroups(created.id);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function updateGroup(action) {
    try {
      if (action === "rename")
        await api.festiomeUpdateSpace(groupId, { name: formValue.trim() });
      if (action === "archive") await api.festiomeArchiveSpace(groupId);
      if (action === "leave") await api.festiomeLeaveSpace(groupId);
      setDialog("");
      setFormValue("");
      if (action !== "rename") setGroupId("");
      await loadGroups(action === "rename" ? groupId : "");
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  const rulesBlocked =
    activeGroup && activeGroup.rules && activeGroup.rules_accepted === false;

  async function openDiscover() {
    setPanel("discover");
    if (!eventRef) {
      setDiscover([]);
      return;
    }
    try {
      setDiscover(list(await api.festiomeEventGroups(eventRef)));
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function joinGroup(group) {
    try {
      const result = await api.festiomeJoinGroup(group.id);
      if (result.status === "joined" || result.status === "already_member") {
        setNotice(`You joined ${group.name}.`);
        setPanel("");
        await loadGroups(group.id);
      } else {
        setNotice("Your request to join was sent for approval.");
        if (eventRef) setDiscover(list(await api.festiomeEventGroups(eventRef)));
      }
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function acceptRules() {
    try {
      await api.festiomeAcceptRules(groupId);
      setNotice("Thanks — you've accepted the group rules.");
      await loadGroups(groupId);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function openJoinRequests() {
    setPanel("requests");
    try {
      setJoinReqs(list(await api.festiomeGroupJoinRequests(groupId)));
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function decideRequest(request, approve, role = "member") {
    try {
      if (approve)
        await api.festiomeApproveJoinRequest(groupId, request.id, { role });
      else await api.festiomeDenyJoinRequest(groupId, request.id);
      setJoinReqs((current) => current.filter((r) => r.id !== request.id));
      await loadGroupData();
      await loadGroups(groupId);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function createSubgroup(event) {
    event.preventDefault();
    if (!eventRef || !subForm.name.trim()) return;
    try {
      const created = await api.festiomeCreateSubgroup(eventRef, {
        ...subForm,
        name: subForm.name.trim(),
        rules: subForm.rules.trim(),
      });
      setDialog("");
      setSubForm({ name: "", join_policy: "request", visibility: "listed", rules: "" });
      await loadGroups(created.id);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function saveGroupSettings(event) {
    event.preventDefault();
    try {
      await api.festiomeUpdateSpace(groupId, {
        join_policy: settingsForm.join_policy,
        visibility: settingsForm.visibility,
        rules: settingsForm.rules.trim(),
      });
      setDialog("");
      setNotice("Group settings saved.");
      await loadGroups(groupId);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function createChannel(event) {
    event.preventDefault();
    try {
      const created = await api.festiomeCreateChannel(groupId, {
        name: formValue.trim(),
        kind: channelPrivate ? "discussion" : channelKind,
        is_private: channelPrivate,
        ...(channelPrivate && { member_ids: channelPickIds }),
      });
      setDialog("");
      setFormValue("");
      setChannelPrivate(false);
      setChannelPickIds([]);
      await loadGroupData();
      setChannelId(created.id);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function openChannelMembers() {
    try {
      const current = await api.festiomeChannelMembers(channelId);
      setChannelMembers(list(current));
      setChannelAddIds([]);
      setDialog("channel-members");
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function addChannelMembers() {
    if (!channelAddIds.length) return;
    try {
      const updated = await api.festiomeAddChannelMembers(channelId, channelAddIds);
      setChannelMembers(list(updated));
      setChannelAddIds([]);
      await loadGroupData();
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function removeChannelMember(memberId) {
    try {
      await api.festiomeRemoveChannelMember(channelId, memberId);
      setChannelMembers((current) => current.filter((m) => m.id !== memberId));
      await loadGroupData();
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function startDirectMessage(member) {
    try {
      const dm = await api.festiomeOpenDirectMessage(groupId, member.id);
      await loadGroupData();
      setChannelId(dm.id);
      setPanel("");
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function send(event) {
    event.preventDefault();
    if ((!draft.trim() && !attachments.length) || sending) return;
    setSending(true);
    try {
      const mentionIds = members
        .filter((member) =>
          draft.includes(`@${name(member).replace(/\s+/g, "")}`),
        )
        .map((member) => member.id);
      const body =
        draft.trim() || `Shared ${attachments[0]?.filename || "an attachment"}`;
      const created = editing
        ? await api.festiomeEditMessage(editing.id, { body })
        : await api.festiomeSend(channelId, {
            body,
            ...(reply && { parent_id: reply.id }),
            ...(attachments.length && { attachments }),
            ...(mentionIds.length && { mention_member_ids: mentionIds }),
            ...(scheduleAt && {
              scheduled_for: new Date(scheduleAt).toISOString(),
            }),
          });
      mergeMessages([created]);
      setDraft("");
      setReply(null);
      setEditing(null);
      setAttachments([]);
      setScheduleAt("");
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setSending(false);
    }
  }
  async function removeMessage(message) {
    if (!confirm("Delete this message?")) return;
    try {
      await api.festiomeDeleteMessage(message.id);
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, deleted: true, body: "" } : item,
        ),
      );
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  function pingTyping() {
    if (!channelId || Date.now() - lastTypingPingRef.current < 3000) return;
    lastTypingPingRef.current = Date.now();
    api.festiomeTyping(channelId).catch(() => {});
  }
  async function toggleReaction(message, emoji, reactedByMe) {
    try {
      if (reactedByMe) await api.festiomeUnreact(message.id, emoji);
      else await api.festiomeReact(message.id, emoji);
      loadMessages(true);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function uploadFiles(files) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        [...files].map((file) => api.festiomeUpload(channelId, file)),
      );
      setAttachments((current) => [...current, ...uploaded]);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function invite(event) {
    event.preventDefault();
    try {
      const created = await api.festiomeInvite(groupId, {
          email: inviteEmail.trim(),
        }),
        link = `${location.origin}/festiome?invite=${encodeURIComponent(created.token)}`;
      await navigator.clipboard?.writeText(link);
      setInviteEmail("");
      setNotice(`FestioMe invitation link copied: ${link}`);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function memberAction(member, action, value) {
    try {
      if (action === "role")
        await api.festiomeUpdateMember(groupId, member.id, { role: value });
      if (
        action === "remove" &&
        confirm(`Remove ${name(member)} from FestioMe?`)
      )
        await api.festiomeRemoveMember(groupId, member.id);
      if (
        action === "owner" &&
        confirm(`Transfer ownership to ${name(member)}?`)
      )
        await api.festiomeTransferOwner(groupId, member.id);
      await loadGroupData();
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function runSearch(event) {
    event.preventDefault();
    if (!search.trim()) return;
    try {
      setSearchResults(
        list(
          searchAllGroups
            ? await api.festiomeSearchAllGroups(search.trim())
            : await api.festiomeSearch(groupId, search.trim()),
        ),
      );
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function openReports() {
    setPanel("reports");
    try {
      setReports(list(await api.festiomeReports(groupId)));
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  const refreshLeaderboard = useCallback(async () => {
    if (!groupId) return;
    try {
      const result = await api.festiomeLeaderboard(groupId);
      setLeaderboard({ items: result.items || [], me: result.me || null });
    } catch {
      /* the Profile tab's "your points" line is a nicety, not critical */
    }
  }, [groupId]);
  useEffect(() => { refreshLeaderboard(); }, [refreshLeaderboard]);
  function openLeaderboard() {
    setPanel("leaderboard");
    refreshLeaderboard();
  }
  async function openMatches() {
    setPanel("matches");
    if (!groupId) return;
    try {
      setMatches(list(await api.festiomeMatches(groupId)));
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  function openEditProfile() {
    setProfileForm({
      display_name: me?.display_name || name(user) || "",
      bio: me?.bio || "",
      tags: (me?.interest_tags || []).join(", "),
      discoverable: me?.discoverable !== false,
    });
    setDialog("editProfile");
  }
  async function saveProfile(event) {
    event.preventDefault();
    if (!groupId) return;
    try {
      await api.festiomeUpdateProfile(groupId, {
        display_name: profileForm.display_name.trim(),
        bio: profileForm.bio.trim(),
        interest_tags: profileForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
        discoverable: profileForm.discoverable,
      });
      await loadWorkspace(groupId);
      setDialog("");
      setNotice("Profile updated");
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function reportMessage(message) {
    const reason = prompt("Why are you reporting this message?");
    if (!reason?.trim()) return;
    try {
      await api.festiomeReportMessage(message.id, { reason: reason.trim() });
      setNotice("Report sent to FestioMe moderators.");
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function resolveReport(report, status) {
    try {
      await api.festiomeUpdateReport(groupId, report.id, { status });
      setReports((current) =>
        current.map((item) =>
          item.id === report.id ? { ...item, status } : item,
        ),
      );
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function openPreferences() {
    setDialog("preferences");
    try {
      setPreferences(await api.festiomeNotificationPreferences(groupId));
    } catch {
      /* defaults remain usable */
    }
  }
  async function savePreferences(event) {
    event.preventDefault();
    try {
      await api.festiomeSaveNotificationPreferences(groupId, preferences);
      setDialog("");
      setNotice("FestioMe notification preferences saved.");
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function createPoll(event) {
    event.preventDefault();
    try {
      const clean = pollOptions.map((item) => item.trim()).filter(Boolean);
      await api.festiomeCreatePoll(channelId, {
        question: pollQuestion.trim(),
        options: clean,
      });
      setDialog("");
      setPollQuestion("");
      setPollOptions(["", ""]);
      loadMessages(true);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  const mentionChoices = useMemo(
    () =>
      draft.match(/(?:^|\s)@([^\s]*)$/)
        ? members
            .filter((member) =>
              name(member).toLowerCase().includes(RegExp.$1.toLowerCase()),
            )
            .slice(0, 5)
        : [],
    [draft, members],
  );
  function insertMention(member) {
    setDraft((current) =>
      current.replace(/@[^\s]*$/, `@${name(member).replace(/\s+/g, "")} `),
    );
  }

  async function sendHomePost(event) {
    event.preventDefault();
    const body = homeDraft.trim();
    if (!body) return;
    const guestContext = api.festiomeGuestContext();
    try {
      setSending(true);
      if (guestMode && communication?.capabilities?.guest_chat_posting && guestContext) {
        await api.sendGuestChatMessage(guestContext.eventId || eventRef, guestContext.passToken, body);
        setHomeDraft("");
        await loadCommunication();
        setHomeSection("guest-chat");
        return;
      }
      const target = channels.find((channel) => !channel.is_dm && channel.kind === "discussion")
        || channels.find((channel) => !channel.is_dm);
      if (!target) throw new Error("No conversation is available for this post.");
      await api.festiomeSend(target.id, { body });
      setHomeDraft("");
      setChannelId(target.id);
      setShowHome(false);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setSending(false);
    }
  }

  if (loading)
    return (
      <div className="min-h-[60vh] grid place-items-center text-sm text-slate-500">
        Opening FestioMe…
      </div>
    );
  if (serviceDown)
    return (
      <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-amber-300 bg-amber-50 p-8 text-center dark:border-amber-800 dark:bg-amber-950/30">
        <div className="text-3xl">💬</div>
        <h1 className="mt-3 text-xl font-bold dark:text-white">
          FestioMe is taking a moment
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {notice}
        </p>
        <button
          onClick={() => {
            setLoading(true);
            loadGroups();
          }}
          className="mt-5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );

  if (showHome) {
    const displayName = (me?.display_name || name(user)).split(" ")[0] || "there";
    const unreadTotal = groups.reduce((total, group) => total + Number(group.unread_count || 0), 0)
      + channels.reduce((total, channel) => total + Number(channel.unread_count || 0), 0);
    const announcements = communication?.announcements || [];
    const guestChat = communication?.chat || [];
    const hostMessages = communication?.direct || [];
    const hostInbox = communication?.inbox || [];
    const latestAnnouncement = announcements[0];
    const latestChat = guestChat.slice(-2);
    const latestHostMessage = [...hostMessages].reverse().find((item) => item.sender_type === "organizer") || hostMessages.at(-1);
    const nativeLatest = messages.at(-1);
    const dmChannels = channels.filter((channel) => channel.is_dm);
    const currentSegment = journey?.program?.current_segments?.[0] || null;
    const nextSegment = journey?.program?.next_segments?.[0] || null;
    const sessionChannels = channels.filter((channel) => !channel.is_dm && /session|workshop|opening|keynote|panel/i.test(channel.name));
    const people = (matches.length ? matches.map((match) => ({
      ...members.find((member) => member.id === match.member_id),
      ...match,
      id: match.member_id,
      interest_tags: match.shared_tags || [],
    })) : members.filter((member) => !member.is_me)).slice(0, 6);
    const upcomingMeetup = meetups.find((meetup) => meetup.status === "scheduled") || null;
    const acceptedConnections = connections.filter((item) => item.status === "accepted");
    const topicCounts = [...members.reduce((counts, member) => {
      (member.interest_tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
      return counts;
    }, new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const openWorkspace = (group = activeGroup, preferredChannel = "") => {
      if (group?.id) setGroupId(group.id);
      if (preferredChannel) setChannelId(preferredChannel);
      setShowHome(false);
    };
    const nav = [
      ["home", "⌂", "Home"],
      ["people", "♙", "People"],
      ["groups", "♧", "Groups"],
      ["meetups", "▣", "Meetups"],
      ["sessions", "▹", "Sessions"],
      ["messages", "✉", "Messages"],
    ];
    const sourceBadge = (children, tone = "teal") => <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${tone === "purple" ? "border-purple-400/30 bg-purple-500/10 text-purple-300" : "border-teal-400/30 bg-teal-500/10 text-teal-300"}`}>{children}</span>;
    return (
      <div className="festiome-unified-home mx-auto flex min-h-[calc(100dvh-5.5rem)] w-full max-w-7xl overflow-hidden border-y border-teal-400/15 bg-[#061120] text-white shadow-2xl sm:min-h-[calc(100vh-7rem)] sm:rounded-3xl sm:border">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-white/10 bg-[#050e1e] p-4 md:flex">
          <div className="mb-8 px-2 text-2xl font-black">Festio<span className="text-teal-300">Me</span></div>
          <nav className="space-y-2">
            {nav.map(([key, icon, label]) => <button key={key} onClick={() => setHomeSection(key)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold ${homeSection === key ? "bg-teal-600/30 text-white" : "text-slate-300 hover:bg-white/5"}`}><span className="text-lg">{icon}</span>{label}{key === "messages" && unreadTotal > 0 && <span className="ml-auto rounded-full bg-purple-500 px-2 py-0.5 text-[10px]">{unreadTotal}</span>}</button>)}
          </nav>
          <button onClick={() => setHomeSection("profile")} className={`mt-auto flex items-center gap-3 rounded-xl border border-white/10 px-3 py-3 text-sm font-bold ${homeSection === "profile" ? "bg-white/10" : ""}`}><span className="grid h-8 w-8 place-items-center rounded-full bg-teal-700">{initials(name(user))}</span>Profile</button>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-3 sm:gap-4 sm:px-7 sm:py-4">
            <div className="min-w-0"><h1 className="line-clamp-2 break-words text-sm font-black leading-5 sm:text-lg">{activeGroup?.name || communication?.event?.name || "Your event community"}</h1><p className="mt-0.5 text-[11px] text-teal-300 sm:text-xs">FestioMe community</p></div>
            <div className="flex items-center gap-3"><button onClick={() => { setShowHome(false); openPreferences(); }} className="relative grid h-10 w-10 place-items-center rounded-full border border-white/15" aria-label="Notifications">🔔{unreadTotal > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-purple-500 px-1.5 text-[10px] font-black">{unreadTotal}</span>}</button><span className="grid h-10 w-10 place-items-center rounded-full bg-teal-700 text-xs font-black">{initials(name(user))}</span></div>
          </header>

          <div className="sticky top-0 z-30 overflow-x-auto border-b border-white/10 bg-[#061120]/95 p-1.5 backdrop-blur md:hidden"><div className="flex min-w-max gap-1">{[...nav, ["profile", "◯", "Profile"]].map(([key, icon, label]) => <button key={key} onClick={() => setHomeSection(key)} className={`w-16 shrink-0 rounded-lg px-1 py-2 text-[9px] font-bold ${homeSection === key ? "bg-teal-600/30 text-teal-200" : "text-slate-400"}`}><span className="block text-sm">{icon}</span><span className="block truncate">{label}</span></button>)}</div></div>

          <main className="min-w-0 overflow-x-hidden p-3 pb-8 sm:p-7">
            {communicationError && <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"><span>{communicationError}</span><button onClick={loadCommunication} className="font-black underline">Retry</button></div>}
            {communicationLoading && <div className="mb-5 text-xs font-bold text-teal-300">Refreshing Guest Communication…</div>}

            {homeSection === "home" && <div className="fm-guest-dashboard">
              <div className="fm-guest-welcome"><div><h2>Welcome back, {displayName}</h2><p>Your event community is live. Connect, learn, and make it count.</p></div><span><i/> {connection === "live" ? "Live updates" : "Reconnecting"}</span></div>
              <div className="fm-guest-columns">
                <div className="fm-guest-main">
                  <div className="fm-guest-feature-row">
                    <article className="fm-now-card">
                      <div className="fm-card-heading"><h3>Happening now</h3><span><i/> LIVE</span></div>
                      <div className="fm-session-hero"><div className="fm-session-art"><strong>MBF<br/><em>SUMMIT</em></strong><span>Building the future together.</span></div><div><span className="fm-session-number">{currentSegment?.category || "SESSION"}</span><h3>{currentSegment?.title || sessionChannels[0]?.name || "Community conversation"}</h3><p>{currentSegment?.description || "Meet peers, share ideas, and continue the session together."}</p><small>{currentSegment?.ends_at ? `Until ${new Date(currentSegment.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `${members.length} community members`}</small></div></div>
                      <div className="fm-session-actions"><button onClick={() => openWorkspace(activeGroup, sessionChannels[0]?.id || channels.find((channel) => !channel.is_dm)?.id)}>◯ Join discussion</button>{guestMode && currentSegment && guestPushContext?.eventId && guestPushContext?.passToken ? <a href={`/live/guest?event=${encodeURIComponent(guestPushContext.eventId)}&pass=${encodeURIComponent(guestPushContext.passToken)}&session=${encodeURIComponent(currentSegment.step_id)}`}>Open Festio Live</a> : <button className="outline" onClick={() => setHomeSection("sessions")}>View session</button>}</div>
                    </article>
                    <article className="fm-announcement-card"><div className="fm-card-heading"><h3>📣 Organizer announcement</h3>{sourceBadge("Event update", "purple")}</div>{latestAnnouncement ? <><span>{time(latestAnnouncement.created_at || latestAnnouncement.sent_at)}</span><h3>{latestAnnouncement.title}</h3><p>{latestAnnouncement.body}</p></> : <><span>From the event team</span><h3>Welcome to the community</h3><p>Announcements, helpful updates, and important moments will appear here.</p></>}<button onClick={() => setHomeSection("feed")}>View all announcements →</button></article>
                  </div>

                  <section className="fm-dashboard-section"><div className="fm-dashboard-title"><div><h3>People you should meet</h3><p>Suggested from interests you chose to share.</p></div><button onClick={() => setHomeSection("people")}>See all</button></div><div className="fm-people-preview">{people.slice(0, 3).map((person) => {
                    const relationship = connections.find((item) => item.other_member?.id === person.id);
                    return <article key={person.id}><span className="fm-preview-avatar">{initials(name(person))}</span><div><h4>{name(person)}</h4><p>{person.bio || "Event community member"}</p></div><div className="fm-preview-tags">{(person.interest_tags || []).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="fm-preview-actions"><button onClick={async () => { try { const dm = await api.festiomeOpenDirectMessage(groupId, person.id); await loadGroupData(); openWorkspace(activeGroup, dm.id); } catch (error) { setNotice(errorText(error)); } }}>Message</button><button className="primary" disabled={relationship?.status === "accepted" || relationship?.status === "pending"} onClick={async () => { try { const next = await api.festiomeRequestConnection(groupId, person.id); setConnections((items) => [next, ...items.filter((item) => item.id !== next.id)]); } catch (error) { setNotice(errorText(error)); } }}>{relationship?.status === "accepted" ? "Connected" : relationship?.status === "pending" ? "Requested" : "Connect"}</button></div></article>})}{!people.length && <div className="fm-dashboard-empty">Add interests to your profile to unlock people suggestions.</div>}</div></section>

                  <section className="fm-dashboard-section"><div className="fm-dashboard-title"><div><h3>Session conversations</h3><p>Continue the discussion around your program.</p></div><button onClick={() => setHomeSection("sessions")}>See all</button></div><div className="fm-session-list">{sessionChannels.slice(0, 4).map((channel, index) => <button key={channel.id} onClick={() => openWorkspace(activeGroup, channel.id)}><span className={`tone-${index % 4}`}>#{index + 1}</span><div><strong>{channel.name}</strong><small>{channel.description || "Join this session community"}</small></div><b>{channel.unread_count || 0}</b></button>)}{!sessionChannels.length && <button onClick={() => openWorkspace(activeGroup)}><span className="tone-0">#</span><div><strong>{activeChannel?.name || "General community"}</strong><small>Start the first event conversation</small></div><b>{activeChannel?.unread_count || 0}</b></button>}</div></section>

                  {upcomingMeetup && <section className="fm-upcoming-meetup"><div><span>UPCOMING MEETUP</span><h3>{upcomingMeetup.title}</h3><p>{new Date(upcomingMeetup.starts_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}{upcomingMeetup.location ? ` · ${upcomingMeetup.location}` : ""}</p><small>{upcomingMeetup.attendee_count} going · Hosted by {upcomingMeetup.creator_name}</small></div><button onClick={async () => { try { const updated = await api.festiomeRsvpMeetup(upcomingMeetup.id, "going"); setMeetups((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (error) { setNotice(errorText(error)); } }}>{upcomingMeetup.my_status === "going" ? "Going ✓" : "RSVP"}</button></section>}
                </div>

                <aside className="fm-guest-side">
                  <article><div className="fm-dashboard-title"><h3>Your connections</h3><button onClick={() => setHomeSection("people")}>See all</button></div><div className="fm-connection-list">{acceptedConnections.slice(0, 4).map((item) => <button key={item.id} onClick={() => setHomeSection("messages")}><span>{initials(name(item.other_member))}</span><div><strong>{name(item.other_member)}</strong><small>{item.other_member.bio || "Connected"}</small></div><i/></button>)}{!acceptedConnections.length && <p>Connections you accept will appear here.</p>}</div></article>
                  <article><div className="fm-dashboard-title"><h3>Trending topics</h3></div><div className="fm-trending-list">{topicCounts.map(([tag, count]) => <button key={tag} onClick={() => setHomeSection("people")}># {tag}<span>{count}</span></button>)}{!topicCounts.length && <p>Topics appear as members add profile interests.</p>}</div></article>
                  <article className="fm-community-pulse"><div className="fm-dashboard-title"><h3>Community pulse</h3><span><i/> Live</span></div><div><span><strong>{members.length}</strong><small>Members</small></span><span><strong>{channels.filter((channel) => !channel.is_dm).length}</strong><small>Conversations</small></span><span><strong>{meetups.reduce((sum, item) => sum + Number(item.attendee_count || 0), 0)}</strong><small>Meetup RSVPs</small></span></div><p>Keep the energy going—jump into a conversation.</p></article>
                  {nextSegment && <article className="fm-next-session"><span>NEXT UP</span><h3>{nextSegment.title}</h3><p>{new Date(nextSegment.starts_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</p><button onClick={() => setHomeSection("sessions")}>View program</button></article>}
                </aside>
              </div>
            </div>}

            {homeSection === "feed" && <section><div className="mb-5"><h2 className="text-3xl font-black">Event feed</h2><p className="mt-1 text-sm text-slate-400">Organizer updates from Guest Communication.</p></div><div className="space-y-4">{announcements.length ? announcements.map((item) => <article key={item.id} className="rounded-2xl border border-purple-400/20 bg-white/[0.035] p-5"><div className="flex items-center justify-between gap-3">{sourceBadge("Event Updates", "purple")}<time className="text-xs text-slate-500">{time(item.created_at || item.sent_at)}</time></div><h3 className="mt-4 text-xl font-black">{item.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{item.body}</p>{item.audience_type && <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-slate-500">Audience: {item.audience_type.replaceAll("_", " ")}</p>}</article>) : <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">No event updates yet.</div>}</div></section>}

            {homeSection === "guest-chat" && <section><div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-3xl font-black"># General</h2><p className="mt-1 text-sm text-slate-400">Shared Guest Chat · not merged with FestioMe channels</p></div>{sourceBadge("Guest Chat")}</div><div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">{guestChat.length ? guestChat.map((item) => <div key={item.id} className="flex gap-3 rounded-xl p-2"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-orange-500/20 text-xs font-black">{initials(name(item))}</span><div><div className="text-xs font-black">{name(item)} <span className="ml-1 font-normal text-slate-500">{time(item.created_at)}</span></div><p className="mt-1 text-sm text-slate-200">{text(item)}</p></div></div>) : <p className="p-4 text-sm text-slate-400">No messages yet.</p>}</div>{guestMode && communication?.capabilities?.guest_chat_posting && <form onSubmit={sendHomePost} className="mt-4 flex gap-2"><input value={homeDraft} onChange={(event) => setHomeDraft(event.target.value)} placeholder="Message Guest Chat…" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-[#0b1a30] px-4 py-3 text-sm"/><button disabled={sending || !homeDraft.trim()} className="rounded-xl bg-teal-500 px-5 font-black text-slate-950 disabled:opacity-40">Send</button></form>}{!communication?.capabilities?.guest_chat_posting && <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">Guest posting is paused. Existing messages remain visible.</p>}</section>}

            {homeSection === "people" && (() => {
              const q = peopleSearch.trim().toLowerCase()
              const everyone = members.filter((member) => !member.is_me)
              const filteredPeople = !q ? everyone : everyone.filter((member) =>
                name(member).toLowerCase().includes(q)
                || (member.bio || "").toLowerCase().includes(q)
                || (member.interest_tags || []).some((tag) => tag.toLowerCase().includes(q)))
              return <section className="fm-guest-page"><div className="fm-dashboard-title"><div><h2>People</h2><p>Discover attendees through interests they chose to share.</p></div><button onClick={openEditProfile}>Edit my interests</button></div>
                <div className="fm-people-search"><input value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} placeholder="Search people by name, bio, or interest…" /></div>
                <div className="fm-guest-people-grid">{filteredPeople.map((member) => {
                  const suggestion = matches.find((item) => item.member_id === member.id);
                  const relationship = connections.find((item) => item.other_member?.id === member.id);
                  return <article key={member.id}><span className="fm-preview-avatar">{initials(name(member))}</span><div><h3>{name(member)}</h3><p>{member.bio || "Event community member"}</p></div><div className="fm-preview-tags">{(suggestion?.shared_tags || member.interest_tags || []).slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>{relationship?.direction === "incoming" && relationship.status === "pending" ? <div className="fm-preview-actions"><button className="primary" onClick={async () => { try { const updated = await api.festiomeDecideConnection(relationship.id, "accepted"); setConnections((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (error) { setNotice(errorText(error)); } }}>Accept</button><button onClick={async () => { try { const updated = await api.festiomeDecideConnection(relationship.id, "declined"); setConnections((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (error) { setNotice(errorText(error)); } }}>Decline</button></div> : <div className="fm-preview-actions"><button onClick={async () => { try { const dm = await api.festiomeOpenDirectMessage(groupId, member.id); await loadGroupData(); openWorkspace(activeGroup, dm.id); } catch (error) { setNotice(errorText(error)); } }}>Message</button><button className="primary" disabled={relationship?.status === "accepted" || relationship?.status === "pending"} onClick={async () => { try { const next = await api.festiomeRequestConnection(groupId, member.id); setConnections((items) => [next, ...items.filter((item) => item.id !== next.id)]); } catch (error) { setNotice(errorText(error)); } }}>{relationship?.status === "accepted" ? "Connected" : relationship?.status === "pending" ? "Requested" : "Connect"}</button></div>}</article>
                })}{!filteredPeople.length && <div className="fm-dashboard-empty">{q ? `No one matches "${peopleSearch}".` : "No one else has joined yet."}</div>}</div></section>
            })()}

            {homeSection === "meetups" && <section className="fm-guest-page"><div className="fm-dashboard-title"><div><h2>Meetups</h2><p>Turn online introductions into useful event connections.</p></div><button onClick={() => setDialog(dialog === "meetup" ? "" : "meetup")}>Create meetup</button></div>{dialog === "meetup" && <form className="fm-guest-meetup-form" onSubmit={async (event) => { event.preventDefault(); try { const created = await api.festiomeCreateMeetup(groupId, { ...meetupDraft, title: meetupDraft.title.trim(), description: meetupDraft.description.trim(), location: meetupDraft.location.trim() }); setMeetups((items) => [...items, created].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))); setMeetupDraft({ title: "", location: "", starts_at: "", description: "" }); setDialog(""); } catch (error) { setNotice(errorText(error)); } }}><input required value={meetupDraft.title} onChange={(event) => setMeetupDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Meetup title"/><input value={meetupDraft.location} onChange={(event) => setMeetupDraft((value) => ({ ...value, location: event.target.value }))} placeholder="Location"/><input required type="datetime-local" value={meetupDraft.starts_at} onChange={(event) => setMeetupDraft((value) => ({ ...value, starts_at: event.target.value }))}/><textarea value={meetupDraft.description} onChange={(event) => setMeetupDraft((value) => ({ ...value, description: event.target.value }))} placeholder="What should people expect?"/><button>Create meetup</button></form>}<div className="fm-guest-meetup-list">{meetups.map((meetup) => <article key={meetup.id}><div className="fm-meetup-day"><strong>{new Date(meetup.starts_at).getDate()}</strong><span>{new Date(meetup.starts_at).toLocaleDateString([], { month: "short" })}</span></div><div><span>{new Date(meetup.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{meetup.location ? ` · ${meetup.location}` : ""}</span><h3>{meetup.title}</h3><p>{meetup.description || `Hosted by ${meetup.creator_name}`}</p><small>{meetup.attendee_count} going{meetup.capacity ? ` · ${Math.max(0, meetup.capacity - meetup.attendee_count)} spots left` : ""}</small></div><button className={meetup.my_status === "going" ? "active" : ""} onClick={async () => { try { const updated = await api.festiomeRsvpMeetup(meetup.id, meetup.my_status === "going" ? "interested" : "going"); setMeetups((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (error) { setNotice(errorText(error)); } }}>{meetup.my_status === "going" ? "Going ✓" : "RSVP"}</button></article>)}{!meetups.length && <div className="fm-dashboard-empty">No upcoming meetups yet. Create the first one.</div>}</div></section>}

            {homeSection === "sessions" && <section className="fm-guest-page"><div className="fm-dashboard-title"><div><h2>Sessions</h2><p>Your live program and its community conversations.</p></div></div><div className="fm-program-list">{(journey?.program?.days || []).flatMap((day) => day.segments).map((segment) => {
              const channel = sessionChannels.find((item) => item.name.toLowerCase().includes(segment.title.toLowerCase().slice(0, 12))) || sessionChannels.find((item) => item.name.includes(segment.title.split(":")[0]));
              return <article key={segment.step_id} className={segment.state}><div><span>{segment.state}</span><h3>{segment.title}</h3><p>{new Date(segment.starts_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}{segment.category ? ` · ${segment.category}` : ""}</p></div><div>{channel && <button onClick={() => openWorkspace(activeGroup, channel.id)}>Open discussion</button>}{guestMode && guestPushContext?.eventId && guestPushContext?.passToken && <a href={`/live/guest?event=${encodeURIComponent(guestPushContext.eventId)}&pass=${encodeURIComponent(guestPushContext.passToken)}&session=${encodeURIComponent(segment.step_id)}`}>Festio Live</a>}</div></article>;
            })}{!(journey?.program?.days || []).length && sessionChannels.map((channel) => <article key={channel.id}><div><span>COMMUNITY</span><h3>{channel.name}</h3><p>{channel.description || "Session conversation"}</p></div><button onClick={() => openWorkspace(activeGroup, channel.id)}>Open discussion</button></article>)}{!(journey?.program?.days || []).length && !sessionChannels.length && <div className="fm-dashboard-empty">No session communities are available yet.</div>}</div></section>}

            {homeSection === "groups" && <section><div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-3xl font-black">Groups</h2><p className="mt-1 text-sm text-slate-400">Native FestioMe communities.</p></div>{!guestMode && <button onClick={() => { setShowHome(false); setDialog("new-group"); setFormValue(""); }} className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950">New group</button>}</div><div className="space-y-3">{groups.map((group) => <div key={group.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4"><span className="grid h-12 w-12 place-items-center rounded-xl bg-teal-500/20 font-black text-teal-200">{initials(group.name)}</span><div className="min-w-0 flex-1"><strong className="block truncate">{group.name}</strong><span className="text-sm text-slate-400">{group.member_count || 0} members</span></div><button onClick={() => openWorkspace(group)} className="rounded-xl border border-teal-400/40 px-4 py-2 text-sm font-black text-teal-300">Open group</button></div>)}</div></section>}

            {homeSection === "messages" && <section><div className="mb-5"><h2 className="text-3xl font-black">Messages</h2><p className="mt-1 text-sm text-slate-400">Private conversations stay in their original inbox.</p></div><div className="space-y-4">{guestMode && <article className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.05] p-5"><div className="flex items-center justify-between gap-3"><strong>Message Host</strong><span className="text-xs text-amber-200">🔒 Only you and the organizer</span></div><div className="mt-4 space-y-3">{hostMessages.length ? hostMessages.map((item) => <div key={item.id} className="rounded-xl bg-white/[0.04] p-3"><div className="text-xs font-black">{item.sender_type === "organizer" ? "Event organizer" : "You"} · <span className="font-normal text-slate-500">{time(item.created_at)}</span></div><p className="mt-1 text-sm">{text(item)}</p></div>) : <p className="text-sm text-slate-400">No private messages yet. Use FestioHub to start a host conversation.</p>}</div>{guestMode && <button onClick={openFestioHub} className="mt-4 rounded-xl border border-blue-300/40 px-4 py-2 text-sm font-black text-blue-200">Open in FestioHub</button>}</article>}{!guestMode && <article className="rounded-2xl border border-blue-400/20 p-5"><strong>Guest Questions Inbox</strong><div className="mt-4 space-y-2">{hostInbox.length ? hostInbox.map((thread) => <div key={thread.thread_id || thread.id} className="rounded-xl bg-white/[0.04] p-3"><div className="text-sm font-black">{thread.guest_name || thread.title || "Guest question"}</div><p className="mt-1 text-sm text-slate-400">{thread.latest_message || thread.preview || "Private guest conversation"}</p></div>) : <p className="text-sm text-slate-400">No guest questions.</p>}</div><a href={`/admin?event=${encodeURIComponent(eventRef || "")}#communication`} className="mt-4 inline-flex rounded-xl border border-blue-300/40 px-4 py-2 text-sm font-black text-blue-200">Open organizer inbox</a></article>}{dmChannels.map((channel) => <button key={channel.id} onClick={() => openWorkspace(activeGroup, channel.id)} className="flex w-full items-center gap-3 rounded-2xl border border-white/10 p-4 text-left"><span className="grid h-10 w-10 place-items-center rounded-full bg-purple-500/20">✉</span><span className="flex-1"><strong className="block">{channel.name}</strong><span className="text-xs text-slate-400">FestioMe direct message</span></span><span className="text-sm font-black text-teal-300">Open</span></button>)}</div></section>}

            {homeSection === "profile" && (
              <section>
                <h2 className="text-3xl font-black">Profile</h2>
                <div className="mt-5 max-w-lg rounded-2xl border border-white/10 bg-white/[0.035] p-6">
                  <span className="grid h-20 w-20 place-items-center rounded-full bg-teal-700 text-xl font-black">{initials(me?.display_name || name(user))}</span>
                  <h3 className="mt-4 text-xl font-black">{me?.display_name || name(user)}</h3>
                  <p className="mt-1 text-sm capitalize text-slate-400">{me?.role || (guestMode ? "Guest" : "Organizer")}</p>
                  {me?.bio && <p className="mt-3 text-sm text-slate-300">{me.bio}</p>}
                  {!!me?.interest_tags?.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {me.interest_tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-teal-500/15 px-2.5 py-1 text-[11px] font-bold text-teal-300">{tag}</span>
                      ))}
                    </div>
                  )}
                  {leaderboard.me && <p className="mt-3 text-xs font-bold text-slate-400">Your points: <span className="text-teal-300">{leaderboard.me.points}</span></p>}
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button onClick={openEditProfile} className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950">Edit profile</button>
                    <button onClick={() => { setShowHome(false); setPanel("people"); }} className="rounded-xl border border-teal-400/40 px-4 py-2 text-sm font-black text-teal-300">View community profile</button>
                  </div>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl overflow-hidden rounded-2xl border border-[#1b3a52] bg-[#0a1f33] shadow-sm border-[#1b3a52] bg-[#0a1f33]">
      <aside
        className={`${groupId ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-[#1b3a52] border-[#1b3a52] md:w-72`}
      >
        <div className="flex items-center justify-between border-b p-4 border-[#1b3a52]">
          <div>
            {guestMode && <a href="#" onClick={(event) => { event.preventDefault(); openFestioHub(); }} className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-teal-600 text-teal-300">← FestioHub</a>}
            <h1 className="font-bold text-white">FestioMe</h1>
            <p className="text-xs text-[#7893a8]">Connect, share and stay updated.</p>
          </div>
          {!guestMode && <button
            onClick={() => {
              setDialog("new-group");
              setFormValue("");
            }}
            className="grid h-9 w-9 place-items-center rounded-xl bg-teal-600 text-xl text-white"
          >
            +
          </button>}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {!groups.length && (
            <div className="m-2 rounded-xl border border-dashed p-5 text-center text-sm text-[#7893a8]">
              Create your first FestioMe group.
            </div>
          )}
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => setGroupId(group.id)}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left ${group.id === groupId ? "bg-teal-500/10 bg-teal-500/15" : "hover:bg-[#132b45] hover:bg-[#132b45]"}`}
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-700 text-sm font-bold text-white">
                {initials(group.name)}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm text-white">
                  {group.name}
                </b>
                <small className="text-[#7893a8]">
                  {group.member_count || 0} members
                </small>
              </span>
              {Number(group.unread_count || 0) > 0 && (
                <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[11px] font-bold text-white">
                  {group.unread_count}
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>
      <section
        className={`${groupId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}
      >
        {!activeGroup ? (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <div className="text-4xl">💬</div>
              <h2 className="mt-3 font-bold text-white">
                Welcome to FestioMe
              </h2>
              <p className="text-sm text-[#7893a8]">
                Choose or create a group.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b p-3 border-[#1b3a52]">
              <button onClick={() => setShowHome(true)} className="rounded-lg border px-3 py-2 text-xs font-bold text-teal-600 border-[#1b3a52] text-teal-300">← Home</button>
              <button onClick={() => setGroupId("")} className="p-2 md:hidden">
                ←
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-bold text-white">
                  {activeGroup.name}
                </h2>
                <p className="text-xs text-[#7893a8]">
                  {members.length} members ·{" "}
                  <span
                    className={connection === "live" ? "text-emerald-500" : ""}
                  >
                    {connection === "live" ? "Live" : "Reconnecting"}
                  </span>
                </p>
              </div>
              {guestMode && <a href="#" onClick={(event) => { event.preventDefault(); openFestioHub(); }} className="rounded-lg border px-3 py-2 text-xs font-bold text-teal-700 border-[#1b3a52] text-teal-300">FestioHub</a>}
              {eventRef && (
                <button
                  onClick={openDiscover}
                  className="rounded-lg border px-3 py-2 text-xs border-[#1b3a52]"
                >
                  Discover
                </button>
              )}
              <button
                onClick={() => setPanel("search")}
                className="rounded-lg border px-3 py-2 text-xs border-[#1b3a52]"
              >
                Search
              </button>
              <button
                onClick={() => setPanel(panel === "people" ? "" : "people")}
                className="rounded-lg border px-3 py-2 text-xs border-[#1b3a52]"
              >
                People
              </button>
              <button
                onClick={() => (panel === "leaderboard" ? setPanel("") : openLeaderboard())}
                className="rounded-lg border px-3 py-2 text-xs border-[#1b3a52]"
              >
                🏆 Leaderboard
              </button>
              <button
                onClick={() => (panel === "matches" ? setPanel("") : openMatches())}
                className="rounded-lg border px-3 py-2 text-xs border-[#1b3a52]"
              >
                🤝 Suggested
              </button>
              <button
                onClick={openPreferences}
                className="rounded-lg border px-3 py-2 text-xs border-[#1b3a52]"
                aria-label="FestioMe settings"
              >
                ⚙
              </button>
              {canModerate && (
                <button
                  onClick={() => setPanel(panel === "manage" ? "" : "manage")}
                  className="rounded-lg border px-3 py-2 text-xs border-[#1b3a52]"
                >
                  Manage
                </button>
              )}
            </header>
            <div className="relative flex min-h-0 flex-1">
              <aside className="hidden w-48 shrink-0 border-r bg-[#061120]/60 p-2 border-[#1b3a52] sm:block">
                <div className="flex items-center justify-between px-2 py-2 text-[11px] font-bold uppercase text-[#7893a8]">
                  <span>Channels</span>
                  {canManage && (
                    <button
                      onClick={() => {
                        setDialog("new-channel");
                        setFormValue("");
                      }}
                      className="text-lg"
                    >
                      +
                    </button>
                  )}
                </div>
                {channels
                  .filter((channel) => !channel.is_dm)
                  .map((channel) => (
                    <button
                      key={channel.id}
                      onClick={() => setChannelId(channel.id)}
                      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${channel.id === channelId ? "bg-[#0a1f33] font-semibold text-teal-700 shadow bg-[#0d2338] text-teal-300" : "text-[#9bb0c1] text-[#c9d8e3]"}`}
                    >
                      <span>{channelIcon(channel)}</span>
                      <span className="truncate">{channel.name}</span>
                      {Number(channel.unread_count || 0) > 0 && (
                        <span className="ml-auto rounded-full bg-teal-600 px-1.5 text-[10px] text-white">
                          {channel.unread_count}
                        </span>
                      )}
                    </button>
                  ))}
                {channels.some((channel) => channel.is_dm) && (
                  <div className="mt-4 px-2 py-2 text-[11px] font-bold uppercase text-[#7893a8]">
                    Direct Messages
                  </div>
                )}
                {channels
                  .filter((channel) => channel.is_dm)
                  .map((channel) => (
                    <button
                      key={channel.id}
                      onClick={() => setChannelId(channel.id)}
                      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${channel.id === channelId ? "bg-[#0a1f33] font-semibold text-teal-700 shadow bg-[#0d2338] text-teal-300" : "text-[#9bb0c1] text-[#c9d8e3]"}`}
                    >
                      <span>{channelIcon(channel)}</span>
                      <span className="truncate">{channel.name}</span>
                      {Number(channel.unread_count || 0) > 0 && (
                        <span className="ml-auto rounded-full bg-teal-600 px-1.5 text-[10px] text-white">
                          {channel.unread_count}
                        </span>
                      )}
                    </button>
                  ))}
              </aside>
              <main className="flex min-w-0 flex-1 flex-col">
                <div className="border-b p-2 sm:hidden">
                  <select
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="w-full rounded-lg border bg-[#0a1f33] p-2 text-sm bg-[#0d2338] text-white"
                  >
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channelIcon(channel)} {channel.name}
                      </option>
                    ))}
                  </select>
                </div>
                {activeChannel && (
                  <div className="flex items-center gap-2 border-b px-4 py-2 text-sm border-[#1b3a52] sm:px-6">
                    <span>{channelIcon(activeChannel)}</span>
                    <b className="truncate text-white">{activeChannel.name}</b>
                    {activeChannel.is_private && !activeChannel.is_dm && (
                      <>
                        <span className="text-xs text-[#7893a8]">
                          · {activeChannel.member_count} member
                          {activeChannel.member_count === 1 ? "" : "s"} · private
                        </span>
                        <button
                          onClick={() => openChannelMembers(activeChannel)}
                          className="ml-auto rounded-lg border px-2 py-1 text-xs text-teal-600 border-[#1b3a52] text-teal-300"
                        >
                          Members
                        </button>
                      </>
                    )}
                    {activeChannel.is_dm && (
                      <span className="text-xs text-[#7893a8]">· direct message</span>
                    )}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
                  {cursor && (
                    <div className="pb-4 text-center">
                      <button
                        onClick={older}
                        disabled={loadingOlder}
                        className="rounded-full border px-4 py-1.5 text-xs text-[#7893a8] border-[#1b3a52]"
                      >
                        {loadingOlder ? "Loading…" : "Load older messages"}
                      </button>
                    </div>
                  )}
                  {threadLoading && (
                    <p className="py-8 text-center text-sm text-[#7893a8]">
                      Loading messages…
                    </p>
                  )}
                  {!threadLoading && channelId && !messages.length && (
                    <div className="grid h-full place-items-center text-center">
                      <div>
                        <div className="text-3xl">👋</div>
                        <h3 className="mt-3 font-bold text-white">
                          Start {channelIcon(activeChannel)}{" "}
                          {activeChannel?.name}
                        </h3>
                      </div>
                    </div>
                  )}
                  <div className="space-y-4">
                    {messages.map((message) => {
                      const parent =
                        message.parent ||
                        messages.find((item) => item.id === message.parent_id);
                      const deleted = message.deleted || message.deleted_at;
                      return (
                        <article key={message.id} className="group flex gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#13294a] text-xs font-bold bg-[#13294a]">
                            {initials(name(message))}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <b className="text-sm text-white">
                                {name(message)}
                              </b>
                              <time className="text-[11px] text-[#7893a8]">
                                {time(message.created_at)}
                                {message.edited_at ? " · edited" : ""}
                              </time>
                              {message.scheduled_for && (
                                <span className="rounded bg-amber-500/10 px-1.5 text-[10px] text-amber-700">
                                  Scheduled
                                </span>
                              )}
                            </div>
                            {parent && (
                              <div className="my-1 truncate border-l-2 border-teal-400 pl-2 text-xs text-[#7893a8]">
                                {name(parent)}: {text(parent)}
                              </div>
                            )}
                            <p
                              className={`whitespace-pre-wrap break-words text-sm ${deleted ? "italic text-[#7893a8]" : "text-[#c9d8e3] text-[#eef6f7]"}`}
                            >
                              {deleted ? "Message deleted" : text(message)}
                            </p>
                            {message.attachments?.map((file) => (
                              <button
                                type="button"
                                key={file.id || file.url}
                                onClick={() =>
                                  api
                                    .festiomeDownloadAttachment(
                                      file.url,
                                      file.filename,
                                    )
                                    .catch((error) =>
                                      setNotice(errorText(error)),
                                    )
                                }
                                className="mt-2 flex max-w-sm items-center gap-2 rounded-lg border p-2 text-xs text-teal-700 border-[#1b3a52]"
                              >
                                <span>📎</span>
                                <span className="truncate">
                                  {file.name || file.filename || "Attachment"}
                                </span>
                                <span className="ml-auto text-[#7893a8]">
                                  {file.size_bytes > 1
                                    ? `${Math.ceil(file.size_bytes / 1024)} KB`
                                    : ""}
                                </span>
                              </button>
                            ))}
                            {message.poll && (
                              <div className="mt-2 max-w-md rounded-xl border p-3 border-[#1b3a52]">
                                <b className="text-sm text-white">
                                  {message.poll.question}
                                </b>
                                {message.poll.options?.map((option) => (
                                  <button
                                    key={option.id}
                                    onClick={() =>
                                      api
                                        .festiomeVotePoll(
                                          message.poll.id,
                                          option.id,
                                        )
                                        .then(() => loadMessages(true))
                                        .catch((e) => setNotice(errorText(e)))
                                    }
                                    className="mt-2 flex w-full justify-between rounded-lg bg-[#0d2338] px-3 py-2 text-left text-xs bg-[#0d2338]"
                                  >
                                    <span>{option.label || option.text}</span>
                                    <span>{option.votes || 0}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {!deleted && (
                              <div className="mt-1 flex gap-3 text-xs text-[#7893a8] opacity-20 group-hover:opacity-100">
                                <button onClick={() => setReply(message)}>
                                  Reply
                                </button>
                                <span className="relative flex items-center gap-1">
                                  {(message.reactions || []).filter((r) => r.count > 0).map((r) => (
                                    <button
                                      key={r.emoji}
                                      onClick={() => toggleReaction(message, r.emoji, r.reacted_by_me)}
                                      className={`rounded-full border px-1.5 ${r.reacted_by_me ? "border-teal-400 bg-teal-500/10 text-teal-600 text-teal-300" : "border-[#1b3a52] border-[#1b3a52]"}`}
                                    >
                                      {r.emoji} {r.count}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => setReactionPickerFor(reactionPickerFor === message.id ? null : message.id)}
                                    className="rounded-full border border-dashed border-[#1b3a52] px-1.5 border-[#1b3a52]"
                                  >
                                    +
                                  </button>
                                  {reactionPickerFor === message.id && (
                                    <span className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full border bg-[#0a1f33] p-1 text-sm shadow-lg border-[#1b3a52] bg-[#0d2338]">
                                      {REACTION_EMOJIS.map((emoji) => (
                                        <button
                                          key={emoji}
                                          onClick={() => {
                                            const existing = (message.reactions || []).find((r) => r.emoji === emoji);
                                            toggleReaction(message, emoji, existing?.reacted_by_me);
                                            setReactionPickerFor(null);
                                          }}
                                          className="rounded-full px-1 hover:bg-[#0d2338] hover:bg-[#1a3555]"
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </span>
                                  )}
                                </span>
                                {(message.can_edit ||
                                  message.author_member_id === me?.id) && (
                                  <button
                                    onClick={() => {
                                      setEditing(message);
                                      setDraft(text(message));
                                    }}
                                  >
                                    Edit
                                  </button>
                                )}
                                {(message.can_delete ||
                                  canModerate ||
                                  message.author_member_id === me?.id) && (
                                  <button
                                    onClick={() => removeMessage(message)}
                                  >
                                    Delete
                                  </button>
                                )}
                                <button onClick={() => reportMessage(message)}>
                                  Report
                                </button>
                              </div>
                            )}
                            {message.author_member_id === me?.id && message.seen_count > 0 && (
                              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#7893a8]">
                                <svg viewBox="0 0 20 20" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10l4 4 10-10"/></svg>
                                Seen by {message.seen_count}
                              </p>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                </div>
                {channelId && rulesBlocked && (
                  <div className="border-t bg-amber-500/10 p-4 border-[#1b3a52] bg-amber-500/10">
                    <b className="text-sm text-amber-800 text-amber-200">
                      Please review the group rules
                    </b>
                    <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-[#9bb0c1] text-[#c9d8e3]">
                      {activeGroup.rules}
                    </p>
                    <button
                      onClick={acceptRules}
                      className="mt-3 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Accept &amp; continue
                    </button>
                  </div>
                )}
                {channelId && !rulesBlocked && (
                  <form
                    onSubmit={send}
                    className="relative border-t p-3 border-[#1b3a52]"
                  >
                    {mentionChoices.length > 0 && (
                      <div className="absolute bottom-full left-6 mb-1 w-64 rounded-xl border bg-[#0a1f33] p-1 shadow-xl border-[#1b3a52] bg-[#0d2338]">
                        {mentionChoices.map((member) => (
                          <button
                            type="button"
                            key={member.id}
                            onClick={() => insertMention(member)}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#0d2338] hover:bg-[#1a3555]"
                          >
                            @{name(member).replace(/\s+/g, "")}
                          </button>
                        ))}
                      </div>
                    )}
                    {(reply || editing) && (
                      <div className="mb-2 flex justify-between rounded-lg bg-[#0d2338] px-3 py-2 text-xs text-[#7893a8] bg-[#0d2338]">
                        <span>
                          {editing
                            ? "Editing message"
                            : `Replying to ${name(reply)}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setReply(null);
                            setEditing(null);
                            setDraft("");
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                    {attachments.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {attachments.map((file, index) => (
                          <span
                            key={file.id || index}
                            className="rounded-lg bg-[#0d2338] px-2 py-1 text-xs bg-[#0d2338]"
                          >
                            📎 {file.name || file.filename}{" "}
                            <button
                              type="button"
                              onClick={() =>
                                setAttachments((items) =>
                                  items.filter((_, i) => i !== index),
                                )
                              }
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {showComposerTools && (
                      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#0d2338] p-2 bg-[#0d2338]">
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploading}
                          className="rounded-lg border px-3 py-1.5 text-xs border-[#1b3a52]"
                        >
                          {uploading ? "Uploading…" : "📎 Attach files"}
                        </button>
                        <input
                          ref={fileRef}
                          type="file"
                          multiple
                          className="hidden"
                          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv"
                          onChange={(event) => uploadFiles(event.target.files)}
                        />
                        <button
                          type="button"
                          onClick={() => setDialog("poll")}
                          className="rounded-lg border px-3 py-1.5 text-xs border-[#1b3a52]"
                        >
                          📊 Poll
                        </button>
                        {canModerate && (
                          <label className="flex items-center gap-2 text-xs">
                            Schedule{" "}
                            <input
                              type="datetime-local"
                              value={scheduleAt}
                              onChange={(e) => setScheduleAt(e.target.value)}
                              className="rounded border bg-[#0a1f33] p-1 bg-[#0a1f33]"
                            />
                          </label>
                        )}
                      </div>
                    )}
                    {typingMember && (
                      <p className="mb-1 px-1 text-xs italic text-[#7893a8]">
                        {typingMember.display_name || "Someone"} is typing…
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowComposerTools((v) => !v)}
                        className="rounded-full border px-3 border-[#1b3a52]"
                      >
                        +
                      </button>
                      <input
                        value={draft}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          pingTyping();
                        }}
                        placeholder={`Message ${channelIcon(activeChannel)} ${activeChannel?.name || ""} — use @ to mention`}
                        className="min-w-0 flex-1 rounded-full border bg-[#0a1f33] px-4 py-2.5 text-sm border-[#1b3a52] bg-[#0d2338] text-white"
                      />
                      <button
                        disabled={
                          (!draft.trim() && !attachments.length) || sending
                        }
                        className="rounded-full bg-teal-600 px-5 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {sending
                          ? "Sending…"
                          : editing
                            ? "Save"
                            : scheduleAt
                              ? "Schedule"
                              : "Send"}
                      </button>
                    </div>
                  </form>
                )}
              </main>
              {panel && (
                <aside className="absolute inset-y-0 right-0 z-20 w-80 overflow-y-auto border-l bg-[#0a1f33] p-4 shadow-xl border-[#1b3a52] bg-[#0a1f33] md:static">
                  <div className="mb-4 flex justify-between">
                    <h3 className="font-bold capitalize text-white">
                      {panel}
                    </h3>
                    <button onClick={() => setPanel("")}>×</button>
                  </div>
                  {panel === "people" && (
                    <>
                      <form onSubmit={invite} className="mb-5 flex gap-2">
                        <input
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="Email address"
                          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs bg-[#0d2338]"
                        />
                        <button className="rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white">
                          Invite
                        </button>
                      </form>
                      {members.some((member) => STAFF_ROLES.includes(member.role)) && (
                        <div className="mb-4">
                          <p className="mb-1 text-[11px] font-bold uppercase text-[#7893a8]">
                            Event staff
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {members
                              .filter((member) => STAFF_ROLES.includes(member.role))
                              .map((member) => (
                                <span
                                  key={member.id}
                                  className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-700 bg-teal-500/15 text-teal-300"
                                  title={member.role}
                                >
                                  {name(member)}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}
                      <div className="space-y-3">
                        {members.map((member) => (
                          <div
                            key={member.id}
                            className="flex items-center gap-2"
                          >
                            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#13294a] text-[11px] font-bold bg-[#13294a]">
                              {initials(name(member))}
                            </span>
                            <span className="min-w-0 flex-1">
                              <b className="block truncate text-sm text-white">
                                {name(member)}
                              </b>
                              {canManage && !member.is_me ? (
                                <select
                                  value={member.role || "member"}
                                  onChange={(e) =>
                                    memberAction(member, "role", e.target.value)
                                  }
                                  className="bg-transparent text-[11px] capitalize text-[#7893a8]"
                                >
                                  <option>member</option>
                                  <option>moderator</option>
                                  <option>admin</option>
                                </select>
                              ) : (
                                <small className="capitalize text-[#7893a8]">
                                  {member.role}
                                </small>
                              )}
                            </span>
                            {!member.is_me && (
                              <button
                                onClick={() => startDirectMessage(member)}
                                title="Send a direct message"
                                className="text-xs text-teal-600 text-teal-300"
                              >
                                Message
                              </button>
                            )}
                            {canManage && !member.is_me && (
                              <button
                                onClick={() => memberAction(member, "remove")}
                                className="text-xs text-rose-500"
                              >
                                Remove
                              </button>
                            )}
                            {isOwner && !member.is_me && (
                              <button
                                onClick={() => memberAction(member, "owner")}
                                title="Make owner"
                                className="text-xs"
                              >
                                ♛
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {panel === "leaderboard" && (
                    <div className="space-y-2">
                      {!leaderboard.items.length && (
                        <p className="py-8 text-center text-sm text-[#7893a8]">
                          No points yet — post, react, vote, or check in to start climbing.
                        </p>
                      )}
                      {leaderboard.items.map((row) => (
                        <div
                          key={row.member_id}
                          className={`flex items-center gap-3 rounded-lg px-2 py-2 ${row.member_id === leaderboard.me?.member_id ? "bg-teal-500/10" : ""}`}
                        >
                          <span className="w-6 text-center text-sm font-black text-[#7893a8]">{row.rank}</span>
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#13294a] text-[11px] font-bold bg-[#13294a]">
                            {initials(row.display_name)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{row.display_name}</span>
                          <span className="text-sm font-black text-teal-500">{row.points}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {panel === "matches" && (
                    <div className="space-y-3">
                      {!matches.length && (
                        <p className="py-8 text-center text-sm text-[#7893a8]">
                          {me?.interest_tags?.length
                            ? "No shared interests found yet in this group."
                            : "Add interests to your profile to see suggested connections."}
                        </p>
                      )}
                      {matches.map((match) => (
                        <div key={match.member_id} className="rounded-xl border p-3 border-[#1b3a52]">
                          <div className="flex items-center gap-2">
                            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#13294a] text-[11px] font-bold bg-[#13294a]">
                              {initials(match.display_name)}
                            </span>
                            <b className="flex-1 truncate text-sm text-white">{match.display_name}</b>
                            <button
                              onClick={() => startDirectMessage(match)}
                              className="text-xs font-bold text-teal-600 text-teal-300"
                            >
                              Message
                            </button>
                          </div>
                          {match.bio && <p className="mt-2 text-xs text-[#7893a8]">{match.bio}</p>}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {match.shared_tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-bold text-teal-500">{tag}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {panel === "search" && (
                    <>
                      <form onSubmit={runSearch} className="flex gap-2">
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search FestioMe"
                          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm bg-[#0d2338]"
                        />
                        <button className="rounded-lg bg-teal-600 px-3 text-white">
                          ⌕
                        </button>
                      </form>
                      <div className="mt-2 flex gap-1 rounded-lg border p-0.5 text-[11px] font-bold border-[#1b3a52]">
                        <button
                          type="button"
                          onClick={() => setSearchAllGroups(false)}
                          className={`flex-1 rounded-md py-1 ${!searchAllGroups ? "bg-teal-600 text-white" : "text-[#7893a8]"}`}
                        >
                          This group
                        </button>
                        <button
                          type="button"
                          onClick={() => setSearchAllGroups(true)}
                          className={`flex-1 rounded-md py-1 ${searchAllGroups ? "bg-teal-600 text-white" : "text-[#7893a8]"}`}
                        >
                          All my groups
                        </button>
                      </div>
                      <div className="mt-4 space-y-3">
                        {searchResults.map((result) => (
                          <button
                            key={result.id}
                            onClick={() => {
                              if (result.channel_id)
                                setChannelId(result.channel_id);
                              setPanel("");
                            }}
                            className="block w-full rounded-lg border p-3 text-left border-[#1b3a52]"
                          >
                            <b className="text-xs text-white">
                              {name(result)}
                            </b>
                            <p className="line-clamp-2 text-xs text-[#7893a8]">
                              {text(result)}
                            </p>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {panel === "manage" && (
                    <div className="space-y-2">
                      {canManage && (
                        <button
                          onClick={() => {
                            setDialog("rename");
                            setFormValue(activeGroup.name);
                          }}
                          className="w-full rounded-lg border p-3 text-left text-sm border-[#1b3a52]"
                        >
                          Rename FestioMe group
                        </button>
                      )}
                      {canModerate && !activeGroup.is_primary && (
                        <button
                          onClick={openJoinRequests}
                          className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm border-[#1b3a52]"
                        >
                          <span>Join requests</span>
                          {Number(activeGroup.pending_request_count || 0) > 0 && (
                            <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[11px] font-bold text-white">
                              {activeGroup.pending_request_count}
                            </span>
                          )}
                        </button>
                      )}
                      {canManage && !activeGroup.is_primary && (
                        <button
                          onClick={() => {
                            setSettingsForm({
                              join_policy: activeGroup.join_policy || "request",
                              visibility: activeGroup.visibility || "listed",
                              rules: activeGroup.rules || "",
                            });
                            setDialog("settings");
                          }}
                          className="w-full rounded-lg border p-3 text-left text-sm border-[#1b3a52]"
                        >
                          Access &amp; rules
                        </button>
                      )}
                      {canManage && eventRef && (
                        <button
                          onClick={() => {
                            setSubForm({ name: "", join_policy: "request", visibility: "listed", rules: "" });
                            setDialog("new-subgroup");
                          }}
                          className="w-full rounded-lg border p-3 text-left text-sm border-[#1b3a52]"
                        >
                          New group for this event
                        </button>
                      )}
                      <button
                        onClick={openReports}
                        className="w-full rounded-lg border p-3 text-left text-sm border-[#1b3a52]"
                      >
                        Moderation reports
                      </button>
                      <button
                        onClick={() => setDialog("leave")}
                        className="w-full rounded-lg border p-3 text-left text-sm text-amber-600 border-[#1b3a52]"
                      >
                        Leave group
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => setDialog("archive")}
                          className="w-full rounded-lg border p-3 text-left text-sm text-rose-600 border-[#1b3a52]"
                        >
                          Archive group
                        </button>
                      )}
                    </div>
                  )}
                  {panel === "discover" && (
                    <div className="space-y-3">
                      <p className="text-xs text-[#7893a8]">
                        Groups for this event you can join.
                      </p>
                      {!discover.length && (
                        <p className="text-sm text-[#7893a8]">
                          No other groups to join right now.
                        </p>
                      )}
                      {discover.map((group) => (
                        <div
                          key={group.id}
                          className="rounded-xl border p-3 border-[#1b3a52]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <b className="text-sm text-white">{group.name}</b>
                            <span className="rounded bg-[#0d2338] px-1.5 py-0.5 text-[10px] capitalize text-[#7893a8] bg-[#0d2338]">
                              {group.is_primary ? "everyone" : group.join_policy}
                            </span>
                          </div>
                          {group.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-[#7893a8]">
                              {group.description}
                            </p>
                          )}
                          <div className="mt-2 flex items-center justify-between">
                            <small className="text-[#7893a8]">
                              {group.member_count || 0} members
                            </small>
                            {group.is_member ? (
                              <button
                                onClick={() => {
                                  setPanel("");
                                  setGroupId(group.id);
                                }}
                                className="rounded-lg border px-3 py-1.5 text-xs border-[#1b3a52]"
                              >
                                Open
                              </button>
                            ) : group.is_primary || group.join_policy === "closed" ? (
                              <span className="text-xs text-[#7893a8]">Invite only</span>
                            ) : group.has_pending_request ? (
                              <span className="text-xs text-amber-600">Requested</span>
                            ) : (
                              <button
                                onClick={() => joinGroup(group)}
                                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
                              >
                                {group.join_policy === "open" ? "Join" : "Ask to join"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {panel === "requests" && (
                    <div className="space-y-3">
                      {!joinReqs.length && (
                        <p className="text-sm text-[#7893a8]">
                          No pending join requests.
                        </p>
                      )}
                      {joinReqs.map((request) => (
                        <div
                          key={request.id}
                          className="rounded-xl border p-3 border-[#1b3a52]"
                        >
                          <b className="text-sm text-white">
                            {request.display_name}
                          </b>
                          {request.message && (
                            <p className="mt-1 text-xs text-[#7893a8]">
                              “{request.message}”
                            </p>
                          )}
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => decideRequest(request, true)}
                              className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => decideRequest(request, false)}
                              className="rounded-lg border px-3 py-1.5 text-xs text-rose-500 border-[#1b3a52]"
                            >
                              Deny
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {panel === "reports" && (
                    <div className="space-y-3">
                      {!reports.length && (
                        <p className="text-sm text-[#7893a8]">
                          No moderation reports.
                        </p>
                      )}
                      {reports.map((report) => (
                        <div
                          key={report.id}
                          className="rounded-xl border p-3 border-[#1b3a52]"
                        >
                          <b className="text-sm text-white">
                            {report.reason}
                          </b>
                          <p className="mt-1 text-xs text-[#7893a8]">
                            {report.details || `Message ${report.message_id}`}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <span className="text-xs capitalize">
                              {report.status}
                            </span>
                            {report.status === "open" && (
                              <>
                                <button
                                  onClick={() =>
                                    resolveReport(report, "dismissed")
                                  }
                                  className="text-xs text-[#7893a8]"
                                >
                                  Dismiss
                                </button>
                                <button
                                  onClick={() =>
                                    resolveReport(report, "resolved")
                                  }
                                  className="text-xs text-teal-600"
                                >
                                  Resolve
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              )}
            </div>
          </>
        )}
      </section>
      {dialog === "new-group" && (
        <Dialog title="Create FestioMe group" onClose={() => setDialog("")}>
          <form onSubmit={createGroup}>
            <input
              autoFocus
              required
              value={formValue}
              onChange={(e) => setFormValue(e.target.value)}
              placeholder="Group name"
              className="w-full rounded-lg border p-3 bg-[#0d2338] text-white"
            />
            <button className="mt-4 w-full rounded-lg bg-teal-600 p-2 font-semibold text-white">
              Create
            </button>
          </form>
        </Dialog>
      )}
      {dialog === "new-channel" && (
        <Dialog title="Create channel" onClose={() => setDialog("")}>
          <form onSubmit={createChannel} className="space-y-3">
            <input
              autoFocus
              required
              value={formValue}
              onChange={(e) => setFormValue(e.target.value)}
              placeholder="Channel name"
              className="w-full rounded-lg border p-3 bg-[#0d2338] text-white"
            />
            {!channelPrivate && (
              <select
                value={channelKind}
                onChange={(e) => setChannelKind(e.target.value)}
                className="w-full rounded-lg border p-3 bg-[#0d2338] text-white"
              >
                <option value="discussion">Discussion — everyone can talk</option>
                <option value="announcement">Announcement — admins post</option>
                <option value="staff">Staff — visible to staff only</option>
              </select>
            )}
            <label className="flex items-center gap-2 text-sm text-[#9bb0c1] text-[#c9d8e3]">
              <input
                type="checkbox"
                checked={channelPrivate}
                onChange={(e) => setChannelPrivate(e.target.checked)}
              />
              Private — only the people you choose can see it
            </label>
            {channelPrivate && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2 border-[#1b3a52]">
                <p className="px-1 pb-1 text-[11px] text-[#7893a8]">
                  Select members (you are added automatically)
                </p>
                {members
                  .filter((member) => !member.is_me)
                  .map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-2 rounded px-1 py-1 text-sm text-[#9bb0c1] hover:bg-[#132b45] text-[#c9d8e3] hover:bg-[#132b45]"
                    >
                      <input
                        type="checkbox"
                        checked={channelPickIds.includes(member.id)}
                        onChange={(e) =>
                          setChannelPickIds((current) =>
                            e.target.checked
                              ? [...current, member.id]
                              : current.filter((id) => id !== member.id),
                          )
                        }
                      />
                      {name(member)}
                    </label>
                  ))}
              </div>
            )}
            <button className="w-full rounded-lg bg-teal-600 p-2 font-semibold text-white">
              Create channel
            </button>
          </form>
        </Dialog>
      )}
      {dialog === "channel-members" && (
        <Dialog title="Channel members" onClose={() => setDialog("")}>
          <div className="space-y-4">
            <div className="space-y-2">
              {channelMembers.map((member) => (
                <div key={member.id} className="flex items-center gap-2 text-sm">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#13294a] text-[10px] font-bold bg-[#13294a]">
                    {initials(name(member))}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-white">
                    {name(member)}
                    {member.is_me && " (you)"}
                  </span>
                  {!member.is_me && (
                    <button
                      onClick={() => removeChannelMember(member.id)}
                      className="text-xs text-rose-500"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase text-[#7893a8]">
                Add people
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2 border-[#1b3a52]">
                {members
                  .filter(
                    (member) =>
                      !channelMembers.some((cm) => cm.id === member.id),
                  )
                  .map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-2 rounded px-1 py-1 text-sm text-[#9bb0c1] text-[#c9d8e3]"
                    >
                      <input
                        type="checkbox"
                        checked={channelAddIds.includes(member.id)}
                        onChange={(e) =>
                          setChannelAddIds((current) =>
                            e.target.checked
                              ? [...current, member.id]
                              : current.filter((id) => id !== member.id),
                          )
                        }
                      />
                      {name(member)}
                    </label>
                  ))}
                {members.filter(
                  (member) => !channelMembers.some((cm) => cm.id === member.id),
                ).length === 0 && (
                  <p className="px-1 py-1 text-xs text-[#7893a8]">
                    Everyone in this group is already in the channel.
                  </p>
                )}
              </div>
              <button
                onClick={addChannelMembers}
                disabled={!channelAddIds.length}
                className="mt-2 w-full rounded-lg bg-teal-600 p-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Add selected
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {dialog === "new-subgroup" && (
        <Dialog title="New group for this event" onClose={() => setDialog("")}>
          <form onSubmit={createSubgroup} className="space-y-3">
            <input
              autoFocus
              required
              value={subForm.name}
              onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
              placeholder="Group name (e.g. VIP, Table 5, Bus A)"
              className="w-full rounded-lg border p-3 bg-[#0d2338] text-white"
            />
            <label className="block text-xs font-semibold text-[#7893a8]">
              Who can join
              <select
                value={subForm.join_policy}
                onChange={(e) => setSubForm({ ...subForm, join_policy: e.target.value })}
                className="mt-1 w-full rounded-lg border p-2 bg-[#0d2338] text-white"
              >
                <option value="open">Open — any guest can join instantly</option>
                <option value="request">Request — you approve each guest</option>
                <option value="closed">Closed — invite only</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-[#7893a8]">
              Visibility
              <select
                value={subForm.visibility}
                onChange={(e) => setSubForm({ ...subForm, visibility: e.target.value })}
                className="mt-1 w-full rounded-lg border p-2 bg-[#0d2338] text-white"
              >
                <option value="listed">Listed in the event group directory</option>
                <option value="unlisted">Unlisted — reachable only by invite</option>
              </select>
            </label>
            <textarea
              value={subForm.rules}
              onChange={(e) => setSubForm({ ...subForm, rules: e.target.value })}
              placeholder="Optional group rules members must accept before posting"
              rows={3}
              className="w-full rounded-lg border p-3 text-sm bg-[#0d2338] text-white"
            />
            <button className="w-full rounded-lg bg-teal-600 p-2 font-semibold text-white">
              Create group
            </button>
          </form>
        </Dialog>
      )}
      {dialog === "settings" && (
        <Dialog title="Access & rules" onClose={() => setDialog("")}>
          <form onSubmit={saveGroupSettings} className="space-y-3">
            <label className="block text-xs font-semibold text-[#7893a8]">
              Who can join
              <select
                value={settingsForm.join_policy}
                onChange={(e) => setSettingsForm({ ...settingsForm, join_policy: e.target.value })}
                className="mt-1 w-full rounded-lg border p-2 bg-[#0d2338] text-white"
              >
                <option value="open">Open — any guest can join instantly</option>
                <option value="request">Request — you approve each guest</option>
                <option value="closed">Closed — invite only</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-[#7893a8]">
              Visibility
              <select
                value={settingsForm.visibility}
                onChange={(e) => setSettingsForm({ ...settingsForm, visibility: e.target.value })}
                className="mt-1 w-full rounded-lg border p-2 bg-[#0d2338] text-white"
              >
                <option value="listed">Listed in the event group directory</option>
                <option value="unlisted">Unlisted — reachable only by invite</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-[#7893a8]">
              Group rules
              <textarea
                value={settingsForm.rules}
                onChange={(e) => setSettingsForm({ ...settingsForm, rules: e.target.value })}
                placeholder="Members must accept these before posting. Editing re-prompts everyone."
                rows={3}
                className="mt-1 w-full rounded-lg border p-3 text-sm bg-[#0d2338] text-white"
              />
            </label>
            <button className="w-full rounded-lg bg-teal-600 p-2 font-semibold text-white">
              Save settings
            </button>
          </form>
        </Dialog>
      )}
      {dialog === "rename" && (
        <Dialog title="Rename FestioMe group" onClose={() => setDialog("")}>
          <input
            autoFocus
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            className="w-full rounded-lg border p-3 bg-[#0d2338] text-white"
          />
          <button
            onClick={() => updateGroup("rename")}
            className="mt-4 w-full rounded-lg bg-teal-600 p-2 font-semibold text-white"
          >
            Save
          </button>
        </Dialog>
      )}
      {["leave", "archive"].includes(dialog) && (
        <Dialog
          title={
            dialog === "leave"
              ? "Leave FestioMe group?"
              : "Archive FestioMe group?"
          }
          onClose={() => setDialog("")}
        >
          <p className="text-sm text-[#7893a8]">
            {dialog === "leave"
              ? "You will lose access unless invited again."
              : "Members will no longer be able to post."}
          </p>
          <button
            onClick={() => updateGroup(dialog)}
            className="mt-4 w-full rounded-lg bg-rose-600 p-2 font-semibold text-white"
          >
            Confirm
          </button>
        </Dialog>
      )}
      {dialog === "poll" && (
        <Dialog title="Create a poll" onClose={() => setDialog("")}>
          <form onSubmit={createPoll} className="space-y-2">
            <input
              required
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Question"
              className="w-full rounded-lg border p-3 bg-[#0d2338] text-white"
            />
            {pollOptions.map((option, index) => (
              <input
                key={index}
                required
                value={option}
                onChange={(e) =>
                  setPollOptions((current) =>
                    current.map((item, i) =>
                      i === index ? e.target.value : item,
                    ),
                  )
                }
                placeholder={`Option ${index + 1}`}
                className="w-full rounded-lg border p-3 bg-[#0d2338] text-white"
              />
            ))}
            <button
              type="button"
              onClick={() => setPollOptions((current) => [...current, ""])}
              className="text-sm text-teal-600"
            >
              + Add option
            </button>
            <button className="w-full rounded-lg bg-teal-600 p-2 font-semibold text-white">
              Post poll
            </button>
          </form>
        </Dialog>
      )}
      {dialog === "editProfile" && (
        <Dialog title="Edit profile" onClose={() => setDialog("")}>
          <form onSubmit={saveProfile} className="space-y-3 text-sm text-white">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-[#7893a8]">Display name</span>
              <input
                required
                value={profileForm.display_name}
                onChange={(e) => setProfileForm({ ...profileForm, display_name: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 bg-[#0d2338]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-[#7893a8]">Bio</span>
              <textarea
                maxLength={280}
                rows={3}
                value={profileForm.bio}
                onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                placeholder="A line about you"
                className="w-full rounded-lg border px-3 py-2 bg-[#0d2338]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-[#7893a8]">Interests</span>
              <input
                value={profileForm.tags}
                onChange={(e) => setProfileForm({ ...profileForm, tags: e.target.value })}
                placeholder="hiking, photography, coffee"
                className="w-full rounded-lg border px-3 py-2 bg-[#0d2338]"
              />
              <span className="mt-1 block text-[11px] text-[#7893a8]">
                Comma-separated. Shared interests power your Suggested connections — up to 10.
              </span>
            </label>
            <label className="flex items-center justify-between rounded-lg border px-3 py-2 border-[#1b3a52]">
              <span>
                <span className="block text-xs font-bold uppercase text-[#7893a8]">Show me in People</span>
                <span className="block text-[11px] text-[#7893a8]">
                  Off hides you from the People directory and Suggested connections. You can still message and be messaged.
                </span>
              </span>
              <input
                type="checkbox"
                checked={profileForm.discoverable}
                onChange={(e) => setProfileForm({ ...profileForm, discoverable: e.target.checked })}
                className="ml-3 h-5 w-5 shrink-0"
              />
            </label>
            <button className="w-full rounded-lg bg-teal-600 p-2 font-semibold text-white">
              Save
            </button>
          </form>
        </Dialog>
      )}
      {dialog === "preferences" && (
        <Dialog title="FestioMe notifications" onClose={() => setDialog("")}>
          <form
            onSubmit={savePreferences}
            className="space-y-3 text-sm text-white"
          >
            <label className="flex justify-between">
              In-app notifications
              <input
                type="checkbox"
                checked={preferences.in_app ?? true}
                onChange={(e) =>
                  setPreferences({ ...preferences, in_app: e.target.checked })
                }
              />
            </label>
            <label className="flex justify-between">
              Email notifications
              <input
                type="checkbox"
                checked={preferences.email ?? false}
                onChange={(e) =>
                  setPreferences({ ...preferences, email: e.target.checked })
                }
              />
            </label>
            <label className="flex justify-between">
              Push notifications
              <input
                type="checkbox"
                checked={preferences.push ?? true}
                onChange={(e) =>
                  setPreferences({ ...preferences, push: e.target.checked })
                }
              />
            </label>
            {guestMode && pushConfig && (
              <div className="flex items-center justify-between rounded-lg bg-[#0d2338] p-2 text-xs bg-[#0d2338]">
                <span>Notifications on this device</span>
                {pushState === "enabled" ? (
                  <button
                    type="button"
                    onClick={disablePush}
                    disabled={pushBusy}
                    className="rounded-md border border-[#1b3a52] px-2 py-1 font-bold dark:border-[#1b3a52]"
                  >
                    {pushBusy ? "Updating…" : "On ✓"}
                  </button>
                ) : pushState === "blocked" ? (
                  <span className="text-amber-600 text-amber-200">Blocked in browser settings</span>
                ) : (
                  <button
                    type="button"
                    onClick={enablePush}
                    disabled={pushBusy}
                    className="rounded-md bg-teal-600 px-2 py-1 font-bold text-white"
                  >
                    {pushBusy ? "Enabling…" : "Enable"}
                  </button>
                )}
              </div>
            )}
            {pushError && <p className="text-xs text-amber-600 text-amber-200">{pushError}</p>}
            <label className="flex items-center justify-between">
              Email digest
              <select
                value={preferences.digest || "daily"}
                onChange={(e) =>
                  setPreferences({ ...preferences, digest: e.target.value })
                }
                className="rounded border bg-[#0a1f33] p-2 bg-[#0d2338]"
              >
                <option value="immediate">Immediate</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="none">Never</option>
              </select>
            </label>
            <button className="w-full rounded-lg bg-teal-600 p-2 font-semibold text-white">
              Save preferences
            </button>
          </form>
        </Dialog>
      )}
      {notice && (
        <button
          onClick={() => setNotice("")}
          className="fixed bottom-20 right-4 z-[80] max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-left text-sm text-white shadow-xl bg-[#0a1f33] text-white"
        >
          {notice}
        </button>
      )}
    </div>
  );
}
