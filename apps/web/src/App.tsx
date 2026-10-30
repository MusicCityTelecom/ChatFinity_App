import {
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  lazy,
  Suspense,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  MessageCircle,
  Hash,
  Plus,
  Video,
  Search,
  Users,
  Settings,
  Send,
  Paperclip,
  Smile,
  X,
  Bookmark,
  Reply,
  Check,
  CheckCheck,
  MoreHorizontal,
  Lock,
  Globe,
  LogOut,
  ArrowLeft,
  ChevronDown,
  PanelLeft,
  Link as LinkIcon,
  ExternalLink,
  Shield,
  Mail,
  Trash2,
  LoaderCircle,
  ArrowDown,
  Headphones,
  Volume2,
} from "lucide-react";
import {
  api,
  type User,
  type Org,
  type Channel,
  type Member,
  type Message,
  type Attachment,
  type Meeting,
} from "./api";
import { Auth } from "./Auth";
import type { MeetingAccess } from "./Meeting";
const MeetingRoom = lazy(() =>
  import("./Meeting").then((m) => ({ default: m.MeetingRoom })),
);
import "./styles.css";
const initialInvite = new URLSearchParams(location.search).get("invite");
if (initialInvite) sessionStorage.setItem("cf-invite", initialInvite);
const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const day = (v: string) =>
  new Date(v).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const time = (v: string) =>
  new Date(v).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
