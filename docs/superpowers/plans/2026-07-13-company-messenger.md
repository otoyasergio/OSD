# Company Messenger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an internal, iMessage-style staff messenger — 1:1 + group chat, read receipts, typing, reply, reactions, photos, voice notes, edit/unsend/delete-for-me, search/mute/pin, and Twilio Video voice/video calls — fully separate from customer SMS.

**Architecture:** New `chat_*` tables with participant-scoped RLS (mirrors the `current_app_user_id()` / `is_active_app_user()` pattern already used everywhere). Supabase Realtime pushes new messages/reactions/participant/call changes to open threads and a personal `user:{id}` channel; typing is an ephemeral broadcast, not persisted. Media (photos + voice notes) lives in a `chat-media` Storage bucket, same shape as `lib/services/photos.ts`. Twilio Video rooms + JWT access tokens are minted from an authenticated server route; RLS on `chat_call` — not the route — is the real participant gate.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS + Realtime + Storage), Twilio Video (`twilio` + `twilio-video` — both new dependencies; this repo currently calls Twilio SMS via raw `fetch`, no SDK), Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-07-13-company-messenger-design.md](../specs/2026-07-13-company-messenger-design.md)

---

## File map

| File                                            | Responsibility                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `supabase/migrations/038_staff_messenger.sql`   | `chat_*` tables, RLS, `chat-media` bucket + storage policies, Realtime publication |
| `lib/database/supabase.generated.ts`            | Types for new tables                                                               |
| `lib/permissions/checks.ts`                     | `canUseMessenger`, `canManageGroupMembers`                                         |
| `lib/services/errors.ts`                        | New messenger/call error codes                                                     |
| `middleware.ts`                                 | Add `/messages` to `PROTECTED_PREFIXES`                                            |
| `components/layout/SidebarNav.tsx`              | Fill the reserved Communication slot with a Messages link                          |
| `lib/messenger/dmKey.ts`                        | Pure: sorted-pair DM key                                                           |
| `lib/messenger/directorySort.ts`                | Pure: active-location-first sort                                                   |
| `lib/messenger/unsendWindow.ts`                 | Pure: unsend time-window check                                                     |
| `lib/services/directory.ts`                     | Company-wide staff directory, location-first sort, search                          |
| `lib/services/messenger.ts`                     | Conversations, messages, read/mute/pin/hide, search                                |
| `app/(app)/messages/page.tsx`                   | Two-pane shell + empty state                                                       |
| `app/(app)/messages/[conversation_id]/page.tsx` | Selected thread                                                                    |
| `app/(app)/messages/directory/page.tsx`         | People browser                                                                     |
| `app/(app)/messages/new/page.tsx`               | Compose (DM or group)                                                              |
| `app/(app)/messages/actions.ts`                 | Server actions wrapping the services                                               |
| `components/messages/MessengerShell.tsx`        | Split pane / mobile list↔thread nav                                                |
| `components/messages/ConversationList.tsx`      | Pinned + recent list, unread/mute indicators                                       |
| `components/messages/ChatThread.tsx`            | Bubbles, day separators, reply quote, context menu                                 |
| `components/messages/MessageBubble.tsx`         | Single bubble + reactions row                                                      |
| `components/messages/Composer.tsx`              | Text + attach + hold-to-record + send                                              |
| `components/messages/DirectoryList.tsx`         | "At this location" / "All company" sections                                        |
| `lib/services/messengerAttachments.ts`          | Photo + voice-note upload/signing (Storage)                                        |
| `lib/twilio/video.ts`                           | Room create/fetch + Video access tokens                                            |
| `lib/services/messengerCalls.ts`                | Call lifecycle rows + `call_event` system messages                                 |
| `app/api/calls/token/route.ts`                  | Authenticated Twilio Video token endpoint                                          |
| `components/messages/CallOverlay.tsx`           | Incoming banner + in-call UI (Twilio Video JS SDK)                                 |
| `.env.local.example`                            | `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET`                                     |
| `package.json`                                  | Add `twilio`, `twilio-video`                                                       |
| `tests/unit/messengerDmKey.test.ts`             | DM key + find-or-create idempotency                                                |
| `tests/unit/directorySort.test.ts`              | Location-first sort                                                                |
| `tests/unit/messengerUnsendWindow.test.ts`      | Unsend window                                                                      |
| `tests/unit/messengerPermissions.test.ts`       | `canUseMessenger` / `canManageGroupMembers`                                        |
| `tests/e2e/messages.spec.ts`                    | Open Messages → start DM → send text (Twilio mocked)                               |

---

### Task 1: Schema, permission, nav, empty shell

**Files:**

