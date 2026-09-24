# Jira Worklog MCP Tool

A standalone Node.js CLI and terminal UI that query Jira through MCP. The CLI reports worklogs for a date, and the TUI lists the current user's issues in Open or In Progress, ordered by priority and then most recently updated. Neither uses VS Code or its MCP tool host. The included configuration launches Atlassian's hosted Rovo MCP server through `mcp-remote`, which handles the remote OAuth connection.

The CLI searches for issues with work logged by the authenticated user, retrieves each candidate issue's worklogs, filters by the user's Jira account ID and the requested date in the selected timezone, and reports start time, estimated end time, duration, issue, comment, and the daily total. Jira stores a start timestamp and duration, not an explicit finish time; the estimate is calculated as start plus duration and may not represent continuous work.

## Requirements

- Node.js 20 or newer
- An MCP server that exposes `searchJiraIssuesUsingJql` and `listJiraIssueWorklogs`, directly or through the `executeRead` wrapper
- `getJiraCurrentUser` and `getAccessibleAtlassianResources` are used when available; otherwise configure the cloud ID/account ID using the settings below

## Setup

From this directory, install dependencies and make a private config file:

```powershell
npm install
Copy-Item worklog.config.example.json worklog.config.json
```

The example config connects to Atlassian's hosted MCP endpoint at `https://mcp.atlassian.com/v2/mcp` using `mcp-remote`'s automatic protocol mode and selects the `mojixinc.atlassian.net` site as the OAuth resource. The first run may open a browser for Atlassian sign-in. If you use a different site, change the `--resource` URL in `worklog.config.json` to that site's base URL.

The configured command starts `mcp-remote` through Node, so it works on Windows without relying on an `.cmd` launcher. Its OAuth cache is managed by `mcp-remote` outside this repository; credentials are not written to the config file.

To use another MCP server instead, replace the `server` command, arguments, and optional working directory with a command that starts your MCP server over stdio. Relative working directories and script paths are resolved from the config file's directory.

```json
{
  "server": {
    "command": "node",
    "args": ["C:/absolute/path/to/your/stdio-mcp-server.js"],
    "cwd": "C:/absolute/path/to/your/mcp-server"
  },
  "cloudId": "",
  "jiraBaseUrl": "https://your-site.atlassian.net",
  "trackedAccountIds": [],
  "timeZone": "Asia/Taipei"
}
```

This CLI does not reuse credentials stored by a VS Code extension. Do not put access tokens or passwords in the config file; use the MCP server's secure sign-in flow or environment variables.

`cloudId` can be omitted if the server exposes `getAccessibleAtlassianResources`. `timeZone` can be omitted if the server exposes `getJiraCurrentUser`; otherwise it defaults to the machine's timezone. The profile timezone for account-specific reports can be selected explicitly with `--timezone`.

The TUI uses `jiraBaseUrl` to create clickable issue links. It can also resolve the URL from Jira's accessible resources or the MCP server's `--resource` argument. Set `jiraBaseUrl` when using a custom MCP server that provides neither. `ATLASSIAN_SITE_URL` can override the configured URL.

Environment overrides:

- `MCP_SERVER_COMMAND`: MCP server executable
- `MCP_SERVER_ARGS`: JSON array of MCP server arguments
- `ATLASSIAN_CLOUD_ID`: Jira cloud ID or site URL
- `ATLASSIAN_SITE_URL`: Jira base URL used for TUI issue links
- `ATLASSIAN_ACCOUNT_ID`: account ID used to filter worklogs if profile lookup is unavailable
- `WORKLOG_TIMEZONE`: timezone used if the CLI option/config/profile does not provide one
- `JIRA_WORKLOG_CONFIG`: path to a config file

## Usage

From the repository root, run it through `npx` without changing directories:

```powershell
npx --yes --package=./tools/jira-worklog jira-worklog --date 2026-09-22 --config ./tools/jira-worklog/worklog.config.json
```

This uses the package in the current workspace. Since the package is private and is not published to npm, `npx jira-worklog` by itself will not find it. To omit the local package path in the future, publish it to an npm registry or invoke it from a repository URL. The config path must still be supplied when running it from outside the package folder.

From this directory, the npm script remains available:

```powershell
npm start -- --date 2026-09-22
npm start -- --date 2026-09-22 --timezone Asia/Taipei --format json
```

The date is required and uses `YYYY-MM-DD`. The CLI asks Jira for candidate issues within a conservative date range, then applies an exact half-open timestamp interval for midnight-to-midnight in the selected timezone. This handles timezone offsets and daylight-saving days correctly. The output includes worklog start times; any end time would only be an estimate based on duration.

## Pending Issues TUI

Start the interactive pending-issues list from this directory:

```powershell
npm run tui
```

The list includes only `In Progress` and `Open` issues, showing `In Progress` first. Within each status, issues remain ordered by Jira priority descending, then last-updated date descending for equal priorities. Click an issue key to open its Jira page in an OSC 8-compatible terminal. The TUI requires a Jira base URL from config, Jira resource metadata, or the MCP server's `--resource` argument.

To include colleagues, add their Jira account IDs to `trackedAccountIds` in `worklog.config.json`. The signed-in user stays included automatically, and the list shows each issue's assignee. The TUI provides an `All` tab and an individual tab for the signed-in user and every configured account, including accounts with no pending issues.

```json
{
  "trackedAccountIds": ["colleague-account-id-1", "colleague-account-id-2"]
}
```

It refreshes on launch, then every configured interval while the TUI is open and within working hours. Use the Left/Right arrows to switch tabs, Up/Down to select an issue, `r` to refresh at any time, and `q` to quit. The default schedule is every 60 minutes, Monday through Friday from 09:00 to 17:00 in the configured timezone. Set `refresh.enabled` to `false` to disable automatic refresh. The configured schedule applies only while the TUI is running; it does not start a background process.

Configure the interval and local work window in `worklog.config.json`:

```json
{
  "refresh": {
    "enabled": true,
    "intervalMinutes": 60,
    "workingHours": {
      "start": "09:00",
      "end": "17:00",
      "days": [1, 2, 3, 4, 5]
    }
  }
}
```

`days` uses 1 for Monday through 7 for Sunday. The schedule uses `timeZone` from the config, Jira profile, or machine timezone, in that order.

Run the local tests with:

```powershell
npm test
```
