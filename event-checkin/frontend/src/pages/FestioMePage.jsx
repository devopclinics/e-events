import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

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
const heart = (message) =>
  (message?.reactions || []).find((reaction) =>
    ["❤️", "❤"].includes(reaction.emoji),
  );

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
  const [search, setSearch] = useState(""),
    [searchResults, setSearchResults] = useState([]),
    [reports, setReports] = useState([]);
  const [scheduleAt, setScheduleAt] = useState(""),
    [showComposerTools, setShowComposerTools] = useState(false);
  const [pollQuestion, setPollQuestion] = useState(""),
    [pollOptions, setPollOptions] = useState(["", ""]);
  const [preferences, setPreferences] = useState({
    in_app: true,
    email: true,
    digest: "daily",
    muted: false,
  });
  const [connection, setConnection] = useState("polling");
  const [discover, setDiscover] = useState([]),
    [joinReqs, setJoinReqs] = useState([]),
    [subForm, setSubForm] = useState({ name: "", join_policy: "request", visibility: "listed", rules: "" }),
    [settingsForm, setSettingsForm] = useState({ join_policy: "request", visibility: "listed", rules: "" });
  const bottomRef = useRef(null),
    fileRef = useRef(null),
    initialLoad = useRef(true);
  const activeGroup = groups.find((item) => item.id === groupId),
    activeChannel = channels.find((item) => item.id === channelId);
  const me = members.find(
    (member) =>
      member.is_me ||
      member.user_id === user?.id ||
      member.email === user?.email,
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
      if (next.at(-1)?.id) {
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
    [channelId],
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
  const eventRef = activeGroup?.external_event_ref;
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
  async function toggleLike(message) {
    const h = heart(message),
      liked = h?.reacted_by_me;
    try {
      if (liked) await api.festiomeUnlike(message.id);
      else await api.festiomeLike(message.id);
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
      setSearchResults(list(await api.festiomeSearch(groupId, search.trim())));
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

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <aside
        className={`${groupId ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-slate-200 dark:border-slate-700 md:w-72`}
      >
        <div className="flex items-center justify-between border-b p-4 dark:border-slate-700">
          <div>
            {guestMode && <a href="#" onClick={(event) => { event.preventDefault(); history.back(); }} className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-teal-600 dark:text-teal-300">← FestioHub</a>}
            <h1 className="font-bold dark:text-white">FestioMe</h1>
            <p className="text-xs text-slate-500">Connect, share and stay updated.</p>
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
            <div className="m-2 rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">
              Create your first FestioMe group.
            </div>
          )}
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => setGroupId(group.id)}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left ${group.id === groupId ? "bg-teal-50 dark:bg-teal-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-700 text-sm font-bold text-white">
                {initials(group.name)}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm dark:text-white">
                  {group.name}
                </b>
                <small className="text-slate-500">
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
              <h2 className="mt-3 font-bold dark:text-white">
                Welcome to FestioMe
              </h2>
              <p className="text-sm text-slate-500">
                Choose or create a group.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b p-3 dark:border-slate-700">
              <button onClick={() => setGroupId("")} className="p-2 md:hidden">
                ←
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-bold dark:text-white">
                  {activeGroup.name}
                </h2>
                <p className="text-xs text-slate-500">
                  {members.length} members ·{" "}
                  <span
                    className={connection === "live" ? "text-emerald-500" : ""}
                  >
                    {connection === "live" ? "Live" : "Reconnecting"}
                  </span>
                </p>
              </div>
              {guestMode && <a href="#" onClick={(event) => { event.preventDefault(); history.back(); }} className="rounded-lg border px-3 py-2 text-xs font-bold text-teal-700 dark:border-slate-600 dark:text-teal-300">FestioHub</a>}
              {eventRef && (
                <button
                  onClick={openDiscover}
                  className="rounded-lg border px-3 py-2 text-xs dark:border-slate-600"
                >
                  Discover
                </button>
              )}
              <button
                onClick={() => setPanel("search")}
                className="rounded-lg border px-3 py-2 text-xs dark:border-slate-600"
              >
                Search
              </button>
              <button
                onClick={() => setPanel(panel === "people" ? "" : "people")}
                className="rounded-lg border px-3 py-2 text-xs dark:border-slate-600"
              >
                People
              </button>
              <button
                onClick={openPreferences}
                className="rounded-lg border px-3 py-2 text-xs dark:border-slate-600"
                aria-label="FestioMe settings"
              >
                ⚙
              </button>
              {canModerate && (
                <button
                  onClick={() => setPanel(panel === "manage" ? "" : "manage")}
                  className="rounded-lg border px-3 py-2 text-xs dark:border-slate-600"
                >
                  Manage
                </button>
              )}
            </header>
            <div className="relative flex min-h-0 flex-1">
              <aside className="hidden w-48 shrink-0 border-r bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-950/20 sm:block">
                <div className="flex items-center justify-between px-2 py-2 text-[11px] font-bold uppercase text-slate-500">
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
                      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${channel.id === channelId ? "bg-white font-semibold text-teal-700 shadow dark:bg-slate-800 dark:text-teal-300" : "text-slate-600 dark:text-slate-300"}`}
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
                  <div className="mt-4 px-2 py-2 text-[11px] font-bold uppercase text-slate-500">
                    Direct Messages
                  </div>
                )}
                {channels
                  .filter((channel) => channel.is_dm)
                  .map((channel) => (
                    <button
                      key={channel.id}
                      onClick={() => setChannelId(channel.id)}
                      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${channel.id === channelId ? "bg-white font-semibold text-teal-700 shadow dark:bg-slate-800 dark:text-teal-300" : "text-slate-600 dark:text-slate-300"}`}
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
                    className="w-full rounded-lg border bg-white p-2 text-sm dark:bg-slate-800 dark:text-white"
                  >
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channelIcon(channel)} {channel.name}
                      </option>
                    ))}
                  </select>
                </div>
                {activeChannel && (
                  <div className="flex items-center gap-2 border-b px-4 py-2 text-sm dark:border-slate-700 sm:px-6">
                    <span>{channelIcon(activeChannel)}</span>
                    <b className="truncate dark:text-white">{activeChannel.name}</b>
                    {activeChannel.is_private && !activeChannel.is_dm && (
                      <>
                        <span className="text-xs text-slate-400">
                          · {activeChannel.member_count} member
                          {activeChannel.member_count === 1 ? "" : "s"} · private
                        </span>
                        <button
                          onClick={() => openChannelMembers(activeChannel)}
                          className="ml-auto rounded-lg border px-2 py-1 text-xs text-teal-600 dark:border-slate-600 dark:text-teal-400"
                        >
                          Members
                        </button>
                      </>
                    )}
                    {activeChannel.is_dm && (
                      <span className="text-xs text-slate-400">· direct message</span>
                    )}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
                  {cursor && (
                    <div className="pb-4 text-center">
                      <button
                        onClick={older}
                        disabled={loadingOlder}
                        className="rounded-full border px-4 py-1.5 text-xs text-slate-500 dark:border-slate-600"
                      >
                        {loadingOlder ? "Loading…" : "Load older messages"}
                      </button>
                    </div>
                  )}
                  {threadLoading && (
                    <p className="py-8 text-center text-sm text-slate-400">
                      Loading messages…
                    </p>
                  )}
                  {!threadLoading && channelId && !messages.length && (
                    <div className="grid h-full place-items-center text-center">
                      <div>
                        <div className="text-3xl">👋</div>
                        <h3 className="mt-3 font-bold dark:text-white">
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
                      const h = heart(message);
                      return (
                        <article key={message.id} className="group flex gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-200 text-xs font-bold dark:bg-slate-700">
                            {initials(name(message))}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <b className="text-sm dark:text-white">
                                {name(message)}
                              </b>
                              <time className="text-[11px] text-slate-400">
                                {time(message.created_at)}
                                {message.edited_at ? " · edited" : ""}
                              </time>
                              {message.scheduled_for && (
                                <span className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-700">
                                  Scheduled
                                </span>
                              )}
                            </div>
                            {parent && (
                              <div className="my-1 truncate border-l-2 border-teal-400 pl-2 text-xs text-slate-400">
                                {name(parent)}: {text(parent)}
                              </div>
                            )}
                            <p
                              className={`whitespace-pre-wrap break-words text-sm ${deleted ? "italic text-slate-400" : "text-slate-700 dark:text-slate-200"}`}
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
                                className="mt-2 flex max-w-sm items-center gap-2 rounded-lg border p-2 text-xs text-teal-700 dark:border-slate-700"
                              >
                                <span>📎</span>
                                <span className="truncate">
                                  {file.name || file.filename || "Attachment"}
                                </span>
                                <span className="ml-auto text-slate-400">
                                  {file.size_bytes > 1
                                    ? `${Math.ceil(file.size_bytes / 1024)} KB`
                                    : ""}
                                </span>
                              </button>
                            ))}
                            {message.poll && (
                              <div className="mt-2 max-w-md rounded-xl border p-3 dark:border-slate-700">
                                <b className="text-sm dark:text-white">
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
                                    className="mt-2 flex w-full justify-between rounded-lg bg-slate-100 px-3 py-2 text-left text-xs dark:bg-slate-800"
                                  >
                                    <span>{option.label || option.text}</span>
                                    <span>{option.votes || 0}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {!deleted && (
                              <div className="mt-1 flex gap-3 text-xs text-slate-400 opacity-20 group-hover:opacity-100">
                                <button onClick={() => setReply(message)}>
                                  Reply
                                </button>
                                <button
                                  onClick={() => toggleLike(message)}
                                  className={
                                    h?.reacted_by_me ? "text-rose-500" : ""
                                  }
                                >
                                  ♥ {h?.count || ""}
                                </button>
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
                          </div>
                        </article>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                </div>
                {channelId && rulesBlocked && (
                  <div className="border-t bg-amber-50 p-4 dark:border-slate-700 dark:bg-amber-950/30">
                    <b className="text-sm text-amber-800 dark:text-amber-200">
                      Please review the group rules
                    </b>
                    <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">
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
                    className="relative border-t p-3 dark:border-slate-700"
                  >
                    {mentionChoices.length > 0 && (
                      <div className="absolute bottom-full left-6 mb-1 w-64 rounded-xl border bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                        {mentionChoices.map((member) => (
                          <button
                            type="button"
                            key={member.id}
                            onClick={() => insertMention(member)}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            @{name(member).replace(/\s+/g, "")}
                          </button>
                        ))}
                      </div>
                    )}
                    {(reply || editing) && (
                      <div className="mb-2 flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800">
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
                            className="rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800"
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
                      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800">
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploading}
                          className="rounded-lg border px-3 py-1.5 text-xs dark:border-slate-600"
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
                          className="rounded-lg border px-3 py-1.5 text-xs dark:border-slate-600"
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
                              className="rounded border bg-white p-1 dark:bg-slate-900"
                            />
                          </label>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowComposerTools((v) => !v)}
                        className="rounded-full border px-3 dark:border-slate-600"
                      >
                        +
                      </button>
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={`Message ${channelIcon(activeChannel)} ${activeChannel?.name || ""} — use @ to mention`}
                        className="min-w-0 flex-1 rounded-full border bg-white px-4 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
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
                <aside className="absolute inset-y-0 right-0 z-20 w-80 overflow-y-auto border-l bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900 md:static">
                  <div className="mb-4 flex justify-between">
                    <h3 className="font-bold capitalize dark:text-white">
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
                          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs dark:bg-slate-800"
                        />
                        <button className="rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white">
                          Invite
                        </button>
                      </form>
                      {members.some((member) => STAFF_ROLES.includes(member.role)) && (
                        <div className="mb-4">
                          <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">
                            Event staff
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {members
                              .filter((member) => STAFF_ROLES.includes(member.role))
                              .map((member) => (
                                <span
                                  key={member.id}
                                  className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
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
                            <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-200 text-[11px] font-bold dark:bg-slate-700">
                              {initials(name(member))}
                            </span>
                            <span className="min-w-0 flex-1">
                              <b className="block truncate text-sm dark:text-white">
                                {name(member)}
                              </b>
                              {canManage && !member.is_me ? (
                                <select
                                  value={member.role || "member"}
                                  onChange={(e) =>
                                    memberAction(member, "role", e.target.value)
                                  }
                                  className="bg-transparent text-[11px] capitalize text-slate-400"
                                >
                                  <option>member</option>
                                  <option>moderator</option>
                                  <option>admin</option>
                                </select>
                              ) : (
                                <small className="capitalize text-slate-400">
                                  {member.role}
                                </small>
                              )}
                            </span>
                            {!member.is_me && (
                              <button
                                onClick={() => startDirectMessage(member)}
                                title="Send a direct message"
                                className="text-xs text-teal-600 dark:text-teal-400"
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
                  {panel === "search" && (
                    <>
                      <form onSubmit={runSearch} className="flex gap-2">
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search FestioMe"
                          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm dark:bg-slate-800"
                        />
                        <button className="rounded-lg bg-teal-600 px-3 text-white">
                          ⌕
                        </button>
                      </form>
                      <div className="mt-4 space-y-3">
                        {searchResults.map((result) => (
                          <button
                            key={result.id}
                            onClick={() => {
                              if (result.channel_id)
                                setChannelId(result.channel_id);
                              setPanel("");
                            }}
                            className="block w-full rounded-lg border p-3 text-left dark:border-slate-700"
                          >
                            <b className="text-xs dark:text-white">
                              {name(result)}
                            </b>
                            <p className="line-clamp-2 text-xs text-slate-500">
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
                          className="w-full rounded-lg border p-3 text-left text-sm dark:border-slate-700"
                        >
                          Rename FestioMe group
                        </button>
                      )}
                      {canModerate && !activeGroup.is_primary && (
                        <button
                          onClick={openJoinRequests}
                          className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm dark:border-slate-700"
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
                          className="w-full rounded-lg border p-3 text-left text-sm dark:border-slate-700"
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
                          className="w-full rounded-lg border p-3 text-left text-sm dark:border-slate-700"
                        >
                          New group for this event
                        </button>
                      )}
                      <button
                        onClick={openReports}
                        className="w-full rounded-lg border p-3 text-left text-sm dark:border-slate-700"
                      >
                        Moderation reports
                      </button>
                      <button
                        onClick={() => setDialog("leave")}
                        className="w-full rounded-lg border p-3 text-left text-sm text-amber-600 dark:border-slate-700"
                      >
                        Leave group
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => setDialog("archive")}
                          className="w-full rounded-lg border p-3 text-left text-sm text-rose-600 dark:border-slate-700"
                        >
                          Archive group
                        </button>
                      )}
                    </div>
                  )}
                  {panel === "discover" && (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-500">
                        Groups for this event you can join.
                      </p>
                      {!discover.length && (
                        <p className="text-sm text-slate-500">
                          No other groups to join right now.
                        </p>
                      )}
                      {discover.map((group) => (
                        <div
                          key={group.id}
                          className="rounded-xl border p-3 dark:border-slate-700"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <b className="text-sm dark:text-white">{group.name}</b>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] capitalize text-slate-500 dark:bg-slate-800">
                              {group.is_primary ? "everyone" : group.join_policy}
                            </span>
                          </div>
                          {group.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                              {group.description}
                            </p>
                          )}
                          <div className="mt-2 flex items-center justify-between">
                            <small className="text-slate-400">
                              {group.member_count || 0} members
                            </small>
                            {group.is_member ? (
                              <button
                                onClick={() => {
                                  setPanel("");
                                  setGroupId(group.id);
                                }}
                                className="rounded-lg border px-3 py-1.5 text-xs dark:border-slate-600"
                              >
                                Open
                              </button>
                            ) : group.is_primary || group.join_policy === "closed" ? (
                              <span className="text-xs text-slate-400">Invite only</span>
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
                        <p className="text-sm text-slate-500">
                          No pending join requests.
                        </p>
                      )}
                      {joinReqs.map((request) => (
                        <div
                          key={request.id}
                          className="rounded-xl border p-3 dark:border-slate-700"
                        >
                          <b className="text-sm dark:text-white">
                            {request.display_name}
                          </b>
                          {request.message && (
                            <p className="mt-1 text-xs text-slate-500">
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
                              className="rounded-lg border px-3 py-1.5 text-xs text-rose-500 dark:border-slate-600"
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
                        <p className="text-sm text-slate-500">
                          No moderation reports.
                        </p>
                      )}
                      {reports.map((report) => (
                        <div
                          key={report.id}
                          className="rounded-xl border p-3 dark:border-slate-700"
                        >
                          <b className="text-sm dark:text-white">
                            {report.reason}
                          </b>
                          <p className="mt-1 text-xs text-slate-500">
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
                                  className="text-xs text-slate-500"
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
              className="w-full rounded-lg border p-3 dark:bg-slate-800 dark:text-white"
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
              className="w-full rounded-lg border p-3 dark:bg-slate-800 dark:text-white"
            />
            {!channelPrivate && (
              <select
                value={channelKind}
                onChange={(e) => setChannelKind(e.target.value)}
                className="w-full rounded-lg border p-3 dark:bg-slate-800 dark:text-white"
              >
                <option value="discussion">Discussion — everyone can talk</option>
                <option value="announcement">Announcement — admins post</option>
                <option value="staff">Staff — visible to staff only</option>
              </select>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={channelPrivate}
                onChange={(e) => setChannelPrivate(e.target.checked)}
              />
              Private — only the people you choose can see it
            </label>
            {channelPrivate && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2 dark:border-slate-700">
                <p className="px-1 pb-1 text-[11px] text-slate-400">
                  Select members (you are added automatically)
                </p>
                {members
                  .filter((member) => !member.is_me)
                  .map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-2 rounded px-1 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
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
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-200 text-[10px] font-bold dark:bg-slate-700">
                    {initials(name(member))}
                  </span>
                  <span className="min-w-0 flex-1 truncate dark:text-white">
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
              <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">
                Add people
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2 dark:border-slate-700">
                {members
                  .filter(
                    (member) =>
                      !channelMembers.some((cm) => cm.id === member.id),
                  )
                  .map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-2 rounded px-1 py-1 text-sm text-slate-600 dark:text-slate-300"
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
                  <p className="px-1 py-1 text-xs text-slate-400">
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
              className="w-full rounded-lg border p-3 dark:bg-slate-800 dark:text-white"
            />
            <label className="block text-xs font-semibold text-slate-500">
              Who can join
              <select
                value={subForm.join_policy}
                onChange={(e) => setSubForm({ ...subForm, join_policy: e.target.value })}
                className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800 dark:text-white"
              >
                <option value="open">Open — any guest can join instantly</option>
                <option value="request">Request — you approve each guest</option>
                <option value="closed">Closed — invite only</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-500">
              Visibility
              <select
                value={subForm.visibility}
                onChange={(e) => setSubForm({ ...subForm, visibility: e.target.value })}
                className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800 dark:text-white"
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
              className="w-full rounded-lg border p-3 text-sm dark:bg-slate-800 dark:text-white"
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
            <label className="block text-xs font-semibold text-slate-500">
              Who can join
              <select
                value={settingsForm.join_policy}
                onChange={(e) => setSettingsForm({ ...settingsForm, join_policy: e.target.value })}
                className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800 dark:text-white"
              >
                <option value="open">Open — any guest can join instantly</option>
                <option value="request">Request — you approve each guest</option>
                <option value="closed">Closed — invite only</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-500">
              Visibility
              <select
                value={settingsForm.visibility}
                onChange={(e) => setSettingsForm({ ...settingsForm, visibility: e.target.value })}
                className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800 dark:text-white"
              >
                <option value="listed">Listed in the event group directory</option>
                <option value="unlisted">Unlisted — reachable only by invite</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-500">
              Group rules
              <textarea
                value={settingsForm.rules}
                onChange={(e) => setSettingsForm({ ...settingsForm, rules: e.target.value })}
                placeholder="Members must accept these before posting. Editing re-prompts everyone."
                rows={3}
                className="mt-1 w-full rounded-lg border p-3 text-sm dark:bg-slate-800 dark:text-white"
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
            className="w-full rounded-lg border p-3 dark:bg-slate-800 dark:text-white"
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
          <p className="text-sm text-slate-500">
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
              className="w-full rounded-lg border p-3 dark:bg-slate-800 dark:text-white"
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
                className="w-full rounded-lg border p-3 dark:bg-slate-800 dark:text-white"
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
      {dialog === "preferences" && (
        <Dialog title="FestioMe notifications" onClose={() => setDialog("")}>
          <form
            onSubmit={savePreferences}
            className="space-y-3 text-sm dark:text-white"
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
            <label className="flex items-center justify-between">
              Email digest
              <select
                value={preferences.digest || "daily"}
                onChange={(e) =>
                  setPreferences({ ...preferences, digest: e.target.value })
                }
                className="rounded border bg-white p-2 dark:bg-slate-800"
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
          className="fixed bottom-20 right-4 z-[80] max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-left text-sm text-white shadow-xl dark:bg-white dark:text-slate-900"
        >
          {notice}
        </button>
      )}
    </div>
  );
}
