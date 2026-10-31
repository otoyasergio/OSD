const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
const matchingVoiceUrl =
  process.env.TWILIO_TEST_NO_MATCH === "1"
    ? "https://old-preview.example/api/twilio/voice/inbound"
    : `${appUrl}/api/twilio/voice/inbound`;

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
          phone_number: "+16474241088",
          friendly_name: "Toronto shop",
          voice_application_sid: null,
          voice_url: matchingVoiceUrl,
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
      status_callback: `${appUrl}/api/twilio/voice/status`,
    });
  }

  return json({ message: `Unexpected test URL: ${url}` }, 404);
};
