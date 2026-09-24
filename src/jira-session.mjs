import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createOperationCaller } from "./mcp-client.mjs";
import { normalizeJiraBaseUrl } from "./issue-links.mjs";

export async function readConfig(configPath) {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file ${configPath}: ${error.message}`);
    }
    throw error;
  }
}

function getServerSettings(config, configDirectory) {
  const command = process.env.MCP_SERVER_COMMAND || config.server?.command;
  let args = config.server?.args ?? [];
  if (process.env.MCP_SERVER_ARGS) {
    try {
      args = JSON.parse(process.env.MCP_SERVER_ARGS);
    } catch (error) {
      throw new Error(`MCP_SERVER_ARGS must be a JSON array: ${error.message}`);
    }
  }
  if (!command) {
    throw new Error("No MCP server command is configured. Set server.command in worklog.config.json.");
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new Error("MCP server args must be an array of strings.");
  }
  const cwd = config.server?.cwd
    ? resolve(configDirectory, config.server.cwd)
    : configDirectory;
  return { command, args, cwd };
}

function unwrapData(value) {
  let result = value;
  while (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    Object.hasOwn(result, "data") &&
    (Object.keys(result).length === 1 || Object.hasOwn(result, "message"))
  ) {
    result = result.data;
  }
  return result;
}

function getResourceUrl(args) {
  const resourceIndex = args.indexOf("--resource");
  return resourceIndex >= 0 ? args[resourceIndex + 1] : undefined;
}

export async function resolveJiraSite({ callOperation, config = {}, serverArgs = [], env = process.env }) {
  const configuredCloudId = env.ATLASSIAN_CLOUD_ID || config.cloudId || undefined;
  const configuredBaseUrl = env.ATLASSIAN_SITE_URL || config.jiraBaseUrl;
  const resourceArgumentUrl = getResourceUrl(serverArgs);
  let resources = [];

  if (!configuredCloudId || !(configuredBaseUrl || resourceArgumentUrl)) {
    try {
      const accessible = unwrapData(await callOperation("getAccessibleAtlassianResources"));
      resources = Array.isArray(accessible?.resources) ? accessible.resources : [];
    } catch (error) {
      if (!configuredCloudId) {
        throw error;
      }
    }
  }

  const matchingResource = configuredCloudId
    ? resources.find((item) => [item.cloudId, item.id, item.url].includes(configuredCloudId))
    : undefined;
  const resource = matchingResource ?? (!configuredCloudId
    ? resources.find((item) => item.products?.some((product) => product.id === "jira")) ?? resources[0]
    : undefined);
  const cloudId = configuredCloudId ?? resource?.cloudId ?? resource?.id ?? resource?.url;
  if (!cloudId) {
    throw new Error("Could not resolve a Jira site. Set cloudId in worklog.config.json or ATLASSIAN_CLOUD_ID.");
  }
  const cloudIdUrl = typeof configuredCloudId === "string" && /^https?:\/\//i.test(configuredCloudId)
    ? configuredCloudId
    : undefined;
  const jiraBaseUrl = normalizeJiraBaseUrl(
    configuredBaseUrl ?? resource?.url ?? resourceArgumentUrl ?? cloudIdUrl
  );
  return { cloudId, jiraBaseUrl };
}

async function getUserProfile(callOperation, cloudId) {
  try {
    return unwrapData(await callOperation("getJiraCurrentUser", cloudId));
  } catch (profileError) {
    try {
      return unwrapData(await callOperation("atlassianUserInfo"));
    } catch {
      return { profileError };
    }
  }
}

export async function openJiraSession({
  config,
  configPath,
  clientName = "jira-worklog",
  timeZone
}) {
  const server = getServerSettings(config, dirname(configPath));
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    env: process.env,
    stderr: "inherit"
  });
  const client = new Client({ name: clientName, version: "1.0.0" });

  try {
    await client.connect(transport);
    const callOperation = await createOperationCaller(client);
    const { cloudId, jiraBaseUrl } = await resolveJiraSite({
      callOperation,
      config,
      serverArgs: server.args
    });
    const profile = await getUserProfile(callOperation, cloudId);
    const accountId = process.env.ATLASSIAN_ACCOUNT_ID || profile?.accountId;
    if (!accountId) {
      throw new Error("Could not resolve your Jira accountId. Ensure getJiraCurrentUser is available or set ATLASSIAN_ACCOUNT_ID.");
    }
    const resolvedTimeZone = timeZone
      ?? config.timeZone
      ?? process.env.WORKLOG_TIMEZONE
      ?? profile?.timeZone
      ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    return {
      callOperation,
      cloudId,
      jiraBaseUrl,
      accountId,
      profile,
      timeZone: resolvedTimeZone,
      close: () => client.close().catch(() => {})
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}