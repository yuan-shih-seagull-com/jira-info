import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const toolDirectory = resolve(testDirectory, "..");

test("runs the CLI against an independent stdio MCP server", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "jira-worklog-mcp-"));
  const configPath = join(temporaryDirectory, "worklog.config.json");
  const serverPath = join(toolDirectory, "fixtures", "fake-mcp-server.mjs");
  const cliPath = join(toolDirectory, "src", "cli.mjs");
  writeFileSync(configPath, JSON.stringify({
    server: { command: process.execPath, args: [serverPath] }
  }));

  const env = { ...process.env };
  for (const key of [
    "MCP_SERVER_COMMAND",
    "MCP_SERVER_ARGS",
    "ATLASSIAN_CLOUD_ID",
    "ATLASSIAN_ACCOUNT_ID",
    "WORKLOG_TIMEZONE",
    "JIRA_WORKLOG_CONFIG"
  ]) {
    delete env[key];
  }

  try {
    const result = spawnSync(process.execPath, [cliPath, "--date", "2026-09-22", "--config", configPath], {
      encoding: "utf8",
      env,
      timeout: 15000
    });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Date: 2026-09-22 \(Asia\/Taipei\)/);
    assert.match(result.stdout, /13:00\s+19:00\s+6h\s+BPLAT-19372\s+Remove dependency to MFC/);
    assert.match(result.stdout, /Total: 6h \(1 entry\)/);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});