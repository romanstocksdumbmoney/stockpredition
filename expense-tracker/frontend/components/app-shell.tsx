"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useAuth } from "@/components/auth-context";
import { apiFetch } from "@/lib/api";
import { initials } from "@/lib/format";

const navLinks = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/upload", label: "Upload Receipt", icon: "📸" },
  { href: "/receipts", label: "All Receipts", icon: "📋" },
  { href: "/reports", label: "Reports", icon: "📊" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const initialsText = useMemo(() => initials(user?.display_name || user?.email || "ET"), [user]);

  async function signOut() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.push("/login");
    } catch {
      setMenuOpen(false);
    }
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="logo">🧾 Expense Tracker</div>
        <nav className="sidebar-nav">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`sidebar-link ${pathname === link.href ? "active" : ""}`}
            >
              <span>{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div />
          <div className="avatar-menu">
            <button className="avatar-btn" onClick={() => setMenuOpen((prev) => !prev)}>
              {initialsText}
            </button>
            {menuOpen ? (
              <div className="menu-panel">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push("/settings");
                  }}
                >
                  Account Settings
                </button>
                <button onClick={signOut}>Sign Out</button>
              </div>
            ) : null}
          </div>
        </header>
        <section className="page-content">{children}</section>
      </main>

      <nav className="mobile-tabs">
        <Link href="/" className={pathname === "/" ? "active" : ""}>
          🏠 Home
        </Link>
        <Link href="/upload" className={pathname === "/upload" ? "active" : ""}>
          📸 Upload
        </Link>
        <Link href="/receipts" className={pathname === "/receipts" ? "active" : ""}>
          📋 Receipts
        </Link>
        <Link href="/reports" className={pathname === "/reports" ? "active" : ""}>
          📊 Reports
        </Link>
      </nav>
    </div>
  );
}
