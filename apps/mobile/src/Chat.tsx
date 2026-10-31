import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  ScrollView,
  Alert,
  AppState,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { api, openAttachment } from "./api";
import type { User, Channel, Message, Attachment } from "./types";
import { useTheme, initials } from "./theme";
export type Draft = {
  body: string;
  clientId: string;
  reply: Message | null;
  attachments: Attachment[];
};
export const blankDraft = (): Draft => ({
  body: "",
  clientId: Crypto.randomUUID(),
  reply: null,
  attachments: [],
});
export function Chat({
  channel,
  user,
  drafts,
  version,
  typing,
  onTyping,
  onBack,
  onMeeting,
  onChannelChanged,
}: {
  channel: Channel;
  user: User;
  drafts: Map<string, Draft>;
  version: number;
  typing: string;
  onTyping: () => void;
  onBack: () => void;
  onMeeting: () => void;
  onChannelChanged: () => Promise<void>;
}) {
  const { c, s } = useTheme(),
    [messages, setMessages] = useState<Message[]>([]),
    [more, setMore] = useState(false),
    [draft, setDraft] = useState(() => drafts.get(channel.id) || blankDraft()),
    [loading, setLoading] = useState(true),
    [older, setOlder] = useState(false),
    [sending, setSending] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [saved, setSaved] = useState(false),
    [selected, setSelected] = useState<Message | null>(null),
    [editing, setEditing] = useState<Message | null>(null),
    [editText, setEditText] = useState("");
  const list = useRef<FlatList<Message>>(null),
    nearBottom = useRef(true),
    lastRead = useRef(""),
    loadVersion = useRef(0),
    alive = useRef(true),
    draftRef = useRef(draft);
  draftRef.current = draft;
  function update(value: Draft) {
    drafts.set(channel.id, value);
    draftRef.current = value;
    setDraft(value);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  async function refresh(signal?: AbortSignal) {
    if (!channel.joined) {
      setLoading(false);
      return;
    }
    const generation = ++loadVersion.current;
    try {
      const params = new URLSearchParams({
        ...(query ? { search: query } : {}),
        ...(saved ? { saved: "true" } : {}),
      });
      const r = await api<{
        messages: (Message & { client_id?: string })[];
        more: boolean;
      }>(
        `/channels/${channel.id}/messages?${params}`,
        "GET",
        undefined,
        signal,
      );
      if (!alive.current || generation !== loadVersion.current) return;
      setMessages((old) => {
        if (query || saved || !old.length) return r.messages;
        const map = new Map(old.map((m) => [m.id, m]));
        for (const m of r.messages) map.set(m.id, m);
        return [...map.values()].sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        );
      });
      setMore((old) =>
        query || saved || messages.length <= 50 ? r.more : old,
      );
      const current = draftRef.current;
      if (r.messages.some((m) => m.client_id === current.clientId))
        update(blankDraft());
      setError("");
    } catch (e) {
      if (!signal?.aborted && alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    setMessages([]);
    setLoading(true);
    nearBottom.current = true;
    lastRead.current = "";
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [channel.id, channel.joined, query, saved]);
  useEffect(() => {
    void refresh();
  }, [version]);
  async function markRead() {
    const last = messages[messages.length - 1];
    if (
      !last ||
      query ||
      saved ||
      !nearBottom.current ||
      AppState.currentState !== "active" ||
      lastRead.current === last.id
    )
      return;
    lastRead.current = last.id;
    try {
      await api(`/channels/${channel.id}/read`, "POST", { messageId: last.id });
    } catch {
      lastRead.current = "";
    }
  }
  useEffect(() => {
    void markRead();
  }, [messages]);
  async function previous() {
    if (!messages[0]) return;
    setOlder(true);
    try {
      const r = await api<{ messages: Message[]; more: boolean }>(
        `/channels/${channel.id}/messages?before=${messages[0].id}${query ? "&search=" + encodeURIComponent(query) : ""}${saved ? "&saved=true" : ""}`,
      );
      setMessages((old) => [
        ...r.messages,
        ...old.filter((m) => !r.messages.some((n) => n.id === m.id)),
      ]);
      setMore(r.more);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOlder(false);
    }
  }
  async function send() {
    if (
      sending ||
      uploading ||
      (!draftRef.current.body.trim() && !draftRef.current.attachments.length)
    )
      return;
    const pending = draftRef.current;
    setSending(true);
    setError("");
    try {
      await api(`/channels/${channel.id}/messages`, "POST", {
        body: pending.body,
        clientId: pending.clientId,
        replyId: pending.reply?.id,
        attachments: pending.attachments.map((a) => a.id),
      });
      if (draftRef.current.clientId === pending.clientId) update(blankDraft());
      nearBottom.current = true;
      await refresh();
      await onChannelChanged();
    } catch (e) {
      setError(
        (e as Error).message + " Your draft is retained; tap send to retry.",
      );
    } finally {
      setSending(false);
    }
  }
  async function attach() {
    if (draftRef.current.attachments.length >= 5) {
      setError("Attach up to five files per message.");
      return;
    }
    setUploading(true);
    try {
      const chosen = await DocumentPicker.getDocumentAsync({
        type: [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "application/pdf",
          "text/plain",
          "text/csv",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (chosen.canceled) return;
      const file = chosen.assets[0];
      if (file.size && file.size > 20 * 1024 * 1024)
        throw new Error("Choose a file smaller than 20 MB.");
      const form = new FormData();
      form.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || "application/octet-stream",
      } as unknown as Blob);
      const result = await api<Attachment>(
        `/channels/${channel.id}/attachments`,
        "POST",
        form,
      );
      update({
        ...draftRef.current,
        attachments: [...draftRef.current.attachments, result],
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function action(fn: () => Promise<unknown>) {
    try {
      await fn();
      setSelected(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.header}>
        <Pressable
          accessibilityLabel="Back to conversations"
          style={s.icon}
          onPress={onBack}
        >
          <Ionicons name="chevron-back" size={25} color={c.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: "800" }]} numberOfLines={1}>
            {channel.kind === "public"
              ? "# "
              : channel.kind === "private"
                ? "🔒 "
                : ""}
            {channel.display_name}
          </Text>
          <Text numberOfLines={1} style={s.small}>
            {channel.topic || "A little closer, wherever you are."}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Search conversation"
          style={s.icon}
          onPress={() => {
            setSearchOpen(!searchOpen);
            setSearch("");
          }}
        >
          <Ionicons name="search" size={21} color={c.accent} />
        </Pressable>
        <Pressable
          accessibilityLabel={saved ? "Show all messages" : "Saved messages"}
          style={[s.icon, saved ? { backgroundColor: c.soft } : {}]}
          onPress={() => setSaved(!saved)}
        >
          <Ionicons
            name={saved ? "bookmark" : "bookmark-outline"}
            size={21}
            color={c.accent}
          />
        </Pressable>
        {channel.joined && (
          <Pressable
            accessibilityLabel="Start or join meeting"
            style={s.icon}
            onPress={onMeeting}
          >
            <Ionicons name="videocam-outline" size={24} color={c.accent} />
          </Pressable>
        )}
      </View>
      {searchOpen && (
        <View
          style={{ padding: 12, borderBottomWidth: 1, borderColor: c.line }}
        >
          <TextInput
            accessibilityLabel="Search messages"
            autoFocus
            placeholder="Search this conversation…"
            placeholderTextColor={c.muted}
            value={search}
            onChangeText={setSearch}
            style={s.input}
          />
        </View>
      )}
      {channel.meeting_id && (
        <Pressable
          onPress={onMeeting}
          style={[
            s.row,
            { backgroundColor: c.soft, padding: 11, justifyContent: "center" },
          ]}
        >
          <Ionicons name="videocam" size={18} color={c.accent} />
          <Text style={{ color: c.accent, fontWeight: "700" }}>
            A meeting is happening · Join in
          </Text>
        </Pressable>
      )}
      {!channel.joined ? (
        <View style={[s.content, { flex: 1, justifyContent: "center" }]}>
          <Text style={s.title}>Join the conversation.</Text>
          <Text style={s.subtitle}>
            This is a public channel in your organization. Join to read and send
            messages.
          </Text>
          <Pressable
            style={s.button}
            onPress={() =>
              void action(async () => {
                await api(`/channels/${channel.id}/join`, "POST", {});
                await onChannelChanged();
              })
            }
          >
            <Text style={s.buttonText}>Join channel</Text>
          </Pressable>
          {!!error && <Text style={s.error}>{error}</Text>}
        </View>
      ) : (
        <>
          {loading ? (
            <ActivityIndicator style={{ flex: 1 }} color={c.accent} />
          ) : (
            <FlatList
              ref={list}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={{ padding: 14, gap: 13, flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              onScroll={(e) => {
                const n = e.nativeEvent;
                nearBottom.current =
                  n.contentSize.height -
                    n.layoutMeasurement.height -
                    n.contentOffset.y <
                  130;
                if (nearBottom.current) void markRead();
              }}
              scrollEventThrottle={100}
              onContentSizeChange={() => {
                if (nearBottom.current && !older && !query && !saved)
                  list.current?.scrollToEnd({ animated: false });
              }}
              ListHeaderComponent={
                more ? (
                  <Pressable
                    disabled={older}
                    style={[s.secondary, { marginBottom: 14 }]}
                    onPress={() => {
                      nearBottom.current = false;
                      void previous();
                    }}
                  >
                    <Text style={s.text}>
                      {older ? "Loading…" : "Load earlier messages"}
                    </Text>
                  </Pressable>
                ) : undefined
              }
              ListEmptyComponent={
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    padding: 24,
                    gap: 12,
                  }}
                >
                  <Ionicons
                    name={saved ? "bookmark-outline" : "chatbubbles-outline"}
                    size={34}
                    color={c.muted}
                  />
                  <Text style={s.subtitle}>
                    {query
                      ? "No matching messages."
                      : saved
                        ? "No saved messages in this conversation."
                        : "Start with a hello."}
                  </Text>
                </View>
              }
              renderItem={({ item: m }) => (
                <Pressable
                  accessibilityLabel={"Message from " + m.sender_name}
                  onLongPress={() => {
                    if (!m.deleted_at) setSelected(m);
                  }}
                  delayLongPress={350}
                  style={{
                    alignSelf:
                      m.sender_id === user.id ? "flex-end" : "flex-start",
                    maxWidth: "92%",
                    gap: 4,
                  }}
                >
                  <View style={[s.row, { gap: 8, paddingHorizontal: 4 }]}>
                    <Text
                      style={[s.small, { fontWeight: "700", color: c.ink }]}
                    >
                      {m.sender_name}
                    </Text>
                    <Text style={[s.small, { fontSize: 10 }]}>
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {m.edited_at ? " · edited" : ""}
                    </Text>
                    {m.saved && (
                      <Ionicons name="bookmark" size={12} color={c.accent} />
                    )}
                  </View>
                  <View
                    style={{
                      backgroundColor:
                        m.sender_id === user.id ? c.soft : c.card,
                      borderWidth: 1,
                      borderColor: c.line,
                      borderRadius: 17,
                      padding: 13,
                      gap: 8,
                    }}
                  >
                    {m.broadcast_id && (
                      <Text
                        style={{
                          fontSize: 10,
                          color: c.accent,
                          fontWeight: "800",
                        }}
                      >
                        ORGANIZATION BROADCAST
                      </Text>
                    )}
                    {m.reply_id && (
                      <View
                        style={{
                          padding: 9,
                          borderLeftWidth: 3,
                          borderColor: c.accent,
                          backgroundColor: c.bg,
                          borderRadius: 5,
                        }}
                      >
                        <Text style={[s.small, { fontWeight: "700" }]}>
                          {m.reply_name}
                        </Text>
                        <Text numberOfLines={2} style={s.small}>
                          {m.reply_body || "Attachment"}
                        </Text>
                      </View>
                    )}
                    <Text
                      selectable
                      style={[
                        s.text,
                        m.deleted_at
                          ? { color: c.muted, fontStyle: "italic" }
                          : {},
                      ]}
                    >
                      {m.deleted_at ? "This message was removed." : m.body}
                    </Text>
                    {!m.deleted_at &&
                      m.attachments.map((a) => (
                        <Pressable
                          key={a.id}
                          accessibilityLabel={"Open attachment " + a.name}
                          style={[
                            s.row,
                            {
                              padding: 9,
                              backgroundColor: c.bg,
                              borderRadius: 9,
                            },
                          ]}
                          onPress={() =>
                            void openAttachment(a).catch((e) =>
                              setError(e.message),
                            )
                          }
                        >
                          <Ionicons
                            name="document-attach-outline"
                            size={20}
                            color={c.accent}
                          />
                          <View style={{ flexShrink: 1 }}>
                            <Text
                              numberOfLines={2}
                              style={[
                                s.small,
                                { color: c.accent, fontWeight: "700" },
                              ]}
                            >
                              {a.name}
                            </Text>
                            <Text style={s.small}>
                              {Math.max(1, Math.round(a.size / 1024))} KB
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                  </View>
                  {m.reactions.length > 0 && (
                    <View style={[s.row, { flexWrap: "wrap", gap: 5 }]}>
                      {m.reactions.map((r) => (
                        <Pressable
                          key={r.emoji}
                          accessibilityLabel={r.emoji + " reaction"}
                          style={[
                            s.pill,
                            {
                              borderWidth: r.mine ? 1 : 0,
                              borderColor: c.accent,
                            },
                          ]}
                          onPress={() =>
                            void action(() =>
                              api(`/messages/${m.id}/react`, "POST", {
                                emoji: r.emoji,
                                active: !r.mine,
                              }),
                            )
                          }
                        >
                          <Text style={s.small}>
                            {r.emoji} {r.count}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </Pressable>
              )}
            />
          )}
          {!!typing && (
            <Text
              style={[s.small, { paddingHorizontal: 18, paddingVertical: 5 }]}
            >
              {typing} is typing…
            </Text>
          )}
          {!!error && (
            <Pressable onPress={() => setError("")}>
              <Text accessibilityRole="alert" style={[s.error, { margin: 10 }]}>
                {error}
              </Text>
            </Pressable>
          )}
          <View
            style={{
              padding: 12,
              gap: 9,
              backgroundColor: c.card,
              borderTopWidth: 1,
              borderColor: c.line,
            }}
          >
            {draft.reply && (
              <View
                style={[
                  s.row,
                  {
                    borderLeftWidth: 3,
                    borderColor: c.accent,
                    paddingLeft: 10,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.small, { fontWeight: "700" }]}>
                    Replying to {draft.reply.sender_name}
                  </Text>
                  <Text numberOfLines={1} style={s.small}>
                    {draft.reply.body || "Attachment"}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Cancel reply"
                  style={s.icon}
                  onPress={() => update({ ...draft, reply: null })}
                >
                  <Ionicons name="close" size={19} color={c.muted} />
                </Pressable>
              </View>
            )}
            {draft.attachments.map((a) => (
              <View key={a.id} style={s.row}>
                <Ionicons name="document" size={16} color={c.accent} />
                <Text numberOfLines={1} style={[s.small, { flex: 1 }]}>
                  {a.name}
                </Text>
                <Pressable
                  disabled={sending}
                  accessibilityLabel={"Remove " + a.name}
                  onPress={() =>
                    update({
                      ...draftRef.current,
                      attachments: draftRef.current.attachments.filter(
                        (v) => v.id !== a.id,
                      ),
                    })
                  }
                >
                  <Ionicons name="close-circle" size={20} color={c.muted} />
                </Pressable>
              </View>
            ))}
            <View style={[s.row, { alignItems: "flex-end", gap: 7 }]}>
              <Pressable
                accessibilityLabel="Attach file"
                style={s.icon}
                disabled={sending || uploading}
                onPress={() => void attach()}
              >
                {uploading ? (
                  <ActivityIndicator color={c.accent} />
                ) : (
                  <Ionicons name="attach" size={25} color={c.accent} />
                )}
              </Pressable>
              <TextInput
                accessibilityLabel="Message"
                multiline
                maxLength={10000}
                editable={!sending}
                placeholder="Write a message…"
                placeholderTextColor={c.muted}
                style={[
                  s.input,
                  { flex: 1, minHeight: 46, maxHeight: 140, paddingTop: 12 },
                ]}
                value={draft.body}
                onChangeText={(body) => {
                  update({ ...draftRef.current, body });
                  onTyping();
                }}
              />
              <Pressable
                accessibilityLabel="Send message"
                disabled={
                  sending ||
                  uploading ||
                  (!draft.body.trim() && !draft.attachments.length)
                }
                style={[
                  s.button,
                  {
                    width: 48,
                    padding: 0,
                    opacity:
                      sending ||
                      uploading ||
                      (!draft.body.trim() && !draft.attachments.length)
                        ? 0.45
                        : 1,
                  },
                ]}
                onPress={() => void send()}
              >
                {sending ? (
                  <ActivityIndicator color={c.onAccent} />
                ) : (
                  <Ionicons name="arrow-up" size={24} color={c.onAccent} />
                )}
              </Pressable>
            </View>
            <Text style={[s.small, { fontSize: 10, paddingLeft: 4 }]}>
              Hold a message to reply, react or save it.
            </Text>
          </View>
        </>
      )}
      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "#071B25AA",
            justifyContent: "flex-end",
          }}
          onPress={() => setSelected(null)}
        >
          <Pressable
            style={[
              s.card,
              {
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                padding: 22,
                paddingBottom: 38,
              },
            ]}
            onPress={() => {}}
          >
            <Text numberOfLines={2} style={s.subtitle}>
              {selected?.body || "Attachment"}
            </Text>
            <View
              style={[
                s.row,
                { justifyContent: "space-between", paddingVertical: 10 },
              ]}
            >
              {["👍", "❤️", "😂", "🎉", "👀", "✅"].map((emoji) => (
                <Pressable
                  key={emoji}
                  accessibilityLabel={"React " + emoji}
                  style={s.icon}
                  onPress={() => {
                    if (selected)
                      void action(() =>
                        api(`/messages/${selected.id}/react`, "POST", {
                          emoji,
                          active: !selected.reactions.find(
                            (r) => r.emoji === emoji,
                          )?.mine,
                        }),
                      );
                  }}
                >
                  <Text style={{ fontSize: 26 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {selected && (
              <>
                <Pressable
                  style={s.secondary}
                  onPress={() => {
                    update({ ...draftRef.current, reply: selected });
                    setSelected(null);
                  }}
                >
                  <Ionicons
                    name="arrow-undo-outline"
                    size={20}
                    color={c.accent}
                  />
                  <Text style={s.text}>Reply</Text>
                </Pressable>
                <Pressable
                  style={s.secondary}
                  onPress={() =>
                    void action(() =>
                      api(`/messages/${selected.id}/save`, "POST", {
                        active: !selected.saved,
                      }),
                    )
                  }
                >
                  <Ionicons
                    name={selected.saved ? "bookmark" : "bookmark-outline"}
                    size={20}
                    color={c.accent}
                  />
                  <Text style={s.text}>
                    {selected.saved ? "Unsave message" : "Save message"}
                  </Text>
                </Pressable>
                {selected.sender_id === user.id && (
                  <>
                    <Pressable
                      style={s.secondary}
                      onPress={() => {
                        setEditing(selected);
                        setEditText(selected.body);
                        setSelected(null);
                      }}
                    >
                      <Text style={s.text}>Edit message</Text>
                    </Pressable>
                    <Pressable
                      style={s.secondary}
                      onPress={() =>
                        Alert.alert(
                          "Remove message?",
                          "This removes the message for everyone.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: () =>
                                void action(() =>
                                  api(`/messages/${selected.id}`, "DELETE"),
                                ),
                            },
                          ],
                        )
                      }
                    >
                      <Text style={{ color: c.danger }}>Remove message</Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={!!editing}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditing(null)}
      >
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          style={s.screen}
        >
          <Text style={s.title}>Edit message</Text>
          <TextInput
            accessibilityLabel="Edit message text"
            multiline
            value={editText}
            onChangeText={setEditText}
            style={[s.input, { minHeight: 130 }]}
            autoFocus
          />
          <Pressable
            style={s.button}
            onPress={() => {
              if (editing)
                void action(async () => {
                  await api(`/messages/${editing.id}`, "PATCH", {
                    body: editText,
                  });
                  setEditing(null);
                });
            }}
          >
            <Text style={s.buttonText}>Save changes</Text>
          </Pressable>
          <Pressable style={s.secondary} onPress={() => setEditing(null)}>
            <Text style={s.text}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </Modal>
    </KeyboardAvoidingView>
  );
}
