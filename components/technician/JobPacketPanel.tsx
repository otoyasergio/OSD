"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { TechnicianNotes } from "@/components/work_orders/TechnicianNotes";
import { addTechnicianNoteAction } from "@/app/(app)/work_orders/note-actions";
import type { JobPacket } from "@/lib/services/jobPacket";
import type { JobPacketSection } from "@/lib/technician/assignmentHref";
import { techJobPacketHref } from "@/lib/technician/assignmentHref";
import type { FloorStage } from "@/lib/technician/floorStage";
import type { IntakePhoto } from "@/lib/services/photos";
import type { WorkOrderJob } from "@/lib/services/workOrders";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { formatDateTime } from "@/lib/datetime/format";

function toNoteJobs(packet: JobPacket): WorkOrderJob[] {
  return packet.jobs.map(
    (job) =>
      ({
        job_id: job.job_id,
        service_name_snapshot: job.service_name,
      }) as WorkOrderJob
  );
}

export function JobPacketPanel({
  packet,
  section,
  closeHref,
  photos = [],
  selectedJobId = null,
  stage,
}: {
  packet: JobPacket;
  section: JobPacketSection | null;
  closeHref: string;
  photos?: IntakePhoto[];
  selectedJobId?: string | null;
  stage: FloorStage;
}) {
  const jobsRef = useRef<HTMLElement>(null);
  const notesRef = useRef<HTMLElement>(null);
  const photosRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const target =
      section === "jobs"
        ? jobsRef.current
        : section === "notes"
          ? notesRef.current
          : section === "photos"
            ? photosRef.current
            : null;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);

  const notesHref = techJobPacketHref(packet.work_order_id, {
    jobId: selectedJobId ?? undefined,
    section: "notes",
    stage,
  });
  const photosHref = techJobPacketHref(packet.work_order_id, {
    jobId: selectedJobId ?? undefined,
    section: "photos",
    stage,
  });

  return (
    <div className="floor-packet">
      <div className="floor-packet-scroll">
        <header className="floor-packet-header">
          <p className="floor-wo-meta">
            {packet.work_order_number} · {packet.wo_status_label}
          </p>
          <h2 className="floor-bike">{packet.motorcycle_label}</h2>
          <p className="floor-muted">
            Intake photos &amp; notes — available whenever this bike is on your docket
          </p>
          <div className="floor-packet-jump" aria-label="Jump to section">
            <Link href={notesHref} className="pit-secondary-link">
              Notes
            </Link>
            <Link href={photosHref} className="pit-secondary-link">
              Photos
            </Link>
          </div>
        </header>

        <section
          ref={jobsRef}
          id="floor-packet-jobs"
          className="floor-packet-section"
          aria-labelledby="floor-packet-jobs-title"
        >
          <h3 id="floor-packet-jobs-title" className="floor-section-title">
            Jobs on this visit
          </h3>
          {packet.jobs.length === 0 ? (
            <p className="floor-muted">No active jobs on this work order.</p>
          ) : (
            <ul className="floor-service-list">
              {packet.jobs.map((job) => {
                const content = (
                  <>
                    <span className="floor-service-main">
                      <span className="floor-service-name">{job.service_name}</span>
                      <span className="floor-service-meta">{job.status_label}</span>
                    </span>
                    <span className="floor-service-owner">
                      {job.assigned_to_me ? "Open on floor" : "Other tech"}
                    </span>
                  </>
                );

                return (
                  <li key={job.job_id}>
                    {job.assigned_to_me ? (
                      <Link
                        href={job.floor_href}
                        className={`floor-service-item${
                          selectedJobId === job.job_id
                            ? " floor-service-item--selected"
                            : ""
                        }`}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="floor-service-item floor-service-item--other">
                        {content}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          ref={notesRef}
          id="floor-packet-notes"
          className="floor-packet-section"
          aria-labelledby="floor-packet-notes-title"
        >
          <h3 id="floor-packet-notes-title" className="floor-section-title">
            Technician notes
          </h3>
          <TechnicianNotes
            notes={packet.notes}
            jobs={toNoteJobs(packet)}
            readOnly={false}
            canAdd
            addAction={addTechnicianNoteAction.bind(null, packet.work_order_id)}
          />
        </section>

        <section
          ref={photosRef}
          id="floor-packet-photos"
          className="floor-packet-section"
          aria-labelledby="floor-packet-photos-title"
        >
          <h3 id="floor-packet-photos-title" className="floor-section-title">
            Intake &amp; proof photos
          </h3>
          {photos.length === 0 ? (
            <p className="floor-muted">No intake or proof photos on file.</p>
          ) : (
            <ul className="floor-packet-photo-grid">
              {photos.map((photo) => (
                <li key={photo.photo_id} className="floor-packet-photo">
                  {photo.signed_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo.signed_url}
                      alt={`${PHOTO_CATEGORY_LABELS[photo.category]} photo`}
                      className="floor-packet-photo-img"
                    />
                  ) : (
                    <div className="floor-packet-photo-missing">Preview unavailable</div>
                  )}
                  <div className="floor-packet-photo-meta">
                    <span className="floor-service-name">
                      {PHOTO_CATEGORY_LABELS[photo.category]}
                    </span>
                    <span className="floor-muted">
                      {formatDateTime(photo.created_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="floor-packet-footer">
        <Link href={closeHref} className="btn btn-primary floor-tap floor-tap--wide">
          Back to job
        </Link>
      </footer>
    </div>
  );
}
