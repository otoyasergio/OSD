-- One reviewed assistant response may produce at most one append-only
-- technician note. Application checks provide a friendly error; this partial
-- unique index closes concurrent promotion races.
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_note_ai_source
  ON public.technician_note (source_ai_message_id)
  WHERE source_ai_message_id IS NOT NULL;
