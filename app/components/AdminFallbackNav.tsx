import { useLocation } from "@remix-run/react";
import AppNavLink from "./AppNavLink";
import styles from "../styles/admin.module.css";

type NavItem = {
  label: string;
  to: string;
  match?: string[];
  priority?: number;
};

const NAV_ITEMS: NavItem[] = [
  {
    label: "Analytics",
    to: "/admin/dashboard",
    match: ["/admin/dashboard"],
    priority: 2,
  },
  {
    label: "Settings",
    to: "/admin/settings",
    match: ["/admin/settings"],
    priority: 3,
  },
  {
    label: "FBT",
    to: "/admin/bundles",
    match: ["/admin/bundles"],
    priority: 3,
  },
];

function findActiveItem(pathname: string) {
  return NAV_ITEMS.reduce<NavItem | undefined>((current, item) => {
    if (!item.match || item.match.length === 0) {
      return current;
    }

    const matched = item.match.some((candidate) => {
      if (candidate === pathname) {
        return true;
      }
      const normalized = candidate.endsWith("/") ? candidate : `${candidate}/`;
      return pathname.startsWith(normalized);
    });

    if (!matched) {
      return current;
    }

    if (!current || (item.priority ?? 0) > (current.priority ?? 0)) {
      return item;
    }

    const currentMatchLength = current.match?.[0]?.length ?? 0;
    const itemMatchLength = item.match?.[0]?.length ?? 0;
    if ((item.priority ?? 0) === (current.priority ?? 0) && itemMatchLength > currentMatchLength) {
      return item;
    }

    return current;
  }, undefined);
}

export function AdminFallbackNav() {
  const location = useLocation();
  const activeItem = findActiveItem(location.pathname);

  return (
    <nav className={styles.fallbackNav} aria-label="App section navigation">
      {NAV_ITEMS.map((item) => {
        const isActive = activeItem?.label === item.label;
        const className = `${styles.fallbackNavLink}${isActive ? ` ${styles.fallbackNavLinkActive}` : ""}`;

        return (
          <AppNavLink
            key={item.label}
            to={item.to}
            prefetch="intent"
            className={className}
          >
            {item.label}
          </AppNavLink>
        );
      })}
    </nav>
  );
}

export default AdminFallbackNav;
