# OTOMOTO MOTO DIAGNOSTICS v1.1.0

This directory preserves the policy text supplied with the diagnostics package:

- `SKILL.md`
- `references/workflows.md`
- `references/source-policy.md`
- `references/templates.md`

The server-owned runtime policy is distilled in
`lib/diagnostics/prompts.ts` so Next.js does not need to read arbitrary Markdown
files at runtime. Update the prompt version and rerun the acceptance scenarios
whenever these source documents change.

Not included in the supplied package:

- `OTOMOTO_Universal_Diagnostic_Tree_2026.docx`
- Official Visual Motorcycle Inspection Report template
- Backup Universal Motorcycle Diagnostic Decision Tree
- Exact-model OEM manuals and wiring diagrams
- Ten PDFs from the earlier local Codex plugin

Their names are not evidence that the application can access them.
