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
          profile_photo_path: string | null;
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
          profile_photo_path?: string | null;
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
          primary_technician_id: string | null;
          mileage: number | null;
          mileage_unit: "km" | "mi";
          billing_collected_cents: number | null;
          created_at: string;
          completed_at: string | null;
          opened_at: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      motorcycle: {
        Row: {
          motorcycle_id: string;
          customer_id: string;
          year: number;
          make: string;
          model: string;
          vin: string | null;
          colour: string | null;
          plate_number: string | null;
          odometer_unit: "km" | "mi";
          notes: string | null;
          created_at: string;
          updated_at: string;
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
          address: string | null;
          date_of_birth: string | null;
          account_type: string;
          sms_opted_out_at: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
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
      shop_closure: {
        Row: {
          location_id: string;
          closure_date: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          location_id: string;
          closure_date: string;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["shop_closure"]["Insert"]>;
      };
      staff_notification: {
        Row: {
          staff_notification_id: string;
          recipient_user_id: string;
          actor_user_id: string | null;
          location_id: string;
          work_order_id: string;
          kind: "work_order_assigned";
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          staff_notification_id?: string;
          recipient_user_id: string;
          actor_user_id?: string | null;
          location_id: string;
          work_order_id: string;
          kind?: "work_order_assigned";
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff_notification"]["Insert"]>;
      };
      chat_conversation: {
        Row: {
          conversation_id: string;
          type: string;
          title: string | null;
          dm_key: string | null;
          created_by_user_id: string | null;
          last_message_at: string | null;
          created_at: string;
        };
        Insert: {
          conversation_id?: string;
          type: string;
          title?: string | null;
          dm_key?: string | null;
          created_by_user_id?: string | null;
          last_message_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["chat_conversation"]["Insert"]>;
      };
      chat_participant: {
        Row: {
          conversation_id: string;
          user_id: string;
          joined_at: string;
          last_read_at: string | null;
          muted_at: string | null;
          pinned_at: string | null;
          hidden_at: string | null;
          left_at: string | null;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          joined_at?: string;
          last_read_at?: string | null;
          muted_at?: string | null;
          pinned_at?: string | null;
          hidden_at?: string | null;
          left_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["chat_participant"]["Insert"]>;
      };
      chat_message: {
        Row: {
          message_id: string;
          conversation_id: string;
          sender_user_id: string | null;
          kind: string;
          body: string | null;
          reply_to_message_id: string | null;
          edited_at: string | null;
          unsent_at: string | null;
          created_at: string;
        };
        Insert: {
          message_id?: string;
          conversation_id: string;
          sender_user_id?: string | null;
          kind: string;
          body?: string | null;
          reply_to_message_id?: string | null;
          edited_at?: string | null;
          unsent_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["chat_message"]["Insert"]>;
      };
      chat_attachment: {
        Row: {
          attachment_id: string;
          message_id: string;
          storage_path: string;
          mime_type: string;
          bytes: number | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: {
          attachment_id?: string;
          message_id: string;
          storage_path: string;
          mime_type: string;
          bytes?: number | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["chat_attachment"]["Insert"]>;
      };
      chat_reaction: {
        Row: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["chat_reaction"]["Insert"]>;
      };
      chat_call: {
        Row: {
          call_id: string;
          conversation_id: string;
          kind: string;
          twilio_room_sid: string | null;
          twilio_room_name: string;
          status: string;
          started_by_user_id: string | null;
          started_at: string;
          ended_at: string | null;
        };
        Insert: {
          call_id?: string;
          conversation_id: string;
          kind: string;
          twilio_room_sid?: string | null;
          twilio_room_name: string;
          status?: string;
          started_by_user_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["chat_call"]["Insert"]>;
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
      is_chat_participant: {
        Args: { p_conversation_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
  };
};
