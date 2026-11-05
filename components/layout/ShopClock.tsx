"use client";

import { useEffect, useState } from "react";
import { shopClockStatus } from "@/lib/datetime/format";

export function ShopClock() {
  const [status, setStatus] = useState<ReturnType<typeof shopClockStatus> | null>(null);

  useEffect(() => {
    const tick = () => setStatus(shopClockStatus(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!status) return null;
  const [when, detail] = status.label.split(" · ");

  return (
    <p className={status.open ? "sidebar-clock" : "sidebar-clock sidebar-clock--closed"}>
      <span>{when}</span>
      {detail ? <span>{detail}</span> : null}
    </p>
  );
}
