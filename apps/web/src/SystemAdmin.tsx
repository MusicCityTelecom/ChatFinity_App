import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Shield,
  Users,
  Building2,
  Mail,
  KeyRound,
  Settings,
  X,
  Plus,
  Check,
  RefreshCw,
  Megaphone,
  Activity,
  Copy,
  ExternalLink,
} from "lucide-react";
import { api, type User } from "./api";
import { BroadcastComposer } from "./WorkspaceTools";
interface AdminUser extends User {
  disabled_at: string | null;
  organizations: { id: string; name: string; role: string }[];
  created_at: string;
}
interface AdminOrg {
  id: string;
  name: string;
  join_code: string;
  allow_join_requests: boolean;
  member_count: number;
  channel_count: number;
}
export function SystemAdmin({
  me,
  onClose,
  onOpenOrg,
  onProfileChanged,
}: {
  me: User;
  onClose: () => void;
  onOpenOrg: (id: string) => Promise<void>;
  onProfileChanged: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [tab, setTab] = useState("overview"),
    [users, setUsers] = useState<AdminUser[]>([]),
    [orgs, setOrgs] = useState<AdminOrg[]>([]),
    [requests, setRequests] = useState<Record<string, any>[]>([]),
    [audit, setAudit] = useState<Record<string, any>[]>([]),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [settings, setSettings] = useState({
      registration_open: true,
      default_org_creation: true,
    }),
    [selected, setSelected] = useState<AdminUser | null>(null),
    [filter, setFilter] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [creating, setCreating] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    void refresh();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    if (selected)
      dialog.current
        ?.querySelector(".admin-editor")
        ?.scrollIntoView({ block: "start" });
  }, [selected?.id]);
  async function refresh() {
    try {
      const [overview, people, organizations, pending, events] =
        await Promise.all([
          api<{ counts: typeof counts; settings: typeof settings }>(
            "/admin/overview",
          ),
          api<{ users: AdminUser[] }>("/admin/users"),
          api<{ organizations: AdminOrg[] }>("/admin/orgs"),
          api<{ requests: typeof requests }>("/admin/join-requests"),
          api<{ events: typeof audit }>("/admin/audit"),
        ]);
      setCounts(overview.counts);
      setSettings(overview.settings);
      setUsers(people.users);
      setOrgs(organizations.organizations);
      setRequests(pending.requests);
      setAudit(events.events);
      setSelected((old) =>
        old ? people.users.find((u) => u.id === old.id) || null : null,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const choose = (value: string) => {
    setTab(value);
    setSelected(null);
    setCreating(false);
    setError("");
    setNotice("");
  };
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await run(async () => {
      const memberships = f
        .getAll("organizations")
        .map((orgId) => ({ orgId, role: String(f.get("role") || "member") }));
      await api("/admin/users", "POST", {
        email: f.get("email"),
        name: f.get("name"),
        canCreateOrg: f.get("canCreateOrg") === "on",
        systemAdmin: f.get("systemAdmin") === "on",
        memberships,
      });
      setCreating(false);
      setNotice(
        "User created. Their password setup link is queued for delivery.",
      );
    });
  }
  return (
    <dialog ref={dialog} className="system-admin" onCancel={onClose}>
      <header className="admin-heading">
        <span className="admin-brand">
          <Shield size={22} />
          <div>
            <strong>System administration</strong>
            <small>ChatFinity · {me.email}</small>
          </div>
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Refresh administration"
            onClick={() => void refresh()}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Close system administration"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
      </header>
      <div className="admin-layout">
        <nav aria-label="System administration sections">
          {[
            ["overview", "Overview", <Activity size={17} />],
            ["users", "Users", <Users size={17} />],
            ["organizations", "Organizations", <Building2 size={17} />],
            ["requests", "Join requests", <Mail size={17} />],
            ["broadcast", "Broadcast", <Megaphone size={17} />],
            ["settings", "System settings", <Settings size={17} />],
            ["audit", "Activity log", <Shield size={17} />],
          ].map(([key, label, icon]) => (
            <button
              key={String(key)}
              className={tab === key ? "selected" : ""}
              onClick={() => choose(String(key))}
            >
              {icon}
              <span>{label}</span>
              {key === "requests" && requests.length > 0 && (
                <b>{requests.length}</b>
              )}
            </button>
          ))}
        </nav>
        <main className="admin-content">
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="form-notice" role="status">
              {notice}
            </div>
          )}
          {tab === "overview" && (
            <>
              <span className="eyebrow">YOUR SYSTEM, AT A GLANCE</span>
              <h1>Everything in one place.</h1>
              <p>
                Manage accounts and access across every organization.
                Organization owners manage their own people and conversations.
              </p>
              <div className="admin-stats">
                {Object.entries(counts).map(([key, value]) => (
                  <div key={key}>
                    <strong>{value}</strong>
                    <span>{key.replace("_", " ")}</span>
                  </div>
                ))}
              </div>
              <div className="admin-callouts">
                <button
                  onClick={() => {
                    choose("users");
                    setCreating(true);
                  }}
                >
                  <Users />
                  <strong>Add someone</strong>
                  <span>Create an account and assign access.</span>
                </button>
                <button onClick={() => choose("requests")}>
                  <Mail />
                  <strong>Review join requests</strong>
                  <span>Approve verified people requesting access.</span>
                </button>
                <button onClick={() => choose("broadcast")}>
                  <Megaphone />
                  <strong>Keep everyone informed</strong>
                  <span>
                    Send a persistent announcement to selected organizations.
                  </span>
                </button>
              </div>
            </>
          )}
          {tab === "users" && (
            <>
              <div className="admin-section-heading">
                <div>
                  <h1>People and permissions</h1>
                  <p>
                    Accounts, password resets, system roles and organization
                    access.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setCreating(!creating);
                    setSelected(null);
                  }}
                >
                  <Plus size={16} /> Add user
                </button>
              </div>
              {creating && (
                <form className="admin-editor" onSubmit={create}>
                  <h2>Create an account</h2>
                  <div className="admin-form-grid">
                    <label>
                      Name
                      <input name="name" required maxLength={100} />
                    </label>
                    <label>
                      Email
                      <input name="email" type="email" required />
                    </label>
                  </div>
                  <label className="checkbox-label">
                    <input name="canCreateOrg" type="checkbox" defaultChecked />{" "}
                    Allow this user to create organizations
                  </label>
                  <label className="checkbox-label">
                    <input name="systemAdmin" type="checkbox" /> System
                    administrator — can manage all accounts and organizations
                  </label>
                  <fieldset className="admin-org-checklist">
                    <legend>Assign to organizations</legend>
                    {orgs.map((o) => (
                      <label key={o.id}>
                        <input
                          type="checkbox"
                          name="organizations"
                          value={o.id}
                        />
                        {o.name}
                      </label>
                    ))}
                    {!orgs.length && (
                      <p>Create an organization from the workspace first.</p>
                    )}
                  </fieldset>
                  <label>
                    Role in the selected organizations
                    <select name="role">
                      <option value="member">Member</option>
                      <option value="admin">Organization admin</option>
                      <option value="owner">Organization owner</option>
                    </select>
                  </label>
                  <p className="muted">
                    The user receives a one-time setup link to choose their own
                    password.
                  </p>
                  <button className="primary" disabled={busy}>
                    Create and send setup link
                  </button>
                </form>
              )}
              <label className="admin-search">
                <span>Find a person</span>
                <input
                  type="search"
                  placeholder="Search name or email…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>System access</th>
                      <th>Organizations</th>
                      <th>Account</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {users
                      .filter((u) =>
                        (u.name + " " + u.email)
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((u) => (
                        <tr key={u.id}>
                          <td>
                            <strong>{u.name}</strong>
                            <small>{u.email}</small>
                          </td>
                          <td>
                            {u.is_system_admin
                              ? "System admin"
                              : u.can_create_org
                                ? "Can create organizations"
                                : "Participant"}
                          </td>
                          <td>
                            {u.organizations.map((o) => o.name).join(", ") ||
                              "No assignments"}
                          </td>
                          <td>
                            {u.disabled_at
                              ? "Disabled"
                              : u.verified_at
                                ? "Active"
                                : "Email unverified"}
                          </td>
                          <td>
                            <button
                              className="secondary"
                              onClick={() => {
                                setSelected(u);
                                setCreating(false);
                              }}
                            >
                              Manage
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {selected && (
                <section className="admin-editor" key={selected.id}>
                  <div className="admin-section-heading">
                    <h2>{selected.name}</h2>
                    <button
                      className="icon-button"
                      aria-label="Close user management"
                      onClick={() => setSelected(null)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(async () => {
                        await api(`/admin/users/${selected.id}`, "PATCH", {
                          name: f.get("name"),
                          canCreateOrg: f.get("canCreateOrg") === "on",
                          systemAdmin: f.get("systemAdmin") === "on",
                          disabled: f.get("disabled") === "on",
                          verified: f.get("verified") === "on",
                        });
                        if (selected.id === me.id) await onProfileChanged();
                        setNotice("User account updated.");
                      });
                    }}
                  >
                    <label>
                      Name
                      <input
                        name="name"
                        defaultValue={selected.name}
                        required
                      />
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        name="canCreateOrg"
                        defaultChecked={selected.can_create_org}
                      />{" "}
                      Can create organizations
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        name="systemAdmin"
                        defaultChecked={selected.is_system_admin}
                      />{" "}
                      System administrator
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        name="verified"
                        defaultChecked={!!selected.verified_at}
                      />{" "}
                      Email verified by administrator
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        name="disabled"
                        defaultChecked={!!selected.disabled_at}
                      />{" "}
                      Disable account and revoke its sessions
                    </label>
                    <button className="primary" disabled={busy}>
                      Save account
                    </button>
                  </form>
                  <div className="modal-divider" />
                  <h3>Organization assignments</h3>
                  {selected.organizations.map((o) => (
                    <div className="admin-assignment" key={o.id}>
                      <span>
                        <strong>{o.name}</strong>
                        <small>{o.role}</small>
                      </span>
                      <button
                        className="text-button danger-text"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(
                              `/admin/users/${selected.id}/memberships/${o.id}`,
                              "DELETE",
                            );
                            setNotice("Organization access removed.");
                          })
                        }
                      >
                        Remove access
                      </button>
                    </div>
                  ))}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget),
                        memberships = f
                          .getAll("orgs")
                          .map((orgId) => ({ orgId, role: f.get("role") }));
                      if (!memberships.length) {
                        setError("Select at least one organization.");
                        return;
                      }
                      void run(async () => {
                        await api(
                          `/admin/users/${selected.id}/memberships`,
                          "POST",
                          { memberships },
                        );
                        setNotice("Organization assignments updated.");
                      });
                    }}
                  >
                    <fieldset className="admin-org-checklist">
                      <legend>Add or update access</legend>
                      {orgs.map((o) => (
                        <label key={o.id}>
                          <input type="checkbox" name="orgs" value={o.id} />
                          {o.name}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      Role
                      <select name="role">
                        <option value="member">Member</option>
                        <option value="admin">Organization admin</option>
                        <option value="owner">Organization owner</option>
                      </select>
                    </label>
                    <button className="secondary" disabled={busy}>
                      Assign selected organizations
                    </button>
                  </form>
                  <div className="modal-divider" />
                  <h3>
                    <KeyRound size={17} /> Password controls
                  </h3>
                  <p className="muted">
                    A reset signs the user out. A temporary password must be
                    changed after their next sign-in.
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await api<{ message: string }>(
                          `/admin/users/${selected.id}/password-reset`,
                          "POST",
                          {},
                        );
                        setNotice(r.message);
                      })
                    }
                  >
                    Email password reset link
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget),
                        form = e.currentTarget;
                      void run(async () => {
                        await api(
                          `/admin/users/${selected.id}/password-reset`,
                          "POST",
                          { temporaryPassword: f.get("password") },
                        );
                        form.reset();
                        setNotice(
                          "Temporary password set. Share it securely with the user.",
                        );
                      });
                    }}
                  >
                    <label>
                      Set a temporary password
                      <input
                        name="password"
                        type="password"
                        minLength={12}
                        maxLength={200}
                        autoComplete="new-password"
                        required
                      />
                    </label>
                    <button className="secondary" disabled={busy}>
                      Set temporary password
                    </button>
                  </form>
                </section>
              )}
            </>
          )}
          {tab === "organizations" && (
            <>
              <h1>Organizations</h1>
              <p>
                Share the Organization ID with people who should request access.
                Requests need verified email and approval.
              </p>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Organization</th>
                      <th>People</th>
                      <th>Join requests</th>
                      <th>Administration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.name}</strong>
                          <button
                            className="copy-org-id"
                            title="Copy Organization ID"
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                o.join_code || o.id,
                              );
                              setNotice("Organization ID copied.");
                            }}
                          >
                            <code>{o.join_code || o.id}</code>
                            <Copy size={13} />
                          </button>
                        </td>
                        <td>{o.member_count}</td>
                        <td>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={o.allow_join_requests}
                              onChange={(e) =>
                                void run(() =>
                                  api(`/admin/orgs/${o.id}`, "PATCH", {
                                    allowJoinRequests: e.target.checked,
                                  }),
                                )
                              }
                            />{" "}
                            Accept requests
                          </label>
                        </td>
                        <td>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api(
                                  `/admin/orgs/${o.id}/join`,
                                  "POST",
                                  {},
                                );
                                await onOpenOrg(o.id);
                                onClose();
                              })
                            }
                          >
                            <ExternalLink size={14} /> Open as owner
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Opening as owner records your administrative access and adds you
                to that organization.
              </p>
            </>
          )}
          {tab === "requests" && (
            <>
              <h1>Membership requests</h1>
              <p>Only requests from verified email accounts appear here.</p>
              {requests.map((j) => (
                <div className="admin-request" key={j.id}>
                  <span>
                    <strong>{j.name}</strong>
                    <small>
                      {j.email} → {j.organization_name}
                    </small>
                  </span>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/admin/join-requests/${j.id}`, "POST", {
                          approve: true,
                        }),
                      )
                    }
                  >
                    Approve
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/admin/join-requests/${j.id}`, "POST", {
                          approve: false,
                        }),
                      )
                    }
                  >
                    Decline
                  </button>
                </div>
              ))}
              {!requests.length && (
                <p className="form-notice">No pending verified requests.</p>
              )}
            </>
          )}
          {tab === "broadcast" && (
            <>
              <h1>Send an organization broadcast</h1>
              <p>
                Reach every member of one or more organizations. Each
                organization receives its own announcement.
              </p>
              <BroadcastComposer
                organizations={orgs}
                onSent={(r) => {
                  setNotice(
                    `Broadcast delivered to ${r.organizationCount} organization(s).`,
                  );
                  void refresh();
                }}
              />
            </>
          )}
          {tab === "settings" && (
            <>
              <h1>System settings</h1>
              <form
                className="admin-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api("/admin/settings", "PATCH", {
                      registrationOpen: settings.registration_open,
                      defaultOrgCreation: settings.default_org_creation,
                    });
                    setNotice("System settings saved.");
                  });
                }}
              >
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.registration_open}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        registration_open: e.target.checked,
                      })
                    }
                  />{" "}
                  Allow public email signup and Organization ID requests
                </label>
                <p className="muted">
                  When disabled, people need an email invitation or an account
                  created by a system administrator.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.default_org_creation}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        default_org_creation: e.target.checked,
                      })
                    }
                  />{" "}
                  New independent accounts can create organizations
                </label>
                <p className="muted">
                  Accounts signing up with an Organization ID request
                  participant access. You can grant organization-creation
                  permission individually.
                </p>
                <button className="primary" disabled={busy}>
                  Save system settings
                </button>
              </form>
            </>
          )}
          {tab === "audit" && (
            <>
              <h1>System activity</h1>
              <div className="audit-list">
                {audit.map((a) => (
                  <div key={a.id}>
                    <Shield size={16} />
                    <span>
                      <strong>{a.action.replaceAll(".", " · ")}</strong>
                      <small>
                        {a.actor_name || "System"} ·{" "}
                        {new Date(a.created_at).toLocaleString()}
                      </small>
                      <code>{JSON.stringify(a.detail)}</code>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </dialog>
  );
}
