import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, getLocalDate, getLocalDayWindow, getWorklogsForDate } from "../src/worklog.mjs";

test("gets today's date in the requested timezone", () => {
  const timestamp = Date.parse("2026-09-24T03:30:00.000Z");

  assert.equal(getLocalDate(timestamp, "Asia/Taipei"), "2026-09-24");
  assert.equal(getLocalDate(timestamp, "America/Los_Angeles"), "2026-09-23");
});

test("calculates a local calendar-day window in the requested timezone", () => {
  const window = getLocalDayWindow("2026-09-22", "Asia/Taipei");

  assert.equal(new Date(window.startMs).toISOString(), "2026-09-21T16:00:00.000Z");
  assert.equal(new Date(window.endMs).toISOString(), "2026-09-22T16:00:00.000Z");
});

test("handles a daylight-saving day that is not 24 hours long", () => {
  const window = getLocalDayWindow("2026-03-08", "America/New_York");

  assert.equal(window.endMs - window.startMs, 23 * 60 * 60 * 1000);
});

test("returns only the current user's worklogs that start on the requested local date", async () => {
  const requests = [];
  const callOperation = async (name, cloudId, inputs) => {
    requests.push({ name, cloudId, inputs });
    if (name === "searchJiraIssuesUsingJql") {
      return {
        isLast: true,
        issues: [{ id: "400870", key: "BPLAT-19372", fields: { summary: "Remove dependency to MFC" } }]
      };
    }
    if (name === "listJiraIssueWorklogs") {
      return {
        isLast: true,
        total: 3,
        worklogs: [
          {
            id: "mine",
            author: { accountId: "current-user", displayName: "Current User" },
            started: "2026-09-22T01:00:00.000-0400",
            timeSpentSeconds: 21600,
            comment: "Implementation"
          },
          {
            id: "other-user",
            author: { accountId: "someone-else", displayName: "Someone Else" },
            started: "2026-09-22T05:00:00.000Z",
            timeSpentSeconds: 3600,
            comment: "Not mine"
          },
          {
            id: "previous-local-day",
            author: { accountId: "current-user", displayName: "Current User" },
            started: "2026-09-21T15:59:59.999Z",
            timeSpentSeconds: 1800,
            comment: "Previous day in Taipei"
          }
        ]
      };
    }
    throw new Error(`Unexpected MCP operation ${name}`);
  };

  const report = await getWorklogsForDate({
    callOperation,
    cloudId: "jira-cloud-id",
    accountId: "current-user",
    date: "2026-09-22",
    timeZone: "Asia/Taipei"
  });

  assert.equal(report.entryCount, 1);
  assert.equal(report.totalSeconds, 21600);
  assert.equal(report.totalTimeSpent, "6h");
  assert.equal(report.entries[0].localStartTime, "13:00");
  assert.equal(report.entries[0].estimatedEnd.localTime, "19:00");
  assert.equal(report.entries[0].estimatedEnd.localDate, "2026-09-22");
  assert.equal(report.entries[0].issueKey, "BPLAT-19372");
  assert.equal(report.entries[0].comment, "Implementation");

  const search = requests.find((request) => request.name === "searchJiraIssuesUsingJql");
  assert.match(search.inputs.jql, /worklogAuthor = currentUser\(\)/);
  assert.match(search.inputs.jql, /worklogDate >= "2026-09-20"/);
  assert.match(search.inputs.jql, /worklogDate <= "2026-09-24"/);

  const worklogQuery = requests.find((request) => request.name === "listJiraIssueWorklogs");
  assert.equal(worklogQuery.inputs.startedAfter, Date.parse("2026-09-21T16:00:00.000Z"));
  assert.equal(worklogQuery.inputs.startedBefore, Date.parse("2026-09-22T16:00:00.000Z"));
});

test("returns worklogs and totals for every requested account only", async () => {
  const requests = [];
  const callOperation = async (name, cloudId, inputs) => {
    requests.push({ name, cloudId, inputs });
    if (name === "searchJiraIssuesUsingJql") {
      return {
        isLast: true,
        issues: [{ id: "1", key: "APP-1", fields: { summary: "Shared task" } }]
      };
    }
    if (name === "listJiraIssueWorklogs") {
      return {
        isLast: true,
        total: 3,
        worklogs: [{
          id: "current-entry",
          author: { accountId: "current-account", displayName: "Current User" },
          started: "2026-09-22T01:00:00Z",
          timeSpentSeconds: 3600
        }, {
          id: "tracked-entry",
          author: { accountId: "tracked-account", displayName: "Tracked User" },
          started: "2026-09-22T02:00:00Z",
          timeSpentSeconds: 7200
        }, {
          id: "untracked-entry",
          author: { accountId: "untracked-account", displayName: "Untracked User" },
          started: "2026-09-22T03:00:00Z",
          timeSpentSeconds: 10800
        }]
      };
    }
    throw new Error(`Unexpected MCP operation ${name}`);
  };

  const report = await getWorklogsForDate({
    callOperation,
    cloudId: "jira-cloud-id",
    accountIds: ["current-account", "tracked-account", "no-entry-account", "tracked-account"],
    date: "2026-09-22",
    timeZone: "UTC"
  });

  const search = requests.find((request) => request.name === "searchJiraIssuesUsingJql");
  assert.match(search.inputs.jql, /worklogAuthor in \("current-account", "tracked-account", "no-entry-account"\)/);
  assert.deepEqual(report.entries.map((entry) => entry.authorAccountId), ["current-account", "tracked-account"]);
  assert.deepEqual(report.accountTotals, [{
    accountId: "current-account",
    displayName: "Current User",
    entryCount: 1,
    totalSeconds: 3600,
    totalTimeSpent: "1h"
  }, {
    accountId: "tracked-account",
    displayName: "Tracked User",
    entryCount: 1,
    totalSeconds: 7200,
    totalTimeSpent: "2h"
  }, {
    accountId: "no-entry-account",
    displayName: "no-entry-account",
    entryCount: 0,
    totalSeconds: 0,
    totalTimeSpent: "0m"
  }]);
});

test("formats durations without rounding away seconds", () => {
  assert.equal(formatDuration(19830), "5h 30m 30s");
  assert.equal(formatDuration(0), "0m");
});

test("rejects an invalid calendar date", () => {
  assert.throws(() => getLocalDayWindow("2026-02-30", "Asia/Taipei"), /Invalid calendar date/);
});