import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { render } from "ink-testing-library";
import { PendingIssuesApp } from "../src/pending-screen.mjs";
import { fitCell, getColumnWidths, getNextSelectionIndex, getWorklogColumnWidths } from "../src/pending-screen.mjs";

const testDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const tuiPath = resolve(testDirectory, "..", "src", "tui.mjs");

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
  }
  assert.ok(predicate(), "condition did not become true");
}

test("keeps issue columns within narrow and standard terminal widths", () => {
  for (const width of [9, 20, 24, 40, 80, 120]) {
    const columns = getColumnWidths(width);
    const overhead = columns.assignee > 0 ? 6 : 5;
    assert.equal(overhead + columns.key + columns.assignee + columns.status + columns.priority + columns.summary, width);
  }
});

test("keeps worklog columns within narrow and standard terminal widths", () => {
  for (const width of [9, 20, 24, 40, 80, 120]) {
    const columns = getWorklogColumnWidths(width);
    assert.equal(5 + columns.start + columns.duration + columns.issue + columns.summary, width);
  }
});

test("truncates short cells without exceeding their width", () => {
  assert.equal(fitCell("SUMMARY", 1), "S");
  assert.equal(fitCell("SUMMARY", 2), "SU");
  assert.equal(fitCell("SUMMARY", 4), "S...");
});

test("keeps selection valid for empty and bounded issue lists", () => {
  assert.equal(getNextSelectionIndex(0, 0, 1), 0);
  assert.equal(getNextSelectionIndex(0, 3, -1), 0);
  assert.equal(getNextSelectionIndex(1, 3, 1), 2);
  assert.equal(getNextSelectionIndex(2, 3, 1), 2);
});

test("loads pending issues and refreshes them when the user presses r", async () => {
  let searchCount = 0;
  const session = {
    accountId: "test-user",
    cloudId: "test-cloud",
    jiraBaseUrl: "https://jira.example.test",
    timeZone: "UTC",
    profile: { displayName: "Test User" },
    callOperation: async () => {
      searchCount += 1;
      return {
        isLast: true,
        issues: [{
          id: "1",
          key: "APP-1",
          fields: {
            summary: `Review rollout ${searchCount}`,
              status: { name: "In Progress", statusCategory: { name: "In Progress" } },
            priority: { name: "High" }
          }
        }]
      };
    }
  };
  const refreshSchedule = {
    enabled: false,
    intervalMinutes: 60,
    workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] }
  };
  const app = render(React.createElement(PendingIssuesApp, { session, refreshSchedule }));

  try {
    await waitFor(() => searchCount === 1);
    await waitFor(() => app.lastFrame().includes("Review rollout 1"));
    app.stdin.write("r");
    await waitFor(() => searchCount === 2);
    await waitFor(() => app.lastFrame().includes("Review rollout 2"));
    assert.match(app.lastFrame(), /In Progress/);
    assert.ok(app.lastFrame().includes("\u001b]8;;https://jira.example.test/browse/APP-1\u001b\\APP-1\u001b]8;;\u001b\\"));
  } finally {
    app.unmount();
  }
});

test("exits the pending-issues screen when the user presses q", async () => {
  let unmounted = false;
  const props = {
    session: {
      accountId: "test-user",
      cloudId: "test-cloud",
      timeZone: "UTC",
      profile: { displayName: "Test User" },
      callOperation: async () => ({ isLast: true, issues: [] })
    },
    refreshSchedule: {
      enabled: false,
      intervalMinutes: 60,
      workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] }
    }
  };
  function ExitAwareApp() {
    React.useEffect(() => () => {
      unmounted = true;
    }, []);
    return React.createElement(PendingIssuesApp, props);
  }
  const app = render(React.createElement(ExitAwareApp));

  try {
    app.stdin.write("q");
    await waitFor(() => unmounted);
  } finally {
    app.unmount();
  }
});

