import type { MotorcycleFormState } from "@/app/(app)/motorcycles/actions";
import type { ServiceInformation } from "@/lib/services/motorcycles";
import { ServiceInformationForm } from "@/components/forms/ServiceInformationForm";

type Props = {
  serviceInformation: ServiceInformation | null;
  canEdit: boolean;
  action: (
    state: MotorcycleFormState,
    formData: FormData
  ) => Promise<MotorcycleFormState>;
};

export function ServiceInfoTab({
  serviceInformation,
  canEdit,
  action,
}: Props) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">
          Service information
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          {serviceInformation?.last_updated
            ? `Last updated ${new Date(serviceInformation.last_updated).toLocaleString()}`
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
