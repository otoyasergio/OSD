"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Package,
  Users,
  Wrench,
} from "lucide-react";
import type { UserRole } from "@/lib/database/types";
import {
  buildTabBarItems,
  isTabSelected,
  type TabBarItemId,
} from "@/lib/navigation/tabBar";
import { useCommsSnapshot } from "@/components/comms/CommsDock";

const TAB_ICONS: Record<TabBarItemId, LucideIcon> = {
  home: LayoutDashboard,
  orders: ClipboardList,
  customers: Users,
  floor: Wrench,
  parts: Package,
  messages: MessageSquare,
  more: MoreHorizontal,
};

type Props = {
  role: UserRole;
  moreOpen: boolean;
  onMoreToggle: () => void;
};

export function TabBar({ role, moreOpen, onMoreToggle }: Props) {
  const pathname = usePathname();
  const items = buildTabBarItems(role);
  const unreadCount = useCommsSnapshot()?.unreadCount ?? 0;

  return (
    <nav className="app-tab-bar" aria-label="Primary">
      {items.map((item) => {
        const selected = isTabSelected(pathname, item, items, moreOpen);
        const Icon = TAB_ICONS[item.id];
        const className = selected
          ? "app-tab-bar-item app-tab-bar-item--selected"
          : "app-tab-bar-item";

        if (item.kind === "more") {
          return (
            <button
              key={item.id}
              type="button"
              className={className}
              aria-current={selected ? "page" : undefined}
              aria-expanded={moreOpen}
              aria-controls="app-sidebar-nav"
              onClick={onMoreToggle}
            >
              <Icon className="app-tab-bar-icon" aria-hidden />
              <span className="app-tab-bar-label">{item.label}</span>
            </button>
          );
        }

        return (
          <Link
            key={item.id}
            href={item.href}
            className={className}
            aria-current={selected ? "page" : undefined}
          >
            <span className="app-tab-bar-icon-wrap">
              <Icon className="app-tab-bar-icon" aria-hidden />
              {item.id === "messages" && unreadCount > 0 ? (
                <span className="app-tab-bar-badge" aria-label={`${unreadCount} unread`}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </span>
            <span className="app-tab-bar-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
