const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
const matchingVoiceUrl =
  process.env.TWILIO_TEST_NO_MATCH === "1"
    ? "https://old-preview.example/api/twilio/voice/inbound"
    : `${appUrl}/api/twilio/voice/inbound`;
const voiceNumber = process.env.TWILIO_TEST_OWNED_NUMBER ?? "+14165550123";
const matchingStatusUrl = `${appUrl}/api/twilio/voice/status`;
const numberStatusUrl =
  process.env.TWILIO_TEST_BAD_NUMBER_STATUS === "1"
    ? "https://old-preview.example/api/twilio/voice/status"
    : matchingStatusUrl;
const appStatusUrl =
  process.env.TWILIO_TEST_BAD_APP_STATUS === "1"
    ? "https://old-preview.example/api/twilio/voice/status"
    : matchingStatusUrl;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.fetch = async (input) => {
  const url = String(input);

  if (/\/Accounts\/AC[0-9a-f]{32}\.json$/.test(url)) {
    return json({
      friendly_name: "OTOMOTO",
      status: "active",
      type: "Full",
    });
  }

  if (url.includes("/IncomingPhoneNumbers.json")) {
    return json({
      incoming_phone_numbers: [
        {
          phone_number: voiceNumber,
          friendly_name: "Toronto Voice",
          voice_application_sid: null,
          voice_url: matchingVoiceUrl,
          status_callback: numberStatusUrl,
        },
        {
          phone_number: "+18885550199",
          friendly_name: "Unrelated toll-free",
          voice_application_sid: null,
          voice_url: "",
        },
      ],
    });
  }

  if (/\/Applications\/AP[0-9a-f]{32}\.json$/.test(url)) {
    return json({
      friendly_name: "Toronto shop browser calling",
      voice_url: `${appUrl}/api/twilio/voice/outbound`,
      status_callback: appStatusUrl,
    });
  }

  return json({ message: `Unexpected test URL: ${url}` }, 404);
};
