import * as SecureStore from "expo-secure-store";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { Attachment, User } from "./types";
export const SERVER = "https://chat.innaware.net";
const KEY = "chatfinity.session.v1";
type Session = { token: string; csrf: string; expiresAt: string };
let session: Session | null = null;
let expired: () => void = () => {};
export const onSessionExpired = (fn: () => void) => {
  expired = fn;
};
const storeOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export async function restoreSession() {
  const raw = await SecureStore.getItemAsync(KEY, storeOptions);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw) as Session;
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(saved.token) ||
      !saved.csrf ||
      new Date(saved.expiresAt).getTime() <= Date.now()
    )
      throw new Error("Expired");
    session = saved;
    return true;
  } catch {
    await clearSession();
    return false;
  }
}
export async function clearSession() {
  session = null;
  await SecureStore.deleteItemAsync(KEY, storeOptions);
  const downloads = new Directory(Paths.cache, "chatfinity-downloads");
  if (downloads.exists) downloads.delete();
}
export function authHeaders() {
  return {
    Origin: SERVER,
    ...(session
      ? {
          Authorization: "Bearer " + session.token,
          "X-CSRF-Token": session.csrf,
        }
      : {}),
  };
}
export async function api<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController(),
    timer = setTimeout(
      () => controller.abort(),
      body instanceof FormData ? 90000 : 20000,
    );
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const form = body instanceof FormData;
    const response = await fetch(SERVER + "/api" + path, {
      method,
      credentials: "omit",
      headers: {
        ...authHeaders(),
        ...(form ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: form ? body : JSON.stringify(body) }),
      signal: controller.signal,
    });
    let result: any;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        "ChatFinity could not complete that request. Please try again.",
      );
    }
    if (!response.ok) {
      if (response.status === 401 && session) {
        await clearSession();
        expired();
      }
      throw new Error(result.error || "Please try again.");
    }
    return result as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
export async function signIn(email: string, password: string) {
  const result = await api<Session & { user: User }>(
    "/auth/mobile-login",
    "POST",
    { email, password },
  );
  session = {
    token: result.token,
    csrf: result.csrf,
    expiresAt: result.expiresAt,
  };
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session), storeOptions);
  } catch {
    try {
      await api("/auth/logout", "POST", {});
    } finally {
      session = null;
    }
    throw new Error(
      "Your device could not securely save this sign-in. Please try again.",
    );
  }
  return result.user;
}
export async function signOut() {
  try {
    if (session) await api("/auth/logout", "POST", {});
  } finally {
    await clearSession();
  }
}
export function connectEvents() {
  if (!session) throw new Error("Please sign in.");
  const NativeWebSocket = WebSocket as typeof WebSocket & {
    new (
      url: string,
      protocols: undefined,
      options: { headers: Record<string, string> },
    ): WebSocket;
  };
  return new NativeWebSocket(
    SERVER.replace("https:", "wss:") + "/api/events",
    undefined,
    { headers: authHeaders() },
  );
}
export async function openAttachment(attachment: Attachment) {
  const directory = new Directory(Paths.cache, "chatfinity-downloads");
  directory.create({ idempotent: true, intermediates: true });
  const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const target = new File(directory, attachment.id + "-" + safeName);
  try {
    await File.downloadFileAsync(
      SERVER + "/api/attachments/" + attachment.id,
      target,
      { headers: authHeaders(), idempotent: true },
    );
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("Sharing is unavailable on this device.");
    await Sharing.shareAsync(target.uri, {
      mimeType: attachment.mime,
      dialogTitle: attachment.name,
    });
  } catch (e) {
    if (target.exists) target.delete();
    throw e;
  }
}
