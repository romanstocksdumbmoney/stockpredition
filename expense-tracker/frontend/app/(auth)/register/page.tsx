"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-context";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

function strength(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  return score;
}

export default function RegisterPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordStrength = useMemo(() => strength(password), [password]);
  const strengthLabel = passwordStrength <= 2 ? "Weak" : passwordStrength <= 4 ? "Medium" : "Strong";
  const strengthClass = passwordStrength <= 2 ? "weak" : passwordStrength <= 4 ? "medium" : "strong";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (passwordStrength <= 2) {
      setError("Please choose a stronger password.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch<{ success: boolean; user: User }>("/api/auth/register", {
        method: "POST",
        body: { display_name: displayName, email, password },
      });
      setUser(response.user);
      router.push("/upload?welcome=true");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <h1 className="auth-logo">🧾 Expense Tracker</h1>
      <h2>Create Account</h2>
      <form onSubmit={onSubmit} className="auth-form">
        <label>
          Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <div className={`strength-meter ${strengthClass}`}>
          <span>{strengthLabel}</span>
          <div className="meter-track">
            <div style={{ width: `${Math.max(passwordStrength, 1) * 20}%` }} />
          </div>
        </div>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Create Account"}
        </button>
      </form>
      <p className="auth-links">
        Already have an account? <Link href="/login">Sign in →</Link>
      </p>
    </div>
  );
}
