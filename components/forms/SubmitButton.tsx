"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  label,
  pendingLabel,
  variant = "primary",
}: {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "accent" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  const variantClass =
    variant === "accent"
      ? "btn-accent"
      : variant === "secondary"
        ? "btn-secondary"
        : variant === "danger"
          ? "btn-danger"
          : "btn-primary";

  return (
    <button type="submit" disabled={pending} className={`btn ${variantClass}`}>
      {pending ? pendingLabel : label}
    </button>
  );
}
