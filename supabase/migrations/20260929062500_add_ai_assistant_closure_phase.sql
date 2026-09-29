-- Persist the job-completion closure report as a structured assistant phase.

ALTER TABLE public.ai_assistant_thread
  DROP CONSTRAINT ai_assistant_thread_diagnostic_phase_check,
  ADD CONSTRAINT ai_assistant_thread_diagnostic_phase_check CHECK (
    diagnostic_phase IS NULL
    OR diagnostic_phase IN (
      'information_needed',
      'diagnosis',
      'repair_planning',
      'repair_in_progress',
      'verification',
      'ready_for_technician_verification',
      'closure_report'
    )
  );

ALTER TABLE public.ai_assistant_message
  DROP CONSTRAINT ai_assistant_message_phase_check,
  ADD CONSTRAINT ai_assistant_message_phase_check CHECK (
    phase IS NULL
    OR phase IN (
      'information_needed',
      'diagnosis',
      'repair_planning',
      'repair_in_progress',
      'verification',
      'ready_for_technician_verification',
      'closure_report'
    )
  );
