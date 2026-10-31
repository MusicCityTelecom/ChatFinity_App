import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, signIn, SERVER } from "./api";
import type { User } from "./types";
import { useTheme } from "./theme";
export function Auth({ onLogin }: { onLogin: (u: User) => void }) {
  const { c, s } = useTheme(),
    [mode, setMode] = useState<"login" | "signup" | "forgot">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [org, setOrg] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "login") {
        onLogin(await signIn(email.trim(), password));
        return;
      }
      if (mode === "signup") {
        await api("/auth/signup", "POST", {
          email: email.trim(),
          password,
          name: name.trim(),
          ...(org.trim() ? { organizationId: org.trim() } : {}),
        });
        setMode("login");
        setPassword("");
        setNotice(
          "Check your email to verify your account, then sign in. Organization requests need administrator approval.",
        );
      } else {
        await api("/auth/forgot", "POST", { email: email.trim() });
        setNotice(
          "If your email has an account, a password reset link is on its way.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 28,
          gap: 22,
          maxWidth: 540,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <View style={[s.row, { marginBottom: 12 }]}>
          <View style={[s.avatar, { backgroundColor: c.accent }]}>
            <Ionicons name="chatbubbles" size={24} color={c.onAccent} />
          </View>
          <Text style={[s.title, { fontSize: 24 }]}>ChatFinity.</Text>
        </View>
        <View>
          <Text style={s.title}>
            {mode === "login"
              ? "Your people.\nAlways a little closer."
              : mode === "signup"
                ? "Start a great conversation."
                : "Let’s get you back in."}
          </Text>
          <Text style={[s.subtitle, { marginTop: 10 }]}>
            One account for your organizations, conversations and meetings.
          </Text>
        </View>
        {mode === "signup" && (
          <Field
            label="Your name"
            value={name}
            onChangeText={setName}
            autoComplete="name"
          />
        )}
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        {mode !== "forgot" && (
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            placeholder={
              mode === "signup"
                ? "At least 12 characters"
                : "Your ChatFinity password"
            }
          />
        )}
        {mode === "signup" && (
          <>
            <Field
              label="Organization ID (optional)"
              value={org}
              onChangeText={setOrg}
              autoCapitalize="characters"
              placeholder="CF-…"
            />
            <Text style={s.small}>
              Enter an ID to request access to an existing organization. Leave
              blank to start your own.
            </Text>
          </>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        )}
        {!!notice && <Text style={[s.card, s.subtitle]}>{notice}</Text>}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !email.trim() || (mode !== "forgot" && !password)}
          style={[s.button, { opacity: busy ? 0.5 : 1 }]}
          onPress={() => void submit()}
        >
          {busy ? (
            <ActivityIndicator color={c.onAccent} />
          ) : (
            <>
              <Text style={s.buttonText}>
                {mode === "login"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset link"}
              </Text>
              <Ionicons name="arrow-forward" size={19} color={c.onAccent} />
            </>
          )}
        </Pressable>
        <View style={{ gap: 15, alignItems: "center" }}>
          {mode === "login" && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode("forgot");
                setError("");
              }}
            >
              <Text style={{ color: c.accent }}>Forgot your password?</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError("");
              setNotice("");
            }}
          >
            <Text style={{ color: c.accent }}>
              {mode === "login"
                ? "New here? Create an account"
                : "Back to sign in"}
            </Text>
          </Pressable>
          <Pressable onPress={() => void Linking.openURL(SERVER)}>
            <Text style={s.small}>chat.innaware.net · Open web app</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export function Field({
  label,
  ...props
}: import("react-native").TextInputProps & { label: string }) {
  const { c, s } = useTheme();
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={s.input}
        {...props}
      />
    </View>
  );
}
