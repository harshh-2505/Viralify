export function localDateTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function zonedDateTimeToIso(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid date and time.");
  const wall = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(wall)) throw new Error("Choose a valid date and time.");
  const candidates = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 12) {
    const probe = wall + hours * 3600000;
    const displayed = new Date(
      `${localDateTime(new Date(probe), timezone)}:00Z`,
    ).getTime();
    const candidate = wall - (displayed - probe);
    if (localDateTime(new Date(candidate), timezone) === value)
      candidates.add(candidate);
  }
  if (candidates.size === 0)
    throw new Error(
      "This time does not exist in that timezone because the clock changes. Choose another time.",
    );
  if (candidates.size > 1)
    throw new Error(
      "This time occurs twice because the clock changes. Choose a time outside the repeated hour.",
    );
  return new Date([...candidates][0]).toISOString();
}
