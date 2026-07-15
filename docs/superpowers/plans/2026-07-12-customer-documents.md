# Customer Documents Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a Documents section on customer profiles with manual uploads and auto-filed signed drop-off agreements.

**Architecture:** Unified `customer_document` rows; uploads in `customer-documents` bucket; contract rows point at existing `contract-signatures` objects. Permissions in app layer.

**Tech Stack:** Next.js, Supabase Postgres + Storage, Vitest

---

### Task 1: Migration + RLS + bucket

- Create: `supabase/migrations/031_customer_documents.sql`
- Backfill existing signed agreements into `customer_document`

### Task 2: Permissions + service

- Modify: `lib/permissions/checks.ts`
- Create: `lib/services/customerDocuments.ts`
- Wire: `lib/services/contracts.ts`, `lib/services/portal.ts`
- Errors in `lib/services/errors.ts`

### Task 3: UI + actions

- Create: `components/customers/CustomerDocuments.tsx`
- Create: `app/(app)/customers/document-actions.ts`
- Modify: `app/(app)/customers/[customer_id]/page.tsx`

### Task 4: Tests

- Permissions unit tests for view/upload/delete
