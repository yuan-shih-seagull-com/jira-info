import assert from "node:assert/strict";
import test from "node:test";
import { buildPendingIssuesJql, getPendingIssues, normalizeTrackedAccountIds } from "../src/issues.mjs";

test("defaults to the current user, In Progress then Open, ordered by priority then recency", () => {
  assert.equal(
    buildPendingIssuesJql(),
    'assignee = currentUser() AND status in ("In Progress", "Open") ORDER BY priority DESC, updated DESC'
  );
});

test("supports account and additional status filters as JQL literals", () => {
  assert.equal(
    buildPendingIssuesJql({
      accountIds: ["account-1", 'account"2'],
      statuses: ["Open", "In Progress", "In Review"]
    }),
    'assignee in ("account-1", "account\\"2") AND status in ("Open", "In Progress", "In Review") ORDER BY priority DESC, updated DESC'
  );
});

test("normalizes configured tracked account IDs and rejects invalid entries", () => {
  assert.deepEqual(normalizeTrackedAccountIds([" colleague-1 ", "colleague-1", "colleague-2"]), [
    "colleague-1", "colleague-2"
  ]);
  assert.deepEqual(normalizeTrackedAccountIds(), []);
  assert.throws(() => normalizeTrackedAccountIds([""]), /non-empty strings/);
  assert.throws(() => normalizeTrackedAccountIds("colleague-1"), /must be an array/);
});

test("requires at least one explicit status", () => {
  assert.throws(() => buildPendingIssuesJql({ statuses: [] }), /statuses must contain at least one status/);
});

test("loads all pages and maps Jira workflow statuses without a fixed status list", async () => {
  const requests = [];
  const callOperation = async (name, cloudId, inputs) => {
    requests.push({ name, cloudId, inputs });
    if (inputs.nextPageToken) {
      return {
        isLast: true,
        issues: [{
          id: "2",
          key: "APP-2",
          fields: {
            summary: "Review rollout",
            status: { name: "Awaiting Review", statusCategory: { name: "In Progress" } },
            assignee: { accountId: "current-account", displayName: "Current User" },
            priority: { name: "High" },
            issuetype: { name: "Task" },
            project: { key: "APP" },
            updated: "2026-09-24T09:00:00.000Z"
          }
        }]
      };
    }
    return {
      isLast: false,
      nextPageToken: "next-page",
      issues: [{
        id: "1",
        key: "APP-1",
        fields: {
          summary: "Investigate timeout",
          status: { name: "Open", statusCategory: { name: "To Do" } }
        }
      }]
    };
  };

  const issues = await getPendingIssues({
    callOperation,
    cloudId: "jira-cloud",
    statuses: ["Open", "Awaiting Review"]
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].name, "searchJiraIssuesUsingJql");
  assert.equal(requests[0].cloudId, "jira-cloud");
  assert.equal(requests[0].inputs.maxResults, 100);
  assert.equal(requests[0].inputs.jql, 'assignee = currentUser() AND status in ("Open", "Awaiting Review") ORDER BY priority DESC, updated DESC');
  assert.equal(requests[0].inputs.view, "full");
  assert.deepEqual(requests[0].inputs.fields, [
    "summary", "status", "assignee", "priority", "issuetype", "project", "updated"
  ]);
  assert.equal(requests[1].inputs.nextPageToken, "next-page");
  assert.deepEqual(issues.map(({ key, status }) => [key, status]), [
    ["APP-1", "Open"],
    ["APP-2", "Awaiting Review"]
  ]);
  assert.equal(issues[1].assignee, "Current User");
  assert.equal(issues[1].assigneeAccountId, "current-account");
  assert.equal(issues[1].statusCategory, "In Progress");
});

test("orders In Progress before Open while preserving Jira priority order within statuses", async () => {
  const issues = await getPendingIssues({
    callOperation: async () => ({
      isLast: true,
      issues: [{
        id: "1",
        key: "APP-1",
        fields: {
          summary: "High priority open issue",
          status: { name: "Open" },
          priority: { name: "High" }
        }
      }, {
        id: "2",
        key: "APP-2",
        fields: {
          summary: "In progress issue",
          status: { name: "In Progress" },
          priority: { name: "Low" }
        }
      }, {
        id: "3",
        key: "APP-3",
        fields: {
          summary: "Medium priority open issue",
          status: { name: "Open" },
          priority: { name: "Medium" }
        }
      }]
    }),
    cloudId: "jira-cloud"
  });

  assert.deepEqual(issues.map((issue) => issue.key), ["APP-2", "APP-1", "APP-3"]);
});

test("rejects a repeated page token instead of looping", async () => {
  let callCount = 0;
  const callOperation = async () => {
    callCount += 1;
    return { isLast: false, nextPageToken: "same", issues: [] };
  };

  await assert.rejects(getPendingIssues({ callOperation, cloudId: "jira-cloud" }), /repeated a search pagination token/);
  assert.equal(callCount, 2);
});