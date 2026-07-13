import { describe, expect, it } from "vitest";
import { twimlMessageResponse } from "@/lib/twilio/twiml";

describe("twimlMessageResponse", () => {
  it("returns empty Response when message is null or undefined", () => {
    expect(twimlMessageResponse(null)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    );
    expect(twimlMessageResponse(undefined)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    );
  });

  it("returns empty Response when message is empty string", () => {
    expect(twimlMessageResponse("")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    );
  });

  it("wraps message in TwiML Message element", () => {
    expect(twimlMessageResponse("Hello from Toronto Moto")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Hello from Toronto Moto</Message></Response>'
    );
  });

  it("escapes XML special characters in message body", () => {
    expect(twimlMessageResponse("Help & support <info> at torontomoto.com")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Help &amp; support &lt;info&gt; at torontomoto.com</Message></Response>'
    );
  });
});
