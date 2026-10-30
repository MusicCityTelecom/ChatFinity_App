import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
  Video,
  Users,
  ArrowLeft,
} from "lucide-react";
import { api, type User } from "./api";
export function Auth({
  onLogin,
  registration,
  invite,
}: {
  onLogin: (u: User) => void;
  registration: boolean;
  invite: string;
}) {
  const params = new URLSearchParams(location.search),
    verify = params.get("verify"),
    reset = params.get("reset");
  const [mode, setMode] = useState(
      verify ? "verify" : reset ? "reset" : "login",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === "login") {
        const result = await api<{ user: User }>("/auth/login", "POST", data);
        onLogin(result.user);
      }
      if (mode === "signup") {
        await api("/auth/signup", "POST", {
          ...data,
          organizationId: data.organizationId || undefined,
          ...(invite ? { invite } : {}),
        });
        setNotice(
          "Your account is ready. Check your email to verify it, then sign in.",
        );
        setMode("login");
      }
      if (mode === "forgot") {
        const r = await api<{ message: string }>("/auth/forgot", "POST", data);
        setNotice(r.message);
      }
      if (mode === "verify") {
        await api("/auth/verify", "POST", { token: verify });
        history.replaceState({}, "", "/");
        setMode("login");
        setNotice("Email verified. You’re ready to sign in.");
      }
      if (mode === "reset") {
        await api("/auth/reset", "POST", {
          token: reset,
          password: data.password,
        });
        history.replaceState({}, "", "/");
        setMode("login");
        setNotice("Password updated. Sign in with your new password.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const heading = {
    login: "Good to have you here.",
    signup: "Your next great conversation.",
    forgot: "Let’s get you back in.",
    verify: "One click. You’re in.",
    reset: "A fresh start.",
  }[mode];
  return (
    <main className="auth">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            <MessageCircle />
          </span>
          ChatFinity<span className="brand-dot">.</span>
        </a>
        <div className="auth-pitch">
          <span className="eyebrow">LESS DISTANCE. MORE CONNECTION.</span>
          <h1>
            A little closer,
            <br />
            wherever
            <br />
            you are<span>.</span>
          </h1>
          <p>
            Your people. Your conversations. Your next big idea. One space to
            bring it all together.
          </p>
          <div className="feature-row">
            <span>
              <MessageCircle size={17} /> Thoughtful chat
            </span>
            <span>
              <Video size={17} /> Face-to-face
            </span>
            <span>
              <Users size={17} /> Your communities
            </span>
          </div>
        </div>
        <div className="auth-footer">
          <span className="online-dot" /> A space for every team, club, and
          community.
        </div>
        <div className="orb orb-one" />
        <div className="orb orb-two" />
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <div className="auth-kicker">
            <ShieldCheck size={16} /> YOUR CONNECTION STARTS HERE
          </div>
          <h2>{heading}</h2>
          <p>
            {invite
              ? "You have an invitation. Sign in or create an account with the email it was sent to."
              : mode === "login"
                ? "Sign in to your ChatFinity account."
                : mode === "verify"
                  ? "Confirm your email to unlock your organizations."
                  : "A shared space starts with you."}
          </p>
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            {!["verify", "reset"].includes(mode) && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                />
              </label>
            )}
            {["login", "signup", "reset"].includes(mode) && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={mode === "login" ? undefined : 12}
                  maxLength={200}
                  required
                  placeholder={
                    mode === "login"
                      ? "Your password"
                      : "At least 12 characters"
                  }
                />
              </label>
            )}
            {mode === "signup" && !invite && (
              <label>
                Organization ID (optional)
                <input
                  name="organizationId"
                  maxLength={80}
                  placeholder="CF-…"
                />
                <small className="muted">
                  Have an ID? Enter it to request access after email
                  verification. Leave blank to start your own organization.
                </small>
              </label>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="form-notice" role="status">
                <CheckCircle2 size={18} />
                {notice}
              </div>
            )}
            <button className="primary wide" disabled={busy}>
              {busy
                ? "One moment…"
                : mode === "login"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Send reset link"
                      : mode === "verify"
                        ? "Verify my email"
                        : "Update password"}
              <ArrowRight size={18} />
            </button>
          </form>
          {mode === "login" ? (
            <>
              <button
                className="text-button"
                onClick={() => {
                  setMode("forgot");
                  setError("");
                }}
              >
                Forgot your password?
              </button>
              {(registration || invite) && (
                <p className="auth-switch">
                  New here?{" "}
                  <button
                    onClick={() => {
                      setMode("signup");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Create an account
                  </button>
                </p>
              )}
            </>
          ) : (
            <button
              className="text-button"
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              <ArrowLeft size={15} /> Back to sign in
            </button>
          )}
          <small className="auth-fine">
            One account. All your organizations.
            <br />
            Your conversations stay within the people and spaces you choose.
          </small>
        </div>
      </section>
    </main>
  );
}
