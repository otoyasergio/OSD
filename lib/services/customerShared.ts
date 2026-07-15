export type CustomerAccountType = "retail" | "fleet" | "commercial";

export const CUSTOMER_ACCOUNT_TYPE_LABELS: Record<CustomerAccountType, string> =
  {
    retail: "Retail",
    fleet: "Fleet",
    commercial: "Commercial",
  };
