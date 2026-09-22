import { Instagram, Youtube } from "lucide-react";
import type { Platform } from "../../shared/types";
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M7 7l7 16L25 6M8 17l6 6 10-9"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="25" cy="24" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}
export function PlatformIcon({
  platform,
  size = 16,
}: {
  platform: Platform;
  size?: number;
}) {
  if (platform === "instagram") return <Instagram size={size} />;
  if (platform === "youtube") return <Youtube size={size} />;
  return (
    <span className="platform-letter" style={{ fontSize: size }}>
      {platform === "linkedin" ? "in" : platform === "tiktok" ? "♪" : "𝕏"}
    </span>
  );
}
