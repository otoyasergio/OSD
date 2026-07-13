/**
 * Supabase Database types.
 *
 * Regenerate against a linked project:
 *   npx supabase gen types typescript --linked > lib/database/supabase.generated.ts
 *
 * Until then, this hand-maintained schema covers core tables used by the app.
 */

export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      app_user: {
        Row: {
          user_id: string;
          auth_user_id: string | null;
          first_name: string;
          last_name: string;
          email: string;
          role: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          auth_user_id?: string | null;
          first_name: string;
          last_name: string;
          email: string;
          role: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_user"]["Insert"]>;
      };
      work_order: {
        Row: {
          work_order_id: string;
          location_id: string;
          motorcycle_id: string;
          customer_id: string | null;
          work_order_number: string | null;
          status: string;
          billing_collected_cents: number | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      location: {
        Row: {
          location_id: string;
          name: string;
          code: string;
          active: boolean;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      customer: {
        Row: {
          customer_id: string;
          first_name: string;
          last_name: string;
          phone: string | null;
          email: string | null;
          account_type: string;
          sms_opted_out_at: string | null;
          sms_transactional_consent_at: string | null;
          sms_marketing_consent_at: string | null;
          sms_consent_source: string | null;
        };
        Insert: {
          customer_id?: string;
          first_name: string;
          last_name: string;
          phone?: string | null;
          email?: string | null;
          account_type: string;
          sms_opted_out_at?: string | null;
          sms_transactional_consent_at?: string | null;
          sms_marketing_consent_at?: string | null;
          sms_consent_source?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["customer"]["Insert"]>;
      };
      sms_consent_event: {
        Row: {
          id: string;
          customer_id: string;
          program: string;
          action: string;
          method: string;
          source_path: string | null;
          actor_user_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          program: string;
          action: string;
          method: string;
          source_path?: string | null;
          actor_user_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sms_consent_event"]["Insert"]>;
      };
      time_clock_entry: {
        Row: {
          entry_id: string;
          user_id: string;
          location_id: string;
          clock_in_at: string;
          clock_out_at: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      mint_work_order_number: {
        Args: { p_location_id: string };
        Returns: string;
      };
      current_app_user_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      user_location_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
    };
    Enums: Record<string, never>;
  };
};
