"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(true);
  }

  return (
    <div className="auth-card">
      <h1 className="auth-logo">🧾 Expense Tracker</h1>
      <h2>Reset Password</h2>
      <form className="auth-form" onSubmit={onSubmit}>
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
        <button type="submit" className="btn-primary">
          Send Reset Link
        </button>
      </form>
      {sent ? <p className="success-text">Check your email for a reset link.</p> : null}
      <p className="auth-links">
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
