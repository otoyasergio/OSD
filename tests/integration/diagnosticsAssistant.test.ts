import { expect, it } from "vitest";
import { createServiceClient, describeIntegration } from "@/tests/integration/helpers";

describeIntegration("Ask OTOMOTO persistence integration", () => {
  it("has assistant storage and reviewed-note provenance columns", async () => {
    const client = createServiceClient();
    const [threads, messages, links, notes] = await Promise.all([
      client.from("ai_assistant_thread").select("ai_assistant_thread_id").limit(1),
      client
        .from("ai_assistant_message")
        .select(
          "ai_assistant_message_id, parent_user_message_id, requested_provider_model, generation_attempt_id"
        )
        .limit(1),
      client.from("ai_assistant_message_photo").select("message_id, photo_id").limit(1),
      client
        .from("technician_note")
        .select("technician_note_id, source_ai_message_id")
        .limit(1),
    ]);

    expect(threads.error).toBeNull();
    expect(messages.error).toBeNull();
    expect(links.error).toBeNull();
    expect(notes.error).toBeNull();
  });
});
