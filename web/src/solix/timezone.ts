// The device wants the host's UTC offset and a POSIX TZ string during the
// handshake (x022). Browsers only expose IANA zone names, so map common zones
// and fall back to a fixed-offset string.

const POSIX: Record<string, string> = {
  "America/New_York": "EST5EDT,M3.2.0,M11.1.0",
  "America/Detroit": "EST5EDT,M3.2.0,M11.1.0",
  "America/Toronto": "EST5EDT,M3.2.0,M11.1.0",
  "America/Chicago": "CST6CDT,M3.2.0,M11.1.0",
  "America/Denver": "MST7MDT,M3.2.0,M11.1.0",
  "America/Phoenix": "MST7",
  "America/Los_Angeles": "PST8PDT,M3.2.0,M11.1.0",
  "America/Vancouver": "PST8PDT,M3.2.0,M11.1.0",
  "America/Anchorage": "AKST9AKDT,M3.2.0,M11.1.0",
  "Pacific/Honolulu": "HST10",
  "Europe/London": "GMT0BST,M3.5.0/1,M10.5.0",
  "Europe/Dublin": "IST-1GMT0,M10.5.0,M3.5.0/1",
  "Europe/Berlin": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Paris": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Madrid": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Rome": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Amsterdam": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Asia/Tokyo": "JST-9",
  "Asia/Shanghai": "CST-8",
  "Asia/Hong_Kong": "HKT-8",
  "Asia/Singapore": "<+08>-8",
  "Australia/Sydney": "AEST-10AEDT,M10.1.0,M4.1.0/3",
  "Australia/Brisbane": "AEST-10",
  "Pacific/Auckland": "NZST-12NZDT,M9.5.0,M4.1.0/3",
};

/** Seconds west of UTC right now (POSIX sign convention). */
export const offsetSecondsWest = (d = new Date()) => d.getTimezoneOffset() * 60;

function fixedOffsetPosix(minutesWest: number): string {
  const sign = minutesWest >= 0 ? "-" : "+"; // the <name> shows the conventional sign
  const abs = Math.abs(minutesWest);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = abs % 60 ? String(abs % 60).padStart(2, "0") : "";
  const posixHours = `${minutesWest < 0 ? "-" : ""}${Math.floor(abs / 60)}${mm ? ":" + mm : ""}`;
  return `<${sign}${hh}${mm}>${posixHours}`;
}

export function posixTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && POSIX[zone]) return POSIX[zone]!;
  } catch { /* fall through */ }
  return fixedOffsetPosix(new Date().getTimezoneOffset());
}