- Create: `supabase/migrations/038_staff_messenger.sql`
- Modify: `lib/database/supabase.generated.ts`
- Modify: `lib/permissions/checks.ts`
- Modify: `middleware.ts`
- Modify: `components/layout/SidebarNav.tsx`
- Create: `app/(app)/messages/page.tsx`
- Create: `tests/unit/messengerPermissions.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Internal staff messenger: 1:1 + group chat, media, reactions, calls.
-- Separate from customer-facing SMS (lib/twilio/, sms_consent_event).

CREATE TABLE chat_conversation (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('dm', 'group')),
  title text,
  dm_key text,
  created_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversation_dm_key_check CHECK (
    (type = 'dm' AND dm_key IS NOT NULL) OR (type = 'group' AND dm_key IS NULL)
  )
);

-- Sorted "userIdA:userIdB" pair so "message X" always opens the same DM thread.
CREATE UNIQUE INDEX idx_chat_conversation_dm_key
  ON chat_conversation (dm_key) WHERE type = 'dm';

CREATE TABLE chat_participant (
  conversation_id uuid NOT NULL REFERENCES chat_conversation (conversation_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  muted_at timestamptz,
  pinned_at timestamptz,
  hidden_at timestamptz,
  left_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_chat_participant_user ON chat_participant (user_id);

CREATE TABLE chat_message (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversation (conversation_id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'image', 'audio', 'system', 'call_event')),
  body text,
  reply_to_message_id uuid REFERENCES chat_message (message_id) ON DELETE SET NULL,
  edited_at timestamptz,
  unsent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_message_conversation ON chat_message (conversation_id, created_at DESC);

CREATE TABLE chat_attachment (
  attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_message (message_id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  bytes integer,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_reaction (
  message_id uuid NOT NULL REFERENCES chat_message (message_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE chat_call (
  call_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversation (conversation_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('audio', 'video')),
  twilio_room_sid text,
  twilio_room_name text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('ringing', 'active', 'ended', 'missed')) DEFAULT 'ringing',
  started_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

-- RLS helper: current user is an active (non-left) participant of a conversation.
CREATE OR REPLACE FUNCTION public.is_chat_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_participant cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = current_app_user_id()
      AND cp.left_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_chat_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_chat_participant(uuid) TO authenticated, service_role;

ALTER TABLE chat_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_reaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_call ENABLE ROW LEVEL SECURITY;

-- chat_conversation: any active staff member may create (DM/group); read only as a participant.
CREATE POLICY chat_conversation_select ON chat_conversation
  FOR SELECT TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id));

CREATE POLICY chat_conversation_insert ON chat_conversation
  FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY chat_conversation_update ON chat_conversation
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id))
  WITH CHECK (is_active_app_user() AND public.is_chat_participant(conversation_id));

-- chat_participant: see co-participants of your own conversations; only touch your own row.
CREATE POLICY chat_participant_select ON chat_participant
  FOR SELECT TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id));

CREATE POLICY chat_participant_insert ON chat_participant
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND (user_id = current_app_user_id() OR public.is_chat_participant(conversation_id))
  );

CREATE POLICY chat_participant_update ON chat_participant
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND user_id = current_app_user_id())
  WITH CHECK (is_active_app_user() AND user_id = current_app_user_id());

-- chat_message: participants read; only the sender may insert as themselves or update (edit/unsend) their own row.
CREATE POLICY chat_message_select ON chat_message
  FOR SELECT TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id));

CREATE POLICY chat_message_insert ON chat_message
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND public.is_chat_participant(conversation_id)
    AND sender_user_id = current_app_user_id()
  );

CREATE POLICY chat_message_update ON chat_message
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND sender_user_id = current_app_user_id())
  WITH CHECK (is_active_app_user() AND sender_user_id = current_app_user_id());

-- chat_attachment: readable/insertable via the parent message's conversation.
CREATE POLICY chat_attachment_select ON chat_attachment
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM chat_message m
      WHERE m.message_id = chat_attachment.message_id
        AND public.is_chat_participant(m.conversation_id)
    )
  );

CREATE POLICY chat_attachment_insert ON chat_attachment
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM chat_message m
      WHERE m.message_id = chat_attachment.message_id
        AND m.sender_user_id = current_app_user_id()
    )
  );

-- chat_reaction: participants read; anyone may react/unreact as themselves.
CREATE POLICY chat_reaction_select ON chat_reaction
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM chat_message m
      WHERE m.message_id = chat_reaction.message_id
        AND public.is_chat_participant(m.conversation_id)
    )
  );

CREATE POLICY chat_reaction_insert ON chat_reaction
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND user_id = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM chat_message m
      WHERE m.message_id = chat_reaction.message_id
        AND public.is_chat_participant(m.conversation_id)
    )
  );

CREATE POLICY chat_reaction_delete ON chat_reaction
  FOR DELETE TO authenticated
  USING (is_active_app_user() AND user_id = current_app_user_id());

-- chat_call: participants only; server route inserts/updates using the caller's own session.
CREATE POLICY chat_call_select ON chat_call
  FOR SELECT TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id));

CREATE POLICY chat_call_insert ON chat_call
  FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user() AND public.is_chat_participant(conversation_id));

CREATE POLICY chat_call_update ON chat_call
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id))
  WITH CHECK (is_active_app_user() AND public.is_chat_participant(conversation_id));

-- Storage: chat-media bucket for photos + voice notes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  false,
  26214400,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
        'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/aac']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY chat_media_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media' AND is_active_app_user());

CREATE POLICY chat_media_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media' AND is_active_app_user());

CREATE POLICY chat_media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND is_active_app_user());

-- Realtime: first feature in this repo to use it — confirm in Studio if this errors
-- in a given environment (self-hosted publications can differ from cloud defaults).
ALTER PUBLICATION supabase_realtime ADD TABLE chat_message, chat_reaction, chat_participant, chat_call;
```

