"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { normalizeEmailInput } from "@/lib/email/normalize";
import {
  normalizePhoneForMatching,
  type CustomerDuplicateMatch,
} from "@/lib/customers/duplicates";

const DEBOUNCE_MS = 450;

export function CustomerDuplicateWarning({
  phone,
  email,
  excludeCustomerId,
}: {
  phone: string;
  email: string;
  excludeCustomerId?: string;
}) {
  const phoneQuery = normalizePhoneForMatching(phone) ? phone : "";
  const normalizedEmail = normalizeEmailInput(email);
  const emailQuery = normalizedEmail.includes("@") ? normalizedEmail : "";
  const queryKey = `${phoneQuery}|${emailQuery}|${excludeCustomerId ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    matches: CustomerDuplicateMatch[];
  }>({ key: "", matches: [] });

  useEffect(() => {
    if (!phoneQuery && !emailQuery) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (phoneQuery) params.set("phone", phoneQuery);
      if (emailQuery) params.set("email", emailQuery);
      if (excludeCustomerId) params.set("exclude", excludeCustomerId);

      try {
        const response = await fetch(`/api/customers/duplicate-check?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as { matches?: CustomerDuplicateMatch[] };
        if (!response.ok) throw new Error("DUPLICATE_CHECK_FAILED");
        setResult({ key: queryKey, matches: body.matches ?? [] });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setResult({ key: queryKey, matches: [] });
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [emailQuery, excludeCustomerId, phoneQuery, queryKey]);

  const matches = result.key === queryKey ? result.matches : [];

  if (matches.length === 0) return null;

  return (
    <div
      className="sm:col-span-2 rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm"
      role="status"
    >
      <p className="font-semibold text-foreground">Possible existing customer</p>
      <ul className="mt-1 space-y-1">
        {matches.map((match) => (
          <li key={match.customer_id}>
            <Link
              href={`/customers/${match.customer_id}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
            >
              {match.first_name} {match.last_name}
            </Link>{" "}
            already uses this {match.matched_fields.join(" and ")}.
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[var(--status-neutral)]">
        Open the existing record to confirm, or continue if this is intentional.
      </p>
    </div>
  );
}
