export type WixContactInfo = {
  name?: {
    first?: string;
    last?: string;
  };
  emails?: {
    items: Array<{
      tag?: "MAIN" | "HOME" | "WORK" | "UNTAGGED";
      email: string;
      primary?: boolean;
    }>;
  };
  phones?: {
    items: Array<{
      tag?: "MOBILE" | "HOME" | "WORK" | "FAX" | "UNTAGGED";
      phone: string;
      primary?: boolean;
    }>;
  };
};

export type WixContact = {
  id: string;
  revision?: number;
  info?: WixContactInfo;
  primaryInfo?: {
    email?: string;
    phone?: string;
  };
};

export type WixWebhookContactPayload = {
  event?: string;
  contact: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  };
};
