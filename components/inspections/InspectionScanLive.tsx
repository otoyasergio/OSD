"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InspectionScanSection } from "@/components/inspections/InspectionScanSection";
import type { InspectionScanView } from "@/lib/email/scanReport";
import type { MileageUnit } from "@/lib/mileage/format";
import {
  chooseInspectionMileageAction,
  confirmInspectionScanAction,
  loadInspectionScanAction,
  markInspectionNoConnectionAction,
  pasteInspectionScanAction,
} from "@/app/(app)/work_orders/[work_order_id]/inspection/scanActions";

export function InspectionScanLive({
  workOrderId,
  workOrderVin,
  mileage,
  mileageUnit,
  scan,
  readOnly,
}: {
  workOrderId: string;
  workOrderVin: string | null;
  mileage: number | null;
  mileageUnit: MileageUnit;
  scan: InspectionScanView | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const seenScanId = useRef(scan?.scanReportId ?? null);
  const [polled, setPolled] = useState<{
    scan: InspectionScanView | null;
    mileage: number | null;
    mileageUnit: MileageUnit;
  } | null>(null);

  const propsId = scan?.scanReportId ?? null;
  const polledId = polled?.scan?.scanReportId ?? null;

  useEffect(() => {
    seenScanId.current = propsId;
  }, [propsId]);
  const showingPoll =
    polled != null &&
    (polledId !== propsId || polled.mileage !== mileage || polled.mileageUnit !== mileageUnit);
  const shownScan = showingPoll ? polled.scan : scan;
  const shownMileage = showingPoll ? polled.mileage : mileage;
  const shownUnit = showingPoll ? polled.mileageUnit : mileageUnit;

  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    const tick = async () => {
      const next = await loadInspectionScanAction(workOrderId);
      if (cancelled || !next) return;
      setPolled(next);
      const nextId = next.scan?.scanReportId ?? null;
      if (nextId && nextId !== seenScanId.current) {
        seenScanId.current = nextId;
        router.refresh();
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [readOnly, workOrderId, router]);

  return (
    <InspectionScanSection
      workOrderVin={workOrderVin}
      mileage={shownMileage}
      mileageUnit={shownUnit}
      scan={shownScan}
      readOnly={readOnly}
      pasteAction={pasteInspectionScanAction.bind(null, workOrderId)}
      noConnectionAction={markInspectionNoConnectionAction.bind(null, workOrderId)}
      confirmAction={confirmInspectionScanAction.bind(null, workOrderId)}
      mileageAction={chooseInspectionMileageAction.bind(null, workOrderId)}
    />
  );
}
