"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/work_orders", label: "Work Orders" },
  { href: "/customers", label: "Customers" },
  { href: "/motorcycles", label: "Motorcycles" },
  { href: "/technician", label: "Technician" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1">
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`inline-flex min-h-11 items-center rounded px-3 py-2 text-sm font-medium ${
              active
                ? "bg-white text-zinc-950"
                : "text-zinc-300"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
