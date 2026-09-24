import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkingDays, getRefreshSettings, isWithinWorkingHours } from "../src/refresh-schedule.mjs";

test("defaults to hourly refresh during weekday working hours", () => {
  const settings = getRefreshSettings({}, "UTC");

  assert.deepEqual(settings, {
    enabled: true,
    intervalMinutes: 60,
    workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] }
  });
  assert.equal(formatWorkingDays(settings.workingHours.days), "Mon, Tue, Wed, Thu, Fri");
});

test("checks local working hours including timezone and exclusive end time", () => {
  const settings = getRefreshSettings({}, "Asia/Taipei");

  assert.equal(isWithinWorkingHours(Date.parse("2026-09-28T01:00:00.000Z"), "Asia/Taipei", settings), true);
  assert.equal(isWithinWorkingHours(Date.parse("2026-09-28T09:00:00.000Z"), "Asia/Taipei", settings), false);
  assert.equal(isWithinWorkingHours(Date.parse("2026-09-26T02:00:00.000Z"), "Asia/Taipei", settings), false);
});

test("validates schedule settings before starting the TUI", () => {
  assert.throws(() => getRefreshSettings({ intervalMinutes: 0 }, "UTC"), /intervalMinutes/);
  assert.throws(() => getRefreshSettings({ workingHours: { start: "18:00", end: "09:00" } }, "UTC"), /later than start/);
  assert.throws(() => getRefreshSettings({ workingHours: { days: [0] } }, "UTC"), /weekday numbers/);
  assert.throws(() => getRefreshSettings({}, "invalid/timezone"), /Invalid time zone/);
});