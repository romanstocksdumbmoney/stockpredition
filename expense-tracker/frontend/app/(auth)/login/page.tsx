"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-context";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const showLocalBanner = useMemo(() => appUrl.includes("localhost"), [appUrl]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await apiFetch<{ success: boolean; user: User }>("/api/auth/login", {
        method: "POST",
        body: { email, password, remember_me: rememberMe },
      });
      setUser(response.user);
      router.push("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      {showLocalBanner ? (
        <div className="info-banner">🚀 Running locally — access this app at http://localhost:3000</div>
      ) : null}
      <h1 className="auth-logo">🧾 Expense Tracker</h1>
      <h2>Sign In</h2>
      <form onSubmit={onSubmit} className="auth-form">
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
          />
        </label>
        <label>
          Password
          <div className="password-row">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
            <button type="button" className="plain-btn" onClick={() => setShowPassword((prev) => !prev)}>
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
          Remember me
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign In"}
        </button>
      </form>
      <div className="auth-links">
        <Link href="/forgot-password">Forgot password?</Link>
        <p>
          Don&apos;t have an account? <Link href="/register">Sign up →</Link>
        </p>
      </div>
    </div>
  );
}
