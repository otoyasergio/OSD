"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Package, UserRound, Wrench } from "lucide-react";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/technician", label: "Tech Floor", Icon: Wrench, exact: true },
  { href: "/parts", label: "Parts", Icon: Package, exact: false },
  { href: "/messages", label: "Messages", Icon: MessageSquare, exact: false },
  { href: "/account", label: "Account", Icon: UserRound, exact: false },
] as const;

export function FloorTopBar({ trailing }: { trailing?: ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="pit-floor-topbar">
      <p className="pit-floor-topbar-brand">OTOMOTO</p>
      {LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={[
              "pit-floor-topbar-link",
              active ? "pit-floor-topbar-link--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={link.label}
            aria-current={active ? "page" : undefined}
          >
            <link.Icon size={22} aria-hidden />
            <span className="sr-only">{link.label}</span>
          </Link>
        );
      })}
      {trailing ? <div className="pit-floor-topbar-trailing">{trailing}</div> : null}
    </header>
  );
}
