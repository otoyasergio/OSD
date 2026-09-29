# OTOMOTO operating workflows

Use only the section relevant to the request. This is generated shop guidance, not an OEM procedure or a replacement for the named OTOMOTO diagnostic tree.

## Intake

For `/intake`, collect the following in one organized checklist and accept unknown fields:

- Repair-order ID; year, make, model/submodel and market; mileage and units; VIN if available/needed.
- Customer's exact concern; first occurrence; sudden or gradual; frequency; cold/hot; idle/load/speed; weather and fuel level when relevant.
- No-crank, slow-crank, normal-crank/no-start, starts/stalls, or another precise description. Distinguish starter spinning from engine rotating.
- Warning lamps/messages and exact DTCs with module, status, scan-tool identity and freeze-frame if available. Do not clear them first.
- Last known normal operation; recent service, accessory installation, impact, washing, transport or storage; fuel age/type when relevant.
- Modifications including electrical accessories, ECU/exhaust changes, suspension, wheels and battery chemistry.
- Existing measurements with test conditions; previous repairs and whether they changed the symptom.
- Visible leaks/damage; braking, steering or tire concerns; transport/ride-in status.
- Authorized diagnostic scope and supplied budget/time cap; customer contact preference only if needed for the requested draft.

End intake by restating the complaint, listing critical gaps, and selecting one next check. Do not diagnose merely from completed intake.

## First pass

Use relevant items, not an obligatory five-minute procedure: fuel availability/age; kill switch; neutral/clutch/sidestand logic; key/fob/immobilizer indicators; battery chemistry and rest/cranking readings; terminals and grounds; main fuse; dash warnings; scan data; recent work; loose connectors; leaks/damage. Fuel condition is a hypothesis until checked. Chemistry and conditions matter when interpreting voltage; avoid a universal battery cutoff.

## No-crank and slow-crank

First distinguish no starter action, relay clicking, slow engine rotation, and a free-spinning starter that does not rotate the engine. Use evidence to choose the branch; the list below is an isolation map, not mandatory disassembly order.

1. Battery condition and supply under demand; terminals, grounds and main feed/fuse.
2. Ignition/kill/start inputs, security status and actual interlock states against the correct diagram.
3. Relay control supply/command and return, then high-current input/output under the relevant load.
4. Cable and connection voltage drops; starter current/behaviour when appropriate equipment and specifications are available.
5. Starter motor, starter clutch/drive, or mechanical restriction based on the observed behaviour.

Do not condemn a starter from clicking, a relay from silence, or a battery from open-circuit voltage alone. Suspected hydrolock or mechanical lock moves ahead of further powered testing. Do not bridge high-current terminals to skip diagnosis.

## Cranks but will not start

Verify engine rotation and adequate cranking conditions. Preserve codes and check immobilizer status. Check fuel availability/delivery, air path, spark using an appropriate tester, compression/mechanical condition and timing as evidence directs. Review relevant sensor inputs, ECU power/grounds and scan-data plausibility using exact-model information. A pump sound does not prove pressure or delivery; a spark observation does not prove timing or reliable spark under cylinder pressure. Use OEM precautions for fuel-pressure testing and any cylinder/compression work. Keep ignition tests away from fuel vapour.

## Other system groups

- Running/fuelling/ignition: reproduce cold/hot/load conditions safely, preserve data, inspect recent work and intake/exhaust/fuel basics, then correlate measurements before replacing sensors or injectors.
- Charging: identify battery chemistry and charging architecture; inspect battery/connections/accessories; compare loaded system measurements at the OEM conditions. Test stator/regulator only with the correct circuit and limits. Do not disconnect a battery while running as a charging test.
- Parasitic draw: identify sleep behaviour and accessories. Prefer a suitable current clamp where practical; any series-meter procedure must account for instrument rating, fuse and wake-up loads. Never crank through a series multimeter.
- Brakes/ABS: document the symptom, visible leaks/damage, measured wear and recorded faults. Use exact fluid, wear limits, fastener values, bleeding and scan-tool procedures. A warning lamp or image alone cannot establish component failure or safe braking performance.
- Steering/chassis/wheels/final drive: distinguish free play, binding, alignment, wear, noise and load-related symptoms. Use safe support and OEM measurement procedures. Tire tread appearance alone does not establish age, pressure or internal integrity.
- Suspension: separate tire issues, sag/spring suitability, friction, leakage, damping and geometry. Record rider/load and baseline adjustments before changes. General suspension books explain method; exact settings need verified bike/rider/OEM or known tuner data.
- Intermittent faults: record reproduction conditions; use safe connector/ground inspection, logging and controlled wiggle tests. A fault absent today is not verified repaired.

## Advisor workflow

Produce the requested customer message, estimate or handoff directly. Use only case facts and state unknowns without technical overload.

For customer explanations include: reported concern; what the technician actually found; what remains uncertain; recommended next action and why; supplied price/authorization scope; expected update point only if provided. Describe potential causes as potential. Do not turn a proposed test into completed work.

For diagnostic authorization, separate authorization to test from authorization to repair. Name the proposed scope and supplied spending/time cap. If the cap is missing, use a labelled blank or request it; do not manufacture prices, labour allowances, tax rates, shop charges, availability, warranty coverage or completion dates. Never state the customer approved work without a record.

For estimates, use only supplied quantities, rates and prices. Show currency, parts, labour, applicable supplied tax/fees, total, exclusions and approval status. Label incomplete totals as incomplete. OEM book time, technician estimate and billed time are distinct. Unknown line items prevent a firm total.

For handoffs, give complaint → operating conditions → completed tests/readings → current confidence → next discriminating test → authorization/open items. Include supporting sources internally; do not clutter a short customer message with manual jargon.

If the customer asks whether riding is safe, use the actual findings. Where a brake, steering, wheel/tire, fuel-leak or other serious hazard is reported, recommend stopping use and arranging inspection/transport appropriate to the situation. Do not guarantee roadworthiness from a chat or incomplete inspection.

## Verification and closure

Retest the original complaint under comparable conditions; compare before/after readings with the same sourced limits. Check disturbed connectors, fasteners and fluid levels using applicable procedures. Record remaining faults or incomplete checks. Road testing is conditional on technician safety checks and authorization, not an automatic final step.

Use “repair performed; verification pending” if no verification is supplied. Use “symptom not reproduced during [stated test]” when warranted, not “fixed.” Technical findings, customer approval, work performed and release decision remain separate records.
