import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ResearchArtwork } from "../src/research-artwork";

describe("decorative research motion", () => {
  it("keeps the Dashboard artwork static without motion observers, controls or captions", async () => {
    const observer = vi.fn();
    vi.stubGlobal("IntersectionObserver", observer);
    const preference = vi.spyOn(window, "matchMedia");
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<ResearchArtwork thai animated={false} />));
    expect(host.querySelector(".research-artwork")?.getAttribute("data-motion")).toBe("static");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/brand/optical-embryo.webp");
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector(".research-artwork__footer")).toBeNull();
    expect(host.textContent).not.toContain("ภาพศิลป์ชีววิทยา");
    expect(observer).not.toHaveBeenCalled();
    expect(preference).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });
  it.each([true, false])("pauses by choice and visibility, restores motion and cleans up (Thai=%s)", async (thai) => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const preference = {
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener,
      removeEventListener,
      dispatchEvent: vi.fn(),
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(preference);
    let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof intersect) {
          intersect = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ResearchArtwork thai={thai} />));
    const artwork = host.querySelector(".research-artwork")!;
    const button = host.querySelector("button")!;
    expect(artwork.getAttribute("data-motion")).toBe("playing");
    expect(button.textContent).toContain(thai ? "พักภาพเคลื่อนไหว" : "Pause motion");
    await act(async () => button.click());
    expect(artwork.getAttribute("data-motion")).toBe("paused");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain(thai ? "เล่นภาพเคลื่อนไหว" : "Play motion");
    await act(async () => button.click());
    await act(async () => intersect?.([{ isIntersecting: false }]));
    expect(artwork.getAttribute("data-motion")).toBe("paused");
    await act(async () => intersect?.([{ isIntersecting: true }]));
    expect(artwork.getAttribute("data-motion")).toBe("playing");
    await act(async () => {
      hidden.mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(artwork.getAttribute("data-motion")).toBe("paused");
    await act(async () => {
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event("visibilitychange"));
      preference.matches = true;
      addEventListener.mock.calls[0][1]();
    });
    expect(artwork.getAttribute("data-motion")).toBe("reduced");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain(thai ? "ภาพนิ่ง" : "Still image");
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith("change", addEventListener.mock.calls[0][1]);
    host.remove();
    vi.restoreAllMocks();
  });
});
