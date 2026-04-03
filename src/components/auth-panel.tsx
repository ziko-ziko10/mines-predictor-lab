"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

interface AuthPanelProps {
  title: string;
  description: string;
}

type AuthMode = "signin" | "signup";

function getFriendlyError(message: string) {
  if (message.toLowerCase().includes("invalid login credentials")) {
    return "That email and password combination was not accepted.";
  }

  if (message.toLowerCase().includes("email not confirmed")) {
    return "Your account exists, but the email address still needs confirmation before the first password login.";
  }

  return message;
}

export function AuthPanel({ title, description }: AuthPanelProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  function resetFeedback(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage(null);
    setError(null);
  }

  function validate() {
    if (!email.trim()) {
      return "Enter your email address first.";
    }

    if (!password) {
      return "Enter your password.";
    }

    if (password.length < 8) {
      return "Password must be at least 8 characters long.";
    }

    if (mode === "signup" && password !== confirmPassword) {
      return "Password confirmation does not match.";
    }

    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = validate();

    if (validationError) {
      setError(validationError);
      setMessage(null);
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (signInError) {
          setError(getFriendlyError(signInError.message));
          return;
        }

        setMessage("Signed in successfully.");
        router.refresh();
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (signUpError) {
        setError(getFriendlyError(signUpError.message));
        return;
      }

      if (data.session) {
        setMessage("Account created and signed in successfully.");
        router.refresh();
        return;
      }

      setConfirmPassword("");
      setMode("signin");
      setMessage("Account created. If email confirmation is enabled in Supabase, verify the email first, then sign in with your password.");
    });
  }

  return (
    <div className="page-stack">
      <section className="auth-shell">
        <article className="card auth-showcase">
          <div className="auth-showcase-copy">
            <p className="eyebrow">Private Workspace</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>

          <div className="auth-showcase-grid">
            <div className="showcase-stat">
              <strong>Password protected</strong>
              <small>Every prediction, heatmap, and loss log stays behind account-required access.</small>
            </div>
            <div className="showcase-stat">
              <strong>User-owned datasets</strong>
              <small>Rounds are linked to the signed-in Supabase user, not mixed into a shared pool.</small>
            </div>
            <div className="showcase-stat">
              <strong>Built for daily use</strong>
              <small>Fast prediction flow, compact boards, and history views tuned for repeated sessions.</small>
            </div>
          </div>
        </article>

        <article className="card auth-form-card">
          <div className="auth-mode-row">
            <button
              type="button"
              className={mode === "signin" ? "segment is-active" : "segment"}
              onClick={() => resetFeedback("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "segment is-active" : "segment"}
              onClick={() => resetFeedback("signup")}
            >
              Create account
            </button>
          </div>

          <div className="auth-form-header">
            <h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p>
              {mode === "signin"
                ? "Use your email and password to open your private predictor workspace."
                : "Create a password-protected account. If email confirmation is enabled in Supabase, verify first before the first login."}
            </p>
          </div>

          <form className="auth-form-stack" onSubmit={handleSubmit}>
            <label>
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>

            <label>
              <span>Password</span>
              <div className="input-with-action">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
                <button type="button" className="inline-action" onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            {mode === "signup" ? (
              <label>
                <span>Confirm password</span>
                <div className="input-with-action">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat your password"
                  />
                  <button
                    type="button"
                    className="inline-action"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                  >
                    {showConfirmPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
            ) : null}

            <div className="auth-password-rule">
              <strong>Password rule</strong>
              <small>Use at least 8 characters. A longer password is better for account safety.</small>
            </div>

            <div className="button-row auth-actions-row">
              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting
                  ? mode === "signin"
                    ? "Signing in..."
                    : "Creating account..."
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </button>
            </div>
          </form>

          {message ? <p className="success-text notice-banner success-banner">{message}</p> : null}
          {error ? <p className="error-text notice-banner error-banner">{error}</p> : null}
        </article>
      </section>
    </div>
  );
}
