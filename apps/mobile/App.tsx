import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  AppState,
  Share,
  Alert,
  Switch,
  BackHandler,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import {
  api,
  restoreSession,
  clearSession,
  onSessionExpired,
  signOut,
  connectEvents,
} from "./src/api";
import { Auth, Field } from "./src/Auth";
import { useTheme, initials } from "./src/theme";
import { Chat, type Draft } from "./src/Chat";
import { MeetingScreen } from "./src/Meeting";
import { PasswordChange, Settings } from "./src/Settings";
import type { User, Org, Channel, Member } from "./src/types";
export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}
function Root() {
  const { c, s, dark } = useTheme(),
    [loading, setLoading] = useState(true),
    [user, setUser] = useState<User | null>(null),
    [error, setError] = useState("");
  async function restore() {
    setLoading(true);
    setError("");
    try {
      if (await restoreSession())
        setUser((await api<{ user: User }>("/me")).user);
    } catch (e) {
      console.warn("Session restore failed", e);
      setError(
        "We couldn’t open your saved sign-in. Check your connection and try again, or return to sign in.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    onSessionExpired(() => setUser(null));
    void restore();
    return () => onSessionExpired(() => {});
  }, []);
  return (
    <SafeAreaView edges={["top", "bottom", "left", "right"]} style={s.screen}>
      <StatusBar style={dark ? "light" : "dark"} />
      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <Ionicons name="chatbubbles" size={42} color={c.accent} />
          <ActivityIndicator color={c.accent} />
          <Text style={s.small}>Finding your people…</Text>
        </View>
      ) : error && !user ? (
        <View style={[s.content, { flex: 1, justifyContent: "center" }]}>
          <Text style={s.title}>Let’s reconnect.</Text>
          <Text style={s.error}>{error}</Text>
          <Pressable style={s.button} onPress={() => void restore()}>
            <Text style={s.buttonText}>Try again</Text>
          </Pressable>
          <Pressable
            style={s.secondary}
            onPress={async () => {
              await clearSession();
              setError("");
              setUser(null);
            }}
          >
            <Text style={s.text}>Back to sign in</Text>
          </Pressable>
        </View>
      ) : user?.must_change_password ? (
        <PasswordChange
          required
          onChanged={async () =>
            setUser((await api<{ user: User }>("/me")).user)
          }
        />
      ) : !user ? (
        <Auth onLogin={setUser} />
      ) : !user.verified_at ? (
        <View style={[s.content, { flex: 1, justifyContent: "center" }]}>
          <Ionicons name="mail-outline" size={40} color={c.accent} />
          <Text style={s.title}>Check your inbox.</Text>
          <Text style={s.subtitle}>
            Open the verification link sent to {user.email}, then refresh here.
          </Text>
          <Pressable
            style={s.button}
            onPress={async () => {
              try {
                setUser((await api<{ user: User }>("/me")).user);
              } catch (e) {
                Alert.alert("Could not refresh", (e as Error).message);
              }
            }}
          >
            <Text style={s.buttonText}>I’ve verified my email</Text>
          </Pressable>
          <Pressable
            style={s.secondary}
            onPress={async () => {
              try {
                await api("/auth/resend", "POST", {});
                Alert.alert("Check your inbox", "Verification email queued.");
              } catch (e) {
                Alert.alert("Could not resend", (e as Error).message);
              }
            }}
          >
            <Text style={s.text}>Resend verification</Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              await signOut();
              setUser(null);
            }}
          >
            <Text style={{ color: c.accent, textAlign: "center" }}>
              Sign out
            </Text>
          </Pressable>
        </View>
      ) : (
        <Workspace
          key={user.id}
          user={user}
          onUser={(next) =>
            setUser((current) => (current?.id === next.id ? next : current))
          }
          onSignOut={async () => {
            try {
              await signOut();
            } finally {
              setUser(null);
            }
          }}
        />
      )}
    </SafeAreaView>
  );
}
function Workspace({
  user,
  onUser,
  onSignOut,
}: {
  user: User;
  onUser: (u: User) => void;
  onSignOut: () => Promise<void>;
}) {
  const { c, s } = useTheme(),
    [orgs, setOrgs] = useState<Org[]>([]),
    [orgId, setOrgId] = useState(""),
    [channels, setChannels] = useState<Channel[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [channelId, setChannelId] = useState(""),
    [tab, setTab] = useState("messages"),
    [modal, setModal] = useState(""),
    [filter, setFilter] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [typing, setTyping] = useState(""),
    [meeting, setMeeting] = useState(""),
    [sound, setSound] = useState(true),
    [pending, setPending] = useState<
      { id: string; organization_name: string; status: string }[]
    >([]);
  const drafts = useRef(new Map<string, Draft>()),
    socket = useRef<WebSocket | null>(null),
    state = useRef({ orgId, channelId, user, meeting, sound }),
    typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    lastTyping = useRef(0),
    soundPlayer = useAudioPlayer(require("./assets/message.wav"));
  state.current = { orgId, channelId, user, meeting, sound };
  const org = orgs.find((o) => o.id === orgId),
    channel = channels.find((v) => v.id === channelId);
  const handler = useRef<(e: any) => void>(() => {});
  async function loadOrgs() {
    const r = await api<{ organizations: Org[] }>("/orgs");
    setOrgs(r.organizations);
    setOrgId((old) =>
      r.organizations.some((o) => o.id === old)
        ? old
        : r.organizations[0]?.id || "",
    );
    if (!r.organizations.length)
      setPending(
        (await api<{ requests: typeof pending }>("/me/join-requests")).requests,
      );
  }
  async function loadOrg(id: string, signal?: AbortSignal) {
    if (!id) return;
    const [ch, people] = await Promise.all([
      api<{ channels: Channel[] }>(
        `/orgs/${id}/channels`,
        "GET",
        undefined,
        signal,
      ),
      api<{ members: Member[] }>(
        `/orgs/${id}/members`,
        "GET",
        undefined,
        signal,
      ),
    ]);
    if (state.current.orgId !== id || signal?.aborted) return;
    setChannels(ch.channels);
    setMembers(people.members);
    setChannelId((old) =>
      old && ch.channels.some((v) => v.id === old) ? old : "",
    );
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void perform(loadOrgs).finally(() => setLoading(false));
    void SecureStore.getItemAsync("chatfinity.sound").then((v) =>
      setSound(v !== "off"),
    );
    return () => {
      clearTimeout(typingTimer.current);
    };
  }, []);
  useEffect(() => {
    setChannelId("");
    setChannels([]);
    setMembers([]);
    setFilter("");
    if (!orgId) return;
    const cancel = new AbortController();
    void loadOrg(orgId, cancel.signal).catch((e) => {
      if (!cancel.signal.aborted) setError(e.message);
    });
    return () => cancel.abort();
  }, [orgId]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (meeting) {
        setMeeting("");
        return true;
      }
      if (channelId) {
        setChannelId("");
        return true;
      }
      if (tab !== "messages") {
        setTab("messages");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [meeting, channelId, tab]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(t);
  }, [notice]);
  handler.current = (e) => {
    const now = state.current;
    if (e.type === "typing") {
      if (e.channelId === now.channelId && e.userId !== now.user.id) {
        setTyping(e.name);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(""), 5000);
      }
      return;
    }
    if (e.type === "connected" || e.type === "organization.updated") {
      void loadOrgs().catch((e) => setError(e.message));
    }
    if (e.orgId === now.orgId || e.type === "connected") {
      void loadOrg(now.orgId).catch((e) => setError(e.message));
      if (e.channelId === now.channelId || e.type === "connected") {
        if (e.type !== "conversation.read") setVersion((v) => v + 1);
      }
    }
    if (e.type === "meeting.ended" && e.meetingId === now.meeting) {
      setMeeting("");
      setNotice("The meeting has ended.");
    }
    if (
      e.type === "message.created" &&
      e.senderId !== now.user.id &&
      e.channelId !== now.channelId
    ) {
      setNotice(
        "New message in " +
          (orgs.find((o) => o.id === e.orgId)?.name || "your organization"),
      );
      if (now.user.status !== "busy" && now.sound && !now.meeting) {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
        void soundPlayer
          .seekTo(0)
          .then(() => soundPlayer.play())
          .catch(() => {});
      }
    }
  };
  useEffect(() => {
    let stopped = false,
      retry: ReturnType<typeof setTimeout> | undefined,
      attempt = 0;
    function start() {
      if (stopped || AppState.currentState !== "active") return;
      try {
        const ws = connectEvents();
        socket.current = ws;
        ws.onopen = () => {
          attempt = 0;
          setConnected(true);
        };
        ws.onmessage = (e) => {
          try {
            handler.current(JSON.parse(String(e.data)));
          } catch {}
        };
        ws.onerror = () => {
          setConnected(false);
        };
        ws.onclose = () => {
          setConnected(false);
          if (!stopped && AppState.currentState === "active") {
            retry = setTimeout(
              () => {
                void api("/me")
                  .then(() => start())
                  .catch(() => {
                    if (!stopped) retry = setTimeout(start, 15000);
                  });
              },
              Math.min(15000, 1000 * 2 ** attempt++),
            );
          }
        };
      } catch (e) {
        setError((e as Error).message);
      }
    }
    start();
    const lifecycle = AppState.addEventListener("change", (next) => {
      clearTimeout(retry);
      if (next === "active") {
        void api<{ user: User }>("/me")
          .then((r) => {
            onUser(r.user);
            if (!socket.current || socket.current.readyState >= 2) start();
          })
          .catch((e) => setError(e.message));
      } else {
        socket.current?.close();
        setConnected(false);
      }
    });
    const pulse = setInterval(() => {
      if (socket.current?.readyState === 1)
        socket.current.send(
          JSON.stringify({
            type: "activity",
            active: AppState.currentState === "active",
          }),
        );
      if (AppState.currentState === "active" && state.current.orgId)
        void loadOrg(state.current.orgId).catch(() => {});
    }, 30000);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(pulse);
      lifecycle.remove();
      socket.current?.close();
      socket.current = null;
    };
  }, []);
  async function openDM(member: Member) {
    await perform(async () => {
      const r = await api<{ id: string }>(`/orgs/${orgId}/dm`, "POST", {
        userId: member.id,
      });
      await loadOrg(orgId);
      setChannelId(r.id);
      setTab("messages");
    });
  }
  async function startMeeting() {
    if (!channel) return;
    await perform(async () => {
      const id =
        channel.meeting_id ||
        (
          await api<{ id: string }>(
            `/channels/${channel.id}/meetings`,
            "POST",
            { title: channel.display_name + " · Meet" },
          )
        ).id;
      setMeeting(id);
    });
  }
  function chooseOrg(id: string) {
    setChannelId("");
    setChannels([]);
    setMembers([]);
    setOrgId(id);
    setModal("");
    setTab("messages");
  }
  return (
    <View style={s.screen}>
      {channel && tab === "messages" ? (
        <Chat
          key={channel.id}
          channel={channel}
          user={user}
          drafts={drafts.current}
          version={version}
          typing={typing}
          onBack={() => {
            setChannelId("");
            setTyping("");
          }}
          onMeeting={() => void startMeeting()}
          onChannelChanged={() => loadOrg(orgId)}
          onTyping={() => {
            if (
              Date.now() - lastTyping.current > 2300 &&
              socket.current?.readyState === 1
            ) {
              lastTyping.current = Date.now();
              socket.current.send(
                JSON.stringify({ type: "typing", channelId }),
              );
            }
          }}
        />
      ) : (
        <>
          <View style={s.header}>
            <Pressable
              accessibilityLabel="Switch organization"
              style={[s.row, { flex: 1 }]}
              onPress={() => setModal("organizations")}
            >
              <View style={s.avatar}>
                <Text
                  style={{ fontWeight: "800", color: c.accent, fontSize: 17 }}
                >
                  {org ? initials(org.name) : "CF"}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[s.text, { fontWeight: "800" }]}>
                  {org?.name || "Your organizations"}
                </Text>
                <Text style={[s.small, { fontSize: 10 }]}>
                  {connected ? "● Connected" : "○ Reconnecting…"}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={17} color={c.muted} />
            </Pressable>
            <Pressable
              accessibilityLabel="Workspace actions"
              style={s.icon}
              onPress={() => setModal("actions")}
            >
              <Ionicons name="add" size={26} color={c.accent} />
            </Pressable>
          </View>
          {tab === "settings" ? (
            <Settings
              user={user}
              sound={sound}
              onSound={(value) => {
                setSound(value);
                void SecureStore.setItemAsync(
                  "chatfinity.sound",
                  value ? "on" : "off",
                );
              }}
              onUser={onUser}
              onSignOut={onSignOut}
            />
          ) : loading ? (
            <ActivityIndicator color={c.accent} style={{ flex: 1 }} />
          ) : !org ? (
            <ScrollView
              contentContainerStyle={[
                s.content,
                { flexGrow: 1, justifyContent: "center" },
              ]}
            >
              <Ionicons name="people-outline" size={45} color={c.accent} />
              <Text style={s.title}>Find your people.</Text>
              <Text style={s.subtitle}>
                Join an organization with its ID or create a space for your own
                team.
              </Text>
              {pending.map((p) => (
                <View key={p.id} style={s.card}>
                  <Text style={s.text}>{p.organization_name}</Text>
                  <Text style={s.small}>
                    {p.status === "pending"
                      ? "Waiting for administrator approval"
                      : p.status}
                  </Text>
                </View>
              ))}
              <Pressable style={s.button} onPress={() => setModal("join-org")}>
                <Text style={s.buttonText}>Join an organization</Text>
              </Pressable>
              {(user.can_create_org || user.is_system_admin) && (
                <Pressable
                  style={s.secondary}
                  onPress={() => setModal("create-org")}
                >
                  <Text style={s.text}>Create an organization</Text>
                </Pressable>
              )}
              <Pressable
                style={s.secondary}
                onPress={() => void perform(loadOrgs)}
              >
                <Text style={s.text}>Refresh access</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView
              contentContainerStyle={s.content}
              refreshControl={undefined}
            >
              <View>
                <Text style={s.title}>
                  {tab === "people"
                    ? "Your people."
                    : "Good conversations\nstart here."}
                </Text>
                <Text style={[s.subtitle, { marginTop: 8 }]}>
                  {tab === "people"
                    ? "One organization. Plenty of connection."
                    : "A place for the little updates and the big ideas."}
                </Text>
              </View>
              <TextInput
                accessibilityLabel={
                  tab === "people" ? "Find a person" : "Find a conversation"
                }
                placeholder={
                  tab === "people" ? "Find a person…" : "Find a conversation…"
                }
                placeholderTextColor={c.muted}
                value={filter}
                onChangeText={setFilter}
                style={s.input}
              />
              {tab === "messages"
                ? channels
                    .filter((ch) =>
                      ch.display_name
                        .toLowerCase()
                        .includes(filter.toLowerCase()),
                    )
                    .map((ch) => (
                      <Pressable
                        key={ch.id}
                        accessibilityLabel={
                          "Open conversation " + ch.display_name
                        }
                        onPress={() => {
                          setChannelId(ch.id);
                          setTyping("");
                        }}
                        style={[
                          s.row,
                          {
                            paddingVertical: 14,
                            borderBottomWidth: 1,
                            borderColor: c.line,
                          },
                        ]}
                      >
                        <View
                          style={[
                            s.avatar,
                            {
                              backgroundColor: ch.meeting_id ? c.soft : c.card,
                            },
                          ]}
                        >
                          <Ionicons
                            name={
                              ch.kind === "dm"
                                ? "chatbubble-outline"
                                : ch.kind === "private"
                                  ? "lock-closed-outline"
                                  : "grid-outline"
                            }
                            size={21}
                            color={c.accent}
                          />
                        </View>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text
                            style={[
                              s.text,
                              { fontWeight: ch.unread ? "800" : "600" },
                            ]}
                          >
                            {ch.display_name}
                          </Text>
                          <Text numberOfLines={1} style={s.small}>
                            {ch.meeting_id
                              ? "● A meeting is happening"
                              : ch.joined
                                ? ch.last_message ||
                                  ch.topic ||
                                  "Start with a hello."
                                : "Public channel · Tap to join"}
                          </Text>
                        </View>
                        {ch.unread > 0 && (
                          <View style={s.pill}>
                            <Text
                              style={{
                                color: c.accent,
                                fontSize: 12,
                                fontWeight: "800",
                              }}
                            >
                              {ch.unread > 99 ? "99+" : ch.unread}
                            </Text>
                          </View>
                        )}
                        <Ionicons
                          name="chevron-forward"
                          size={15}
                          color={c.muted}
                        />
                      </Pressable>
                    ))
                : members
                    .filter(
                      (m) =>
                        m.id !== user.id &&
                        (m.name + " " + m.email)
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                    )
                    .map((m) => (
                      <Pressable
                        key={m.id}
                        style={[
                          s.row,
                          {
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderColor: c.line,
                          },
                        ]}
                        disabled={busy}
                        onPress={() => void openDM(m)}
                      >
                        <View style={s.avatar}>
                          <Text style={{ fontWeight: "800", color: c.accent }}>
                            {initials(m.name)}
                          </Text>
                          <View
                            style={{
                              position: "absolute",
                              right: 0,
                              bottom: 0,
                              width: 11,
                              height: 11,
                              borderRadius: 6,
                              borderWidth: 2,
                              borderColor: c.card,
                              backgroundColor: m.online ? "#40B88D" : "#A5B6BA",
                            }}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.text, { fontWeight: "700" }]}>
                            {m.name}
                          </Text>
                          <Text style={s.small}>
                            {m.online
                              ? m.status === "busy"
                                ? "Do not disturb"
                                : m.status === "away"
                                  ? "Away"
                                  : "Online"
                              : "Offline"}
                          </Text>
                        </View>
                        <Ionicons
                          name="chatbubble-ellipses-outline"
                          size={21}
                          color={c.accent}
                        />
                      </Pressable>
                    ))}
              {tab === "people" && members.length < 2 && (
                <View style={s.card}>
                  <Text style={s.subtitle}>
                    Invite someone from the web app, or share your Organization
                    ID so they can request access.
                  </Text>
                  <Pressable
                    style={s.secondary}
                    onPress={() =>
                      void Share.share({
                        message: `Join ${org.name} on ChatFinity. Organization ID: ${org.join_code || org.id}\nhttps://chat.innaware.net`,
                      })
                    }
                  >
                    <Text style={s.text}>Share Organization ID</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          )}
          <View
            style={[
              s.row,
              {
                justifyContent: "space-around",
                borderTopWidth: 1,
                borderColor: c.line,
                paddingVertical: 8,
                backgroundColor: c.card,
                gap: 0,
              },
            ]}
          >
            {[
              ["messages", "chatbubbles-outline", "Chats"],
              ["people", "people-outline", "People"],
              ["settings", "person-circle-outline", "You"],
            ].map(([key, icon, label]) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === key }}
                key={key}
                style={{
                  alignItems: "center",
                  gap: 4,
                  padding: 7,
                  minWidth: 70,
                }}
                onPress={() => {
                  setTab(key);
                  setFilter("");
                }}
              >
                <Ionicons
                  name={icon as any}
                  size={23}
                  color={tab === key ? c.accent : c.muted}
                />
                <Text
                  style={{
                    color: tab === key ? c.accent : c.muted,
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {!!notice && (
        <Pressable
          style={{
            position: "absolute",
            top: 8,
            left: 16,
            right: 16,
            backgroundColor: c.accent,
            padding: 14,
            borderRadius: 13,
            elevation: 4,
          }}
          onPress={() => setNotice("")}
        >
          <Text style={{ color: c.onAccent, fontSize: 13, fontWeight: "600" }}>
            {notice}
          </Text>
        </Pressable>
      )}
      {!!error && (
        <Pressable
          style={{ position: "absolute", bottom: 75, left: 14, right: 14 }}
          onPress={() => setError("")}
        >
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        </Pressable>
      )}
      <Modal
        visible={!!meeting}
        animationType="slide"
        onRequestClose={() => setMeeting("")}
      >
        <SafeAreaView style={s.screen}>
          <MeetingScreen
            key={meeting || "closed"}
            id={meeting}
            user={user}
            admin={!!org && ["owner", "admin"].includes(org.role)}
            onLeave={() => setMeeting("")}
          />
        </SafeAreaView>
      </Modal>
      <Modal
        visible={!!modal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModal("")}
      >
        <SafeAreaView style={s.screen}>
          <View style={s.header}>
            <Text style={[s.text, { fontWeight: "800", flex: 1 }]}>
              {modal === "organizations"
                ? "Your organizations"
                : modal === "actions"
                  ? "Bring people together"
                  : modal === "broadcast"
                    ? "Organization broadcast"
                    : modal === "channel"
                      ? "Create a conversation"
                      : modal === "join-org"
                        ? "Join an organization"
                        : "Create an organization"}
            </Text>
            <Pressable
              accessibilityLabel="Close dialog"
              style={s.icon}
              onPress={() => setModal("")}
            >
              <Ionicons name="close" size={23} color={c.ink} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            {modal === "organizations" && (
              <>
                {orgs.map((o) => (
                  <Pressable
                    key={o.id}
                    style={[s.card, s.row]}
                    onPress={() => chooseOrg(o.id)}
                  >
                    <View style={s.avatar}>
                      <Text style={{ color: c.accent, fontWeight: "800" }}>
                        {initials(o.name)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.text, { fontWeight: "700" }]}>
                        {o.name}
                      </Text>
                      <Text style={s.small}>{o.role}</Text>
                    </View>
                    {o.id === orgId && (
                      <Ionicons
                        name="checkmark-circle"
                        size={24}
                        color={c.accent}
                      />
                    )}
                  </Pressable>
                ))}
                <Pressable
                  style={s.secondary}
                  onPress={() => setModal("join-org")}
                >
                  <Text style={s.text}>Join another organization</Text>
                </Pressable>
                {(user.can_create_org || user.is_system_admin) && (
                  <Pressable
                    style={s.secondary}
                    onPress={() => setModal("create-org")}
                  >
                    <Text style={s.text}>Create an organization</Text>
                  </Pressable>
                )}
              </>
            )}
            {modal === "actions" && (
              <>
                {org && (
                  <>
                    <Pressable
                      style={s.card}
                      onPress={() => setModal("channel")}
                    >
                      <Ionicons
                        name="chatbubbles-outline"
                        size={27}
                        color={c.accent}
                      />
                      <Text style={s.text}>
                        Create a channel or private group
                      </Text>
                    </Pressable>
                    <Pressable
                      style={s.card}
                      onPress={() => setModal("broadcast")}
                    >
                      <Ionicons
                        name="megaphone-outline"
                        size={27}
                        color={c.accent}
                      />
                      <Text style={s.text}>
                        Broadcast to your organizations
                      </Text>
                    </Pressable>
                    <Pressable
                      style={s.card}
                      onPress={() =>
                        void Share.share({
                          message: `Join ${org.name} on ChatFinity. Organization ID: ${org.join_code || org.id}\nhttps://chat.innaware.net`,
                        })
                      }
                    >
                      <Ionicons
                        name="share-outline"
                        size={27}
                        color={c.accent}
                      />
                      <Text style={s.text}>Share Organization ID</Text>
                    </Pressable>
                  </>
                )}
                <Pressable
                  style={s.secondary}
                  onPress={() => setModal("join-org")}
                >
                  <Text style={s.text}>Join an organization</Text>
                </Pressable>
                {(user.can_create_org || user.is_system_admin) && (
                  <Pressable
                    style={s.secondary}
                    onPress={() => setModal("create-org")}
                  >
                    <Text style={s.text}>Create an organization</Text>
                  </Pressable>
                )}
              </>
            )}
            {(modal === "join-org" || modal === "create-org") && (
              <OrganizationForm
                mode={modal}
                onDone={async (message) => {
                  setModal("");
                  setNotice(message);
                  await loadOrgs();
                }}
              />
            )}
            {modal === "channel" && org && (
              <ChannelForm
                orgId={org.id}
                members={members.filter((m) => m.id !== user.id)}
                onDone={async (id) => {
                  await loadOrg(org.id);
                  setChannelId(id);
                  setModal("");
                  setTab("messages");
                }}
              />
            )}
            {modal === "broadcast" && (
              <BroadcastForm
                organizations={orgs}
                onDone={(message) => {
                  setModal("");
                  setNotice(message);
                }}
              />
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
function OrganizationForm({
  mode,
  onDone,
}: {
  mode: string;
  onDone: (message: string) => Promise<void>;
}) {
  const { s } = useTheme(),
    [value, setValue] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 17 }}>
      <Text style={s.subtitle}>
        {mode === "join-org"
          ? "Enter the Organization ID your administrator shared. Your request needs approval."
          : "A separate space for your team, business, friends or community."}
      </Text>
      <Field
        label={mode === "join-org" ? "Organization ID" : "Organization name"}
        value={value}
        onChangeText={setValue}
        maxLength={80}
      />
      {!!error && <Text style={s.error}>{error}</Text>}
      <Pressable
        style={s.button}
        disabled={busy || !value.trim()}
        onPress={async () => {
          setBusy(true);
          try {
            await api(
              mode === "join-org" ? "/join-requests" : "/orgs",
              "POST",
              mode === "join-org"
                ? { organizationId: value.trim() }
                : { name: value.trim() },
            );
            await onDone(
              mode === "join-org"
                ? "Your access request is waiting for approval."
                : "Organization created.",
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Text style={s.buttonText}>
          {busy
            ? "Working…"
            : mode === "join-org"
              ? "Request access"
              : "Create organization"}
        </Text>
      </Pressable>
    </View>
  );
}
function ChannelForm({
  orgId,
  members,
  onDone,
}: {
  orgId: string;
  members: Member[];
  onDone: (id: string) => Promise<void>;
}) {
  const { c, s } = useTheme(),
    [name, setName] = useState(""),
    [privateGroup, setPrivate] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 17 }}>
      <Field
        label="Conversation name"
        value={name}
        onChangeText={setName}
        maxLength={60}
      />
      <View style={s.row}>
        <Text style={[s.text, { flex: 1 }]}>Private group</Text>
        <Switch
          accessibilityLabel="Private group"
          value={privateGroup}
          onValueChange={setPrivate}
        />
      </View>
      <Text style={s.subtitle}>
        {privateGroup
          ? "Only selected people can see and join this group."
          : "Anyone in your organization can discover and join this channel."}
      </Text>
      {privateGroup &&
        members.map((m) => (
          <Pressable
            key={m.id}
            style={s.row}
            onPress={() =>
              setSelected((old) =>
                old.includes(m.id)
                  ? old.filter((id) => id !== m.id)
                  : [...old, m.id],
              )
            }
          >
            <Ionicons
              name={selected.includes(m.id) ? "checkbox" : "square-outline"}
              size={24}
              color={c.accent}
            />
            <Text style={s.text}>{m.name}</Text>
          </Pressable>
        ))}
      {!!error && <Text style={s.error}>{error}</Text>}
      <Pressable
        disabled={busy || !name.trim()}
        style={s.button}
        onPress={async () => {
          setBusy(true);
          try {
            const r = await api<{ id: string }>(
              `/orgs/${orgId}/channels`,
              "POST",
              {
                name: name.trim(),
                kind: privateGroup ? "private" : "public",
                members: privateGroup ? selected : [],
              },
            );
            await onDone(r.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Text style={s.buttonText}>
          {busy ? "Creating…" : "Create conversation"}
        </Text>
      </Pressable>
    </View>
  );
}
function BroadcastForm({
  organizations,
  onDone,
}: {
  organizations: Org[];
  onDone: (message: string) => void;
}) {
  const { c, s } = useTheme(),
    [selected, setSelected] = useState<string[]>([]),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 17 }}>
      <Text style={s.subtitle}>
        Every member of each selected organization will receive this
        announcement in its own Announcements conversation.
      </Text>
      {organizations.map((o) => (
        <Pressable
          key={o.id}
          style={s.row}
          onPress={() =>
            setSelected((old) =>
              old.includes(o.id)
                ? old.filter((id) => id !== o.id)
                : [...old, o.id],
            )
          }
        >
          <Ionicons
            name={selected.includes(o.id) ? "checkbox" : "square-outline"}
            size={24}
            color={c.accent}
          />
          <Text style={s.text}>{o.name}</Text>
        </Pressable>
      ))}
      <TextInput
        accessibilityLabel="Announcement"
        placeholder="What would you like everyone to know?"
        placeholderTextColor={c.muted}
        multiline
        maxLength={10000}
        value={body}
        onChangeText={setBody}
        style={[s.input, { minHeight: 150, textAlignVertical: "top" }]}
      />
      {!!error && <Text style={s.error}>{error}</Text>}
      <Pressable
        disabled={busy || !body.trim() || !selected.length}
        style={s.button}
        onPress={() =>
          Alert.alert(
            "Send organization broadcast?",
            `This will reach every member of ${selected.length} selected organization(s).`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Send broadcast",
                onPress: async () => {
                  setBusy(true);
                  try {
                    const r = await api<{ organizationCount: number }>(
                      "/broadcasts",
                      "POST",
                      { organizationIds: selected, body },
                    );
                    onDone(
                      `Broadcast delivered to ${r.organizationCount} organization(s).`,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                },
              },
            ],
          )
        }
      >
        <Text style={s.buttonText}>{busy ? "Sending…" : "Send broadcast"}</Text>
      </Pressable>
    </View>
  );
}