- [ ] **Step 2: Update generated types**

Run `npm run db:types` against a linked project with the migration applied, or hand-add `chat_conversation` / `chat_participant` / `chat_message` / `chat_attachment` / `chat_reaction` / `chat_call` Row/Insert/Update types to `lib/database/supabase.generated.ts` mirroring the migration columns.

- [ ] **Step 3: Permission gates (TDD)**

```ts
// tests/unit/messengerPermissions.test.ts
import { describe, expect, it } from "vitest";
import { canUseMessenger, canManageGroupMembers } from "@/lib/permissions/checks";

describe("canUseMessenger", () => {
  it("allows every active staff role", () => {
    for (const role of [
      "owner",
      "manager",
      "service_advisor",
      "technician",
      "admin",
    ] as const) {
      expect(canUseMessenger(role)).toBe(true);
    }
  });
});

describe("canManageGroupMembers", () => {
  it("allows the creator regardless of role", () => {
    expect(canManageGroupMembers("technician", true)).toBe(true);
  });
  it("allows owners/managers even if not the creator", () => {
    expect(canManageGroupMembers("manager", false)).toBe(true);
    expect(canManageGroupMembers("technician", false)).toBe(false);
  });
});
```

In `lib/permissions/checks.ts`:

```ts
const ACTIVE_STAFF_ROLES: UserRole[] = [
  "owner",
  "manager",
  "service_advisor",
  "technician",
  "admin",
];

/** Company messenger — every active role can use it. */
export function canUseMessenger(role: UserRole) {
  return ACTIVE_STAFF_ROLES.includes(role);
}

/** Add/remove group members: the creator, or an owner/manager. */
export function canManageGroupMembers(role: UserRole, isCreator: boolean) {
  return isCreator || OWNERS_MANAGERS.includes(role);
}
```

Run: `npm test -- tests/unit/messengerPermissions.test.ts` — expect PASS.

- [ ] **Step 4: Protect `/messages`**

In `middleware.ts`, add `"/messages"` to `PROTECTED_PREFIXES`.

- [ ] **Step 5: Nav — fill the Communication slot**

In `components/layout/SidebarNav.tsx`: import `canUseMessenger` and a `MessageSquare` (or similar) icon from `lucide-react`; add `"/messages": MessageSquare` to `NAV_ICONS`; build a `communicationLinks` array gated by `canUseMessenger(role)` and use it for the existing `communication` category's subgroup instead of the empty placeholder:

```ts
const communicationLinks: NavLink[] = [];
if (canUseMessenger(role)) {
  communicationLinks.push({
    href: "/messages",
    label: "Messages",
    icon: iconFor("/messages"),
  });
}
```

```ts
{
  id: "communication",
  label: "Communication",
  subgroups: communicationLinks.length > 0 ? [{ links: communicationLinks }] : [],
},
```

- [ ] **Step 6: Empty `/messages` shell**

`app/(app)/messages/page.tsx` — server component: `requireUser()`, `if (!canUseMessenger(user.role)) redirect("/dashboard")`, render a placeholder two-pane layout (empty conversation list + "Select a conversation" state). No data yet — this is a smoke-testable checkpoint before Task 2.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/038_staff_messenger.sql lib/database/supabase.generated.ts \
  lib/permissions/checks.ts middleware.ts components/layout/SidebarNav.tsx \
  app/\(app\)/messages/page.tsx tests/unit/messengerPermissions.test.ts
git commit -m "feat: add messenger schema, permission gate, nav slot, and empty shell"
```

---

### Task 2: Directory + find-or-create DM + text send/list + Realtime

**Files:**

- Create: `lib/messenger/dmKey.ts`
- Create: `lib/messenger/directorySort.ts`
- Create: `lib/services/directory.ts`
- Create: `lib/services/messenger.ts` (conversation list, `startDirectMessage`, send/list text messages)
- Create: `app/(app)/messages/actions.ts`
- Create: `app/(app)/messages/[conversation_id]/page.tsx`
- Create: `app/(app)/messages/directory/page.tsx`
- Create: `components/messages/MessengerShell.tsx`, `ConversationList.tsx`, `ChatThread.tsx`, `MessageBubble.tsx`, `Composer.tsx`, `DirectoryList.tsx`
- Create: `tests/unit/messengerDmKey.test.ts`, `tests/unit/directorySort.test.ts`
- Modify: `lib/services/errors.ts`

- [ ] **Step 1: Pure helpers (TDD)**

```ts
// lib/messenger/dmKey.ts
export function buildDmKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(":");
}
```

```ts
// lib/messenger/directorySort.ts
export type DirectoryStaffLike = {
  user_id: string;
  last_name: string;
  first_name: string;
  location_ids: string[];
};

