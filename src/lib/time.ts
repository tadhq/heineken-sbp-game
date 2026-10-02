/** Timezone math without a date library: the kiosk and server only need "start of day in zone X". */

function partsInZone(instant: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

/** Milliseconds the zone is ahead of UTC at `instant`. */
function zoneOffset(instant: number, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of local midnight, `dayOffset` days from the day containing `instant`. */
export function startOfDay(instant: number, timeZone: string, dayOffset = 0): Date {
  const p = partsInZone(instant, timeZone);
  const guess = Date.UTC(p.y, p.m - 1, p.d + dayOffset);
  // Two passes settle DST transitions where the offset at the guess differs from midnight's.
  let t = guess - zoneOffset(guess, timeZone);
  t = guess - zoneOffset(t, timeZone);
  return new Date(t);
}

/** "YYYY-MM-DD" of `instant` in the zone. */
export function dayKey(instant: number, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** UTC instant of local midnight for a "YYYY-MM-DD" day in the zone. */
export function startOfDayKey(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  // Noon UTC is safely inside the same calendar day for every real zone offset.
  return startOfDay(Date.UTC(y, m - 1, d, 12), timeZone);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
