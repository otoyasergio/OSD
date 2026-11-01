import { createClient } from "@/lib/database/supabase-server";
import { evaluatePerformWorkDocumentation } from "@/lib/status/workDocumentation";

/** Server check for marking Perform work done. Shop photos and notes only. */
export async function assertPerformWorkDocumented(jobId: string): Promise<void> {
  const supabase = await createClient();
  const [notesResult, photosResult] = await Promise.all([
    supabase.from("technician_note").select("note, note_type").eq("job_id", jobId),
    supabase
      .from("intake_photo")
      .select("category, notes")
      .eq("job_id", jobId)
      .eq("category", "job_work"),
  ]);
  if (notesResult.error) throw notesResult.error;
  if (photosResult.error) throw photosResult.error;

  const gate = evaluatePerformWorkDocumentation({
    notes: (notesResult.data ?? []) as Array<{ note: string; note_type: string }>,
    photos: (photosResult.data ?? []) as Array<{
      category: string;
      notes: string | null;
    }>,
  });
  if (!gate.ok) throw new Error(gate.code);
}
