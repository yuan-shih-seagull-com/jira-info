import assert from "node:assert/strict";
import test from "node:test";
import { resolveJiraSite } from "../src/jira-session.mjs";
import { createTerminalHyperlink, getJiraIssueUrl, normalizeJiraBaseUrl } from "../src/issue-links.mjs";

test("resolves cloud ID and URL from the matching Jira resource", async () => {
  const site = await resolveJiraSite({
    config: { cloudId: "jira-two" },
    env: {},
    callOperation: async () => ({
      resources: [
        { cloudId: "jira-one", url: "https://one.example.com", products: [{ id: "jira" }] },
        { cloudId: "jira-two", url: "https://two.example.com/", products: [{ id: "jira" }] }
      ]
    })
  });

  assert.deepEqual(site, { cloudId: "jira-two", jiraBaseUrl: "https://two.example.com" });
});

test("treats a blank configured cloud ID as missing", async () => {
  const site = await resolveJiraSite({
    config: { cloudId: "", jiraBaseUrl: "https://two.example.com" },
    serverArgs: ["--resource", "https://two.example.com/"],
    env: {},
    callOperation: async () => ({
      resources: [{ cloudId: "jira-two", url: "https://two.example.com", products: [{ id: "jira" }] }]
    })
  });

  assert.deepEqual(site, { cloudId: "jira-two", jiraBaseUrl: "https://two.example.com" });
});

test("prefers an explicit Jira base URL over MCP resource metadata", async () => {
  const site = await resolveJiraSite({
    config: { cloudId: "jira-one", jiraBaseUrl: "https://jira.example.com/jira/" },
    serverArgs: ["--resource", "https://oauth.example.com"],
    env: {},
    callOperation: async () => {
      throw new Error("Resource lookup should not be needed.");
    }
  });

  assert.deepEqual(site, { cloudId: "jira-one", jiraBaseUrl: "https://jira.example.com/jira" });
});

test("uses the MCP resource URL when Jira does not report a site URL", async () => {
  const site = await resolveJiraSite({
    config: { cloudId: "jira-one" },
    serverArgs: ["--resource", "https://jira.example.com/"],
    env: {},
    callOperation: async () => ({ resources: [] })
  });

  assert.deepEqual(site, { cloudId: "jira-one", jiraBaseUrl: "https://jira.example.com" });
});

test("rejects unsafe Jira base URLs", async () => {
  await assert.rejects(resolveJiraSite({
    config: { cloudId: "jira-one", jiraBaseUrl: "javascript:alert(1)" },
    env: {},
    callOperation: async () => ({ resources: [] })
  }), /HTTP or HTTPS/);
});

test("builds an issue URL under Jira context paths and encodes the issue key", () => {
  assert.equal(
    getJiraIssueUrl("https://jira.example.com/jira/", "APP 1"),
    "https://jira.example.com/jira/browse/APP%201"
  );
});

test("formats an OSC 8 hyperlink and removes terminal controls from its label", () => {
  const link = createTerminalHyperlink("https://jira.example.com/browse/APP-1", "APP-1\u001b[31m");

  assert.equal(link, "\u001b]8;;https://jira.example.com/browse/APP-1\u001b\\APP-1[31m\u001b]8;;\u001b\\");
});

test("allows the shared CLI session to omit an optional Jira URL", async () => {
  assert.equal(normalizeJiraBaseUrl(undefined), undefined);
  assert.equal(normalizeJiraBaseUrl(""), undefined);
});