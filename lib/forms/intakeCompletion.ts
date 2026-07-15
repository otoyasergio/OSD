export type IntakeFollowUp = "signature" | "paper_copy";

export function withIntakeFollowUp(href: string, followUp: IntakeFollowUp): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}follow_up=${encodeURIComponent(followUp)}`;
}
