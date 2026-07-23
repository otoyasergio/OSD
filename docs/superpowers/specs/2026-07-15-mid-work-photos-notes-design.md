# Mid-work photos & notes (Floor OS)

**Date:** 2026-07-15  
**Status:** Approved  
**Parent:** [2026-07-12-technician-floor-os-design.md](./2026-07-12-technician-floor-os-design.md)  
**Related:** [2026-07-13-technician-floor-os-ux-polish-design.md](./2026-07-13-technician-floor-os-ux-polish-design.md)  
**Approach:** Extend Floor Work + revive Notes mode (reuse `intake_photo` + `technician_note`)

## Goal

While a job is in progress, technicians can capture optional shop-only photos and free-form notes without leaving Floor OS. End-of-job **Proof** stays required and separate.

Primary client: Safari on iPad (Floor OS). Deep links to work-order Notes/Photos remain available for office.

## Decisions (from design workshop)

| Topic           | Choice                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Placement       | Both: quick capture on **Work** stage, plus fuller gallery/notes list in Floor **Notes** mode anytime during the job |
| Mid-work photos | Optional documentation — never gate Complete                                                                         |
| Proof           | Unchanged — still requires `job_proof` photo or `proof_exception` note                                               |
| Notes           | Free-form text; optionally attach as a caption when taking a photo                                                   |
| Visibility      | Shop only (techs + office) — never on customer portal                                                                |
| Storage         | Approach 1 — extend existing photo/note tables; no new work-log table                                                |

## Non-goals

- Replacing or weakening the Proof complete gate
- Customer portal visibility or customer-facing progress updates
- Per-checklist-item notes/photos (can be a later enhancement)
- Requiring mid-work media before continuing to Proof

## Data model

### Mid-work photo (± caption)

| Field           | Value                               |
| --------------- | ----------------------------------- |
| Table           | `intake_photo`                      |
| `category`      | new enum value `job_work`           |
| `job_id`        | required (same rule as `job_proof`) |
| `work_order_id` | required                            |
| `notes`         | optional caption (free-form)        |
| Storage bucket  | existing `intake-photos`            |

Migration: add `job_work` to the photo category check constraint / enum used by `intake_photo.category` (mirror how `job_proof` was added in Floor OS migrations).

### Standalone note (no photo)

| Field           | Value                 |
| --------------- | --------------------- |
| Table           | `technician_note`     |
| `note_type`     | `general`             |
| `job_id`        | set to the active job |
| `work_order_id` | set                   |
| `note`          | free-form text        |

No new note type required for v1.

### End-of-job proof (unchanged)

- `intake_photo.category = job_proof` + `job_id`
- Or `technician_note.note_type = proof_exception`

Proof media must **not** appear in the mid-work gallery as interchangeable “work” items (filter by category / note type). Proof exception notes stay on the Proof stage, not in the work journal.

### Visibility / portal

- Same authenticated RLS as existing `intake_photo` and `technician_note` select/insert policies
- Customer portal and any public/customer APIs must not list `job_work` photos or job-linked tech notes as customer content (confirm existing portal queries already exclude them; add explicit filters if any WO photo dump is shared outward)

## Floor UI

### Work stage (quick capture)

Under the checklist / parts block, add a compact **Work journal** strip:

1. Primary actions:
   - **Add photo** — camera / library chooser → optional caption field → upload
   - **Add note** — free-form textarea → save
2. Summary chip: `N photos · M notes` (counts for this job’s `job_work` + job-linked `general` notes) — tapping opens Floor **Notes** mode for the same job
3. Does not block **Continue to Proof**

Photo upload must use the durable prepare/compress path (`preparePhotoFileForUpload`) so Library picks on iOS Safari remain reliable.

### Notes mode (fuller list)

Floor UX polish treats Notes as a **secondary** entry (not on the Inspect→Work→Proof→Done rail). Revive it as an in-shell surface for the **active job**, opened via:

- Work journal summary chip (`N photos · M notes`)
- Existing secondary Notes control on the floor shell

Not only a deep link to the WO Notes tab.

- Chronological timeline mixing:
  - `job_work` photos (thumbnail + caption + time + author)
  - Standalone `technician_note` rows for this `job_id` with `note_type = general` only
  - Exclude `proof_exception` and `job_proof` from this journal (they stay on Proof)
- Same **Add photo** / **Add note** actions as Work
- Secondary link: “Open full work-order notes” → existing WO Notes tab for cross-job / typed notes if needed

### Proof stage

Unchanged behavior and copy. Keep proof uploads as `job_proof` only.

## Work-order surfaces (office)

- **Photos** tab: include `job_work` in labels/filters (e.g. “Job work”) so office can review mid-work media. v1 writers are Floor actions only; Photos tab is read/filter for `job_work` (no ambiguous job-less upload from that tab in v1)
- **Notes** tab: existing list already shows `technician_note`; job-linked general notes from Floor appear here automatically

## Permissions

- Who can add: same as Floor job work / photo upload today (assigned tech + roles that can edit the WO / Floor OS)
- Who can view: shop authenticated users with WO visibility for that location
- No customer portal exposure

## Complete / gates

| Gate                  | Mid-work media                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Continue Work → Proof | No requirement                                                                               |
| Complete job          | Still requires proof photo **or** proof exception — mid-work photos do **not** satisfy proof |

## Services / actions (sketch)

- Extend photo category types + labels: `job_work`
- Floor actions: `uploadJobWorkPhotoAction`, `addJobWorkNoteAction` (or generalize existing floor photo/note actions with category/type)
- Floor data loader: return work-journal entries (photos + notes) + counts for the focused job
- Reuse `uploadIntakePhoto` with `category: "job_work"` and `job_id`
- Reuse `addTechnicianNote` with `note_type: "general"` and `job_id`

## UX copy (suggested)

- Work strip title: **Work journal**
- Empty state: “Optional — add photos or notes while you work. Proof is still required at the end.”
- Photo caption placeholder: “What should the shop know about this photo?”
- Note placeholder: “Note for the shop (parts, findings, questions)…”

## Testing (acceptance)

1. On Work, add a library photo with caption → appears in Notes mode timeline with caption
2. On Work, add a standalone note → appears in Notes mode and WO Notes tab
3. Counts on Work strip match Notes mode entries for that job
4. Complete still blocked without proof even if several `job_work` photos exist
5. Proof photo still completes the gate; Proof media never appears in the Floor work journal timeline
6. Customer portal does not show mid-work photos/notes
7. iPad Safari: Library and Camera both succeed for work photos (prepare/compress path)

## Out of scope / later

- Attaching notes to checklist line items
- Sharing selected journal items to the customer
- Replacing Proof with mid-work media
- Editing/deleting journal entries (v1 append-only unless existing delete policies already allow office cleanup)
