// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

describe("accessibility tokens", () => {
  it("keeps brand and status text readable against their surfaces", () => {
    const token = (name: string) => styles.match(new RegExp(`--${name}:\\s*(#[a-f\\d]{6})`, "i"))![1].slice(1);
    for (const [foreground, background] of [
      ["ink", "canvas"],
      ["muted", "canvas"],
      ["primary", "primary-soft"],
      ["danger", "danger-soft"],
      ["accent", "accent-soft"],
      ["abnormal", "abnormal-soft"],
      ["info", "info-soft"],
      ["sidebar-text", "sidebar"],
      ["ink", "brand-lime"],
      ["ink", "surface-soft"],
      ["muted", "surface-soft"],
      ["ink", "hero-surface"],
      ["muted", "hero-surface"],
      ["ink", "nav-active"],
      ["ink", "nav-active-hover"],
    ]) {
      const values = [luminance(token(foreground)), luminance(token(background))].sort((a, b) => b - a);
      expect((values[0] + 0.05) / (values[1] + 0.05), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(1.05 / (luminance(token("primary")) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it("loads the institutional Thai families locally with a readable fallback", () => {
    expect(styles).toMatch(/--font-body: "Noto Sans Thai"/);
    expect(styles).toMatch(/--font-heading: "Prompt"/);
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).toContain("font-display: swap");
  });
  it("keeps strong UI boundaries at 3:1 contrast against white", () => {
    const color = styles.match(/--line-strong:\s*(#[a-f\d]{6})/i)?.[1];
    expect(color).toBeDefined();
    expect(1.05 / (luminance(color!.slice(1)) + 0.05)).toBeGreaterThanOrEqual(3);
    expect(styles).toMatch(/input:focus[^}]+outline:\s*3px solid var\(--primary\)/);
  });
});