/** Active-location staff first (alphabetical), then everyone else (alphabetical). */
export function sortDirectory<T extends DirectoryStaffLike>(
  staff: T[],
  activeLocationId: string | null
): T[] {
  const byName = (a: T, b: T) =>
    a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
  const atLocation = staff.filter(
    (s) => activeLocationId != null && s.location_ids.includes(activeLocationId)
  );
  const rest = staff.filter((s) => !atLocation.includes(s));
  return [...atLocation.sort(byName), ...rest.sort(byName)];
}
```

```ts
// tests/unit/directorySort.test.ts + tests/unit/messengerDmKey.test.ts
import { describe, expect, it } from "vitest";
import { buildDmKey } from "@/lib/messenger/dmKey";
import { sortDirectory } from "@/lib/messenger/directorySort";

describe("buildDmKey", () => {
  it("is order-independent", () => {
    expect(buildDmKey("a", "b")).toBe(buildDmKey("b", "a"));
  });
});

describe("sortDirectory", () => {
  it("puts active-location staff first, alphabetically, then everyone else", () => {
    const staff = [
      { user_id: "1", first_name: "Zoe", last_name: "Zephyr", location_ids: ["loc-2"] },
      { user_id: "2", first_name: "Amy", last_name: "Adams", location_ids: ["loc-1"] },
      { user_id: "3", first_name: "Bob", last_name: "Baker", location_ids: ["loc-1"] },
    ];
    const sorted = sortDirectory(staff, "loc-1");
    expect(sorted.map((s) => s.user_id)).toEqual(["2", "3", "1"]);
  });
});
```

Run: `npm test -- tests/unit/messengerDmKey.test.ts tests/unit/directorySort.test.ts` — expect PASS.

- [ ] **Step 2: Errors**

In `lib/services/errors.ts`:

```ts
CONVERSATION_NOT_FOUND: "That conversation no longer exists.",
NOT_A_PARTICIPANT: "You're not part of this conversation.",
SELF_DM_NOT_ALLOWED: "You can't start a conversation with yourself.",
RECIPIENT_REQUIRED: "Choose at least one person to message.",
MESSAGE_NOT_FOUND: "That message no longer exists.",
NOT_MESSAGE_SENDER: "You can only change your own messages.",
```

- [ ] **Step 3: Directory service**

`lib/services/directory.ts`:

```ts
export type DirectoryStaff = {
  user_id: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  location_ids: string[];
};

