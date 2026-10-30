import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ShopMailboxPanel,
  shopMailboxNotice,
} from "@/components/settings/ShopMailboxPanel";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

const redirectUri = "https://service.torontomoto.com/api/google/mail/callback";

describe("shopMailboxNotice", () => {
  it("describes a finished connection", () => {
    expect(shopMailboxNotice("connected")).toMatch(/Google mailbox connected/);
    expect(shopMailboxNotice(undefined)).toBeNull();
  });
});

describe("ShopMailboxPanel", () => {
  it("shows the redirect URI until the OAuth client exists", () => {
    const html = renderToStaticMarkup(
      createElement(ShopMailboxPanel, {
        oauthConfigured: false,
        locationAllowed: true,
        redirectUri,
        emailAddress: null,
        notice: null,
        disconnectAction: async () => {},
      })
    );

    expect(html).toContain(redirectUri);
    expect(html).not.toContain("Connect Google");
    expect(html).toContain("info@torontomoto.com");
  });

  it("offers connect, and shows the connected shop address", () => {
    const html = renderToStaticMarkup(
      createElement(ShopMailboxPanel, {
        oauthConfigured: true,
        locationAllowed: true,
        redirectUri,
        emailAddress: "info@torontomoto.com",
        notice: shopMailboxNotice("connected"),
        disconnectAction: async () => {},
      })
    );

    expect(html).toContain("Reconnect Google");
    expect(html).toContain("info@torontomoto.com");
    expect(html).toContain(TORONTO_SHOP.legalName);
    expect(html).toContain("Disconnect");
    expect(html).toContain("Google mailbox connected");
  });

  it("does not offer Google connect for a non-Toronto location", () => {
    const html = renderToStaticMarkup(
      createElement(ShopMailboxPanel, {
        oauthConfigured: true,
        locationAllowed: false,
        redirectUri,
        emailAddress: null,
        notice: shopMailboxNotice("location"),
        disconnectAction: async () => {},
      })
    );

    expect(html).toContain("Toronto shop only");
    expect(html).not.toContain("Connect Google");
    expect(html).toContain("Ottawa is");
  });
});
