import twilio from "twilio";
import { requireUser, type AppUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import { buildPhoneLookupVariants } from "@/lib/customers/duplicates";
import { canUseMessenger, canUseShopPhone } from "@/lib/permissions";
import { selectInboundRingTargets } from "@/lib/twilio/inboundRing";
import { authorizeOutboundVoice } from "@/lib/twilio/outboundVoice";
import { normalizePhoneE164 } from "@/lib/twilio/phone";
import { isPresenceFresh } from "@/lib/twilio/presenceFresh";
import { encodeVoiceIdentity, decodeVoiceIdentity } from "@/lib/twilio/voiceIdentity";
import {
  inboundPstnTwiml,
  missedCallTwiml,
  outboundPstnTwiml,
  staffAudioTwiml,
} from "@/lib/twilio/voiceTwiml";
import { getTwilioVoiceConfig, isTwilioVoiceConfigured } from "@/lib/twilio/voiceConfig";
import { mapTwilioCallStatus } from "@/lib/twilio/voiceStatusMap";

const PHONE_CALL_COLUMNS =
  "phone_call_id, direction, channel, location_id, from_e164, to_e164, from_user_id, to_user_id, customer_id, work_order_id, conversation_id, twilio_call_sid, status, started_at, answered_at, ended_at, duration_seconds, created_at";

export type PhoneCall = {
  phone_call_id: string;
  direction: "inbound" | "outbound";
  channel: "staff" | "pstn";
  location_id: string;
  from_e164: string | null;
  to_e164: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  customer_id: string | null;
  work_order_id: string | null;
  conversation_id: string | null;
  twilio_call_sid: string | null;
  status: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  counterparty_label: string;
};

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

async function requireMessenger(): Promise<AppUser> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  return user;
}

async function lookupCustomerByPhone(
  admin: ReturnType<typeof createAdminClient>,
  e164: string | null
): Promise<{ customer_id: string; first_name: string; last_name: string } | null> {
  if (!e164) return null;
  const variants = buildPhoneLookupVariants(e164);
  if (variants.length === 0) return null;
  const { data } = await admin
    .from("customer")
    .select("customer_id, first_name, last_name, phone")
    .in("phone", variants)
    .limit(1)
    .maybeSingle();
  return data
    ? {
        customer_id: data.customer_id,
        first_name: data.first_name,
        last_name: data.last_name,
      }
    : null;
}