test("shows TUI usage without requiring an interactive terminal", () => {
  const result = spawnSync(process.execPath, [tuiPath, "--help"], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: jira-pending/);
  assert.match(result.stdout, /--config/);
});

test("fails clearly when the TUI is launched without a terminal", () => {
  const result = spawnSync(process.execPath, [tuiPath], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires an interactive terminal/);
});

test("shows All and individual tabs for the current and every tracked account", async () => {
  const requests = [];
  const session = {
    accountId: "current-account",
    cloudId: "test-cloud",
    jiraBaseUrl: "https://jira.example.test",
    timeZone: "UTC",
    profile: { displayName: "Current User" },
    callOperation: async (name, cloudId, inputs) => {
      requests.push({ name, cloudId, inputs });
      return {
        isLast: true,
        issues: [{
          id: "1",
          key: "APP-1",
          fields: {
            summary: "Current account task",
            status: { name: "In Progress" },
            assignee: { accountId: "current-account", displayName: "Current User" },
            priority: { name: "High" }
          }
        }, {
          id: "2",
          key: "APP-2",
          fields: {
            summary: "First colleague task",
            status: { name: "Open" },
            assignee: { accountId: "colleague-account", displayName: "Colleague Name" },
            priority: { name: "Medium" }
          }
        }, {
          id: "3",
          key: "APP-3",
          fields: {
            summary: "Second colleague task",
            status: { name: "Open" },
            assignee: { accountId: "second-colleague", displayName: "Second Colleague" },
            priority: { name: "Low" }
          }
        }]
      };
    }
  };
  const refreshSchedule = {
    enabled: false,
    intervalMinutes: 60,
    workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] }
  };
  const app = render(React.createElement(PendingIssuesApp, {
    session,
    refreshSchedule,
    trackedAccountIds: ["colleague-account", "second-colleague", "track-third-12345678"]
  }));

  try {
    await waitFor(() => requests.length === 1 && app.lastFrame().includes("Second Colleague"));
    const allFrame = app.lastFrame();
    for (const tab of ["All", "Current User", "Colleague Name", "Second Colleague", "Account 12345678"]) {
      assert.ok(allFrame.includes(tab), `expected a tab for ${tab}`);
    }
    for (const issueKey of ["APP-1", "APP-2", "APP-3"]) {
      assert.ok(allFrame.includes(issueKey), `expected All to include ${issueKey}`);
    }
    assert.equal(requests[0].cloudId, "test-cloud");
    assert.equal(
      requests[0].inputs.jql,
      'assignee in ("current-account", "colleague-account", "second-colleague", "track-third-12345678") AND status in ("In Progress", "Open") ORDER BY priority DESC, updated DESC'
    );
    assert.match(app.lastFrame(), /ASSIGNEE/);

    app.stdin.write("\u001B[C");
    await waitFor(() => app.lastFrame().includes("Assignee: Current User | 1 issue"));
    assert.ok(app.lastFrame().includes("APP-1"));
    assert.ok(!app.lastFrame().includes("APP-2"));
    app.stdin.write("\u001B[B");
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    assert.ok(app.lastFrame().split("\n").find((line) => line.includes("APP-1")).includes("> \u001B]8;;"));

    app.stdin.write("\u001B[C");
    await waitFor(() => app.lastFrame().includes("Assignee: Colleague Name | 1 issue"));
    assert.ok(app.lastFrame().includes("APP-2"));
    assert.ok(!app.lastFrame().includes("APP-1"));

    app.stdin.write("\u001B[C");
    await waitFor(() => app.lastFrame().includes("Assignee: Second Colleague | 1 issue"));
    assert.ok(app.lastFrame().includes("APP-3"));
    assert.ok(!app.lastFrame().includes("APP-2"));

    app.stdin.write("\u001B[C");
    await waitFor(() => app.lastFrame().includes("Assignee: Account 12345678 | 0 issues"));
    assert.ok(app.lastFrame().includes("No pending issues."));
    assert.ok(!app.lastFrame().includes("APP-3"));
  } finally {
    app.unmount();
  }
});