export async function listDirectory(search?: string): Promise<DirectoryStaff[]> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  let query = supabase
    .from("app_user")
    .select("user_id, first_name, last_name, role, user_location(location_id)")
    .eq("status", "active")
    .neq("user_id", user.user_id);

  if (search?.trim()) {
    query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const staff = (data ?? []).map((row) => ({
    user_id: row.user_id,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role as UserRole,
    location_ids: (row.user_location ?? []).map(
      (l: { location_id: string }) => l.location_id
    ),
  }));

  return sortDirectory(staff, user.active_location_id);
}
```

- [ ] **Step 4: Messenger service — conversations + text messages**

`lib/services/messenger.ts` — key exports: `listConversations()`, `startDirectMessage(otherUserId)`, `getConversation(conversationId)`, `listMessages(conversationId)`, `sendTextMessage(conversationId, body, replyToMessageId?)`, `markConversationRead(conversationId)`.

```ts
export async function startDirectMessage(otherUserId: string): Promise<Conversation> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  if (otherUserId === user.user_id) throw new Error("SELF_DM_NOT_ALLOWED");

  const supabase = await createClient();
  const dmKey = buildDmKey(user.user_id, otherUserId);

  const { data: existing, error: findError } = await supabase
    .from("chat_conversation")
    .select(CONVERSATION_COLUMNS)
    .eq("dm_key", dmKey)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing as Conversation;

  const { data: created, error: insertError } = await supabase
    .from("chat_conversation")
    .insert({ type: "dm", dm_key: dmKey, created_by_user_id: user.user_id })
    .select(CONVERSATION_COLUMNS)
    .single();

  if (insertError) {
    // 23505 = unique violation: someone else created this DM between our select and insert.
    if (insertError.code === "23505") {
      const { data: raceWinner, error: reselectError } = await supabase
        .from("chat_conversation")
        .select(CONVERSATION_COLUMNS)
        .eq("dm_key", dmKey)
        .single();
      if (reselectError) throw reselectError;
      return raceWinner as Conversation;
    }
    throw insertError;
  }

  const { error: participantError } = await supabase.from("chat_participant").insert([
    { conversation_id: created.conversation_id, user_id: user.user_id },
    { conversation_id: created.conversation_id, user_id: otherUserId },
  ]);
  if (participantError) throw participantError;

  return created as Conversation;
}
```

`sendTextMessage` inserts into `chat_message` with `sender_user_id: user.user_id`, `kind: "text"`, then updates `chat_conversation.last_message_at`. Reuse a shared `requireParticipant(supabase, conversationId, userId)` guard (belt-and-suspenders on top of RLS) before every read/write.

- [ ] **Step 5: Server actions**

`app/(app)/messages/actions.ts` — thin wrappers: `startDirectMessageAction`, `sendMessageAction`, `markReadAction`, each calling the service, mapping errors with `toFormErrorMessage`, and `revalidatePath("/messages")` / `revalidatePath(\`/messages/${conversationId}\`)` as appropriate.

- [ ] **Step 6: Routes + components**

- `app/(app)/messages/page.tsx` and `.../[conversation_id]/page.tsx` share `MessengerShell` (list + thread panes; on narrow viewports, list ↔ thread navigation).
- `ConversationList` — one row per conversation: name (other participant, or group title), last message preview, timestamp, unread badge.
- `ChatThread` — day separators, `MessageBubble` per message (own = `--accent` orange, theirs = neutral gray per the spec), a `Composer` pinned at the bottom.
- `DirectoryList` on `app/(app)/messages/directory/page.tsx` — "At this location" / "All company" sections from `listDirectory()`; tapping a person calls `startDirectMessageAction` and routes to the resulting conversation.

- [ ] **Step 7: Realtime**

Client-side, inside `ChatThread` (or a `useConversationRealtime` hook): subscribe with the browser client to `postgres_changes` INSERT on `chat_message` filtered by `conversation_id=eq.<id>`, append incoming rows, and unsubscribe on unmount/conversation change. A separate personal channel (`user:{app_user.user_id}`) drives inbox bumps and — later — incoming-call banners from `ConversationList`'s parent layout.

- [ ] **Step 8: Manual check**

Run: `npm run dev` → open `/messages/directory`, start a DM, send a few messages, confirm they appear live in a second browser session signed in as the other participant.

- [ ] **Step 9: Commit**

```bash
git add lib/messenger lib/services/directory.ts lib/services/messenger.ts lib/services/errors.ts \
  app/\(app\)/messages components/messages tests/unit/messengerDmKey.test.ts tests/unit/directorySort.test.ts
git commit -m "feat: add staff directory, DM find-or-create, and realtime text messaging"
```

---

### Task 3: Groups, read receipts, typing, reply, reactions

**Files:**

- Modify: `lib/services/messenger.ts` (`createGroup`, `addGroupMembers`, `removeGroupMember`, `markConversationRead`, `replyTo` support, `toggleReaction`)
- Modify: `app/(app)/messages/actions.ts`
- Modify: `app/(app)/messages/new/page.tsx` (create if not already stubbed in Task 2)
- Modify: `components/messages/ChatThread.tsx`, `MessageBubble.tsx`, `Composer.tsx`
- Create: `components/messages/GroupComposer.tsx` (multi-select → title + create)

- [ ] **Step 1: Groups**

`createGroup({ title, memberUserIds })` — validates at least one other member (`RECIPIENT_REQUIRED`), inserts `chat_conversation` (`type: "group"`), inserts the creator + members into `chat_participant`. `addGroupMembers` / `removeGroupMember` gated by `canManageGroupMembers(user.role, conversation.created_by_user_id === user.user_id)`.

- [ ] **Step 2: Read receipts**

`markConversationRead(conversationId)` — `update chat_participant set last_read_at = now() where conversation_id = ... and user_id = current user`. `ChatThread` computes "Delivered" vs "Read" per own message by comparing `created_at` against the other participant(s)' `last_read_at` (DM: single comparison; group: could show "Read by N" — keep DM-parity behavior as the baseline, group receipts are a nice-to-have, not a blocker).

- [ ] **Step 3: Typing (ephemeral, not persisted)**

Broadcast-only Realtime channel per conversation:

```ts
const channel = supabase.channel(`conversation:${conversationId}`);
channel.on("broadcast", { event: "typing" }, ({ payload }) =>
  setTypingUser(payload.user_id)
);
channel.subscribe();

// on keystroke, throttled:
channel.send({ type: "broadcast", event: "typing", payload: { user_id: currentUserId } });
```

No table, no RLS needed — broadcast payloads aren't persisted. Clear the typing indicator on a short timeout (e.g. 3s of no new events) or on message send.

- [ ] **Step 4: Reply-to**

`Composer` gains a "replying to" state; `sendMessage` accepts `replyToMessageId`; `MessageBubble` renders a quoted snippet above the bubble when `reply_to_message_id` is set (fetch the referenced message's `body`/kind for the quote — join in `listMessages`).

- [ ] **Step 5: Reactions**

`toggleReaction(messageId, emoji)` — insert `chat_reaction`; if the same `(message_id, user_id, emoji)` already exists, delete it instead (toggle). `MessageBubble` renders a compact reaction row grouped by emoji with counts.

- [ ] **Step 6: Commit**

```bash
git add lib/services/messenger.ts app/\(app\)/messages components/messages
git commit -m "feat: add group chats, read receipts, typing, reply, and reactions"
```

---

### Task 4: Photos + voice notes, edit/unsend/delete-for-me

**Files:**

- Create: `lib/services/messengerAttachments.ts`
- Create: `lib/messenger/unsendWindow.ts`
- Create: `tests/unit/messengerUnsendWindow.test.ts`
- Modify: `lib/services/messenger.ts` (`editMessage`, `unsendMessage`, `hideConversationForMe`)
- Modify: `lib/services/errors.ts`
- Modify: `components/messages/Composer.tsx` (photo picker, hold-to-record), `MessageBubble.tsx` (context menu), `ConversationList.tsx` (hidden state)

- [ ] **Step 1: Unsend window (TDD)**

```ts
// lib/messenger/unsendWindow.ts
const UNSEND_WINDOW_MS = 15 * 60 * 1000;

export function canUnsendMessage(createdAt: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() <= UNSEND_WINDOW_MS;
}
```

```ts
// tests/unit/messengerUnsendWindow.test.ts
import { describe, expect, it } from "vitest";
import { canUnsendMessage } from "@/lib/messenger/unsendWindow";

describe("canUnsendMessage", () => {
  it("allows within 15 minutes", () => {
    const now = new Date("2026-07-13T12:10:00Z");
    expect(canUnsendMessage("2026-07-13T12:00:00Z", now)).toBe(true);
  });
  it("blocks after 15 minutes", () => {
    const now = new Date("2026-07-13T12:16:00Z");
    expect(canUnsendMessage("2026-07-13T12:00:00Z", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Errors**

```ts
UNSEND_WINDOW_EXPIRED: "This message is too old to unsend.",
ATTACHMENT_TOO_LARGE: "Attachments must be 25 MB or smaller.",
ATTACHMENT_TYPE_INVALID: "That file type isn't supported in Messages.",
ATTACHMENT_UPLOAD_FAILED: "Could not upload the attachment. Try again.",
```

- [ ] **Step 3: Attachments service**

`lib/services/messengerAttachments.ts` — mirrors `lib/services/photos.ts`: `BUCKET = "chat-media"`, `MAX_BYTES = 25 * 1024 * 1024`, `ALLOWED_IMAGE_TYPES` / `ALLOWED_AUDIO_TYPES`, `uploadChatImage(conversationId, file)` and `uploadVoiceNote(conversationId, file, durationMs)` — both: `requireUser()` + `requireParticipant`, validate type/size, `storagePath = \`${conversationId}/${messageId}/${filename}\``, upload, insert `chat_message` (`kind: "image" | "audio"`) + `chat_attachment`row, roll back the storage object if the DB insert fails (same pattern as`uploadIntakePhoto`). Reuse `signStoragePaths`-style signing for display URLs.

- [ ] **Step 4: Composer — attach + record**

Photo: standard file input → `uploadChatImage`. Voice note: `MediaRecorder` API, hold-to-record button, on release stop the recorder, get a `Blob`, wrap as a `File`, → `uploadVoiceNote`. Show a waveform-free simple duration label (keep v1 simple — no waveform rendering required by the spec).

- [ ] **Step 5: Edit / unsend / delete-for-me**

```ts
export async function editMessage(messageId: string, body: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: message, error } = await supabase
    .from("chat_message")
    .select("message_id, sender_user_id, kind, unsent_at")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message) throw new Error("MESSAGE_NOT_FOUND");
  if (message.sender_user_id !== user.user_id) throw new Error("NOT_MESSAGE_SENDER");
  if (message.unsent_at) throw new Error("MESSAGE_NOT_FOUND");
  if (message.kind !== "text") throw new Error("NOT_MESSAGE_SENDER");

  const { error: updateError } = await supabase
    .from("chat_message")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("message_id", messageId);
  if (updateError) throw updateError;
}

export async function unsendMessage(messageId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: message, error } = await supabase
    .from("chat_message")
    .select("message_id, sender_user_id, created_at, unsent_at")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message) throw new Error("MESSAGE_NOT_FOUND");
  if (message.sender_user_id !== user.user_id) throw new Error("NOT_MESSAGE_SENDER");
  if (message.unsent_at) return; // already unsent — idempotent
  if (!canUnsendMessage(message.created_at)) throw new Error("UNSEND_WINDOW_EXPIRED");

  const { error: updateError } = await supabase
    .from("chat_message")
    .update({ body: null, unsent_at: new Date().toISOString() })
    .eq("message_id", messageId);
  if (updateError) throw updateError;
  // Attachment rows are left in place; UI hides everything on a message once unsent_at is set.
}

export async function hideConversationForMe(conversationId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_participant")
    .update({ hidden_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.user_id);
  if (error) throw error;
}
```

`ConversationList` filters out conversations where the viewer's own `hidden_at` is set (delete-for-me); a new incoming message should clear `hidden_at` again so the thread reappears (handle in `sendTextMessage`/attachment upload: on insert, `update chat_participant set hidden_at = null where conversation_id = ... and user_id != sender`).

- [ ] **Step 6: Commit**

```bash
git add lib/messenger/unsendWindow.ts lib/services/messenger.ts lib/services/messengerAttachments.ts \
  lib/services/errors.ts components/messages tests/unit/messengerUnsendWindow.test.ts
git commit -m "feat: add photo/voice-note attachments, edit, unsend, and delete-for-me"
```

---

### Task 5: Search, mute, pin

**Files:**

- Modify: `lib/services/messenger.ts` (`searchMessages`, `setMuted`, `setPinned`)
- Modify: `app/(app)/messages/actions.ts`
- Modify: `components/messages/ConversationList.tsx` (pinned section, mute indicator), add a search input to `MessengerShell.tsx`

- [ ] **Step 1: Search**

`searchMessages(query)` — `ILIKE` on `chat_message.body`, scoped to conversations where `public.is_chat_participant(conversation_id)` (RLS already enforces this; the query just needs `conversation_id in (select conversation_id from chat_participant where user_id = current)` or rely on RLS + a plain select). Return conversation + message snippet + timestamp for a simple results list.

- [ ] **Step 2: Mute / pin**

`setMuted(conversationId, muted: boolean)` and `setPinned(conversationId, pinned: boolean)` — update `chat_participant.muted_at` / `pinned_at` (null vs `now()`) for the current user only. Muted conversations skip unread-badge emphasis (and, later, push notification hooks if added); pinned conversations render in a "Pinned" section above the regular list, ordered by `pinned_at`.

- [ ] **Step 3: Commit**

```bash
git add lib/services/messenger.ts app/\(app\)/messages components/messages
git commit -m "feat: add message search, mute, and pin"
```

---

### Task 6: Twilio Video — tokens + call lifecycle

**Files:**

- Modify: `package.json` (add `twilio`, `twilio-video`)
- Create: `lib/twilio/video.ts`
- Create: `lib/services/messengerCalls.ts`
- Create: `app/api/calls/token/route.ts`
- Create: `components/messages/CallOverlay.tsx`
- Modify: `.env.local.example`
- Modify: `lib/services/errors.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install twilio twilio-video
```

- [ ] **Step 2: Env**

```bash
# .env.local.example additions
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
# TWILIO_ACCOUNT_SID already present for SMS
```

- [ ] **Step 3: Errors**

```ts
TWILIO_VIDEO_NOT_CONFIGURED: "Video calling is not configured. Add TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET.",
CALL_NOT_FOUND: "That call no longer exists.",
CALL_ALREADY_ENDED: "That call has already ended.",
```

- [ ] **Step 4: Room + token helper**

```ts
// lib/twilio/video.ts
import twilio from "twilio";

function getVideoConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim() ?? "";
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim() ?? "";
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    throw new Error("TWILIO_VIDEO_NOT_CONFIGURED");
  }
  return { accountSid, apiKeySid, apiKeySecret };
}

export function isTwilioVideoConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_API_KEY_SID?.trim() &&
    process.env.TWILIO_API_KEY_SECRET?.trim()
  );
}

export function createVideoAccessToken(identity: string, roomName: string): string {
  const { accountSid, apiKeySid, apiKeySecret } = getVideoConfig();
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 60 * 60,
  });
  token.addGrant(new AccessToken.VideoGrant({ room: roomName }));
  return token.toJwt();
}

export async function ensureVideoRoom(roomName: string): Promise<{ sid: string }> {
  const { accountSid, apiKeySid, apiKeySecret } = getVideoConfig();
  const client = twilio(apiKeySid, apiKeySecret, { accountSid });
  try {
    const room = await client.video.v1.rooms.create({
      uniqueName: roomName,
      type: "group",
    });
    return { sid: room.sid };
  } catch (err) {
    // 53113: room with this unique name already exists — fetch instead.
    if ((err as { code?: number })?.code === 53113) {
      const room = await client.video.v1.rooms(roomName).fetch();
      return { sid: room.sid };
    }
    throw err;
  }
}
```

- [ ] **Step 5: Call service**

`lib/services/messengerCalls.ts`: `startCall(conversationId, kind: "audio" | "video")` — checks participant, builds a unique `twilio_room_name` (e.g. `conv-${conversationId}-${Date.now()}`), calls `ensureVideoRoom`, inserts `chat_call` (`status: "ringing"`) and a `chat_message` (`kind: "call_event"`, e.g. `"Video call started"`), returns the call row (Realtime fans it out to participants — the callee's client renders the incoming banner). `acceptCall` / `declineCall` / `endCall` update `chat_call.status` (`active` / `missed` / `ended`) and `ended_at`, and on end, insert a `call_event` message with duration (`"Video call · 4:12"`).

- [ ] **Step 6: Token route**

```ts
// app/api/calls/token/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createVideoAccessToken, isTwilioVideoConfigured } from "@/lib/twilio/video";

export async function POST(request: Request) {
  const user = await requireUser();
  const { call_id } = (await request.json()) as { call_id?: string };
  if (!call_id) return NextResponse.json({ error: "CALL_NOT_FOUND" }, { status: 404 });
  if (!isTwilioVideoConfigured()) {
    return NextResponse.json({ error: "TWILIO_VIDEO_NOT_CONFIGURED" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: call, error } = await supabase
    .from("chat_call")
    .select("call_id, twilio_room_name, status")
    .eq("call_id", call_id)
    .maybeSingle();
  // RLS restricts chat_call to participants — a miss here means "not found or not yours."
  if (error || !call)
    return NextResponse.json({ error: "CALL_NOT_FOUND" }, { status: 404 });
  if (call.status === "ended" || call.status === "missed") {
    return NextResponse.json({ error: "CALL_ALREADY_ENDED" }, { status: 409 });
  }

  const token = createVideoAccessToken(user.user_id, call.twilio_room_name);
  return NextResponse.json({ token, room_name: call.twilio_room_name });
}
```

- [ ] **Step 7: Call UI**

`CallOverlay` — lazy-loaded client component (`next/dynamic`, `ssr: false`, to keep `twilio-video` out of the main bundle): incoming banner (Accept/Decline) driven by the personal `user:{id}` Realtime channel; on Accept, `fetch("/api/calls/token", { method: "POST", body: JSON.stringify({ call_id }) })`, then `Video.connect(token, { name: room_name })` from `twilio-video`; renders local/remote video tracks (audio-only calls just skip attaching video tracks), mute/camera-toggle/end controls. Wire audio/video call buttons into the conversation header.

- [ ] **Step 8: Manual check**

Run: `npm run dev` with `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` set → start a call from one browser, accept from another signed in as the callee, confirm both connect and "End call" posts the duration system message.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json lib/twilio/video.ts lib/services/messengerCalls.ts \
  app/api/calls/token/route.ts components/messages/CallOverlay.tsx .env.local.example lib/services/errors.ts
git commit -m "feat: add Twilio Video calling to the company messenger"
```

---

### Task 7: Final verification

- [ ] **Step 1: Unit suite**

Run: `npm test -- tests/unit/messengerDmKey.test.ts tests/unit/directorySort.test.ts tests/unit/messengerUnsendWindow.test.ts tests/unit/messengerPermissions.test.ts`

Expected: PASS

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

Expected: PASS

- [ ] **Step 3: Playwright smoke**

```ts
// tests/e2e/messages.spec.ts — sketch
test("start a DM from the directory and send a text", async ({ page }) => {
  await loginAsStaff(page); // reuse existing test auth helper
  await page.goto("/messages/directory");
  await page.getByText("At this location").waitFor();
  await page.getByRole("link", { name: /some staff name/i }).click();
  await page.getByPlaceholder("Message").fill("Hey, quick question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hey, quick question")).toBeVisible();
});
```

Mock `/api/calls/token` in CI rather than hitting live Twilio.

- [ ] **Step 4: Manual smoke checklist**

1. Directory sorts active-location staff above the rest.
2. DM start is idempotent — messaging the same person twice opens the same thread.
3. Group create/add/remove respects `canManageGroupMembers`.
4. Read receipts flip Delivered → Read; typing indicator appears/disappears.
5. Photo + voice note upload, play back, and display correctly.
6. Edit updates `edited_at`; unsend clears the body after 15 min blocks with a clear error; delete-for-me hides the thread only for that user and it reappears on a new incoming message.
7. Search finds a message by body text; mute suppresses unread emphasis; pin reorders the list.
8. Audio and video calls connect, ring, and show a duration system message on end.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address messenger verification gaps"
```

(Only if fixes were needed; otherwise skip the empty commit.)

---

## Spec coverage checklist

| Spec requirement                                                 | Task    |
| ---------------------------------------------------------------- | ------- |
| Schema + RLS + Realtime publication                              | 1       |
| `canUseMessenger` gate + nav slot + `/messages` protected        | 1       |
| Location-first directory                                         | 2       |
| DM find-or-create idempotency                                    | 2       |
| Text send/list + Realtime                                        | 2       |
| Groups + membership permissions                                  | 3       |
| Read receipts, typing, reply, reactions                          | 3       |
| Photos + voice notes (Storage)                                   | 4       |
| Edit / unsend (15 min) / delete-for-me                           | 4       |
| Search / mute / pin                                              | 5       |
| Twilio Video tokens + call lifecycle UI                          | 6       |
| Unit: DM idempotency, permissions, directory sort, unsend window | 2, 4, 1 |
| Light Playwright smoke                                           | 7       |

## Self-review notes

- Every RLS policy composes with the existing `current_app_user_id()` / `is_active_app_user()` helpers — no new identity model introduced.
- `chat_call` writes always go through the server route/service using the caller's own session; RLS (not the route) is the actual trust boundary for who can read/join a call.
- Realtime is genuinely new to this codebase (grepped: no prior `.channel(` usage) — Task 1's migration comment flags this so the implementer double-checks the publication exists in the target environment before relying on it.
- Twilio Video needs two new npm packages (`twilio`, `twilio-video`) since the existing SMS integration is fetch-only — flagged in Task 6, Step 1 rather than assumed.
