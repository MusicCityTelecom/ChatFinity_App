import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Switch,
  Linking,
  Alert,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, SERVER } from "./api";
import { Field } from "./Auth";
import type { User } from "./types";
import { useTheme } from "./theme";
export function PasswordChange({
  required,
  onChanged,
  onCancel,
}: {
  required?: boolean;
  onChanged: () => Promise<void>;
  onCancel?: () => void;
}) {
  const { s } = useTheme(),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <ScrollView
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.title}>
        {required ? "Choose your own password." : "Change password"}
      </Text>
      <Text style={s.subtitle}>
        {required
          ? "Your administrator supplied a temporary password. Set your own to continue."
          : "Your other signed-in sessions will be disconnected."}
      </Text>
      <Field
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoComplete="current-password"
      />
      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        placeholder="At least 12 characters"
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
      />
      {!!error && <Text style={s.error}>{error}</Text>}
      <Pressable
        disabled={busy}
        style={s.button}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            if (password.length < 12)
              throw new Error("Use at least 12 characters.");
            if (password !== confirm)
              throw new Error("The new passwords do not match.");
            await api("/auth/change-password", "POST", {
              currentPassword: current,
              password,
            });
            await onChanged();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Text style={s.buttonText}>
          {busy ? "Updating…" : "Change password"}
        </Text>
      </Pressable>
      {onCancel && (
        <Pressable style={s.secondary} onPress={onCancel}>
          <Text style={s.text}>Back</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
export function Settings({
  user,
  sound,
  onSound,
  onUser,
  onSignOut,
}: {
  user: User;
  sound: boolean;
  onSound: (value: boolean) => void;
  onUser: (u: User) => void;
  onSignOut: () => Promise<void>;
}) {
  const { c, s } = useTheme(),
    [changing, setChanging] = useState(false),
    [name, setName] = useState(user.name),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  if (changing)
    return (
      <PasswordChange
        onChanged={async () => {
          onUser((await api<{ user: User }>("/me")).user);
          setChanging(false);
          setNotice("Password updated.");
        }}
        onCancel={() => setChanging(false)}
      />
    );
  return (
    <ScrollView
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.title}>Make yourself at home.</Text>
      <Text style={s.subtitle}>{user.email}</Text>
      <View style={s.card}>
        <Field label="Your name" value={name} onChangeText={setName} />
        <Pressable
          style={s.button}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const r = await api<{ user: User }>("/me", "PATCH", { name });
              onUser(r.user);
              setNotice("Profile updated.");
              setError("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Text style={s.buttonText}>Save profile</Text>
        </Pressable>
        <Text style={[s.label, { marginTop: 12 }]}>PRESENCE</Text>
        {[
          ["online", "Available"],
          ["away", "Away"],
          ["busy", "Do not disturb"],
          ["invisible", "Appear offline"],
        ].map(([value, label]) => (
          <Pressable
            key={value}
            style={s.row}
            onPress={async () => {
              try {
                onUser(
                  (await api<{ user: User }>("/me", "PATCH", { status: value }))
                    .user,
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Ionicons
              name={
                user.status === value ? "radio-button-on" : "radio-button-off"
              }
              size={21}
              color={c.accent}
            />
            <Text style={s.text}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.card}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.text}>Message sound and vibration</Text>
            <Text style={s.small}>
              While ChatFinity is open. Do not disturb silences alerts.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Message sound and vibration"
            value={sound}
            onValueChange={onSound}
          />
        </View>
        <Text style={s.small}>
          Background push notifications are not available in this preview build.
        </Text>
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
      {!!notice && (
        <Text style={[s.subtitle, { color: c.accent }]}>{notice}</Text>
      )}
      <Pressable style={s.secondary} onPress={() => setChanging(true)}>
        <Ionicons name="key-outline" size={20} color={c.accent} />
        <Text style={s.text}>Change password</Text>
      </Pressable>
      <Pressable
        style={s.secondary}
        onPress={() => void Linking.openURL(SERVER)}
      >
        <Ionicons name="open-outline" size={20} color={c.accent} />
        <Text style={s.text}>
          {user.is_system_admin
            ? "Open web app and system administration"
            : "Open web app"}
        </Text>
      </Pressable>
      <Pressable
        style={s.secondary}
        onPress={() =>
          Alert.alert(
            "Sign out?",
            "This phone’s ChatFinity session will be removed.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign out",
                style: "destructive",
                onPress: () =>
                  void onSignOut().catch((e) => setError(e.message)),
              },
            ],
          )
        }
      >
        <Text style={{ color: c.danger, fontWeight: "700" }}>Sign out</Text>
      </Pressable>
      <Text style={[s.small, { textAlign: "center", marginVertical: 16 }]}>
        ChatFinity 0.1.0 · Mobile preview
      </Text>
    </ScrollView>
  );
}
