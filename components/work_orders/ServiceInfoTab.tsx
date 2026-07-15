import type { MotorcycleFormState } from "@/app/(app)/motorcycles/actions";
import type { ServiceInformation } from "@/lib/services/motorcycles";
import { ServiceInformationForm } from "@/components/forms/ServiceInformationForm";
import { formatDateTime } from "@/lib/datetime/format";

type Props = {
  serviceInformation: ServiceInformation | null;
  canEdit: boolean;
  action: (
    state: MotorcycleFormState,
    formData: FormData
  ) => Promise<MotorcycleFormState>;
};

export function ServiceInfoTab({ serviceInformation, canEdit, action }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Service information</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          {serviceInformation?.last_updated
            ? `Last updated ${formatDateTime(serviceInformation.last_updated)}`
            : "Not recorded yet."}
        </p>
      </div>
      <ServiceInformationForm
        action={action}
        serviceInformation={serviceInformation}
        canEdit={canEdit}
      />
    </section>
  );
}
