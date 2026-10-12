import { useEffect, useRef, useState } from "react";

export function ResearchArtwork({ thai, animated = true }: { thai: boolean; animated?: boolean }) {
  return animated ? (
    <AnimatedResearchArtwork thai={thai} />
  ) : (
    <div className="research-artwork" data-motion="static">
      <ArtworkScene />
    </div>
  );
}

function ArtworkScene() {
  return (
    <div className="research-artwork__scene" aria-hidden="true">
      <img src="/brand/optical-embryo.webp" width="1200" height="800" alt="" fetchPriority="high" />
      <div className="research-artwork__light" />
      <svg className="research-artwork__reticle" viewBox="0 0 600 440" focusable="false">
        <title>Decorative optical frame</title>
        <circle cx="300" cy="220" r="190" strokeDasharray="1 12" />
        <path d="M80 120V70h65M455 370h65v-50M300 15v20m0 370v20M60 220h20m440 0h20" />
      </svg>
    </div>
  );
}

function AnimatedResearchArtwork({ thai }: { thai: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [visible, setVisible] = useState(true);
  const [hidden, setHidden] = useState(document.hidden);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changePreference = () => setReduced(preference.matches);
    const changeVisibility = () => setHidden(document.hidden);
    preference.addEventListener("change", changePreference);
    document.addEventListener("visibilitychange", changeVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (element.current) observer.observe(element.current);
    return () => {
      preference.removeEventListener("change", changePreference);
      document.removeEventListener("visibilitychange", changeVisibility);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className="research-artwork"
      ref={element}
      data-motion={reduced ? "reduced" : paused || !visible || hidden ? "paused" : "playing"}
    >
      <ArtworkScene />
      <div className="research-artwork__footer">
        <button
          type="button"
          className="motion-toggle"
          aria-pressed={paused}
          disabled={reduced}
          onClick={() => setPaused((current) => !current)}
        >
          <span aria-hidden="true">{reduced ? "—" : paused ? "▷" : "Ⅱ"}</span>
          {reduced
            ? thai
              ? "ภาพนิ่ง"
              : "Still image"
            : paused
              ? thai
                ? "เล่นภาพเคลื่อนไหว"
                : "Play motion"
              : thai
                ? "พักภาพเคลื่อนไหว"
                : "Pause motion"}
        </button>
      </div>
    </div>
  );
}
