"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-context";
import { apiFetch } from "@/lib/api";
import { initials } from "@/lib/format";
import type { Category } from "@/lib/types";

const ICONS = ["📦", "🍽️", "🚗", "✈️", "🏨", "💻", "📣", "💡", "🎬", "🩺", "🧰", "📎"];
const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#84cc16", "#ec4899", "#64748b", "#3b82f6"];

type Preferences = {
  defaultFormat: "PDF" | "CSV";
  includeImages: boolean;
  currency: string;
  weeklyEmail: boolean;
  monthlyEmail: boolean;
  sendOn: string;
  sendTime: string;
};

const PREFS_KEY = "expense-tracker-preferences";

export default function SettingsPage() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [editingName, setEditingName] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState(ICONS[0]);
  const [newCategoryColor, setNewCategoryColor] = useState(COLORS[0]);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [dangerPassword, setDangerPassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>({
    defaultFormat: "PDF",
    includeImages: true,
    currency: "USD",
    weeklyEmail: false,
    monthlyEmail: false,
    sendOn: "Monday",
    sendTime: "09:00",
  });

  const avatarText = useMemo(() => initials(displayName || user?.email || "ET"), [displayName, user?.email]);

  async function loadCategories() {
    const response = await apiFetch<{ categories: Category[] }>("/api/categories");
    setCategories(response.categories || []);
  }

  useEffect(() => {
    void loadCategories();
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(PREFS_KEY);
    if (saved) {
      try {
        setPreferences(JSON.parse(saved) as Preferences);
      } catch {
        setPreferences((prev) => prev);
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
  }, [preferences]);

  async function saveDisplayName() {
    const response = await apiFetch<{ user: { id: string; email: string; display_name: string | null } }>("/api/auth/profile", {
      method: "PATCH",
      body: { display_name: displayName },
    });
    setUser(response.user);
    setEditingName(false);
    setMessage("Display name updated.");
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordForm.next !== passwordForm.confirm) {
      setMessage("New password and confirmation do not match.");
      return;
    }
    await apiFetch("/api/auth/change-password", {
      method: "POST",
      body: { current_password: passwordForm.current, new_password: passwordForm.next },
    });
    setPasswordForm({ current: "", next: "", confirm: "" });
    setMessage("Password updated.");
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiFetch("/api/categories", {
      method: "POST",
      body: { name: newCategoryName, icon: newCategoryIcon, color: newCategoryColor },
    });
    setNewCategoryName("");
    setShowAddCategory(false);
    setMessage("Category created.");
    await loadCategories();
  }

  async function editCategory(category: Category) {
    const name = window.prompt("Edit category name", category.name);
    if (!name) return;
    await apiFetch(`/api/categories/${category.id}`, {
      method: "PATCH",
      body: { name, icon: category.icon, color: category.color },
    });
    setMessage("Category updated.");
    await loadCategories();
  }

  async function deleteCategory(category: Category) {
    await apiFetch(`/api/categories/${category.id}`, { method: "DELETE" });
    setMessage("Category deleted and related receipts moved to Other.");
    await loadCategories();
  }

  async function deleteAllReceipts() {
    if (deleteConfirm !== "DELETE") {
      setMessage('Type DELETE to confirm deleting all receipts.');
      return;
    }
    await apiFetch("/api/receipts", { method: "DELETE" });
    setDeleteConfirm("");
    setMessage("All receipts deleted.");
  }

  async function deleteAccount() {
    if (!dangerPassword) {
      setMessage("Enter your password to delete your account.");
      return;
    }
    await apiFetch("/api/auth/delete-account", { method: "POST", body: { password: dangerPassword } });
    setUser(null);
    router.push("/login");
  }

  return (
    <div className="stack gap-24">
      <h1>Settings</h1>
      {message ? <div className="success-banner">{message}</div> : null}

      <section className="card">
        <h2>Account</h2>
        <div className="profile-row">
          <div className="avatar-large">{avatarText}</div>
          <div className="stack gap-8" style={{ flex: 1 }}>
            <label>
              Display name
              {editingName ? (
                <div className="row gap-8">
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                  <button className="btn-primary" onClick={() => void saveDisplayName()}>
                    Save
                  </button>
                  <button className="btn-outline" onClick={() => setEditingName(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="row gap-8">
                  <input value={displayName} readOnly />
                  <button className="btn-outline" onClick={() => setEditingName(true)}>
                    Edit
                  </button>
                </div>
              )}
            </label>
            <label>
              Email
              <input value={user?.email || ""} readOnly />
            </label>
          </div>
        </div>

        <form className="stack gap-8" onSubmit={changePassword}>
          <h3>Change Password</h3>
          <input
            type="password"
            placeholder="Current password"
            value={passwordForm.current}
            onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })}
            required
          />
          <input
            type="password"
            placeholder="New password"
            value={passwordForm.next}
            onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })}
            required
          />
          <PasswordStrength password={passwordForm.next} />
          <input
            type="password"
            placeholder="Confirm password"
            value={passwordForm.confirm}
            onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })}
            required
          />
          <button className="btn-primary">Update Password</button>
        </form>
      </section>

      <section className="card">
        <div className="row space-between">
          <h2>Categories</h2>
          <button className="btn-outline" onClick={() => setShowAddCategory((prev) => !prev)}>
            + Add Custom Category
          </button>
        </div>
        <div className="stack gap-8">
          {categories.map((category) => (
            <div key={category.id} className="category-row">
              <span className="dot" style={{ background: category.color }} />
              <span>{category.icon}</span>
              <span>{category.name}</span>
              <div className="row gap-8" style={{ marginLeft: "auto" }}>
                {category.is_default ? (
                  <span className="muted">🔒</span>
                ) : (
                  <>
                    <button className="text-link" onClick={() => void editCategory(category)}>
                      Edit
                    </button>
                    <button className="text-link danger" onClick={() => void deleteCategory(category)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {showAddCategory ? (
          <form className="stack gap-8 category-form" onSubmit={addCategory}>
            <input
              placeholder="Category name"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              required
            />
            <div className="emoji-grid">
              {ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={newCategoryIcon === icon ? "active" : ""}
                  onClick={() => setNewCategoryIcon(icon)}
                >
                  {icon}
                </button>
              ))}
            </div>
            <div className="swatch-row">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch ${newCategoryColor === color ? "active" : ""}`}
                  style={{ background: color }}
                  onClick={() => setNewCategoryColor(color)}
                />
              ))}
            </div>
            <div className="row gap-8">
              <button className="btn-primary" type="submit">
                Save
              </button>
              <button className="btn-outline" type="button" onClick={() => setShowAddCategory(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="card">
        <h2>Export Preferences</h2>
        <div className="row gap-12 wrap">
          <button
            className={preferences.defaultFormat === "PDF" ? "btn-primary" : "btn-outline"}
            onClick={() => setPreferences({ ...preferences, defaultFormat: "PDF" })}
          >
            PDF
          </button>
          <button
            className={preferences.defaultFormat === "CSV" ? "btn-primary" : "btn-outline"}
            onClick={() => setPreferences({ ...preferences, defaultFormat: "CSV" })}
          >
            CSV
          </button>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={preferences.includeImages}
            onChange={(event) => setPreferences({ ...preferences, includeImages: event.target.checked })}
          />
          Include images in PDF
        </label>
        <label>
          Currency
          <select
            value={preferences.currency}
            onChange={(event) => setPreferences({ ...preferences, currency: event.target.value })}
          >
            <option>USD</option>
            <option>EUR</option>
            <option>GBP</option>
            <option>CAD</option>
            <option>AUD</option>
          </select>
        </label>
      </section>

      <section className="card">
        <h2>Email Reports</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={preferences.weeklyEmail}
            onChange={(event) => setPreferences({ ...preferences, weeklyEmail: event.target.checked })}
          />
          Weekly report email
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={preferences.monthlyEmail}
            onChange={(event) => setPreferences({ ...preferences, monthlyEmail: event.target.checked })}
          />
          Monthly report email
        </label>
        <div className="row gap-8">
          <label>
            Send on
            <select value={preferences.sendOn} onChange={(event) => setPreferences({ ...preferences, sendOn: event.target.value })}>
              <option>Monday</option>
              <option>Tuesday</option>
              <option>Wednesday</option>
              <option>Thursday</option>
              <option>Friday</option>
              <option>Saturday</option>
              <option>Sunday</option>
            </select>
          </label>
          <label>
            Time
            <input
              type="time"
              value={preferences.sendTime}
              onChange={(event) => setPreferences({ ...preferences, sendTime: event.target.value })}
            />
          </label>
        </div>
      </section>

      <section className="card danger-zone">
        <h2>Danger Zone</h2>
        <div className="stack gap-12">
          <label>
            Type DELETE to confirm
            <input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} />
          </label>
          <button className="btn-danger" onClick={() => void deleteAllReceipts()}>
            Delete All Receipts
          </button>
          <label>
            Enter password to delete account
            <input
              type="password"
              value={dangerPassword}
              onChange={(event) => setDangerPassword(event.target.value)}
            />
          </label>
          <button className="btn-danger" onClick={() => void deleteAccount()}>
            Delete My Account
          </button>
        </div>
      </section>
    </div>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const score = useMemo(() => {
    let value = 0;
    if (password.length >= 8) value += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) value += 1;
    if (/\d/.test(password)) value += 1;
    if (/[^A-Za-z0-9]/.test(password)) value += 1;
    if (password.length >= 12) value += 1;
    return value;
  }, [password]);
  const level = score <= 2 ? "weak" : score <= 4 ? "medium" : "strong";
  const label = level === "weak" ? "Weak" : level === "medium" ? "Medium" : "Strong";
  return (
    <div className={`strength-meter ${level}`}>
      <span>{label}</span>
      <div className="meter-track">
        <div style={{ width: `${Math.max(score, 1) * 20}%` }} />
      </div>
    </div>
  );
}
