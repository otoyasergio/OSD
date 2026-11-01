"use client";

import { useActionState } from "react";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import type { AccountabilityFormState } from "@/app/(app)/work_orders/accountability-actions";
import type { AccountabilitySnapshot } from "@/lib/services/workOrderAccountability";
import type { AdvisorOption } from "@/lib/services/advisorDesk";
import type { TechnicianOption } from "@/lib/services/workOrders";
import { torontoDatetimeLocal } from "@/lib/accountability/torontoTime";

type Action = (
  state: AccountabilityFormState,
  formData: FormData
) => Promise<AccountabilityFormState>;

const blank: AccountabilityFormState = { error: null, saved: false };

function StaffSelect({
  name,
  label,
  people,
  defaultValue,
}: {
  name: string;
  label: string;
  people: Array<{ user_id: string; first_name: string; last_name: string }>;
  defaultValue?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select name={name} className="input" defaultValue={defaultValue ?? ""} required>
        <option value="" disabled>
          Choose
        </option>
        {people.map((person) => (
          <option key={person.user_id} value={person.user_id}>
            {person.first_name} {person.last_name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AccountabilityPanel({
  workOrderId,
  snapshot,
  advisors,
  technicians,
  assignAction,
  maximumAction,
  promiseAction,
  handover,
  finalCheck,
  acknowledge,
}: {
  workOrderId: string;
  snapshot: AccountabilitySnapshot;
  advisors: AdvisorOption[];
  technicians: TechnicianOption[];
  assignAction: Action;
  maximumAction: Action;
  promiseAction: Action;
  handover: Action;
  finalCheck: Action;
  acknowledge: Action;
}) {
  const [advisorState, advisorForm] = useActionState(assignAction, blank);
  const [maximumState, maximumForm] = useActionState(maximumAction, blank);
  const [promiseState, promiseForm] = useActionState(promiseAction, blank);
  const [handoverState, handoverForm] = useActionState(handover, blank);
  const [checkState, checkForm] = useActionState(finalCheck, blank);
  const [ackState, ackForm] = useActionState(acknowledge, blank);
  const contract = snapshot.contract;
  const staff = [
    ...technicians,
    ...advisors.filter(
      (advisor) => !technicians.some((tech) => tech.user_id === advisor.user_id)
    ),
  ];

  return (
    <section className="card card-pad space-y-4">
      <div>
        <h2 className="font-semibold text-foreground">Who acts next</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          {contract.responsibleRole === "advisor"
            ? "Advisor"
            : contract.responsibleRole === "technician"
              ? "Technician"
              : contract.responsibleRole === "head_tech"
                ? "Head tech"
                : "Owner"}
          {contract.responsibleName ? `: ${contract.responsibleName}` : ""}. Evidence:{" "}
          {contract.evidenceMissing ?? contract.evidenceRequired}. Next:{" "}
          {contract.nextAction}.
          {contract.escalationName ? ` Escalate to ${contract.escalationName}.` : ""}
        </p>
      </div>

      <form
        action={advisorForm}
        className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <FormError message={advisorState.error} />
        <StaffSelect
          name="advisor_user_id"
          label="Advisor of record"
          people={advisors}
          defaultValue={snapshot.advisorUserId}
        />
        <SubmitButton label="Save advisor" pendingLabel="Saving…" />
      </form>

      <form
        action={maximumForm}
        className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <FormError message={maximumState.error} />
        <TextField
          label="Maximum authorization (dollars)"
          name="maximum_dollars"
          type="number"
          min="0"
          step="0.01"
          defaultValue={
            snapshot.maximumAuthorizationCents == null
              ? ""
              : String(snapshot.maximumAuthorizationCents / 100)
          }
        />
        <SubmitButton label="Record maximum" pendingLabel="Saving…" />
      </form>
      <p className="text-sm text-[var(--status-neutral)]">
        Use this when the customer declines a written estimate and authorizes a maximum.
        Intake does not require an estimate. Added work past the 10 percent ceiling needs
        a new authorization.
      </p>

      <form
        action={promiseForm}
        className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <FormError message={promiseState.error} />
        <TextField
          label="Promise date"
          name="promise_date"
          type="datetime-local"
          defaultValue={torontoDatetimeLocal(snapshot.estimatedCompletion)}
          hint="Toronto shop time. A short purchase-order line blocks a promise that assumes the whole bike is ready."
        />
        <SubmitButton label="Save promise" pendingLabel="Saving…" />
      </form>

      <form action={handoverForm} className="grid gap-3 sm:grid-cols-2">
        <FormError message={handoverState.error} />
        <TextField label="Keys" name="keys_note" defaultValue={snapshot.keysNote} />
        <TextField
          label="Accessories"
          name="accessories_note"
          defaultValue={snapshot.accessoriesNote}
        />
        <TextField
          label="Spot in the shop"
          name="bike_spot"
          defaultValue={snapshot.bikeSpot}
        />
        <TextField
          label="Who may approve work"
          name="authorized_approver_name"
          defaultValue={snapshot.authorizedApproverName}
        />
        <TextField
          label="Who may collect the motorcycle"
          name="authorized_collector_name"
          defaultValue={snapshot.authorizedCollectorName}
        />
        <div className="sm:col-span-2">
          <SubmitButton label="Save handover" pendingLabel="Saving…" />
        </div>
      </form>

      <form action={checkForm} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h3 className="font-medium">Final check</h3>
          <p className="text-sm text-[var(--status-neutral)]">
            Separate from the arrival inspection and from the head-tech safety check. The
            verifier must be a different account from the technician, and must not have
            clocked time on this visit.
          </p>
        </div>
        <FormError message={checkState.error} />
        <StaffSelect
          name="technician_user_id"
          label="Technician"
          people={staff}
          defaultValue={snapshot.finalCheck?.technician_user_id}
        />
        <StaffSelect
          name="verifier_user_id"
          label="Verifier"
          people={staff}
          defaultValue={snapshot.finalCheck?.verifier_user_id}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Road test</span>
          <select
            name="road_test_result"
            className="input"
            defaultValue={snapshot.finalCheck?.road_test_result ?? "not_performed"}
          >
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="not_performed">Not performed</option>
          </select>
        </label>
        <TextField
          label="Mileage out"
          name="mileage_out"
          type="number"
          min="0"
          defaultValue={
            snapshot.finalCheck?.mileage_out == null
              ? ""
              : String(snapshot.finalCheck.mileage_out)
          }
        />
        <TextField
          label="Leaks"
          name="leaks"
          defaultValue={snapshot.finalCheck?.leaks ?? ""}
        />
        <TextField
          label="Warning lights"
          name="warning_lights"
          defaultValue={snapshot.finalCheck?.warning_lights ?? ""}
        />
        <TextField
          label="Unresolved defects"
          name="unresolved_defects"
          defaultValue={snapshot.finalCheck?.unresolved_defects ?? ""}
        />
        <div className="sm:col-span-2">
          <SubmitButton label="Save final check" pendingLabel="Saving…" />
        </div>
      </form>

      {snapshot.declinedSafetyItems.length > 0 ? (
        <form action={ackForm} className="space-y-3">
          <h3 className="font-medium">Declined safety repairs</h3>
          <p className="text-sm text-[var(--status-neutral)]">
            {snapshot.declinedSafetyItems.join("; ")}. The customer acknowledgment records
            these items. It does not say the shop’s responsibility is gone.
            {snapshot.declinedSafetyAckSigner
              ? ` Acknowledged by ${snapshot.declinedSafetyAckSigner}.`
              : ""}
          </p>
          <FormError message={ackState.error} />
          <TextField label="Customer name" name="signer_name" required />
          <SubmitButton label="Record acknowledgment" pendingLabel="Saving…" />
        </form>
      ) : null}
      <span className="sr-only">Work order {workOrderId}</span>
    </section>
  );
}
