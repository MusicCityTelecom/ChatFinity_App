export interface User {
  id: string;
  email: string;
  name: string;
  verified_at: string | null;
  status: string;
}
export interface Org {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
}
export interface Channel {
  id: string;
  org_id: string;
  name: string;
  display_name: string;
  topic: string;
  kind: "public" | "private" | "dm";
  joined: boolean;
  unread: number;
  meeting_id: string | null;
  created_by: string;
  last_message: string | null;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  online: boolean;
  read_at?: string;
}
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
}
export interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_id: string | null;
  reply_body: string | null;
  reply_name: string | null;
  attachments: Attachment[];
  reactions: { emoji: string; count: number; mine: boolean }[];
  saved: boolean;
}
export interface Meeting {
  id: string;
  title: string;
  host_id: string;
  channel_id: string;
  ended_at: string | null;
}
let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    signal,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body !== undefined
      ? { body: isForm ? body : JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(result.error || "Could not connect. Please try again.");
  }
  if (result.csrf) setCsrf(result.csrf);
  return result;
}
