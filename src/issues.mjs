const SEARCH_PAGE_SIZE = 100;
const DEFAULT_STATUSES = Object.freeze(["In Progress", "Open"]);
const ISSUE_FIELDS = [
  "summary",
  "status",
  "assignee",
  "priority",
  "issuetype",
  "project",
  "updated"
];

function normalizeValues(values, name) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${name} must be an array of non-empty strings.`);
  }
  return [...new Set(values.map((value) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`${name} must contain only non-empty strings.`);
    }
    return value.trim();
  }))];
}

export function normalizeTrackedAccountIds(accountIds = []) {
  return normalizeValues(accountIds, "trackedAccountIds");
}

function quoteJqlValue(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
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

function toPendingIssue(issue) {
  const fields = issue.fields ?? {};
  return {
    id: String(issue.id ?? issue.key ?? ""),
    key: issue.key ?? String(issue.id ?? ""),
    summary: fields.summary ?? "",
    status: fields.status?.name ?? "Unknown",
    statusCategory: fields.status?.statusCategory?.name ?? "",
    assigneeAccountId: fields.assignee?.accountId ?? "",
    assignee: fields.assignee?.displayName ?? fields.assignee?.accountId ?? "",
    priority: fields.priority?.name ?? "",
    issueType: fields.issuetype?.name ?? "",
    project: fields.project?.key ?? "",
    updated: fields.updated ?? ""
  };
}

export function buildPendingIssuesJql({ accountIds = [], statuses = DEFAULT_STATUSES } = {}) {
  const accounts = normalizeValues(accountIds, "accountIds");
  const statusNames = normalizeValues(statuses, "statuses");
  if (statusNames.length === 0) {
    throw new TypeError("statuses must contain at least one status.");
  }
  const assigneeClause = accounts.length
    ? `assignee in (${accounts.map(quoteJqlValue).join(", ")})`
    : "assignee = currentUser()";
  const statusClause = `status in (${statusNames.map(quoteJqlValue).join(", ")})`;

  return `${assigneeClause} AND ${statusClause} ORDER BY priority DESC, updated DESC`;
}

export async function getPendingIssues({
  callOperation,
  cloudId,
  accountIds,
  statuses
}) {
  const jql = buildPendingIssuesJql({ accountIds, statuses });
  const statusOrder = new Map(
    normalizeValues(statuses ?? DEFAULT_STATUSES, "statuses")
      .map((status, index) => [status, index])
  );
  const issues = [];
  const seenTokens = new Set();
  let nextPageToken;

  while (true) {
    const inputs = {
      jql,
      searchResultMode: "issues",
      maxResults: SEARCH_PAGE_SIZE,
      fields: ISSUE_FIELDS,
      view: "full"
    };
    if (nextPageToken) {
      inputs.nextPageToken = nextPageToken;
    }

    const page = unwrapData(await callOperation("searchJiraIssuesUsingJql", cloudId, inputs));
    if (!Array.isArray(page?.issues)) {
      throw new Error("Jira returned an invalid issue search page.");
    }
    issues.push(...page.issues);

    if (page.isLast === true || !page.nextPageToken) {
      if (page.isLast === false && !page.nextPageToken) {
        throw new Error("Jira returned another search page without a nextPageToken.");
      }
      break;
    }
    if (seenTokens.has(page.nextPageToken)) {
      throw new Error("Jira repeated a search pagination token.");
    }
    seenTokens.add(page.nextPageToken);
    nextPageToken = page.nextPageToken;
  }

  return [...new Map(issues
    .filter((issue) => issue.key ?? issue.id)
    .map((issue) => [issue.key ?? issue.id, toPendingIssue(issue)])
  ).values()].sort((left, right) =>
    (statusOrder.get(left.status) ?? statusOrder.size) -
    (statusOrder.get(right.status) ?? statusOrder.size)
  );
}