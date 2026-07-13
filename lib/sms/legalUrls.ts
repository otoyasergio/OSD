export function getPrivacyPolicyUrl(): string | null {
  const v = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim();
  return v || null;
}

export function getTermsUrl(): string | null {
  const v = process.env.NEXT_PUBLIC_TERMS_URL?.trim();
  return v || null;
}
