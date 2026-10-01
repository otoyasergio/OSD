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
      intake_photo: {
        Row: {
          photo_id: string;
          work_order_id: string;
          uploaded_by_user_id: string | null;
          storage_path: string;
          thumb_storage_path: string | null;
          photo_url: string | null;
          category: string;
          notes: string | null;
          inspection_result_id: string | null;
          job_id: string | null;
          client_upload_id: string | null;
          content_type: string | null;
          byte_size: number | null;
          pixel_width: number | null;
          pixel_height: number | null;
          created_at: string;
        };
        Insert: {
          photo_id?: string;
          work_order_id: string;
          uploaded_by_user_id?: string | null;
          storage_path: string;
          thumb_storage_path?: string | null;
          photo_url?: string | null;
          category: string;
          notes?: string | null;
          inspection_result_id?: string | null;
          job_id?: string | null;
          client_upload_id?: string | null;
          content_type?: string | null;
          byte_size?: number | null;
          pixel_width?: number | null;
          pixel_height?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["intake_photo"]["Insert"]>;
      };
      ai_assistant_thread: {
        Row: {
          ai_assistant_thread_id: string;
          work_order_id: string;
          job_id: string | null;
          location_id: string;
          mode: "shop" | "teach" | "intake" | "advisor" | "report";
          audience: "technical" | "front_office";
          status: "pending" | "generating" | "ready" | "failed" | "archived";
          diagnostic_phase:
            | "information_needed"
            | "diagnosis"
            | "repair_planning"
            | "repair_in_progress"
            | "verification"
            | "ready_for_technician_verification"
            | "closure_report"
            | null;
          trigger_type: "inspection_completed" | "job_completed" | null;
          trigger_entity_id: string | null;
          created_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          ai_assistant_thread_id?: string;
          work_order_id: string;
          job_id?: string | null;
          location_id: string;
          mode: "shop" | "teach" | "intake" | "advisor" | "report";
          audience: "technical" | "front_office";
          status?: "pending" | "generating" | "ready" | "failed" | "archived";
          diagnostic_phase?:
            | "information_needed"
            | "diagnosis"
            | "repair_planning"
            | "repair_in_progress"
            | "verification"
            | "ready_for_technician_verification"
            | "closure_report"
            | null;
          trigger_type?: "inspection_completed" | "job_completed" | null;
          trigger_entity_id?: string | null;
          created_by_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_assistant_thread"]["Insert"]>;
      };
      ai_assistant_message: {
        Row: {
          ai_assistant_message_id: string;
          thread_id: string;
          role: "system" | "user" | "assistant" | "tool";
          body: string | null;
          generation_status:
            "pending" | "generating" | "ready" | "failed" | "policy_withheld";
          requested_input: Json | null;
          phase:
            | "information_needed"
            | "diagnosis"
            | "repair_planning"
            | "repair_in_progress"
            | "verification"
            | "ready_for_technician_verification"
            | "closure_report"
            | null;
          created_by_user_id: string | null;
          parent_user_message_id: string | null;
          requested_provider_model: string | null;
          generation_attempt_id: string | null;
          provider_model: string | null;
          provider_response_id: string | null;
          prompt_version: string | null;
          input_token_count: number | null;
          output_token_count: number | null;
          context_as_of: string | null;
          context_hash: string | null;
          safe_error_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          ai_assistant_message_id?: string;
          thread_id: string;
          role: "system" | "user" | "assistant" | "tool";
          body?: string | null;
          generation_status?:
            "pending" | "generating" | "ready" | "failed" | "policy_withheld";
          requested_input?: Json | null;
          phase?:
            | "information_needed"
            | "diagnosis"
            | "repair_planning"
            | "repair_in_progress"
            | "verification"
            | "ready_for_technician_verification"
            | "closure_report"
            | null;
          created_by_user_id?: string | null;
          parent_user_message_id?: string | null;
          requested_provider_model?: string | null;
          generation_attempt_id?: string | null;
          provider_model?: string | null;
          provider_response_id?: string | null;
          prompt_version?: string | null;
          input_token_count?: number | null;
          output_token_count?: number | null;
          context_as_of?: string | null;
          context_hash?: string | null;
          safe_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_assistant_message"]["Insert"]>;
      };
      ai_assistant_message_photo: {
        Row: {
          message_id: string;
          photo_id: string;
          sort_order: number;
          purpose: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          photo_id: string;
          sort_order?: number;
          purpose: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["ai_assistant_message_photo"]["Insert"]
        >;
      };
      technician_note: {
        Row: {
          technician_note_id: string;
          work_order_id: string;
          job_id: string | null;
          created_by_user_id: string | null;
          source_ai_message_id: string | null;
          note: string;
          note_type: string;
          created_at: string;
        };
        Insert: {
          technician_note_id?: string;
          work_order_id: string;
          job_id?: string | null;
          created_by_user_id?: string | null;
          source_ai_message_id?: string | null;
          note: string;
          note_type?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["technician_note"]["Insert"]>;
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
          voice_e164: string | null;
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
          kind: "work_order_assigned" | "ready_for_pickup";
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          staff_notification_id?: string;
          recipient_user_id: string;
          actor_user_id?: string | null;
          location_id: string;
          work_order_id: string;
          kind?: "work_order_assigned" | "ready_for_pickup";
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
      staff_voice_presence: {
        Row: {
          user_id: string;
          location_id: string;
          registered_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          location_id: string;
          registered_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff_voice_presence"]["Insert"]>;
      };
      phone_call: {
        Row: {
          phone_call_id: string;
          direction: string;
          channel: string;
          location_id: string;
          from_e164: string | null;
          to_e164: string | null;
          from_user_id: string | null;
          to_user_id: string | null;
          customer_id: string | null;
          work_order_id: string | null;
          conversation_id: string | null;
          twilio_call_sid: string | null;
          status: string;
          started_at: string;
          answered_at: string | null;
          ended_at: string | null;
          duration_seconds: number | null;
          created_at: string;
        };
        Insert: {
          phone_call_id?: string;
          direction: string;
          channel: string;
          location_id: string;
          from_e164?: string | null;
          to_e164?: string | null;
          from_user_id?: string | null;
          to_user_id?: string | null;
          customer_id?: string | null;
          work_order_id?: string | null;
          conversation_id?: string | null;
          twilio_call_sid?: string | null;
          status?: string;
          started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["phone_call"]["Insert"]>;
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
      is_front_office_app_user: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_chat_participant: {
        Args: { p_conversation_id: string };
        Returns: boolean;
      };
      fitment_year_bounds: {
        Args: Record<string, never>;
        Returns: { min_year: number; max_year: number };
      };
      fitment_makes_for_year: {
        Args: { p_year: number };
        Returns: string[];
      };
      fitment_models_for_year_make: {
        Args: { p_year: number; p_make: string };
        Returns: string[];
      };
      ask_otomoto_begin_turn: {
        Args: {
          p_thread_id: string;
          p_work_order_id: string;
          p_user_id: string;
          p_body: string;
          p_photos?: Json;
        };
        Returns: {
          user_message_id: string;
          assistant_message_id: string;
          generation_attempt_id: string;
        }[];
      };
      ask_otomoto_begin_seed_turn: {
        Args: {
          p_thread_id: string;
          p_work_order_id: string;
          p_trigger_type: string;
          p_trigger_entity_id: string;
          p_user_id: string;
          p_body: string;
        };
        Returns: {
          user_message_id: string;
          assistant_message_id: string;
          generation_attempt_id: string;
        }[];
      };
      ask_otomoto_complete_turn: {
        Args: {
          p_thread_id: string;
          p_assistant_message_id: string;
          p_generation_attempt_id: string;
          p_body: string;
          p_requested_input: Json | null;
          p_phase: string;
          p_requested_provider_model: string;
          p_resolved_provider_model: string;
          p_provider_response_id: string;
          p_prompt_version: string;
          p_input_token_count: number | null;
          p_output_token_count: number | null;
          p_context_as_of: string;
          p_context_hash: string | null;
        };
        Returns: undefined;
      };
      ask_otomoto_fail_turn: {
        Args: {
          p_thread_id: string;
          p_assistant_message_id: string;
          p_generation_attempt_id: string;
          p_safe_error_code: string;
        };
        Returns: boolean;
      };
      ask_otomoto_claim_retry: {
        Args: {
          p_thread_id: string;
          p_work_order_id: string;
          p_stale_after: string;
        };
        Returns: {
          user_message_id: string;
          assistant_message_id: string;
          generation_attempt_id: string;
        }[];
      };
    };
    Enums: Record<string, never>;
  };
};
