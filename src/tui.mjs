#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openJiraSession, readConfig } from "./jira-session.mjs";
import { normalizeTrackedAccountIds } from "./issues.mjs";
import { PendingIssuesApp } from "./pending-screen.mjs";
import { getRefreshSettings } from "./refresh-schedule.mjs";

const h = React.createElement;
const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = `Usage: jira-pending [--config PATH]

Options:
  -c, --config   Config file (default: worklog.config.json in this tool folder)
  -h, --help     Show this help`;

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-h" || argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument !== "-c" && argument !== "--config") {
      throw new Error(`Unknown option: ${argument}\n\n${usage}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${argument}.\n\n${usage}`);
    }
    options.config = value;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The pending-issues TUI requires an interactive terminal.");
  }

  const configPath = resolve(options.config ?? process.env.JIRA_WORKLOG_CONFIG ?? `${projectDirectory}/worklog.config.json`);
  const config = await readConfig(configPath);
  const trackedAccountIds = normalizeTrackedAccountIds(config.trackedAccountIds);
  const session = await openJiraSession({ config, configPath, clientName: "jira-pending-tui" });

  try {
    if (!session.jiraBaseUrl) {
      throw new Error("Could not resolve the Jira site URL for issue links. Set jiraBaseUrl in worklog.config.json or configure the Jira site as the MCP server's --resource.");
    }
    const refreshSchedule = getRefreshSettings(config.refresh, session.timeZone);
    const app = render(h(PendingIssuesApp, { session, refreshSchedule, trackedAccountIds }), { exitOnCtrlC: true });
    await app.waitUntilExit();
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});