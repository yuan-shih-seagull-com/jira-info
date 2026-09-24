import assert from "node:assert/strict";
import test from "node:test";
import { createOperationCaller } from "../src/mcp-client.mjs";

test("calls a directly exposed Atlassian operation and unwraps its result", async () => {
  const calls = [];
  const client = {
    async listTools() {
      return { tools: [{ name: "mcp_atlassian-mcp_listJiraIssueWorklogs" }] };
    },
    async callTool(request) {
      calls.push(request);
      return { content: [{ type: "text", text: JSON.stringify({ data: { worklogs: [] } }) }] };
    }
  };

  const callOperation = await createOperationCaller(client);
  const result = await callOperation("listJiraIssueWorklogs", "jira-cloud", { issueIdOrKey: "BPLAT-1" });

  assert.deepEqual(result, { worklogs: [] });
  assert.deepEqual(calls[0], {
    name: "mcp_atlassian-mcp_listJiraIssueWorklogs",
    arguments: { issueIdOrKey: "BPLAT-1", cloudId: "jira-cloud" }
  });
});

test("uses executeRead when operations are exposed through the read wrapper", async () => {
  const calls = [];
  const client = {
    async listTools() {
      return { tools: [{ name: "mcp_atlassian-mcp_executeRead" }] };
    },
    async callTool(request) {
      calls.push(request);
      return { content: [{ type: "text", text: JSON.stringify({ issues: [] }) }] };
    }
  };

  const callOperation = await createOperationCaller(client);
  await callOperation("searchJiraIssuesUsingJql", "jira-cloud", { jql: "project = BPLAT" });

  assert.deepEqual(calls[0], {
    name: "mcp_atlassian-mcp_executeRead",
    arguments: {
      name: "searchJiraIssuesUsingJql",
      cloudId: "jira-cloud",
      inputs: { jql: "project = BPLAT" }
    }
  });
});