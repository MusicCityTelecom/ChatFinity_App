import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Building2, Mail, Copy, Check } from "lucide-react";
import { api, type User } from "./api";
export function PasswordForm({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="password-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("confirm")) {
          setError("The new passwords do not match.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          await api("/auth/change-password", "POST", {
            currentPassword: f.get("currentPassword"),
            password: f.get("password"),
          });
          await onChanged();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Current password
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={200}
          required
          placeholder="At least 12 characters"
        />
      </label>
      <label>
        Confirm new password
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="primary" disabled={busy}>
        <KeyRound size={16} /> {busy ? "Updating…" : "Change password"}
      </button>
      <p className="muted">Your other sessions will be signed out.</p>
    </form>
  );
}
export function RequiredPasswordChange({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="center-page">
      <div className="welcome-card">
        <KeyRound size={32} />
        <h1>Choose your own password.</h1>
        <p>
          Your administrator provided a temporary password. Set your own before
          continuing.
        </p>
        <PasswordForm onChanged={onChanged} />
      </div>
    </div>
  );
}
export function JoinOrganization({ onJoined }: { onJoined?: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const r = await api<{ message: string }>("/join-requests", "POST", {
            organizationId: new FormData(e.currentTarget).get("organizationId"),
          });
          setNotice(r.message);
          onJoined?.();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        Enter the Organization ID shared by your administrator. Your verified
        request will be reviewed before you can access its conversations.
      </p>
      <label>
        Organization ID
        <input
          name="organizationId"
          required
          autoComplete="off"
          placeholder="CF-… or the full organization ID"
          maxLength={80}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-notice">{notice}</p>}
      <button className="primary" disabled={busy}>
        <Building2 size={16} /> Request access
      </button>
    </form>
  );
}
export function PendingAccess({
  canCreate,
  onCreate,
  onJoin,
  onRefresh,
}: {
  canCreate: boolean;
  onCreate: () => void;
  onJoin: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [requests, setRequests] = useState<
    { id: string; organization_name: string; status: string }[]
  >([]);
  useEffect(() => {
    void api<{ requests: typeof requests }>("/me/join-requests").then((r) =>
      setRequests(r.requests),
    );
  }, []);
  return (
    <div className="empty-workspace">
      <span className="empty-symbol">
        <Building2 size={36} />
      </span>
      <span className="eyebrow">YOUR PEOPLE. YOUR POSSIBILITY.</span>
      <h1>
        {requests.some((r) => r.status === "pending")
          ? "Your request is on its way."
          : "Find your people."}
      </h1>
      <p>
        {canCreate
          ? "Create an organization for your team or request access to an existing one."
          : "Enter an Organization ID or use an email invitation to connect with your organization."}
      </p>
      {requests.map((r) => (
        <div className="pending-access" key={r.id}>
          <strong>{r.organization_name}</strong>
          <span>
            {r.status === "pending"
              ? "Awaiting administrator approval"
              : r.status}
          </span>
        </div>
      ))}
      <div className="empty-workspace-actions">
        {canCreate && (
          <button className="primary" onClick={onCreate}>
            Create your first organization
          </button>
        )}
        <button className="secondary" onClick={onJoin}>
          Join an organization
        </button>
      </div>
      <button className="text-button" onClick={() => void onRefresh()}>
        Refresh my access
      </button>
    </div>
  );
}
export function BroadcastComposer({
  organizations,
  onSent,
}: {
  organizations: { id: string; name: string }[];
  onSent: (r: { id: string; organizationCount: number }) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!selected.length) {
          setError("Select at least one organization.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          const result = await api<{ id: string; organizationCount: number }>(
            "/broadcasts",
            "POST",
            { organizationIds: selected, body },
          );
          setBody("");
          onSent(result);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="admin-org-checklist">
        <legend>Who should receive it?</legend>
        {organizations.map((o) => (
          <label key={o.id}>
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked
                    ? [...old, o.id]
                    : old.filter((id) => id !== o.id),
                )
              }
            />
            {o.name}
          </label>
        ))}
        {!organizations.length && <p>Join or create an organization first.</p>}
      </fieldset>
      <label>
        Announcement
        <textarea
          rows={5}
          maxLength={10000}
          value={body}
          required
          onChange={(e) => setBody(e.target.value)}
          placeholder="What would you like everyone to know?"
        />
      </label>
      <p className="muted">
        Every member of each selected organization receives this message in its
        Announcements conversation. Organizations stay separate.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !selected.length || !body.trim()}
      >
        {busy ? "Sending…" : "Send broadcast"}
      </button>
    </form>
  );
}
export function OrganizationAccess({
  org,
  onError,
  onUpdated,
}: {
  org: { id: string; name: string; role: string; join_code?: string };
  onError: (e: unknown) => void;
  onUpdated: () => Promise<void>;
}) {
  const [requests, setRequests] = useState<
      { id: string; name: string; email: string }[]
    >([]),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false);
  const admin = ["owner", "admin"].includes(org.role);
  async function refresh() {
    if (admin)
      setRequests(
        (
          await api<{ requests: typeof requests }>(
            `/orgs/${org.id}/join-requests`,
          )
        ).requests,
      );
  }
  useEffect(() => {
    void refresh().catch(onError);
  }, [org.id]);
  async function decide(id: string, approve: boolean) {
    setBusy(true);
    try {
      await api(`/orgs/${org.id}/join-requests/${id}`, "POST", { approve });
      await refresh();
      await onUpdated();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="organization-id-card">
        <span>ORGANIZATION ID</span>
        <button
          title="Copy Organization ID"
          onClick={() => {
            void navigator.clipboard.writeText(org.join_code || org.id);
            setCopied(true);
          }}
        >
          <code>{org.join_code || org.id}</code>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <p>
          People can enter this ID at signup. Their email must be verified and
          their request approved.
        </p>
      </div>
      {admin && requests.length > 0 && (
        <section className="org-join-requests">
          <h3>
            Join requests <b>{requests.length}</b>
          </h3>
          {requests.map((j) => (
            <div className="admin-request" key={j.id}>
              <span>
                <strong>{j.name}</strong>
                <small>{j.email}</small>
              </span>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void decide(j.id, true)}
              >
                Approve
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void decide(j.id, false)}
              >
                Decline
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