const emojis = ["👍", "❤️", "😂", "🎉", "👀", "✅"];
function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={"icon-button" + (active ? " active" : "")}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}
function Avatar({
  name,
  online = false,
  size = "",
}: {
  name: string;
  online?: boolean;
  size?: string;
}) {
  return (
    <span className={"avatar " + size}>
      {initials(name)}
      {online && <i />}
    </span>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [config, setConfig] = useState({ registration: true, meetings: false });
  const [invite, setInvite] = useState(
      sessionStorage.getItem("cf-invite") || "",
    ),
    [orgs, setOrgs] = useState<Org[]>([]),
    [orgId, setOrgId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [channelId, setChannelId] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [channelMembers, setChannelMembers] = useState<Member[]>([]);
  const [more, setMore] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false),
    [draft, setDraft] = useState(""),
    [reply, setReply] = useState<Message | null>(null),
    [files, setFiles] = useState<Attachment[]>([]),
    [uploading, setUploading] = useState(false),
    [sending, setSending] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(""),
    [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [savedOnly, setSavedOnly] = useState(false),
    [sidebar, setSidebar] = useState(false);
  const [connected, setConnected] = useState(false),
    [typing, setTyping] = useState<{ name: string; until: number } | null>(
      null,
    ),
    [jump, setJump] = useState(false),
    [emojiPicker, setEmojiPicker] = useState(""),
    [editing, setEditing] = useState<Message | null>(null),
    [editText, setEditText] = useState(""),
    [meeting, setMeeting] = useState<MeetingAccess | null>(null);
  const [sound, setSound] = useState(
      localStorage.getItem("cf-sound") === "true",
    ),
    [desktop, setDesktop] = useState(
      localStorage.getItem("cf-desktop") === "true",
    );
  const socket = useRef<WebSocket | null>(null),
    current = useRef({ orgId, channelId, user, search, savedOnly, channels }),
    eventHandler = useRef<(e: Record<string, any>) => void>(() => {});
  current.current = { orgId, channelId, user, search, savedOnly, channels };
  const list = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    uploadInput = useRef<HTMLInputElement>(null),
    scrollMode = useRef<{
      kind: "bottom" | "preserve" | "prepend";
      height?: number;
      top?: number;
    }>({ kind: "bottom" }),
    clientId = useRef<string | null>(null),
    audio = useRef<AudioContext | null>(null),
    lastTyping = useRef(0),
    lastActivity = useRef(Date.now()),
    lastRead = useRef(""),
    historyAbort = useRef<AbortController | null>(null),
    loadGeneration = useRef(0);
  const org = orgs.find((o) => o.id === orgId),
    channel = channels.find((c) => c.id === channelId),
    isAdmin = org && ["owner", "admin"].includes(org.role);
  const pendingToken =
    new URLSearchParams(location.search).has("verify") ||
    new URLSearchParams(location.search).has("reset");
  useEffect(() => {
    const activity = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    const timer = setInterval(() => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(
          JSON.stringify({
            type: "activity",
            active:
              !document.hidden && Date.now() - lastActivity.current < 120000,
          }),
        );
    }, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, []);
  const draftKey = (c: string) => `cf-draft:${user?.id}:${c}`;
  const catchError = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Please try again.");
  function run(fn: () => Promise<unknown>) {
    setError("");
    void fn().catch(catchError);
  }
  const atBottom = () =>
    !list.current ||
    list.current.scrollHeight -
      list.current.scrollTop -
      list.current.clientHeight <
      100;
  async function loadOrgs(preferred?: string) {
    const { organizations } = await api<{ organizations: Org[] }>("/orgs");
    setOrgs(organizations);
    setOrgId((old) =>
      preferred || (old && organizations.some((o) => o.id === old))
        ? preferred || old
        : organizations[0]?.id || "",
    );
  }
  async function loadOrg(id: string) {
    const [ch, people] = await Promise.all([
      api<{ channels: Channel[] }>(`/orgs/${id}/channels`),
      api<{ members: Member[] }>(`/orgs/${id}/members`),
    ]);
    if (current.current.orgId !== id) return;
    setChannels(ch.channels);
    setMembers(people.members);
    setChannelId((old) =>
      old && ch.channels.some((c) => c.id === old)
        ? old
        : ch.channels.find((c) => c.joined)?.id || ch.channels[0]?.id || "",
    );
  }
  async function loadHistory(reset = false, before?: string) {
    const { channelId: id, search: query, savedOnly: saved } = current.current;
    if (!id) return;
    const selected = current.current.channels.find((c) => c.id === id);
    if (!selected?.joined) {
      setMessages([]);
      return;
    }
    historyAbort.current?.abort();
    const abort = new AbortController();
    historyAbort.current = abort;
    const generation = ++loadGeneration.current;
    setHistoryBusy(true);
    try {
      const params = new URLSearchParams({
        ...(query ? { search: query } : {}),
        ...(saved ? { saved: "true" } : {}),
        ...(before ? { before } : {}),
      });
      const result = await api<{ messages: Message[]; more: boolean }>(
        `/channels/${id}/messages?${params}`,
        "GET",
        undefined,
        abort.signal,
      );
      if (
        current.current.channelId !== id ||
        generation !== loadGeneration.current
      )
        return;
      const el = list.current;
      scrollMode.current = before
        ? {
            kind: "prepend",
            height: el?.scrollHeight || 0,
            top: el?.scrollTop || 0,
          }
        : reset || atBottom()
          ? { kind: "bottom" }
          : { kind: "preserve", top: el?.scrollTop || 0 };
      setMessages((old) => {
        if (reset) return result.messages;
        const merged = new Map(old.map((m) => [m.id, m]));
        result.messages.forEach((m) => merged.set(m.id, m));
        return [...merged.values()].sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        );
      });
      if (reset || before) setMore(result.more);
      else if (!atBottom()) setJump(true);
      const people = await api<{ members: Member[] }>(
        `/channels/${id}/members`,
      );
      if (current.current.channelId === id) setChannelMembers(people.members);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        catchError(e);
    } finally {
      if (generation === loadGeneration.current) setHistoryBusy(false);
    }
  }
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const mode = scrollMode.current;
    if (mode.kind === "bottom") el.scrollTop = el.scrollHeight;
    else if (mode.kind === "prepend")
      el.scrollTop = (mode.top || 0) + el.scrollHeight - (mode.height || 0);
    else el.scrollTop = mode.top || 0;
  }, [messages]);
  useEffect(() => {
    Promise.all([
      api<{ user: User }>("/me")
        .then((r) => setUser(r.user))
        .catch(() => {}),
      api<typeof config>("/config").then(setConfig),
    ]).finally(() => setLoading(false));
    const expired = () => {
      setUser(null);
      setOrgs([]);
      setOrgId("");
      setChannels([]);
      setMessages([]);
      setMeeting(null);
      setError("Please sign in again.");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (user?.verified_at) run(() => loadOrgs());
  }, [user?.id, user?.verified_at]);
  useEffect(() => {
    setChannels([]);
    setMembers([]);
    setChannelId("");
    if (orgId) run(() => loadOrg(orgId));
  }, [orgId]);
  useEffect(() => {
    setMessages([]);
    setReply(null);
    setFiles([]);
    setDraft(channelId ? localStorage.getItem(draftKey(channelId)) || "" : "");
    setTyping(null);
    setJump(false);
    lastRead.current = "";
    clientId.current = null;
    setSidebar(false);
    if (channelId) void loadHistory(true);
    return () => historyAbort.current?.abort();
  }, [channelId, channel?.joined]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (channelId) void loadHistory(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, savedOnly]);
  useEffect(() => {
    if (!user?.verified_at) return;
    let closed = false,
      timer: ReturnType<typeof setTimeout>;
    function connect() {
      if (closed) return;
      const ws = new WebSocket(
        location.origin.replace(/^http/, "ws") + "/api/events",
      );
      socket.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          eventHandler.current(JSON.parse(e.data));
        } catch {
          /* Invalid realtime packet. */
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, 3000);
      };
    }
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [user?.id, user?.verified_at]);
  useEffect(() => {
    const timer = setInterval(
      () => {
        const state = current.current;
        if (state.orgId && state.user?.verified_at) {
          void loadOrg(state.orgId).catch(() => {});
          if (!document.hidden) void loadHistory();
        }
      },
      connected ? 30000 : 10000,
    );
    return () => clearInterval(timer);
  }, [connected]);
  useEffect(() => {
    const timer = setInterval(
      () => setTyping((old) => (old && old.until < Date.now() ? null : old)),
      2000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        /* Sound unsupported. */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  function ping() {
    if (!sound || !audio.current || audio.current.state !== "running") return;
    const a = audio.current,
      o = a.createOscillator(),
      g = a.createGain();
    o.connect(g);
    g.connect(a.destination);
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.055, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.22);
    o.start();
    o.stop(a.currentTime + 0.22);
  }
  eventHandler.current = (e) => {
    if (
      e.type === "typing" &&
      e.channelId === channelId &&
      e.userId !== user?.id
    ) {
      setTyping({ name: e.name, until: Date.now() + 5000 });
      return;
    }
    if (e.type === "connected") {
      void loadOrgs().catch(catchError);
      if (orgId) void loadOrg(orgId).catch(catchError);
      if (channelId) void loadHistory();
      return;
    }
    if (e.type === "organization.updated") {
      void loadOrgs().catch(catchError);
    }
    if (e.orgId === orgId) {
      void loadOrg(orgId).catch(catchError);
      if (e.channelId === channelId && e.type !== "conversation.read")
        void loadHistory();
      if (e.type === "conversation.read" && e.channelId === channelId)
        void api<{ members: Member[] }>(`/channels/${channelId}/members`)
          .then((r) => setChannelMembers(r.members))
          .catch(() => {});
    }
    if (e.type === "meeting.ended" && meeting?.meeting.id === e.meetingId) {
      setMeeting(null);
      setNotice("The meeting has ended.");
    }
    if (
      e.type === "message.created" &&
      e.senderId !== user?.id &&
      user?.status !== "busy" &&
      (document.hidden || e.channelId !== channelId)
    ) {
      ping();
      document.title = "● New message · ChatFinity";
      if (
        desktop &&
        "Notification" in window &&
        Notification.permission === "granted"
      )
        new Notification("New ChatFinity message", {
          body: "A conversation you belong to has a new message.",
          tag: "chatfinity",
        });
    }
  };
  async function markRead() {
    const state = current.current,
      latest = messages[messages.length - 1];
    if (
      !latest ||
      document.hidden ||
      !atBottom() ||
      search ||
      savedOnly ||
      lastRead.current === latest.id ||
      latest.channel_id !== state.channelId
    )
      return;
    lastRead.current = latest.id;
    try {
      await api(`/channels/${state.channelId}/read`, "POST", {
        messageId: latest.id,
      });
      setChannels((old) =>
        old.map((c) => (c.id === state.channelId ? { ...c, unread: 0 } : c)),
      );
    } catch {
      lastRead.current = "";
    }
  }
  useEffect(() => {
    void markRead();
  }, [messages]);
  useEffect(() => {
    const visible = () => {
      if (!document.hidden) {
        document.title = "ChatFinity";
        void markRead();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [messages]);
  function updateDraft(text: string) {
    setDraft(text);
    clientId.current = null;
    if (channelId) {
      localStorage.setItem(draftKey(channelId), text);
      if (
        Date.now() - lastTyping.current > 2500 &&
        socket.current?.readyState === WebSocket.OPEN
      ) {
        socket.current.send(JSON.stringify({ type: "typing", channelId }));
        lastTyping.current = Date.now();
      }
    }
  }
  useLayoutEffect(() => {
    if (composer.current) {
      composer.current.style.height = "auto";
      composer.current.style.height =
        Math.min(130, Math.max(44, composer.current.scrollHeight)) + "px";
    }
  }, [draft]);
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (sending || uploading || !channel || (!draft.trim() && !files.length))
      return;
    setSending(true);
    setError("");
    clientId.current ??= crypto.randomUUID();
    const selected = channelId;
    try {
      await api(`/channels/${selected}/messages`, "POST", {
        body: draft,
        clientId: clientId.current,
        replyId: reply?.id || null,
        attachments: files.map((f) => f.id),
      });
      setDraft("");
      localStorage.removeItem(draftKey(selected));
      setFiles([]);
      setReply(null);
      clientId.current = null;
      scrollMode.current = { kind: "bottom" };
      await loadHistory();
      list.current?.scrollTo({
        top: list.current.scrollHeight,
        behavior: "smooth",
      });
    } catch (e) {
      catchError(e);
    } finally {
      setSending(false);
      composer.current?.focus();
    }
  }
  async function attach(file: File) {
    if (files.length >= 5)
      throw new Error("Attach up to five files per message.");
    if (file.size > 20 * 1024 * 1024)
      throw new Error("Files must be 20 MB or smaller.");
    setUploading(true);
    const selected = channelId;
    try {
      const data = new FormData();
      data.append("file", file);
      const result = await api<Attachment>(
        `/channels/${selected}/files`,
        "POST",
        data,
      );
      if (current.current.channelId === selected) {
        setFiles((old) => [...old, result]);
        clientId.current = null;
      }
    } finally {
      setUploading(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }
  async function joinMeeting(id: string) {
    setMeeting(await api<MeetingAccess>(`/meetings/${id}/token`, "POST", {}));
  }
  async function startMeeting() {
    if (!channel) return;
    const result = channel.meeting_id
      ? { id: channel.meeting_id }
      : await api<{ id: string }>(`/channels/${channelId}/meetings`, "POST", {
          title: channel.display_name + " · meeting",
        });
    await joinMeeting(result.id);
    await loadOrg(orgId);
  }
  function chooseChannel(id: string) {
    if (sending || uploading) return;
    setSearch("");
    setSearchOpen(false);
    setSavedOnly(false);
    setChannelId(id);
  }
  async function loggedIn(u: User) {
    setUser(u);
    setError("");
  }
  if (loading)
    return (
      <div className="loading-screen">
        <MessageCircle />
        <span>Bringing your people together…</span>
      </div>
    );
  if (!user || pendingToken)
    return (
      <Auth
        onLogin={loggedIn}
        registration={config.registration}
        invite={invite}
      />
    );
  if (invite)
    return (
      <div className="center-page">
        <div className="welcome-card">
          <MessageCircle size={36} />
          <h1>Your people are waiting.</h1>
          <p>
            Accept your invitation as <strong>{user.email}</strong>. This will
            add your account to the organization.
          </p>
          {error && <p className="form-error">{error}</p>}
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                const r = await api<{ orgId: string }>(
                  "/invitations/accept",
                  "POST",
                  { token: invite },
                );
                sessionStorage.removeItem("cf-invite");
                setInvite("");
                history.replaceState({}, "", "/");
                const me = await api<{ user: User }>("/me");
                setUser(me.user);
                await loadOrgs(r.orgId);
              })
            }
          >
            Accept invitation
          </button>
          <button
            className="text-button"
            onClick={() => {
              setInvite("");
              sessionStorage.removeItem("cf-invite");
              history.replaceState({}, "", "/");
            }}
          >
            Skip for now
          </button>
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                await api("/auth/logout", "POST", {});
                setUser(null);
              })
            }
          >
            Use a different account
          </button>
        </div>
      </div>
    );
  if (!user.verified_at)
    return (
      <div className="center-page">
        <div className="welcome-card">
          <Mail size={36} />
          <h1>Check your inbox.</h1>
          <p>
            We sent a verification link to <strong>{user.email}</strong>. Open
            it to start connecting.
          </p>
          {error && <p className="form-error">{error}</p>}
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                await api("/auth/resend", "POST", {});
                setNotice("Verification email queued.");
              })
            }
          >
            Resend verification
          </button>
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                setUser((await api<{ user: User }>("/me")).user);
              })
            }
          >
            I’ve verified my email
          </button>
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                await api("/auth/logout", "POST", {});
                setUser(null);
              })
            }
          >
            Sign out
          </button>
          {notice && <p>{notice}</p>}
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <nav className="org-rail" aria-label="Organizations">
        <a className="rail-brand" href="/" title="ChatFinity">
          <MessageCircle size={25} />
        </a>
        <div className="rail-divider" />
        {orgs.map((o) => (
          <button
            key={o.id}
            className={"org-icon" + (o.id === orgId ? " selected" : "")}
            title={o.name}
            aria-label={"Switch to " + o.name}
            disabled={sending || uploading}
            onClick={() => setOrgId(o.id)}
          >
            {initials(o.name)}
          </button>
        ))}
        <button
          className="org-icon add-org"
          title="Create organization"
          aria-label="Create organization"
          onClick={() => setModal("org")}
        >
          <Plus />
        </button>
        <div className="rail-spacer" />
        <IconButton
          label="Your preferences"
          onClick={() => setModal("preferences")}
        >
          <Settings size={20} />
        </IconButton>
        <button
          className="profile-icon"
          title={user.name}
          onClick={() => setModal("preferences")}
        >
          {initials(user.name)}
          <i className={user.status} />
        </button>
      </nav>
      <aside className={"workspace-sidebar" + (sidebar ? " mobile-open" : "")}>
        <header className="workspace-heading">
          <div>
            <small>YOUR ORGANIZATION</small>
            <button onClick={() => setModal("organization")}>
              {org?.name || "Your workspace"}
              <ChevronDown size={16} />
            </button>
          </div>
          <IconButton
            label="Close navigation"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </IconButton>
        </header>
        <div className="workspace-scroll">
          <div className="workspace-intro">
            <span className="workspace-live">
              <i /> {connected ? "Connected" : "Reconnecting…"}
            </span>
            <h2>A place to belong.</h2>
            <p>Make room for good conversations.</p>
          </div>
          <div className="nav-section-head">
            <span>CONVERSATIONS</span>
            <IconButton
              label="Create a channel"
              onClick={() => setModal("channel")}
            >
              <Plus size={17} />
            </IconButton>
          </div>
          <nav aria-label="Channels">
            {channels
              .filter((c) => c.kind !== "dm")
              .map((ch) => (
                <button
                  key={ch.id}
                  className={
                    "channel-link" +
                    (ch.id === channelId ? " selected" : "") +
                    (!ch.joined ? " discover" : "")
                  }
                  onClick={() => chooseChannel(ch.id)}
                >
                  {ch.kind === "private" ? (
                    <Lock size={16} />
                  ) : (
                    <Hash size={17} />
                  )}
                  <span>{ch.display_name}</span>
                  {ch.meeting_id && <Video size={14} />}
                  {ch.unread > 0 && ch.joined && (
                    <b>{ch.unread > 99 ? "99+" : ch.unread}</b>
                  )}
                </button>
              ))}
            {!channels.length && (
              <p className="sidebar-hint">
                Create an organization to get started.
              </p>
            )}
          </nav>
          <div className="nav-section-head direct-head">
            <span>DIRECT MESSAGES</span>
            <IconButton
              label="Start a direct message"
              onClick={() => setModal("dm")}
            >
              <Plus size={17} />
            </IconButton>
          </div>
          <nav aria-label="Direct messages">
            {channels
              .filter((c) => c.kind === "dm")
              .map((ch) => (
                <button
                  key={ch.id}
                  className={
                    "channel-link dm-link" +
                    (ch.id === channelId ? " selected" : "")
                  }
                  onClick={() => chooseChannel(ch.id)}
                >
                  <Avatar name={ch.display_name || "Member"} size="tiny" />
                  <span>{ch.display_name}</span>
                  {ch.unread > 0 && <b>{ch.unread}</b>}
                </button>
              ))}
            <button
              className="channel-link new-dm"
              onClick={() => setModal("dm")}
            >
              <Plus size={16} />
              <span>Start a conversation</span>
            </button>
          </nav>
          <div className="sidebar-note">
            <span>✦</span>
            <strong>Good things start with “hello.”</strong>
            <p>Invite your people and make this space yours.</p>
            <button onClick={() => setModal(isAdmin ? "organization" : "dm")}>
              {isAdmin ? "Invite your people" : "Find your people"}
              <Plus size={14} />
            </button>
          </div>
        </div>
        <footer className="workspace-footer">
          <Headphones size={17} />
          <span>Your space. Your pace.</span>
          <IconButton
            label="Organization members"
            onClick={() => setModal("members")}
          >
            <Users size={17} />
          </IconButton>
        </footer>
      </aside>
      <main className="conversation">
        <header className="conversation-heading">
          <IconButton label="Open navigation" onClick={() => setSidebar(true)}>
            <PanelLeft size={20} />
          </IconButton>
          {channel ? (
            <>
              <div className="conversation-title">
                <span className="title-icon">
                  {channel.kind === "dm" ? (
                    <MessageCircle size={23} />
                  ) : channel.kind === "private" ? (
                    <Lock size={22} />
                  ) : (
                    <Hash size={25} />
                  )}
                </span>
                <div>
                  <h1>{channel.display_name}</h1>
                  <p>{channel.topic || "A little closer, wherever you are."}</p>
                </div>
              </div>
              <div className="conversation-actions">
                <IconButton
                  label="Search conversation"
                  onClick={() => setSearchOpen(!searchOpen)}
                  active={searchOpen}
                >
                  <Search size={19} />
                </IconButton>
                <IconButton
                  label="Saved messages"
                  onClick={() => setSavedOnly(!savedOnly)}
                  active={savedOnly}
                >
                  <Bookmark size={19} />
                </IconButton>
                <IconButton
                  label="Conversation members"
                  onClick={() => setModal("conversation-members")}
                >
                  <Users size={19} />
                </IconButton>
                <button
                  className="meet-button"
                  disabled={!channel.joined || !config.meetings}
                  title={
                    config.meetings
                      ? "Start or join a meeting"
                      : "Your server administrator needs to configure meetings."
                  }
                  onClick={() => run(startMeeting)}
                >
                  <Video size={18} />
                  <span>{channel.meeting_id ? "Join meeting" : "Meet"}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="conversation-title">
              <h1>Welcome to ChatFinity</h1>
            </div>
          )}
        </header>
        {(searchOpen || savedOnly) && (
          <div className="conversation-filters">
            {searchOpen && (
              <label>
                <Search size={17} />
                <input
                  type="search"
                  autoFocus
                  placeholder="Find something in this conversation…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            )}
            {savedOnly && (
              <span className="filter-chip">
                <Bookmark size={14} /> Saved messages{" "}
                <button
                  aria-label="Show all messages"
                  onClick={() => setSavedOnly(false)}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        )}
        {channel?.meeting_id && (
          <div className="meeting-banner">
            <span>
              <i />
              <Video size={17} /> There’s a conversation happening face-to-face.
            </span>
            <button onClick={() => run(() => joinMeeting(channel.meeting_id!))}>
              Join in <ExternalLink size={14} />
            </button>
          </div>
        )}
        {!org ? (
          <div className="empty-workspace">
            <span className="empty-symbol">
              <MessageCircle size={40} />
            </span>
            <span className="eyebrow">YOUR PEOPLE. YOUR POSSIBILITY.</span>
            <h1>Start something together.</h1>
            <p>
              Create an organization for your team, business, friends or
              community. Invite a few people. See where the conversation goes.
            </p>
            <button className="primary" onClick={() => setModal("org")}>
              <Plus size={18} /> Create your first organization
            </button>
          </div>
        ) : !channel ? (
          <div className="empty-workspace">
            <Hash size={40} />
            <h1>Make room for a conversation.</h1>
            <p>
              Create a channel or start a direct message with someone in your
              organization.
            </p>
            <button className="primary" onClick={() => setModal("channel")}>
              Create a channel
            </button>
          </div>
        ) : !channel.joined ? (
          <div className="empty-workspace">
            <Globe size={38} />
            <h1>There’s a place for you here.</h1>
            <p>Join #{channel.display_name} to read messages and take part.</p>
            <button
              className="primary"
              onClick={() =>
                run(async () => {
                  await api(`/channels/${channelId}/join`, "POST", {});
                  await loadOrg(orgId);
                  await loadHistory(true);
                })
              }
            >
              Join channel
            </button>
          </div>
        ) : (
          <>
            <div
              className="message-list"
              ref={list}
              role="log"
              aria-label="Conversation messages"
              onScroll={() => {
                if (atBottom()) {
                  setJump(false);
                  void markRead();
                }
              }}
            >
              {more && (
                <button
                  className="load-older"
                  disabled={historyBusy}
                  onClick={() => void loadHistory(false, messages[0]?.id)}
                >
                  Load earlier messages
                </button>
              )}
              {!more && !search && !savedOnly && (
                <div className="channel-welcome">
                  <span className="channel-welcome-icon">
                    {channel.kind === "dm" ? (
                      <MessageCircle size={28} />
                    ) : (
                      <Hash size={30} />
                    )}
                  </span>
                  <div>
                    <span className="eyebrow">
                      THIS IS THE START OF SOMETHING
                    </span>
                    <h2>
                      {channel.kind === "dm"
                        ? "Say hello to " + channel.display_name
                        : "Welcome to " + channel.display_name + "."}
                    </h2>
                    <p>
                      {channel.kind === "dm"
                        ? "A conversation just for the two of you."
                        : "Ideas, updates, questions, and the occasional very good GIF. This is your space."}
                    </p>
                  </div>
                </div>
              )}
              {!messages.length && !historyBusy && (search || savedOnly) && (
                <div className="no-results">
                  <Search />
                  <h3>
                    {savedOnly
                      ? "Your keepers will live here."
                      : "Nothing here just yet."}
                  </h3>
                  <p>
                    {savedOnly
                      ? "Save a message to find it here later."
                      : "Try a different word or phrase."}
                  </p>
                </div>
              )}
              {messages.map((m, index) => (
                <div key={m.id}>
                  {(index === 0 ||
                    day(messages[index - 1].created_at) !==
                      day(m.created_at)) && (
                    <div className="day-divider">
                      <span>{day(m.created_at)}</span>
                    </div>
                  )}
                  <article
                    className={
                      "message" +
                      (m.sender_id === user.id ? " own" : "") +
                      (m.deleted_at ? " removed" : "")
                    }
                    data-message-id={m.id}
                  >
                    <Avatar name={m.sender_name} />
                    <div className="message-content">
                      <div className="message-byline">
                        <strong>{m.sender_name}</strong>
                        {m.sender_id === user.id && (
                          <span className="you-label">you</span>
                        )}
                        <time dateTime={m.created_at}>
                          {time(m.created_at)}
                        </time>
                        {m.edited_at && <small>edited</small>}
                      </div>
                      {m.reply_id && (
                        <blockquote>
                          <Reply size={14} />
                          <div>
                            <strong>{m.reply_name}</strong>
                            <span>{m.reply_body || "Attachment"}</span>
                          </div>
                        </blockquote>
                      )}
                      {m.deleted_at ? (
                        <p className="removed-message">
                          This message was removed.
                        </p>
                      ) : editing?.id === m.id ? (
                        <form
                          className="edit-message"
                          onSubmit={(e) => {
                            e.preventDefault();
                            run(async () => {
                              await api(`/messages/${m.id}`, "PATCH", {
                                body: editText,
                              });
                              setEditing(null);
                              await loadHistory();
                            });
                          }}
                        >
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            maxLength={10000}
                            required
                          />
                          <div>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </button>
                            <button className="primary" type="submit">
                              Save changes
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <p className="message-text">{m.body}</p>
                          {m.attachments.map((f) => (
                            <a
                              key={f.id}
                              className="attachment"
                              href={"/api/files/" + f.id}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span>
                                <Paperclip size={19} />
                              </span>
                              <div>
                                <strong>{f.name}</strong>
                                <small>
                                  {f.size > 1048576
                                    ? (f.size / 1048576).toFixed(1) + " MB"
                                    : Math.ceil(f.size / 1024) + " KB"}{" "}
                                  · Download attachment
                                </small>
                              </div>
                            </a>
                          ))}
                        </>
                      )}
                      {!m.deleted_at && (
                        <>
                          <div className="message-reactions">
                            {m.reactions.map((r) => (
                              <button
                                key={r.emoji}
                                className={r.mine ? "mine" : ""}
                                onClick={() =>
                                  run(async () => {
                                    await api(
                                      `/messages/${m.id}/react`,
                                      "POST",
                                      { emoji: r.emoji, active: !r.mine },
                                    );
                                    await loadHistory();
                                  })
                                }
                              >
                                {r.emoji}
                                <span>{r.count}</span>
                              </button>
                            ))}
                            {m.saved && (
                              <small>
                                <Bookmark size={12} /> Saved for you
                              </small>
                            )}
                            {m.sender_id === user.id &&
                              channel.kind === "dm" && (
                                <small className="receipt">
                                  {channelMembers.some(
                                    (p) =>
                                      p.id !== user.id &&
                                      p.read_at &&
                                      new Date(p.read_at) >=
                                        new Date(m.created_at),
                                  ) ? (
                                    <>
                                      <CheckCheck size={14} /> Read
                                    </>
                                  ) : (
                                    <>
                                      <Check size={14} /> Sent
                                    </>
                                  )}
                                </small>
                              )}
                          </div>
                          <div className="message-actions">
                            <IconButton
                              label="Reply to message"
                              onClick={() => {
                                setReply(m);
                                composer.current?.focus();
                              }}
                            >
                              <Reply size={16} />
                            </IconButton>
                            <IconButton
                              label="React to message"
                              onClick={() =>
                                setEmojiPicker(emojiPicker === m.id ? "" : m.id)
                              }
                            >
                              <Smile size={16} />
                            </IconButton>
                            <IconButton
                              label={
                                m.saved ? "Unsave message" : "Save message"
                              }
                              onClick={() =>
                                run(async () => {
                                  await api(`/messages/${m.id}/save`, "POST", {
                                    active: !m.saved,
                                  });
                                  await loadHistory();
                                })
                              }
                              active={m.saved}
                            >
                              <Bookmark size={16} />
                            </IconButton>
                            {m.sender_id === user.id && (
                              <IconButton
                                label="Edit message"
                                onClick={() => {
                                  setEditing(m);
                                  setEditText(m.body);
                                }}
                              >
                                <MoreHorizontal size={16} />
                              </IconButton>
                            )}
                            {(m.sender_id === user.id || isAdmin) && (
                              <IconButton
                                label="Remove message"
                                onClick={() => {
                                  setEditing(m);
                                  setModal("delete-message");
                                }}
                              >
                                <Trash2 size={15} />
                              </IconButton>
                            )}
                          </div>
                          {emojiPicker === m.id && (
                            <div className="reaction-picker">
                              {emojis.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() =>
                                    run(async () => {
                                      await api(
                                        `/messages/${m.id}/react`,
                                        "POST",
                                        {
                                          emoji,
                                          active: !m.reactions.some(
                                            (r) => r.emoji === emoji && r.mine,
                                          ),
                                        },
                                      );
                                      setEmojiPicker("");
                                      await loadHistory();
                                    })
                                  }
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                </div>
              ))}
              {historyBusy && !messages.length && (
                <div className="history-loading">
                  <LoaderCircle className="spin" /> Loading your conversations…
                </div>
              )}
            </div>
            <div className="composer-wrap">
              {jump && (
                <button
                  className="jump-button"
                  onClick={() => {
                    list.current?.scrollTo({
                      top: list.current.scrollHeight,
                      behavior: "smooth",
                    });
                    setJump(false);
                  }}
                >
                  <ArrowDown size={14} /> New messages
                </button>
              )}
              {typing && (
                <div className="typing-indicator">
                  <i />
                  <i />
                  <i /> {typing.name} is typing
                </div>
              )}
              {reply && (
                <div className="reply-preview">
                  <Reply size={16} />
                  <div>
                    <strong>Replying to {reply.sender_name}</strong>
                    <span>{reply.body || "Attachment"}</span>
                  </div>
                  <IconButton
                    label="Cancel reply"
                    onClick={() => setReply(null)}
                  >
                    <X size={16} />
                  </IconButton>
                </div>
              )}
              <form className="composer" onSubmit={send}>
                <textarea
                  ref={composer}
                  aria-label="Message"
                  placeholder={
                    "Message " +
                    (channel.kind === "dm"
                      ? channel.display_name
                      : "#" + channel.display_name) +
                    "…"
                  }
                  value={draft}
                  maxLength={10000}
                  rows={1}
                  disabled={sending}
                  onChange={(e) => updateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {files.length > 0 && (
                  <div className="pending-files">
                    {files.map((f) => (
                      <span key={f.id}>
                        <Paperclip size={13} />
                        {f.name}
                        <button
                          type="button"
                          aria-label={"Remove " + f.name}
                          onClick={() => {
                            setFiles((old) => old.filter((x) => x.id !== f.id));
                            clientId.current = null;
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="composer-toolbar">
                  <div>
                    <input
                      type="file"
                      ref={uploadInput}
                      hidden
                      accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv"
                      onChange={(e) => {
                        if (e.target.files?.[0])
                          run(() => attach(e.target.files![0]));
                      }}
                    />
                    <IconButton
                      label="Attach a file"
                      disabled={sending || uploading}
                      onClick={() => uploadInput.current?.click()}
                    >
                      {uploading ? (
                        <LoaderCircle className="spin" size={18} />
                      ) : (
                        <Paperclip size={18} />
                      )}
                    </IconButton>
                    <IconButton
                      label="Insert emoji"
                      onClick={() =>
                        setEmojiPicker(
                          emojiPicker === "compose" ? "" : "compose",
                        )
                      }
                      active={emojiPicker === "compose"}
                    >
                      <Smile size={18} />
                    </IconButton>
                    <span className="composer-hint">
                      A little hello goes a long way.
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="send-button"
                    aria-label="Send message"
                    disabled={
                      sending || uploading || (!draft.trim() && !files.length)
                    }
                  >
                    {sending ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>
                {emojiPicker === "compose" && (
                  <div className="compose-emojis">
                    {[
                      "👋",
                      "😀",
                      "👍",
                      "❤️",
                      "😂",
                      "🎉",
                      "✅",
                      "🙏",
                      "☕",
                      "💡",
                      "🚀",
                      "👀",
                    ].map((e) => (
                      <button
                        type="button"
                        key={e}
                        onClick={() => {
                          updateDraft(draft + e);
                          composer.current?.focus();
                        }}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </form>
              <div className="composer-footnote">
                <span>
                  <Shield size={11} /> Only people in this conversation can
                  access its messages.
                </span>
                <span>
                  <kbd>Enter</kbd> send · <kbd>Shift + Enter</kbd> new line
                </span>
              </div>
            </div>
          </>
        )}
      </main>
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {modal === "org" && (
        <Modal title="A home for your people" onClose={() => setModal("")}>
          <p>
            Create a separate organization for a team, community, or business.
            People can belong to more than one.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const r = await api<{ id: string }>("/orgs", "POST", {
                  name: f.get("name"),
                });
                await loadOrgs(r.id);
                setModal("");
              });
            }}
          >
            <label>
              Organization name
              <input
                name="name"
                autoFocus
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. InnaWare"
              />
            </label>
            <button className="primary">
              Create organization <Plus size={17} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "channel" && (
        <Modal
          title="Make room for a conversation"
          onClose={() => setModal("")}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const r = await api<{ id: string }>(
                  `/orgs/${orgId}/channels`,
                  "POST",
                  {
                    name: f.get("name"),
                    topic: f.get("topic"),
                    kind: f.get("kind"),
                    members: f.getAll("members"),
                  },
                );
                await loadOrg(orgId);
                chooseChannel(r.id);
                setModal("");
              });
            }}
          >
            <label>
              Channel name
              <input
                name="name"
                required
                maxLength={60}
                placeholder="e.g. product-ideas"
                autoFocus
              />
            </label>
            <label>
              What’s this space for?
              <input
                name="topic"
                maxLength={240}
                placeholder="A place to share what’s next."
              />
            </label>
            <label>
              Who can discover this channel?
              <select name="kind">
                <option value="public">Everyone in this organization</option>
                <option value="private">Private — invited members only</option>
              </select>
            </label>
            <fieldset className="member-checklist">
              <legend>Add people</legend>
              {members
                .filter((m) => m.id !== user.id)
                .map((m) => (
                  <label key={m.id}>
                    <input type="checkbox" name="members" value={m.id} />
                    <Avatar name={m.name} size="tiny" />
                    {m.name}
                  </label>
                ))}
            </fieldset>
            <button className="primary" disabled={!orgId}>
              Create channel
            </button>
          </form>
        </Modal>
      )}
      {modal === "dm" && (
        <Modal title="Start with a hello" onClose={() => setModal("")}>
          <p>Choose someone from {org?.name || "your organization"}.</p>
          <div className="member-list">
            {members
              .filter((m) => m.id !== user.id)
              .map((m) => (
                <button
                  key={m.id}
                  onClick={() =>
                    run(async () => {
                      const r = await api<{ id: string }>(
                        `/orgs/${orgId}/dm`,
                        "POST",
                        { userId: m.id },
                      );
                      await loadOrg(orgId);
                      chooseChannel(r.id);
                      setModal("");
                    })
                  }
                >
                  <Avatar name={m.name} online={m.online} />
                  <span>
                    <strong>{m.name}</strong>
                    <small>{m.online ? m.status : "Offline"}</small>
                  </span>
                  <MessageCircle size={18} />
                </button>
              ))}
            {members.length < 2 && (
              <p>
                Invite someone to your organization to start a conversation.
              </p>
            )}
          </div>
        </Modal>
      )}
      {modal === "preferences" && (
        <Modal title="Make yourself at home" onClose={() => setModal("")}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const r = await api<{ user: User }>("/me", "PATCH", {
                  name: f.get("name"),
                  status: f.get("status"),
                });
                setUser(r.user);
                setNotice("Preferences saved.");
                setModal("");
              });
            }}
          >
            <label>
              Your name
              <input
                name="name"
                defaultValue={user.name}
                required
                maxLength={100}
              />
            </label>
            <label>
              Your status
              <select name="status" defaultValue={user.status}>
                <option value="online">Available</option>
                <option value="away">Away</option>
                <option value="busy">Do Not Disturb</option>
                <option value="invisible">Appear offline</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  setSound(e.target.checked);
                  localStorage.setItem("cf-sound", String(e.target.checked));
                }}
              />
              <Volume2 size={17} /> Play a sound for new messages
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                run(async () => {
                  if (!("Notification" in window))
                    throw new Error(
                      "Notifications are not supported in this browser.",
                    );
                  const allowed = desktop
                    ? false
                    : (await Notification.requestPermission()) === "granted";
                  setDesktop(allowed);
                  localStorage.setItem("cf-desktop", String(allowed));
                  setNotice(
                    allowed
                      ? "Desktop notifications enabled."
                      : "Desktop notifications disabled.",
                  );
                })
              }
            >
              {desktop ? "Disable" : "Enable"} desktop notifications
            </button>
            <p className="muted">
              Do Not Disturb silences alerts. Notification preferences and
              drafts are saved in this browser.
            </p>
            <button className="primary">Save preferences</button>
          </form>
          <div className="modal-divider" />
          <button
            className="text-button danger-text"
            onClick={() =>
              run(async () => {
                await api("/auth/logout", "POST", {});
                setUser(null);
                setModal("");
                setOrgId("");
                setMessages([]);
              })
            }
          >
            <LogOut size={16} /> Sign out
          </button>
        </Modal>
      )}
      {["organization", "members"].includes(modal) && org && (
        <OrganizationManager
          org={org}
          user={user}
          members={members}
          onClose={() => setModal("")}
          refresh={() => loadOrg(orgId)}
          onError={catchError}
          onNotice={setNotice}
        />
      )}
      {modal === "conversation-members" && channel && (
        <Modal title="People in this conversation" onClose={() => setModal("")}>
          <div className="member-list">
            {channelMembers.map((m) => (
              <div className="member-row" key={m.id}>
                <Avatar name={m.name} />
                <strong>{m.name}</strong>
                {m.id === user.id && <small>you</small>}
              </div>
            ))}
          </div>
          {channel.kind !== "dm" &&
            (channel.created_by === user.id || isAdmin) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const id = new FormData(e.currentTarget).get("userId");
                  run(async () => {
                    await api(`/channels/${channelId}/members`, "POST", {
                      userId: id,
                    });
                    await loadHistory();
                    setNotice("Member added.");
                  });
                }}
              >
                <label>
                  Add someone
                  <select name="userId" required defaultValue="">
                    <option value="" disabled>
                      Choose a member
                    </option>
                    {members
                      .filter((m) => !channelMembers.some((p) => p.id === m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="primary">Add to conversation</button>
              </form>
            )}
        </Modal>
      )}
      {modal === "delete-message" && editing && (
        <Modal
          title="Remove this message?"
          onClose={() => {
            setModal("");
            setEditing(null);
          }}
        >
          <p>
            The message and its attachments will no longer be available to
            conversation members.
          </p>
          <p className="delete-preview">{editing.body}</p>
          <button
            className="danger"
            onClick={() =>
              run(async () => {
                await api(`/messages/${editing.id}`, "DELETE");
                setModal("");
                setEditing(null);
                await loadHistory();
              })
            }
          >
            Remove message
          </button>
        </Modal>
      )}
      {meeting && (
        <Suspense
          fallback={
            <div className="meeting-loading">Opening your meeting…</div>
          }
        >
          <MeetingRoom
            access={meeting}
            onJoin={() =>
              api<MeetingAccess>(
                `/meetings/${meeting.meeting.id}/token`,
                "POST",
                {},
              )
            }
            isHost={meeting.meeting.host_id === user.id || !!isAdmin}
            onClose={() => setMeeting(null)}
            onEnd={async () => {
              await api(`/meetings/${meeting.meeting.id}/end`, "POST", {});
              setMeeting(null);
              await loadOrg(orgId);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
function OrganizationManager({
  org,
  user,
  members,
  onClose,
  refresh,
  onError,
  onNotice,
}: {
  org: Org;
  user: User;
  members: Member[];
  onClose: () => void;
  refresh: () => Promise<void>;
  onError: (e: unknown) => void;
  onNotice: (s: string) => void;
}) {
  const [invitations, setInvitations] = useState<
      {
        id: string;
        email: string;
        role: string;
        accepted_at: string | null;
        revoked_at: string | null;
        expires_at: string;
      }[]
    >([]),
    [tab, setTab] = useState("people"),
    [audit, setAudit] = useState<
      { id: string; action: string; actor_name: string; created_at: string }[]
    >([]),
    [remove, setRemove] = useState<Member | null>(null),
    [busy, setBusy] = useState(false);
  const admin = ["owner", "admin"].includes(org.role);
  const reload = async () => {
    if (admin) {
      setInvitations(
        (
          await api<{ invitations: typeof invitations }>(
            `/orgs/${org.id}/invitations`,
          )
        ).invitations,
      );
    }
  };
  useEffect(() => {
    void reload().catch(onError);
  }, [org.id]);
  const execute = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={org.name} onClose={onClose}>
      <div className="modal-tabs">
        <button
          className={tab === "people" ? "active" : ""}
          onClick={() => setTab("people")}
        >
          People <span>{members.length}</span>
        </button>
        {admin && (
          <>
            <button
              className={tab === "invite" ? "active" : ""}
              onClick={() => setTab("invite")}
            >
              Invitations
            </button>
            <button
              className={tab === "audit" ? "active" : ""}
              onClick={() => {
                setTab("audit");
                void api<{ events: typeof audit }>(`/orgs/${org.id}/audit`)
                  .then((r) => setAudit(r.events))
                  .catch(onError);
              }}
            >
              Activity
            </button>
          </>
        )}
      </div>
      {tab === "people" && (
        <>
          <p>
            People can belong to multiple organizations. Roles apply only within
            this one.
          </p>
          <div className="member-list">
            {members.map((m) => (
              <div className="member-row" key={m.id}>
                <Avatar name={m.name} online={m.online} />
                <span>
                  <strong>
                    {m.name}
                    {m.id === user.id ? " (you)" : ""}
                  </strong>
                  <small>{m.email}</small>
                </span>
                {org.role === "owner" ? (
                  <select
                    aria-label={"Role for " + m.name}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) =>
                      void execute(async () => {
                        await api(`/orgs/${org.id}/members/${m.id}`, "PATCH", {
                          role: e.target.value,
                        });
                        onNotice("Organization role updated.");
                      })
                    }
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                ) : (
                  <small className="role-label">{m.role}</small>
                )}
                {admin &&
                  m.id !== user.id &&
                  (org.role === "owner" || m.role === "member") && (
                    <IconButton
                      label={"Remove " + m.name}
                      onClick={() => setRemove(m)}
                    >
                      <X size={16} />
                    </IconButton>
                  )}
              </div>
            ))}
          </div>
          {remove && (
            <div className="remove-confirm">
              <p>
                Remove <strong>{remove.name}</strong> from this organization?
                They will lose access to its conversations.
              </p>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void execute(async () => {
                    await api(`/orgs/${org.id}/members/${remove.id}`, "DELETE");
                    setRemove(null);
                    onNotice("Member removed.");
                  })
                }
              >
                Remove member
              </button>
              <button className="text-button" onClick={() => setRemove(null)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {tab === "invite" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void execute(async () => {
                await api(`/orgs/${org.id}/invitations`, "POST", {
                  email: f.get("email"),
                  role: f.get("role"),
                });
                form.reset();
                onNotice("Invitation queued for email delivery.");
              });
            }}
          >
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                placeholder="someone@company.com"
              />
            </label>
            <label>
              Organization role
              <select name="role">
                <option value="member">Member</option>
                {org.role === "owner" && <option value="admin">Admin</option>}
              </select>
            </label>
            <button className="primary" disabled={busy}>
              <Mail size={16} /> Send invitation
            </button>
          </form>
          <div className="modal-divider" />
          {invitations.map((i) => (
            <div className="invitation-row" key={i.id}>
              <span>
                <strong>{i.email}</strong>
                <small>
                  {i.role} ·{" "}
                  {i.accepted_at
                    ? "Accepted"
                    : i.revoked_at
                      ? "Revoked"
                      : new Date(i.expires_at) < new Date()
                        ? "Expired"
                        : "Pending"}
                </small>
              </span>
              {!i.accepted_at && !i.revoked_at && (
                <button
                  className="text-button"
                  onClick={() =>
                    void execute(() =>
                      api(`/orgs/${org.id}/invitations/${i.id}`, "DELETE"),
                    )
                  }
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {tab === "audit" && (
        <div className="audit-list">
          {audit.map((e) => (
            <div key={e.id}>
              <Shield size={16} />
              <span>
                <strong>{e.action.replaceAll(".", " · ")}</strong>
                <small>
                  {e.actor_name} · {day(e.created_at)} {time(e.created_at)}
                </small>
              </span>
            </div>
          ))}
          {!audit.length && <p>Organization activity will appear here.</p>}
        </div>
      )}
    </Modal>
  );
}
