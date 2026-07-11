"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  label,
  pendingLabel,
  variant = "primary",
  className = "",
}: {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "accent" | "secondary" | "danger";
  className?: string;
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
    <button
      type="submit"
      disabled={pending}
      className={`btn ${variantClass} ${className}`.trim()}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
