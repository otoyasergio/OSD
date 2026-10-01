# Safari photo acceptance (real devices)

Shop-device signoff for the Safari photo program. **Linux Playwright WebKit is not device Safari.** Automated WebKit specs prove wiring and resume behavior
with `setInputFiles`; they do not reproduce iOS Photos picker bugs. A human
must walk these flows on current shop hardware before production flags go on.

Live app: <https://service.torontomoto.com>  
Legal entity: **OTOMOTO TORONTO MOTO INC.**

Rollout order: migrations first, then `PHOTO_UPLOAD_QUEUE_ENABLED=1` (durable
queue), then this runbook, then `CHECKOUT_EVIDENCE_ENABLED=1`, then
`npm run deploy:production` from `main` only.

## Signoff fields

Copy this block onto every device/flow row.

| Field                | Value                |
| -------------------- | -------------------- |
| Tester               |                      |
| Device / OS / Safari |                      |
| Date                 |                      |
| Expected result      |                      |
| Result               | pass / fail / waived |
| Artifact link        |                      |
| Blocker / waiver     |                      |

## Devices

- [ ] Current shop iPad — Safari — **portrait**
- [ ] Current shop iPad — Safari — **landscape**
- [ ] Current shop iPhone Safari
- [ ] Safari on supported macOS

Record tester, Device / OS / Safari, date, expected result, result, artifact
link, and blocker / waiver for each device.

## Flows

For each flow: tester, Device / OS / Safari, date, expected result, result,
artifact link, and blocker / waiver.

### Six-photo intake using camera and multi-select library

- [ ] Camera capture of front, rear, left, right, odometer, VIN
- [ ] Multi-select library enqueue of the same six angles
- Expected result: all six commit locally, then appear as server photos

### HEIC, orientation, VIN/odometer legibility at full zoom

- [ ] Library HEIC uploads as a viewable JPEG
- [ ] Orientation matches the bike
- [ ] VIN and odometer remain legible in the lightbox at full zoom

### Camera share/save sheet dismissed and accepted

- [ ] Dismiss the iOS share/save sheet and still keep the queued photo
- [ ] Accept the sheet and still keep the queued photo

### Background, lock, close/reopen, and network-loss resume

- [ ] Background Safari, return, queue still present
- [ ] Lock the device, unlock, queue still present
- [ ] Close Safari / kill the tab, reopen, durable queue resumes
- [ ] Lose network, enqueue, restore network, upload completes

### Low device storage / IndexedDB quota failure copy

- [ ] Forced quota failure shows the shop-safe quota copy, not a raw DOM error

### Multi-tab duplicate protection

- [ ] The same photo opened in two tabs does not create two server rows

### Inspection multi-photo and Retry

- [ ] Inspection slots accept multiple photos
- [ ] Failed inspection photo Retry works

### job_work and job_proof

- [ ] Floor `job_work` uploads
- [ ] Floor `job_proof` uploads
- [ ] Proof gate counts only confirmed `job_proof` server rows, never local queue state

### Five checkout photos; Ready/Complete block; owner/manager reasoned override

- [ ] Five checkout photos (front, rear, left, right, odometer)
- [ ] Ready/Complete block while required evidence is missing
- [ ] Owner/manager reasoned override unblocks Ready/Complete
- [ ] Non-owner cannot create, change, or clear the override

### Gallery/thumb/lightbox/save-to-device and expired signed URL recovery

- [ ] Gallery thumbs open the lightbox
- [ ] Save-to-device writes the open photo
- [ ] Expired signed URL recovers without a dead image

### Profile/chat/customer/staff/motorcycle secondary uploads

- [ ] Profile photo
- [ ] Chat composer photo
- [ ] Customer document
- [ ] Staff document
- [ ] Motorcycle document

### Delete confirmation/reason and reconciliation read-only report

- [ ] Delete requires a correction reason and removes row + object
- [ ] Reconciliation read-only report lists missing originals/thumbs without mutating

### Sign-out/location switch privacy

- [ ] Sign-out warns when photos are still waiting and does not leak another user's queue
- [ ] Location switch remounts a keyed store and does not mix queues

## Blockers that require a human/shop device

Any picker, camera-sheet, orientation, or quota row that cannot be proven on
Linux Playwright WebKit stays a shop-device blocker or recorded waiver.
