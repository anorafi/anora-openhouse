import { useEffect, useRef, useState } from "react";
import type { Page, Role } from "../App";
import { useDemo, ORIGINATOR_ACTION } from "../state/demo";

type IconName = "markets" | "portfolio" | "activity" | "facilities" | "open" | "chevron";

/** 13px glyphs on a 14px box, matching the stroke weight used elsewhere. */
function Icon({ name }: { name: IconName }) {
  switch (name) {
    case "markets":
      return <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2.5 11V7M7 11V3.5M11.5 11V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M1.5 12.75h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>;
    case "portfolio":
      return <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.1" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 2v5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>;
    case "activity":
      return <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M1 7.5h3l2-4 2.5 7 1.7-3H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>;
    case "facilities":
      return <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="1.7" y="1.7" width="10.6" height="4" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
        <rect x="1.7" y="8.3" width="10.6" height="4" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
      </svg>;
    case "chevron":
      return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>;
    case "open":
      return <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="1.7" y="1.7" width="10.6" height="10.6" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 4.6v4.8M4.6 7h4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>;
  }
}

const NAV: Record<Role, Array<{ page: Page; label: string; icon: IconName }>> = {
  investor: [
    { page: "markets", label: "Markets", icon: "markets" },
    { page: "portfolio", label: "Portfolio", icon: "portfolio" },
    { page: "activity", label: "Activity", icon: "activity" },
  ],
  originator: [
    { page: "facilities", label: "My facilities", icon: "facilities" },
    { page: "open-facility", label: "Open a facility", icon: "open" },
    { page: "activity", label: "Activity", icon: "activity" },
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  investor: "Capital provider",
  originator: "Originator",
};

const ROLES: Role[] = ["investor", "originator"];

export function Sidebar({
  role,
  page,
  onRole,
  onNavigate,
  onHome,
}: {
  role: Role;
  page: Page;
  onRole: (role: Role) => void;
  onNavigate: (page: Page) => void;
  onHome: () => void;
}) {
  const { facilities } = useDemo();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Same dismissal behaviour as the network menu in the header.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  // Dot the role that actually has a pending step, so the demo says when to
  // switch instead of leaving you to work it out.
  const waiting: Record<Role, boolean> = {
    originator: facilities.some((facility) => ORIGINATOR_ACTION[facility.stage] !== null),
    investor: facilities.some((facility) => facility.stage === "open" || facility.stage === "repaid" || facility.stage === "recovered"),
  };

  return (
    <aside className="sidebar">
      <button className="brand-name sidebar-brand" onClick={onHome} aria-label="Anora — back to front page">
        Anora
      </button>

      <div className="workspace">
        <span className="side-label">Workspace</span>
        <div className="workspace-current"><strong>{ROLE_LABEL[role]}</strong></div>
      </div>

      <nav className="side-nav" aria-label="Primary navigation">
        {NAV[role].map((item) => (
          <button
            key={item.page}
            className={page === item.page ? "active" : ""}
            onClick={() => onNavigate(item.page)}
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="role-select" ref={menuRef}>
        <button
          type="button"
          className="role-trigger"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Switch role
          {waiting[role === "investor" ? "originator" : "investor"] && <i className="role-dot" aria-label="Action waiting" />}
          <span className="chev"><Icon name="chevron" /></span>
        </button>
        {menuOpen && (
          <div className="role-menu" role="menu">
            {ROLES.map((item) => (
              <button
                key={item}
                role="menuitemradio"
                aria-checked={role === item}
                className={role === item ? "active" : ""}
                onClick={() => { onRole(item); setMenuOpen(false); }}
              >
                <span className="role-check" aria-hidden="true">{role === item ? "✓" : ""}</span>
                {ROLE_LABEL[item]}
                {role === item && <small>Current</small>}
                {waiting[item] && role !== item && <i className="role-dot" aria-label="Action waiting" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
