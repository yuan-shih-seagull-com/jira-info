const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

export function normalizeJiraBaseUrl(value) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim() || CONTROL_CHARACTERS.test(value)) {
    throw new TypeError("Jira base URL must be a valid HTTP or HTTPS URL.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TypeError("Jira base URL must be a valid HTTP or HTTPS URL.");
  }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) {
    throw new TypeError("Jira base URL must use HTTP or HTTPS and cannot include credentials, query, or fragment.");
  }
  return url.href.replace(/\/$/, "");
}

export function getJiraIssueUrl(baseUrl, issueKey) {
  const normalizedBaseUrl = normalizeJiraBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new TypeError("A Jira base URL is required to build an issue link.");
  }
  const url = new URL(normalizedBaseUrl);
  if (typeof issueKey !== "string" || !issueKey.trim() || CONTROL_CHARACTERS.test(issueKey)) {
    throw new TypeError("Jira issue key must be a non-empty string.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/browse/${encodeURIComponent(issueKey)}`;
  return url.href;
}

export function createTerminalHyperlink(url, label) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TypeError("Terminal hyperlink URL must be valid.");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol) || CONTROL_CHARACTERS.test(url)) {
    throw new TypeError("Terminal hyperlink URL must use HTTP or HTTPS.");
  }
  const safeLabel = String(label).replace(/[\u0000-\u001f\u007f-\u009f]/gu, "");
  return `\u001b]8;;${parsedUrl.href}\u001b\\${safeLabel}\u001b]8;;\u001b\\`;
}