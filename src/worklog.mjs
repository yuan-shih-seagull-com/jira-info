const HOURS_IN_DAY = 24;
const SEARCH_PAGE_SIZE = 100;
const WORKLOG_PAGE_SIZE = 100;
const FORMATTERS = new Map();

function getFormatter(timeZone, includeTime = false) {
  const key = `${timeZone}:${includeTime}`;
  if (!FORMATTERS.has(key)) {
    FORMATTERS.set(key, new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(includeTime ? {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      } : {})
    }));
  }
  return FORMATTERS.get(key);
}

function getParts(formatter, timestamp) {
  return Object.fromEntries(
    formatter.formatToParts(new Date(timestamp))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );
}

function dateKey(parts) {
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

function parseDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError(`Date must use YYYY-MM-DD format: ${date}`);
  }

  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  if (value.toISOString().slice(0, 10) !== date) {
    throw new TypeError(`Invalid calendar date: ${date}`);
  }
  return { year, month, day, utcMidnight: value.getTime() };
}

function shiftDate(date, days) {
  const { year, month, day } = parseDate(date);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day + days);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString().slice(0, 10);
}

function firstInstantOfLocalDate(date, timeZone) {
  const { utcMidnight } = parseDate(date);
  const formatter = getFormatter(timeZone);
  const searchRadius = 2 * HOURS_IN_DAY * 60 * 60 * 1000;
  let earlier = utcMidnight - searchRadius;
  let later = utcMidnight + searchRadius;

  if (dateKey(getParts(formatter, earlier)) >= date || dateKey(getParts(formatter, later)) < date) {
    throw new RangeError(`Could not resolve ${date} in timezone ${timeZone}`);
  }

  while (later - earlier > 1) {
    const middle = earlier + Math.floor((later - earlier) / 2);
    if (dateKey(getParts(formatter, middle)) < date) {
      earlier = middle;
    } else {
      later = middle;
    }
  }

  if (dateKey(getParts(formatter, later)) !== date) {
    throw new RangeError(`${date} does not exist in timezone ${timeZone}`);
  }
  return later;
}

export function getLocalDayWindow(date, timeZone) {
  parseDate(date);
  getFormatter(timeZone);
  return {
    startMs: firstInstantOfLocalDate(date, timeZone),
    endMs: firstInstantOfLocalDate(shiftDate(date, 1), timeZone)
  };
}

function localDateTime(timestamp, timeZone) {
  const parts = getParts(getFormatter(timeZone, true), timestamp);
  return {
    localDate: dateKey(parts),
    localTime: parts.second === "00"
      ? `${parts.hour}:${parts.minute}`
      : `${parts.hour}:${parts.minute}:${parts.second}`
  };
}

export function formatDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new TypeError(`Duration must be a non-negative integer number of seconds: ${seconds}`);
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [
    hours > 0 ? `${hours}h` : "",
    minutes > 0 ? `${minutes}m` : "",
    remainingSeconds > 0 ? `${remainingSeconds}s` : ""
  ].filter(Boolean).join(" ") || "0m";
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

async function getCandidateIssues(callOperation, cloudId, date) {
  const startDate = shiftDate(date, -2);
  const endDate = shiftDate(date, 2);
  const jql = `worklogAuthor = currentUser() AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}"`;
  const issues = [];
  const seenTokens = new Set();
  let nextPageToken;

  while (true) {
    const inputs = {
      jql,
      searchResultMode: "issues",
      maxResults: SEARCH_PAGE_SIZE,
      fields: ["summary"],
      view: "compact"
    };
    if (nextPageToken) {
      inputs.nextPageToken = nextPageToken;
    }

    const page = unwrapData(await callOperation("searchJiraIssuesUsingJql", cloudId, inputs));
    issues.push(...(Array.isArray(page?.issues) ? page.issues : []));

    if (page?.isLast === true || !page?.nextPageToken) {
      if (page?.isLast === false && !page?.nextPageToken) {
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

  return [...new Map(issues.map((issue) => [issue.key ?? issue.id, issue])).values()];
}

async function getIssueWorklogs(callOperation, cloudId, issueIdOrKey, startMs, endMs) {
  const worklogs = [];
  let startAt = 0;

  while (true) {
    const page = unwrapData(await callOperation("listJiraIssueWorklogs", cloudId, {
      issueIdOrKey,
      startAt,
      maxResults: WORKLOG_PAGE_SIZE,
      startedAfter: startMs,
      startedBefore: endMs
    }));
    if (!Array.isArray(page?.worklogs)) {
      throw new Error(`Jira returned an invalid worklog page for ${issueIdOrKey}.`);
    }
    worklogs.push(...page.worklogs);

    const total = Number.isInteger(page.total) ? page.total : undefined;
    if (page.isLast === true || (total !== undefined && startAt + page.worklogs.length >= total)) {
      break;
    }
    if (page.worklogs.length === 0) {
      if (page.isLast === false) {
        throw new Error(`Jira returned an empty non-final worklog page for ${issueIdOrKey}.`);
      }
      break;
    }
    if (page.isLast !== false && total === undefined && page.worklogs.length < WORKLOG_PAGE_SIZE) {
      break;
    }
    startAt += page.worklogs.length;
  }

  return worklogs;
}

export async function getWorklogsForDate({ callOperation, cloudId, accountId, date, timeZone }) {
  if (!accountId) {
    throw new TypeError("An accountId is required to filter worklogs to the current user.");
  }
  const { startMs, endMs } = getLocalDayWindow(date, timeZone);
  const issues = await getCandidateIssues(callOperation, cloudId, date);
  const entries = [];

  for (const issue of issues) {
    const issueIdOrKey = issue.key ?? issue.id;
    if (!issueIdOrKey) {
      continue;
    }
    const worklogs = await getIssueWorklogs(callOperation, cloudId, issueIdOrKey, startMs, endMs);

    for (const worklog of worklogs) {
      if (worklog.author?.accountId !== accountId) {
        continue;
      }

      const startedMs = Date.parse(worklog.started);
      if (!Number.isFinite(startedMs)) {
        throw new Error(`Worklog ${worklog.id ?? "(unknown id)"} has an invalid start timestamp.`);
      }
      if (startedMs < startMs || startedMs >= endMs) {
        continue;
      }

      const timeSpentSeconds = Number(worklog.timeSpentSeconds);
      if (!Number.isInteger(timeSpentSeconds) || timeSpentSeconds < 0) {
        throw new Error(`Worklog ${worklog.id ?? "(unknown id)"} has an invalid duration.`);
      }

      const estimatedEndMs = startedMs + timeSpentSeconds * 1000;
      entries.push({
        worklogId: worklog.id ?? null,
        issueKey: issue.key ?? String(issue.id),
        summary: issue.fields?.summary ?? issue.summary ?? "",
        author: worklog.author.displayName ?? "",
        startedAt: worklog.started,
        localStartTime: localDateTime(startedMs, timeZone).localTime,
        estimatedEnd: {
          ...localDateTime(estimatedEndMs, timeZone),
          instant: new Date(estimatedEndMs).toISOString()
        },
        timeSpentSeconds,
        timeSpent: formatDuration(timeSpentSeconds),
        comment: worklog.comment ?? ""
      });
    }
  }

  entries.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const totalSeconds = entries.reduce((total, entry) => total + entry.timeSpentSeconds, 0);
  return {
    date,
    timeZone,
    issueCount: issues.length,
    entryCount: entries.length,
    totalSeconds,
    totalTimeSpent: formatDuration(totalSeconds),
    entries
  };
}