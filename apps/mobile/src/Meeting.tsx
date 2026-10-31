import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Switch,
  Platform,
  PermissionsAndroid,
  ActivityIndicator,
  Alert,
} from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useLocalParticipant,
  useRoomContext,
  useParticipants,
  isTrackReference,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "./api";
import type { Meeting, User } from "./types";
import { useTheme, initials } from "./theme";
type Access = { token: string; url: string; meeting: Meeting };
export function MeetingScreen({
  id,
  user,
  admin,
  onLeave,
}: {
  id: string;
  user: User;
  admin: boolean;
  onLeave: () => void;
}) {
  const { c, s } = useTheme(),
    [access, setAccess] = useState<Access | null>(null),
    [camera, setCamera] = useState(false),
    [mic, setMic] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      void AudioSession.stopAudioSession();
    },
    [],
  );
  async function join() {
    setBusy(true);
    setError("");
    try {
      if (Platform.OS === "android") {
        const needed = [
          ...(mic ? [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] : []),
          ...(camera ? [PermissionsAndroid.PERMISSIONS.CAMERA] : []),
        ];
        if (needed.length) {
          const granted = await PermissionsAndroid.requestMultiple(needed);
          if (
            needed.some(
              (p) => granted[p] !== PermissionsAndroid.RESULTS.GRANTED,
            )
          )
            throw new Error(
              "Allow the selected microphone and camera permissions, or switch them off to join as a listener.",
            );
        }
      }
      const fresh = await api<Access>(`/meetings/${id}/token`, "POST", {});
      await AudioSession.startAudioSession();
      setAccess(fresh);
    } catch (e) {
      setError((e as Error).message);
      await AudioSession.stopAudioSession();
    } finally {
      setBusy(false);
    }
  }
  if (!access)
    return (
      <View style={s.screen}>
        <View style={s.header}>
          <Text style={[s.text, { flex: 1, fontWeight: "700" }]}>
            ChatFinity Meet
          </Text>
          <Pressable
            accessibilityLabel="Close meeting"
            style={s.icon}
            onPress={onLeave}
          >
            <Ionicons name="close" size={24} color={c.ink} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[
            s.content,
            {
              flexGrow: 1,
              justifyContent: "center",
              maxWidth: 520,
              alignSelf: "center",
              width: "100%",
            },
          ]}
        >
          <View style={[s.avatar, { width: 78, height: 78, borderRadius: 25 }]}>
            <Ionicons name="videocam" size={38} color={c.accent} />
          </View>
          <Text style={s.title}>Ready when you are.</Text>
          <Text style={s.subtitle}>
            Choose how you join. Your microphone and camera start only with your
            permission.
          </Text>
          <View style={[s.card, { gap: 20 }]}>
            <View style={s.row}>
              <Ionicons name="mic" size={22} color={c.ink} />
              <Text style={[s.text, { flex: 1 }]}>Microphone</Text>
              <Switch
                accessibilityLabel="Microphone"
                value={mic}
                onValueChange={setMic}
              />
            </View>
            <View style={s.row}>
              <Ionicons name="videocam" size={22} color={c.ink} />
              <Text style={[s.text, { flex: 1 }]}>Camera</Text>
              <Switch
                accessibilityLabel="Camera"
                value={camera}
                onValueChange={setCamera}
              />
            </View>
          </View>
          {!!error && <Text style={s.error}>{error}</Text>}
          <Pressable
            style={s.button}
            disabled={busy}
            onPress={() => void join()}
          >
            {busy ? (
              <ActivityIndicator color={c.onAccent} />
            ) : (
              <Text style={s.buttonText}>Join meeting</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    );
  return (
    <View style={s.screen}>
      <LiveKitRoom
        serverUrl={access.url}
        token={access.token}
        connect
        audio={mic}
        video={camera}
        onDisconnected={onLeave}
        onError={(e) => setError(e.message)}
      >
        <MeetingContent
          title={access.meeting.title}
          canEnd={admin || access.meeting.host_id === user.id}
          onLeave={onLeave}
          onEnd={async () => {
            await api(`/meetings/${id}/end`, "POST", {});
            onLeave();
          }}
        />
        {!!error && <Text style={s.error}>{error}</Text>}
      </LiveKitRoom>
    </View>
  );
}
function MeetingContent({
  title,
  canEnd,
  onLeave,
  onEnd,
}: {
  title: string;
  canEnd: boolean;
  onLeave: () => void;
  onEnd: () => Promise<void>;
}) {
  const { c, s } = useTheme(),
    tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]),
    participants = useParticipants(),
    {
      localParticipant,
      isMicrophoneEnabled,
      isCameraEnabled,
      isScreenShareEnabled,
    } = useLocalParticipant(),
    room = useRoomContext(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
  const controls: [
    string,
    React.ComponentProps<typeof Ionicons>["name"],
    () => Promise<unknown>,
  ][] = [
    [
      isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone",
      isMicrophoneEnabled ? "mic" : "mic-off",
      () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled),
    ],
    [
      isCameraEnabled ? "Turn camera off" : "Turn camera on",
      isCameraEnabled ? "videocam" : "videocam-off",
      () => localParticipant.setCameraEnabled(!isCameraEnabled),
    ],
    ...(Platform.OS === "android"
      ? [
          [
            isScreenShareEnabled ? "Stop screen sharing" : "Share screen",
            "share-social",
            () => localParticipant.setScreenShareEnabled(!isScreenShareEnabled),
          ] as [
            string,
            React.ComponentProps<typeof Ionicons>["name"],
            () => Promise<unknown>,
          ],
        ]
      : []),
  ];
  return (
    <>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[s.text, { fontWeight: "700" }]}>
            {title}
          </Text>
          <Text style={s.small}>
            {participants.length} participant
            {participants.length === 1 ? "" : "s"}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Leave meeting"
          style={[s.icon, { backgroundColor: c.danger }]}
          onPress={() => {
            void room.disconnect();
            onLeave();
          }}
        >
          <Ionicons name="call" size={23} color="white" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, flexGrow: 1 }}>
        {tracks.filter(isTrackReference).map((track) => (
          <View
            key={track.participant.identity + track.source}
            style={{
              height: track.source === Track.Source.ScreenShare ? 280 : 240,
              borderRadius: 16,
              overflow: "hidden",
              backgroundColor: "#11262D",
            }}
          >
            <VideoTrack
              trackRef={track}
              style={{ flex: 1 }}
              objectFit={
                track.source === Track.Source.ScreenShare ? "contain" : "cover"
              }
            />
            <Text
              style={{
                position: "absolute",
                bottom: 10,
                left: 12,
                color: "white",
                backgroundColor: "#102328AA",
                padding: 6,
                borderRadius: 7,
                fontSize: 12,
              }}
            >
              {track.participant.name || "Participant"}
              {track.source === Track.Source.ScreenShare ? " · Screen" : ""}
            </Text>
          </View>
        ))}
        {participants
          .filter(
            (p) =>
              !tracks.some(
                (t) =>
                  t.participant.identity === p.identity &&
                  t.source === Track.Source.Camera,
              ),
          )
          .map((p) => (
            <View
              style={[
                s.card,
                {
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 160,
                },
              ]}
              key={p.identity}
            >
              <View style={[s.avatar, { width: 58, height: 58 }]}>
                <Text style={[s.title, { fontSize: 22 }]}>
                  {initials(p.name || "Participant")}
                </Text>
              </View>
              <Text style={s.text}>{p.name || "Participant"}</Text>
              <Text style={s.small}>
                {p.isMicrophoneEnabled ? "Microphone on" : "Microphone muted"}
              </Text>
            </View>
          ))}
      </ScrollView>
      {!!error && (
        <Text style={[s.error, { marginHorizontal: 14 }]}>{error}</Text>
      )}
      <View
        style={{ padding: 16, borderTopWidth: 1, borderColor: c.line, gap: 12 }}
      >
        <View style={[s.row, { justifyContent: "space-evenly" }]}>
          {controls.map(([label, icon, fn]) => (
            <Pressable
              key={label}
              accessibilityLabel={label}
              disabled={busy}
              onPress={() => void perform(fn)}
              style={[
                s.icon,
                { backgroundColor: c.soft, width: 55, height: 50 },
              ]}
            >
              <Ionicons name={icon} size={23} color={c.accent} />
            </Pressable>
          ))}
        </View>
        {canEnd && (
          <Pressable
            disabled={busy}
            style={s.secondary}
            onPress={() =>
              Alert.alert(
                "End this meeting?",
                "Everyone will be disconnected.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "End for everyone",
                    style: "destructive",
                    onPress: () => void perform(onEnd),
                  },
                ],
              )
            }
          >
            <Text style={{ color: c.danger, fontWeight: "700" }}>
              End for everyone
            </Text>
          </Pressable>
        )}
      </View>
    </>
  );
}
