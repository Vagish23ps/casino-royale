export { cn } from "cn";

/**
 * Deterministic timestamp formatter for audit ledger displays.
 * Guarantees identical output between Node.js SSR and client browser hydration.
 *
 * Enforces:
 * - Locale: en-US
 * - Timezone: Asia/Kolkata
 * - Consistent uppercase AM/PM formatting
 * - Standard ASCII space separator
 * - Safe handling of invalid or empty timestamps
 */
export function formatAuditTimestamp(
  dateInput: string | number | Date | null | undefined,
  includeSeconds: boolean = true
): string {
  if (!dateInput) return "—";

  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return "Invalid date";

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: includeSeconds ? "2-digit" : undefined,
      hour12: true,
    });

    const parts = formatter.formatToParts(date);
    let hour = "";
    let minute = "";
    let second = "";
    let dayPeriod = "";

    for (const part of parts) {
      if (part.type === "hour") hour = part.value;
      else if (part.type === "minute") minute = part.value;
      else if (part.type === "second") second = part.value;
      else if (part.type === "dayPeriod") dayPeriod = part.value.toUpperCase().replace(/\./g, "");
    }

    if (includeSeconds && second) {
      return `${hour}:${minute}:${second} ${dayPeriod}`;
    }
    return `${hour}:${minute} ${dayPeriod}`;
  } catch {
    return "Invalid date";
  }
}

/**
 * Deterministic date formatter for admin displays.
 * Guarantees identical DD/MM/YYYY output between Node.js SSR and client hydration.
 *
 * Enforces:
 * - Locale: en-GB
 * - Timezone: Asia/Kolkata
 * - Format: DD/MM/YYYY (e.g. 18/11/2026)
 * - Safe handling of null, undefined, or invalid dates
 */
export function formatDeterministicDate(
  dateInput: string | number | Date | null | undefined
): string {
  if (!dateInput) return "";

  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return "";

  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const parts = formatter.formatToParts(date);
    let day = "";
    let month = "";
    let year = "";

    for (const part of parts) {
      if (part.type === "day") day = part.value;
      else if (part.type === "month") month = part.value;
      else if (part.type === "year") year = part.value;
    }

    if (day && month && year) {
      return `${day}/${month}/${year}`;
    }

    return "";
  } catch {
    return "";
  }
}
