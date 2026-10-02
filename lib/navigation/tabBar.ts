import type { UserRole } from "@/lib/database/types";
import {
  canUseMessenger,
  canViewClients,
  canViewPartsBoard,
  isFloorTech,
  staffHomePath,
} from "@/lib/permissions/checks";
import { isActiveNavPath } from "@/lib/navigation/activePath";

export type TabBarItemId =
  "home" | "orders" | "customers" | "floor" | "parts" | "messages" | "more";

export type TabBarLink = {
  id: Exclude<TabBarItemId, "more">;
  href: string;
  label: string;
  kind: "link";
};

export type TabBarMore = {
  id: "more";
  label: "More";
  kind: "more";
};

export type TabBarItem = TabBarLink | TabBarMore;

/**
 * iPhone primary destinations. Apple HIG: 3–5 tab-bar items, overflow in More.
 * iPad / desktop keep the existing sidebar and do not show this bar.
 */
export function buildTabBarItems(role: UserRole): TabBarItem[] {
  const items: TabBarItem[] = [];

  if (isFloorTech(role)) {
    items.push({
      id: "floor",
      href: "/technician",
      label: "Floor",
      kind: "link",
    });
    if (canViewPartsBoard(role)) {
      items.push({
        id: "parts",
        href: "/parts",
        label: "Parts",
        kind: "link",
      });
    }
  } else {
    items.push({
      id: "home",
      href: staffHomePath(role),
      label: "Home",
      kind: "link",
    });
    items.push({
      id: "orders",
      href: "/work_orders",
      label: "Orders",
      kind: "link",
    });
    if (canViewClients(role)) {
      items.push({
        id: "customers",
        href: "/customers",
        label: "Customers",
        kind: "link",
      });
    }
  }

  if (canUseMessenger(role)) {
    items.push({
      id: "messages",
      href: "/messages",
      label: "Messages",
      kind: "link",
    });
  }

  items.push({ id: "more", label: "More", kind: "more" });

  return items.slice(0, 5);
}

export function isTabSelected(
  pathname: string,
  item: TabBarItem,
  items: TabBarItem[],
  moreOpen: boolean
): boolean {
  if (item.kind === "more") {
    if (moreOpen) return true;
    return !items.some(
      (other) => other.kind === "link" && isActiveNavPath(pathname, other.href)
    );
  }
  if (moreOpen) return false;
  return isActiveNavPath(pathname, item.href);
}
