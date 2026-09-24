import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "fake-atlassian-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    "getAccessibleAtlassianResources",
    "getJiraCurrentUser",
    "searchJiraIssuesUsingJql",
    "listJiraIssueWorklogs"
  ].map((name) => ({
    name,
    description: `Test implementation of ${name}`,
    inputSchema: { type: "object", properties: {} }
  }))
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  let result;
  switch (params.name) {
    case "getAccessibleAtlassianResources":
      result = { data: { resources: [{
        cloudId: "test-cloud",
        url: "https://jira.example.test",
        products: [{ id: "jira" }]
      }] } };
      break;
    case "getJiraCurrentUser":
      result = { data: { accountId: "test-user", timeZone: "Asia/Taipei" } };
      break;
    case "searchJiraIssuesUsingJql":
      result = {
        data: {
          isLast: true,
          issues: [{
            id: "400870",
            key: "BPLAT-19372",
            fields: {
              summary: "Remove dependency to MFC",
              status: { name: "In Progress", statusCategory: { name: "In Progress" } },
              assignee: { accountId: "test-user", displayName: "Test User" },
              priority: { name: "High" },
              issuetype: { name: "Task" },
              project: { key: "BPLAT" },
              updated: "2026-09-24T09:00:00.000Z"
            }
          }]
        }
      };
      break;
    case "listJiraIssueWorklogs":
      result = {
        data: {
          isLast: true,
          total: 1,
          worklogs: [{
            id: "150748",
            author: { accountId: "test-user", displayName: "Test User" },
            started: "2026-09-22T01:00:00.000-0400",
            timeSpentSeconds: 21600,
            comment: ""
          }]
        }
      };
      break;
    default:
      throw new Error(`Unexpected tool call: ${params.name}`);
  }

  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

await server.connect(new StdioServerTransport());