test("loads current-user worklogs and accepts a date in the TUI", async () => {
  const requests = [];
  const session = {
    accountId: "test-user",
    cloudId: "test-cloud",
    jiraBaseUrl: "https://jira.example.test",
    timeZone: "Asia/Taipei",
    profile: { displayName: "Test User" },
    callOperation: async (name, cloudId, inputs) => {
      requests.push({ name, cloudId, inputs });
      if (name === "searchJiraIssuesUsingJql" && inputs.jql.includes("worklogAuthor = currentUser()")) {
        return {
          isLast: true,
          issues: [{ id: "44", key: "APP-44", fields: { summary: "Implement date picker" } }]
        };
      }
      if (name === "searchJiraIssuesUsingJql") {
        return { isLast: true, issues: [] };
      }
      if (name === "listJiraIssueWorklogs") {
        return {
          isLast: true,
          total: 1,
          worklogs: [{
            id: "worklog-1",
            author: { accountId: "test-user", displayName: "Test User" },
            started: new Date(inputs.startedAfter + 9 * 60 * 60 * 1000).toISOString(),
            timeSpentSeconds: 5400,
            comment: "TUI date input"
          }]
        };
      }
      throw new Error(`Unexpected MCP operation ${name}`);
    }
  };
  const refreshSchedule = {
    enabled: false,
    intervalMinutes: 60,
    workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] }
  };
  const app = render(React.createElement(PendingIssuesApp, { session, refreshSchedule }));
  const worklogSearches = () => requests.filter((request) =>
    request.name === "searchJiraIssuesUsingJql" && request.inputs.jql.includes("worklogAuthor = currentUser()")
  );

  try {
    app.stdin.write("w");
    await waitFor(() => worklogSearches().length === 1);
    await waitFor(() => app.lastFrame().includes("Implement date picker"));
    assert.match(app.lastFrame(), /Total: 1h 30m \(1 entry\)/);
    assert.ok(app.lastFrame().includes("09:00"));
    assert.ok(app.lastFrame().includes("APP-44"));

    app.stdin.write("d");
    await waitFor(() => app.lastFrame().includes("Date: YYYY-MM-DD"));
    app.stdin.write("2026-09-22");
    await waitFor(() => app.lastFrame().includes("Date: 2026-09-22"));
    app.stdin.write("\r");
    await waitFor(() => worklogSearches().length === 2);
    await waitFor(() => requests.filter((request) => request.name === "listJiraIssueWorklogs").length === 2
      && !app.lastFrame().includes("Refreshing...")
      && app.lastFrame().includes("Date: 2026-09-22"));
    assert.match(app.lastFrame(), /Total: 1h 30m \(1 entry\)/);

    const selectedDateSearch = worklogSearches()[1];
    assert.match(selectedDateSearch.inputs.jql, /worklogDate >= "2026-09-20"/);
    assert.match(selectedDateSearch.inputs.jql, /worklogDate <= "2026-09-24"/);
    const selectedDateWorklogRequest = requests
      .filter((request) => request.name === "listJiraIssueWorklogs")
      .at(-1);
    assert.equal(selectedDateWorklogRequest.inputs.startedAfter, Date.parse("2026-09-21T16:00:00.000Z"));
    assert.equal(selectedDateWorklogRequest.inputs.startedBefore, Date.parse("2026-09-22T16:00:00.000Z"));

    app.stdin.write("d");
    await waitFor(() => app.lastFrame().includes("Date: YYYY-MM-DD"));
    app.stdin.write("2026-02-30");
    await waitFor(() => app.lastFrame().includes("Date: 2026-02-30"));
    app.stdin.write("\r");
    await waitFor(() => app.lastFrame().includes("Invalid calendar date: 2026-02-30"));
    assert.equal(worklogSearches().length, 2);
  } finally {
    app.unmount();
  }
});