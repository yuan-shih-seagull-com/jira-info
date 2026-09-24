#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openJiraSession, readConfig } from "./jira-session.mjs";
import { formatDuration, getWorklogsForDate } from "./worklog.mjs";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = `Usage: jira-worklog --date YYYY-MM-DD [--timezone IANA_ZONE] [--format table|json] [--config PATH]

Options:
  -d, --date       Local date to query (required)
  -z, --timezone   Override the timezone returned by Jira
  -f, --format     Output format: table (default) or json
  -c, --config     Config file (default: worklog.config.json in this tool folder)
  -h, --help       Show this help`;

function parseArguments(args) {
  const options = { format: "table" };
  const flags = new Map([
    ["-d", "date"], ["--date", "date"],
    ["-z", "timeZone"], ["--timezone", "timeZone"],
    ["-f", "format"], ["--format", "format"],
    ["-c", "config"], ["--config", "config"]
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-h" || argument === "--help") {
      options.help = true;
      continue;
    }
    const option = flags.get(argument);
    if (!option) {
      throw new Error(`Unknown option: ${argument}\n\n${usage}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${argument}.\n\n${usage}`);
    }
    options[option] = value;
    index += 1;
  }

  if (options.format && !["table", "json"].includes(options.format)) {
    throw new Error("--format must be either table or json.");
  }
  return options;
}

function renderTable(report) {
  const summaries = report.entries.map((entry) => {
    const summary = String(entry.summary).replace(/\s+/g, " ").trim();
    return summary.length > 72 ? `${summary.slice(0, 69)}...` : summary;
  });
  const rows = report.entries.map((entry, index) => [
    entry.localStartTime,
    entry.estimatedEnd.localDate === report.date
      ? entry.estimatedEnd.localTime
      : `${entry.estimatedEnd.localDate} ${entry.estimatedEnd.localTime}`,
    entry.timeSpent,
    entry.issueKey,
    summaries[index]
  ]);
  const headers = ["Start", "Est. end", "Duration", "Issue", "Summary"];
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => row[index].length)
  ));
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  const output = [
    `Date: ${report.date} (${report.timeZone})`,
    line(headers),
    line(widths.map((width) => "-".repeat(width)))
  ];
  output.push(...rows.map(line));
  for (const entry of report.entries) {
    const comment = typeof entry.comment === "string"
      ? entry.comment.replace(/\s+/g, " ").trim()
      : entry.comment ? JSON.stringify(entry.comment) : "";
    if (comment) {
      output.push(`  Comment: ${comment}`);
    }
  }
  output.push(`Total: ${formatDuration(report.totalSeconds)} (${report.entryCount} ${report.entryCount === 1 ? "entry" : "entries"})`);
  return output.join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (!options.date) {
    throw new Error(`--date is required.\n\n${usage}`);
  }

  const configPath = resolve(options.config ?? process.env.JIRA_WORKLOG_CONFIG ?? `${projectDirectory}/worklog.config.json`);
  const config = await readConfig(configPath);
  const session = await openJiraSession({
    config,
    configPath,
    clientName: "jira-worklog-cli",
    timeZone: options.timeZone
  });

  try {
    const report = await getWorklogsForDate({
      callOperation: session.callOperation,
      cloudId: session.cloudId,
      accountId: session.accountId,
      date: options.date,
      timeZone: session.timeZone
    });

    console.log(options.format === "json" ? JSON.stringify(report, null, 2) : renderTable(report));
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});