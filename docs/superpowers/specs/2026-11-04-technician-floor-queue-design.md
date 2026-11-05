# Technician floor queue

**Date:** 2026-11-04  
**Status:** Approved for implementation

## Standard work

A technician has one bike on the bench. The bench is the bike with that technician’s running job clock. The advisor’s `docket_position` is the order. The technician cannot reorder it and cannot skip. A bike returns to its current place in that order. The advisor can still change the order from the assign-docket screen. A returning bike never starts its own clock.

A service is workable when it is assigned to that technician, its status is `approved`, `ready_to_start`, or `in_progress`, and it has no part in `needed` or `ordered`. Completed, declined, cancelled, and waiting-for-approval services are not workable. An in-progress service with a needed or ordered part is not workable.

If one service is blocked and another on that bike can be worked, the bike stays on the bench. The clock runs on the service that can be worked. The blocked service is a note. The work order stays in the bay: it does not move to the parts or approval column. The blocked service still opens its own `job_blocker`, so the clock starts when the part or the approval actually blocks it. The work order Overview lists each open parts or approval blocker with the service name, the reason, the owner, and the time since `opened_at`.

The bike leaves the line in two cases:

- Every remaining service for that technician is blocked. The job clock stops. One reason is shown: customer approval when any remaining service is waiting on the customer, otherwise parts. The visit status becomes `waiting_for_customer_approval` or `waiting_for_parts`, which is the existing front desk row. The blocker keeps its original `opened_at`.
- The technician taps Tool or lift busy. The whole bike leaves even if a service could still be worked. The clock stops. The visit stays in the bay. The wait is owned by that technician and shows only on their Waiting lane.

There is no Swap and no Other.

## Clear

Parts clear when no remaining service has a needed or ordered part. Customer approval clears when no remaining service is waiting on the customer. The tool clears when that technician marks it clear. Clearing a wait never starts a clock. A repeated save does not open a second blocker or a second clock.

An advisor, and a customer approval or decline from the portal, can open or close the customer wait. The portal records a null actor. A technician cannot clear a parts or approval wait, or another technician’s tool wait.

## Screen

The iPad queue has three stacks: On the bench, Your line, and Waiting. Start appears only on the first bike in the line, and only when the bench is empty. Dragging that card onto the empty bench is Start. Dragging any other card does nothing. Waiting cards show the reason, the owner, and the open duration. They cannot be started or dragged. A tool card has Mark clear. After the bike returns, the duration stays on the closed blocker and is not shown on the line card.

Tool or lift busy is the only manual stop. A written note is optional.

## Enforcement

One pure check owns the decision. The floor screen, `pullOntoBench`, `parkJob`, and the database commands `workflow_v2_pull_job_onto_bench` and `workflow_v2_park_job` all use it. Start is refused when a different bike is on the bench (`START_BENCH_OCCUPIED`), when the bike is not first (`START_NOT_NEXT`), or when it is waiting (`START_WAITING`). Pull never writes a swapped blocker. Park accepts only `tool` and does not change the visit status.

Open `swapped` and `other` blockers are closed once. Those bikes return to the line with no clock running.

Peer final inspection, the safety check, Parts, Account, and the assign-docket screen stay as they are. No new queue table. Wait duration is `job_blocker.opened_at` to `cleared_at`, with a domain event on open and close.
