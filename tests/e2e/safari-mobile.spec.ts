import { test, expect } from "@playwright/test";

/**
 * Safari / iOS layout gates. These run on the public sign-in page only — no
 * auth and no database — so they execute on every CI run across the WebKit
 * phone, iPad and desktop projects.
 *
 * They lock in the fixes that are easy to regress silently, because the symptom
 * only shows on a real device: the 16px floor that stops iOS zooming on focus,
 * viewport-fit=cover (without which every env(safe-area-inset-*) collapses to
 * zero), and horizontal overflow.
 */

/** Text-entry types that make iOS Safari zoom when their font is under 16px. */
const ZOOMING_INPUT_TYPES = [
  "text",
  "search",
  "email",
  "tel",
  "url",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
];

test.describe("Safari layout gates", () => {
  test("viewport opts into the safe-area insets", async ({ page }) => {
    await page.goto("/login");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    // Without viewport-fit=cover every env(safe-area-inset-*) resolves to 0px
    // and fixed chrome slides under the notch and the home indicator.
    expect(content).toContain("viewport-fit=cover");
    expect(content).toContain("width=device-width");
    // Pinch-zoom must stay available.
    expect(content).not.toContain("user-scalable=no");
    expect(content).not.toContain("maximum-scale");
  });

  test("iOS home-screen and status bar metadata is present", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#0b1220"
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "sizes",
      "180x180"
    );
  });

  test("sign-in page has no horizontal overflow", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("primary action meets the 44px touch target", async ({ page }) => {
    await page.goto("/login");
    const submit = page.getByRole("button", { name: /sign in/i });
    const box = await submit.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("text controls never compute below 16px on touch devices", async ({ page }) => {
    await page.goto("/login");

    const coarse = await page.evaluate(
      () => window.matchMedia("(pointer: coarse)").matches
    );
    test.skip(!coarse, "auto-zoom only affects coarse-pointer devices");

    // Probe every zooming input type plus the shared control classes, so the
    // global floor is covered rather than just whatever the page happens to use.
    const undersized = await page.evaluate((types: string[]) => {
      const host = document.createElement("div");
      host.id = "safari-font-probe";
      const parts = types.map((type) => `<input type="${type}" data-probe="${type}">`);
      parts.push('<input data-probe="no-type">');
      parts.push('<textarea data-probe="textarea"></textarea>');
      for (const cls of ["input", "textarea", "input-dark", "global-search-input"]) {
        parts.push(`<input class="${cls}" data-probe="class:${cls}">`);
      }
      // Classed textareas need their own check: a single class (0,1,0) outranks
      // the bare `textarea` element selector in the coarse-pointer floor, so
      // these only pass if the component rule itself is >= 16px.
      for (const cls of ["textarea", "inspection-notes-input", "pit-sheet-input"]) {
        parts.push(`<textarea class="${cls}" data-probe="textarea.${cls}"></textarea>`);
      }
      // A 14px label must not drag a `font: inherit` control below the floor.
      parts.push(
        '<label class="pit-sheet-label" data-probe="wrap">' +
          '<textarea class="pit-sheet-input" data-probe="class:pit-sheet-input"></textarea>' +
          "</label>"
      );
      host.innerHTML = parts.join("");
      document.body.append(host);

      const failures: Array<{ probe: string; fontSize: number }> = [];
      for (const el of host.querySelectorAll<HTMLElement>("[data-probe]")) {
        const probe = el.dataset.probe ?? "?";
        if (probe === "wrap") continue;
        const fontSize = Number.parseFloat(getComputedStyle(el).fontSize);
        if (fontSize < 16) failures.push({ probe, fontSize });
      }
      host.remove();
      return failures;
    }, ZOOMING_INPUT_TYPES);

    expect(
      undersized,
      `iOS Safari zooms and never zooms back out when a focused control is under 16px: ${JSON.stringify(
        undersized
      )}`
    ).toEqual([]);
  });

  test("selects drop the native iOS chrome so they line up with inputs", async ({
    page,
  }) => {
    await page.goto("/login");

    const result = await page.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML =
        '<input class="input" id="p-input"><select class="select" id="p-select"><option>a</option></select>' +
        '<select class="select-dark" id="p-select-dark"><option>a</option></select>';
      document.body.append(host);
      const read = (id: string) => {
        const el = document.querySelector<HTMLElement>(`#${id}`)!;
        const cs = getComputedStyle(el);
        return {
          appearance: cs.appearance,
          height: Math.round(el.getBoundingClientRect().height),
          hasChevron: cs.backgroundImage !== "none",
        };
      };
      const out = {
        input: read("p-input"),
        select: read("p-select"),
        selectDark: read("p-select-dark"),
      };
      host.remove();
      return out;
    });

    expect(result.select.appearance).toBe("none");
    expect(result.selectDark.appearance).toBe("none");
    // The custom chevron replaces the native disclosure arrow we just removed.
    expect(result.select.hasChevron).toBe(true);
    expect(result.selectDark.hasChevron).toBe(true);
    // iOS gives an unstyled select its own metrics; matching heights is the
    // observable symptom of the native chrome being gone.
    expect(Math.abs(result.select.height - result.input.height)).toBeLessThanOrEqual(1);
  });
});
