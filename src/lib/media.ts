/** Format an actual byte count without implying file contents were analyzed. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.max(
    0,
    Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1),
  );
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`;
}

/** Format browser- or server-measured duration in seconds. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}
/** Exact byte caps take precedence over the legacy binary-megabyte setting. */
export function uploadLimitBytes(
  maxUploadMb = 50,
  maxUploadBytes?: number,
): number {
  if (
    maxUploadBytes !== undefined &&
    Number.isFinite(maxUploadBytes) &&
    maxUploadBytes > 0
  )
    return maxUploadBytes;
  const megabytes =
    Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : 50;
  return megabytes * 1024 * 1024;
}
