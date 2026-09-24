const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NUMBERS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const FORMATTERS = new Map();

function parseClock(value, name) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new TypeError(`${name} must use HH:mm in 24-hour time.`);
  }
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function getRefreshSettings(config = {}, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("refresh must be an object.");
  }
  const enabled = config.enabled ?? true;
  if (typeof enabled !== "boolean") {
    throw new TypeError("refresh.enabled must be a boolean.");
  }
  const intervalMinutes = config.intervalMinutes ?? 60;
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
    throw new TypeError("refresh.intervalMinutes must be an integer from 1 to 1440.");
  }

  const workingHours = config.workingHours ?? {};
  if (!workingHours || typeof workingHours !== "object" || Array.isArray(workingHours)) {
    throw new TypeError("refresh.workingHours must be an object.");
  }
  const start = workingHours.start ?? "09:00";
  const end = workingHours.end ?? "17:00";
  const startMinute = parseClock(start, "refresh.workingHours.start");
  const endMinute = parseClock(end, "refresh.workingHours.end");
  if (endMinute <= startMinute) {
    throw new TypeError("refresh.workingHours.end must be later than start.");
  }

  const configuredDays = workingHours.days ?? DEFAULT_DAYS;
  if (!Array.isArray(configuredDays) || configuredDays.length === 0 || configuredDays.some(
    (day) => !Number.isInteger(day) || day < 1 || day > 7
  )) {
    throw new TypeError("refresh.workingHours.days must contain weekday numbers from 1 (Monday) to 7 (Sunday).");
  }
  const days = [...new Set(configuredDays)].sort((left, right) => left - right);

  new Intl.DateTimeFormat("en-US", { timeZone });
  return { enabled, intervalMinutes, workingHours: { start, end, days } };
}

export function isWithinWorkingHours(timestamp, timeZone, settings) {
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("timestamp must be a finite number.");
  }
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    FORMATTERS.set(timeZone, formatter);
  }

  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter(({ type }) => type !== "literal")
    .map(({ type, value }) => [type, value]));
  const day = WEEKDAY_NUMBERS[parts.weekday];
  const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
  const { start, end, days } = settings.workingHours;
  return days.includes(day) && localMinute >= parseClock(start, "workingHours.start")
    && localMinute < parseClock(end, "workingHours.end");
}

export function formatWorkingDays(days) {
  return days.map((day) => DAY_NAMES[day - 1]).join(", ");
}