export async function heartbeatVoicePresence(): Promise<void> {
  const user = await requireMessenger();
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("staff_voice_presence").upsert(
    {
      user_id: user.user_id,
      location_id: user.active_location_id,
      updated_at: now,
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

export async function clearVoicePresence(): Promise<void> {
  const user = await requireMessenger();
  const supabase = await createClient();
  await supabase.from("staff_voice_presence").delete().eq("user_id", user.user_id);
}

export async function listOnlineStaffIds(): Promise<string[]> {
  const user = await requireMessenger();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_voice_presence")
    .select("user_id, updated_at");
  if (error) throw error;
  const now = new Date();
  return (data ?? [])
    .filter((row) => isPresenceFresh(row.updated_at, now))
    .map((row) => row.user_id)
    .filter((id) => id !== user.user_id);
}

export async function prepareOutboundPstnCall(input: {
  to?: string | null;
  customerId?: string | null;
  workOrderId?: string | null;
}): Promise<{
  phoneCallId: string;
  to: string;
  customerName: string | null;
}> {
  const user = await requireUser();
  if (!canUseShopPhone(user.role)) throw new Error("FORBIDDEN");
  if (!isTwilioVoiceConfigured()) throw new Error("TWILIO_VOICE_NOT_CONFIGURED");
  const locationId = user.active_location_id;
  if (!locationId) throw new Error("NO_LOCATION");

  const supabase = await createClient();
  const { data: location, error: locError } = await supabase
    .from("location")
    .select("location_id, voice_e164")
    .eq("location_id", locationId)
    .maybeSingle();
  if (locError) throw locError;
  if (!location?.voice_e164) throw new Error("SHOP_PHONE_NUMBER_MISSING");

  const customerId = input.customerId ?? null;
  let customerName: string | null = null;
  let to = normalizePhoneE164(input.to);

  if (customerId) {
    const { data: customer } = await supabase
      .from("customer")
      .select("customer_id, first_name, last_name, phone")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (customer) {
      customerName = `${customer.first_name} ${customer.last_name}`.trim();
      to = to ?? normalizePhoneE164(customer.phone);
    }
  }
  if (!to) throw new Error("INVALID_PHONE");

  const { data: call, error } = await supabase
    .from("phone_call")
    .insert({
      direction: "outbound",
      channel: "pstn",
      location_id: locationId,
      from_e164: location.voice_e164,
      to_e164: to,
      from_user_id: user.user_id,
      customer_id: customerId,
      work_order_id: input.workOrderId ?? null,
      status: "ringing",
    })
    .select("phone_call_id")
    .single();
  if (error) throw error;

  return { phoneCallId: call.phone_call_id, to, customerName };
}

export async function prepareOutboundStaffCall(input: {
  conversationId: string;
}): Promise<{
  phoneCallId: string;
  toUserIds: string[];
  displayName: string;
}> {
  const user = await requireMessenger();
  if (!isTwilioVoiceConfigured()) throw new Error("TWILIO_VOICE_NOT_CONFIGURED");
  const locationId = user.active_location_id;
  if (!locationId) throw new Error("NO_LOCATION");

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("chat_participant")
    .select("user_id")
    .eq("conversation_id", input.conversationId)
    .eq("user_id", user.user_id)
    .is("left_at", null)
    .maybeSingle();
  if (!membership) throw new Error("NOT_A_PARTICIPANT");

  const { data: participants } = await supabase
    .from("chat_participant")
    .select("user_id, left_at, app_user:user_id (first_name, last_name)")
    .eq("conversation_id", input.conversationId)
    .is("left_at", null);

  const others = (participants ?? []).filter((row) => row.user_id !== user.user_id);
  if (others.length === 0) throw new Error("RECIPIENT_REQUIRED");

  const displayName = others
    .map((row) => {
      const person = row.app_user as { first_name?: string; last_name?: string } | null;
      return `${person?.first_name ?? ""} ${person?.last_name ?? ""}`.trim();
    })
    .filter(Boolean)
    .join(", ");

  const { data: call, error } = await supabase
    .from("phone_call")
    .insert({
      direction: "outbound",
      channel: "staff",
      location_id: locationId,
      from_user_id: user.user_id,
      to_user_id: others.length === 1 ? others[0].user_id : null,
      conversation_id: input.conversationId,
      status: "ringing",
    })
    .select("phone_call_id")
    .single();
  if (error) throw error;

  await supabase.from("chat_message").insert({
    conversation_id: input.conversationId,
    sender_user_id: user.user_id,
    kind: "call_event",
    body: "Audio call started",
  });
  await supabase
    .from("chat_conversation")
    .update({ last_message_at: new Date().toISOString() })
    .eq("conversation_id", input.conversationId);

  return {
    phoneCallId: call.phone_call_id,
    toUserIds: others.map((row) => row.user_id),
    displayName: displayName || "Staff",
  };
}

export async function listPhoneCalls(): Promise<PhoneCall[]> {
  const user = await requireMessenger();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phone_call")
    .select(
      `${PHONE_CALL_COLUMNS}, customer:customer_id (first_name, last_name), from_user:from_user_id (first_name, last_name), to_user:to_user_id (first_name, last_name)`
    )
    .eq("location_id", user.active_location_id!)
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const customer = row.customer as { first_name?: string; last_name?: string } | null;
    const fromUser = row.from_user as { first_name?: string; last_name?: string } | null;
    const toUser = row.to_user as { first_name?: string; last_name?: string } | null;
    const customerLabel = customer
      ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim()
      : "";
    const staffLabel =
      row.direction === "outbound"
        ? `${toUser?.first_name ?? ""} ${toUser?.last_name ?? ""}`.trim()
        : `${fromUser?.first_name ?? ""} ${fromUser?.last_name ?? ""}`.trim();
    const numberLabel = row.direction === "outbound" ? row.to_e164 : row.from_e164;
    return {
      phone_call_id: row.phone_call_id,
      direction: row.direction as PhoneCall["direction"],
      channel: row.channel as PhoneCall["channel"],
      location_id: row.location_id,
      from_e164: row.from_e164,
      to_e164: row.to_e164,
      from_user_id: row.from_user_id,
      to_user_id: row.to_user_id,
      customer_id: row.customer_id,
      work_order_id: row.work_order_id,
      conversation_id: row.conversation_id,
      twilio_call_sid: row.twilio_call_sid,
      status: row.status,
      started_at: row.started_at,
      answered_at: row.answered_at,
      ended_at: row.ended_at,
      duration_seconds: row.duration_seconds,
      created_at: row.created_at,
      counterparty_label: customerLabel || staffLabel || numberLabel || "Unknown",
    };
  });
}

export async function handleInboundVoice(
  params: Record<string, string>
): Promise<string> {
  const admin = createAdminClient();
  const toE164 = normalizePhoneE164(params.To);
  const fromE164 = normalizePhoneE164(params.From);
  if (!toE164) return missedCallTwiml();

  const { data: location } = await admin
    .from("location")
    .select("location_id, voice_e164")
    .eq("voice_e164", toE164)
    .maybeSingle();
  if (!location) return missedCallTwiml();

  const { data: memberships } = await admin
    .from("user_location")
    .select("user_id, location_id")
    .eq("location_id", location.location_id);
  const memberIds = (memberships ?? []).map((row) => row.user_id);
  const { data: users } = memberIds.length
    ? await admin
        .from("app_user")
        .select("user_id, role, status")
        .in("user_id", memberIds)
        .eq("status", "active")
    : { data: [] as Array<{ user_id: string; role: string; status: string }> };

  const { data: presenceRows } = await admin
    .from("staff_voice_presence")
    .select("user_id, location_id, updated_at")
    .eq("location_id", location.location_id);

  const presenceByUser = new Map((presenceRows ?? []).map((row) => [row.user_id, row]));

  const targets = selectInboundRingTargets({
    calledLocationId: location.location_id,
    candidates: (users ?? []).map((person) => {
      const presence = presenceByUser.get(person.user_id);
      return {
        userId: person.user_id,
        role: person.role as AppUser["role"],
        membershipLocationIds: [location.location_id],
        activeLocationId: presence?.location_id ?? null,
        presenceLocationId: presence?.location_id ?? null,
        presenceUpdatedAt: presence?.updated_at ?? null,
      };
    }),
  });

  const customer = await lookupCustomerByPhone(admin, fromE164);
  const callerName = customer
    ? `${customer.first_name} ${customer.last_name}`.trim()
    : fromE164;

  const { data: call } = await admin
    .from("phone_call")
    .insert({
      direction: "inbound",
      channel: "pstn",
      location_id: location.location_id,
      from_e164: fromE164,
      to_e164: toE164,
      customer_id: customer?.customer_id ?? null,
      twilio_call_sid: params.CallSid || null,
      status: targets.length > 0 ? "ringing" : "missed",
      ended_at: targets.length > 0 ? null : new Date().toISOString(),
    })
    .select("phone_call_id")
    .single();

  if (targets.length === 0) return missedCallTwiml();

  return inboundPstnTwiml({
    identities: targets.map(encodeVoiceIdentity),
    actionUrl: appUrl() ? `${appUrl()}/api/twilio/voice/dial-action` : undefined,
    callerName,
    phoneCallId: call?.phone_call_id,
  });
}

async function attachCallSid(
  admin: ReturnType<typeof createAdminClient>,
  phoneCallId: string | undefined,
  callSid: string | undefined
) {
  if (!phoneCallId || !callSid) return;
  await admin
    .from("phone_call")
    .update({ twilio_call_sid: callSid })
    .eq("phone_call_id", phoneCallId)
    .is("twilio_call_sid", null);
}

async function ringStaffConference(args: {
  conferenceName: string;
  callerIdentity: string;
  targetUserIds: string[];
}) {
  if (!isTwilioVoiceConfigured() || args.targetUserIds.length === 0) return;
  const { accountSid, apiKeySid, apiKeySecret } = getTwilioVoiceConfig();
  const client = twilio(apiKeySid, apiKeySecret, { accountSid });
  const twiml = staffAudioTwiml({ identities: [], conferenceName: args.conferenceName });
  await Promise.all(
    args.targetUserIds.map((userId) =>
      client.calls.create({
        to: `client:${encodeVoiceIdentity(userId)}`,
        from: `client:${args.callerIdentity}`,
        twiml,
      })
    )
  );
}

export async function handleOutboundVoice(
  params: Record<string, string>
): Promise<string> {
  const admin = createAdminClient();
  const fromUserId = decodeVoiceIdentity(params.From);
  const callType = (params.CallType ?? params.callType ?? "pstn").toLowerCase();
  const phoneCallId = params.PhoneCallId ?? params.phoneCallId;
  const callSid = params.CallSid;

  if (!fromUserId) return missedCallTwiml();

  const { data: caller } = await admin
    .from("app_user")
    .select("user_id, role, status")
    .eq("user_id", fromUserId)
    .maybeSingle();
  if (!caller || caller.status !== "active") return missedCallTwiml();

  const channel = callType === "staff" ? "staff" : "pstn";
  const allowed = authorizeOutboundVoice({
    role: caller.role as AppUser["role"],
    channel,
  });
  if (!allowed.ok) return missedCallTwiml();

  await attachCallSid(admin, phoneCallId, callSid);

  if (channel === "pstn") {
    let to = normalizePhoneE164(params.To);
    let callerId: string | null = null;
    if (phoneCallId) {
      const { data: call } = await admin
        .from("phone_call")
        .select("to_e164, from_e164, from_user_id")
        .eq("phone_call_id", phoneCallId)
        .maybeSingle();
      if (!call || call.from_user_id !== fromUserId) return missedCallTwiml();
      to = to ?? normalizePhoneE164(call.to_e164);
      callerId = call.from_e164;
    }
    if (!callerId) {
      const locationId = params.LocationId || params.locationId;
      if (locationId) {
        const { data: location } = await admin
          .from("location")
          .select("voice_e164")
          .eq("location_id", locationId)
          .maybeSingle();
        callerId = location?.voice_e164 ?? null;
      }
    }
    if (!to || !callerId) return missedCallTwiml();
    return outboundPstnTwiml({ toE164: to, callerId });
  }

  const conversationId = params.ConversationId ?? params.conversationId;
  const toUserId = params.ToUserId ?? params.toUserId;
  let targetIds: string[] = toUserId ? [toUserId] : [];
  if (conversationId) {
    const { data: participants } = await admin
      .from("chat_participant")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .is("left_at", null);
    targetIds = (participants ?? [])
      .map((row) => row.user_id)
      .filter((id) => id !== fromUserId);
  }
  if (targetIds.length === 0) return missedCallTwiml();

  if (targetIds.length === 1) {
    return staffAudioTwiml({ identities: [encodeVoiceIdentity(targetIds[0])] });
  }

  const conferenceName = `staff-${conversationId ?? phoneCallId ?? callSid}`;
  try {
    await ringStaffConference({
      conferenceName,
      callerIdentity: encodeVoiceIdentity(fromUserId),
      targetUserIds: targetIds,
    });
  } catch {
    // Caller still joins the conference; callees may need to redial.
  }
  return staffAudioTwiml({
    identities: targetIds.map(encodeVoiceIdentity),
    conferenceName,
  });
}

export async function applyVoiceCallStatus(
  params: Record<string, string>
): Promise<void> {
  const admin = createAdminClient();
  const callSid = params.CallSid;
  if (!callSid) return;

  const { data: call } = await admin
    .from("phone_call")
    .select("phone_call_id, direction, status, started_at, answered_at")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();
  if (!call) return;

  const mapped = mapTwilioCallStatus(params.CallStatus, {
    direction: call.direction as "inbound" | "outbound",
  });
  if (!mapped || mapped === call.status) return;

  const now = new Date();
  const patch: Record<string, unknown> = { status: mapped };
  if (mapped === "in_progress" && !call.answered_at) {
    patch.answered_at = now.toISOString();
  }
  if (
    mapped === "completed" ||
    mapped === "missed" ||
    mapped === "no_answer" ||
    mapped === "busy" ||
    mapped === "failed"
  ) {
    patch.ended_at = now.toISOString();
    const start = new Date(call.started_at).getTime();
    patch.duration_seconds = Math.max(0, Math.floor((now.getTime() - start) / 1000));
  }

  await admin.from("phone_call").update(patch).eq("phone_call_id", call.phone_call_id);
}

export async function handleDialAction(params: Record<string, string>): Promise<string> {
  const admin = createAdminClient();
  const parentSid = params.CallSid;
  const dialStatus = params.DialCallStatus ?? params.CallStatus;
  if (parentSid) {
    const { data: call } = await admin
      .from("phone_call")
      .select("phone_call_id, direction, status")
      .eq("twilio_call_sid", parentSid)
      .maybeSingle();
    if (call && call.status === "ringing") {
      const mapped =
        mapTwilioCallStatus(dialStatus, {
          direction: call.direction as "inbound" | "outbound",
        }) ?? "missed";
      await admin
        .from("phone_call")
        .update({
          status: mapped === "ringing" ? "missed" : mapped,
          ended_at: new Date().toISOString(),
        })
        .eq("phone_call_id", call.phone_call_id);
    }
  }
  if (dialStatus === "completed" || dialStatus === "answered") {
    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  }
  return missedCallTwiml();
}
