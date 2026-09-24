import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { getPendingIssues, normalizeTrackedAccountIds } from "./issues.mjs";
import { createTerminalHyperlink, getJiraIssueUrl } from "./issue-links.mjs";
import { formatWorkingDays, isWithinWorkingHours } from "./refresh-schedule.mjs";

const h = React.createElement;

export function fitCell(value, width) {
  const text = String(value ?? "");
  if (width <= 0) {
    return "";
  }
  if (text.length <= width) {
    return text.padEnd(width);
  }
  if (width <= 3) {
    return text.slice(0, width);
  }
  return `${text.slice(0, Math.max(0, width - 3))}...`;
}

export function getColumnWidths(terminalWidth) {
  const hasAssignee = terminalWidth >= 24;
  const overhead = hasAssignee ? 6 : 5;
  const available = Math.max(4, terminalWidth - overhead);
  const widths = {
    key: Math.max(1, Math.min(12, Math.floor(available * 0.2))),
    assignee: hasAssignee ? Math.max(4, Math.min(14, Math.floor(available * 0.18))) : 0,
    status: Math.max(1, Math.min(18, Math.floor(available * 0.3))),
    priority: Math.max(1, Math.min(10, Math.floor(available * 0.15)))
  };
  for (const column of ["priority", "status", "assignee", "key"]) {
    const minimum = column === "assignee" ? (hasAssignee ? 4 : 0) : 1;
    while (widths.key + widths.assignee + widths.status + widths.priority > available - 1 && widths[column] > minimum) {
      widths[column] -= 1;
    }
  }
  const summary = Math.max(1, available - widths.key - widths.assignee - widths.status - widths.priority);
  return { ...widths, summary };
}

export function getNextSelectionIndex(index, issueCount, direction) {
  if (issueCount === 0) {
    return 0;
  }
  return Math.max(0, Math.min(issueCount - 1, index + direction));
}

function formatTime(timestamp, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function getVisibleIssueRange(issueCount, selectedIndex, visibleCount) {
  const lastStart = Math.max(0, issueCount - visibleCount);
  const start = Math.min(Math.max(0, selectedIndex - visibleCount + 1), lastStart);
  return { start, end: Math.min(issueCount, start + visibleCount) };
}

function getIssuesForTab(issues, accountId) {
  return accountId === null
    ? issues
    : issues.filter((issue) => issue.assigneeAccountId === accountId);
}

export function PendingIssuesApp({ session, refreshSchedule, trackedAccountIds = [] }) {
  const { exit } = useApp();
  const [issues, setIssues] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const refreshInProgress = useRef(false);
  const colleagueAccountIds = normalizeTrackedAccountIds(trackedAccountIds)
    .filter((accountId) => accountId !== session.accountId);
  const accountIds = colleagueAccountIds.length > 0
    ? normalizeTrackedAccountIds([session.accountId, ...colleagueAccountIds])
    : undefined;
  const individualAccountIds = accountIds ?? [session.accountId];
  const displayName = session.profile?.displayName ?? session.accountId;
  const accountNames = new Map(issues
    .filter((issue) => issue.assigneeAccountId && issue.assignee)
    .map((issue) => [issue.assigneeAccountId, issue.assignee]));
  const tabs = [
    { accountId: null, label: "All" },
    ...individualAccountIds.map((accountId) => ({
      accountId,
      label: accountId === session.accountId
        ? displayName
        : accountNames.get(accountId) ?? `Account ${accountId.slice(-8)}`
    }))
  ];
  const selectedTabIndex = Math.max(0, tabs.findIndex((tab) => tab.accountId === selectedAccountId));
  const activeTab = tabs[selectedTabIndex];
  const visibleIssues = getIssuesForTab(issues, activeTab.accountId);

  const refresh = async () => {
    if (refreshInProgress.current) {
      return;
    }
    refreshInProgress.current = true;
    setLoading(true);
    setError("");
    try {
      const nextIssues = await getPendingIssues({
        callOperation: session.callOperation,
        cloudId: session.cloudId,
        accountIds
      });
      const nextVisibleIssues = getIssuesForTab(nextIssues, activeTab.accountId);
      setIssues(nextIssues);
      setSelectedIndex((index) => Math.min(index, Math.max(0, nextVisibleIssues.length - 1)));
      setLastRefreshedAt(Date.now());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      refreshInProgress.current = false;
      setLoading(false);
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refreshRef.current();
    if (!refreshSchedule.enabled) {
      return undefined;
    }
    const timer = setInterval(() => {
      if (isWithinWorkingHours(Date.now(), session.timeZone, refreshSchedule)) {
        void refreshRef.current();
      }
    }, refreshSchedule.intervalMinutes * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshSchedule, session.timeZone]);

  const moveTab = (direction) => {
    const nextTabIndex = Math.max(0, Math.min(tabs.length - 1, selectedTabIndex + direction));
    const nextTab = tabs[nextTabIndex];
    if (nextTab.accountId !== activeTab.accountId) {
      setSelectedAccountId(nextTab.accountId);
      setSelectedIndex(0);
    }
  };

  useInput((input, key) => {
    if (input.toLowerCase() === "q" || key.escape) {
      exit();
    } else if (input.toLowerCase() === "r") {
      void refreshRef.current();
    } else if (key.leftArrow) {
      moveTab(-1);
    } else if (key.rightArrow) {
      moveTab(1);
    } else if (key.upArrow) {
      setSelectedIndex((index) => getNextSelectionIndex(index, visibleIssues.length, -1));
    } else if (key.downArrow) {
      setSelectedIndex((index) => getNextSelectionIndex(index, visibleIssues.length, 1));
    }
  });

  const terminalWidth = process.stdout.columns ?? 100;
  const terminalHeight = process.stdout.rows ?? 24;
  const columns = getColumnWidths(terminalWidth);
  const visibleCount = Math.max(1, terminalHeight - 10);
  const visibleRange = getVisibleIssueRange(visibleIssues.length, selectedIndex, visibleCount);
  const issueCount = `${visibleIssues.length} ${visibleIssues.length === 1 ? "issue" : "issues"}`;
  const accountDescription = activeTab.accountId !== null
    ? `Assignee: ${activeTab.label} | ${issueCount}`
    : colleagueAccountIds.length > 0
      ? `Tracking ${displayName} + ${colleagueAccountIds.length} ${colleagueAccountIds.length === 1 ? "colleague" : "colleagues"} | ${issueCount}`
      : `Assignee: ${displayName} | ${issueCount}`;
  const refreshDescription = refreshSchedule.enabled
    ? `Auto refresh: every ${refreshSchedule.intervalMinutes} min, ${formatWorkingDays(refreshSchedule.workingHours.days)} ${refreshSchedule.workingHours.start}-${refreshSchedule.workingHours.end} (${session.timeZone})`
    : "Auto refresh: off";
  const header = `  ${fitCell("KEY", columns.key)}${columns.assignee > 0 ? ` ${fitCell("ASSIGNEE", columns.assignee)}` : ""} ${fitCell("STATUS", columns.status)} ${fitCell("PRIORITY", columns.priority)} ${fitCell("SUMMARY", columns.summary)}`;
  const rows = visibleIssues.slice(visibleRange.start, visibleRange.end).map((issue, index) => {
    const issueIndex = visibleRange.start + index;
    const selected = issueIndex === selectedIndex;
    const issueKey = fitCell(issue.key, columns.key).trimEnd();
    const issueKeyCell = session.jiraBaseUrl
      ? `${createTerminalHyperlink(getJiraIssueUrl(session.jiraBaseUrl, issue.key), issueKey)}${" ".repeat(Math.max(0, columns.key - issueKey.length))}`
      : fitCell(issue.key, columns.key);
    const assigneeCell = columns.assignee > 0 ? ` ${fitCell(issue.assignee, columns.assignee)}` : "";
    const row = `${selected ? "> " : "  "}${issueKeyCell}${assigneeCell} ${fitCell(issue.status, columns.status)} ${fitCell(issue.priority || "-", columns.priority)} ${fitCell(issue.summary, columns.summary)}`;
    return h(Box, { key: issue.id, backgroundColor: selected ? "blue" : undefined },
      h(Text, { color: selected ? "white" : undefined }, row));
  });
  const refreshed = lastRefreshedAt === null
    ? "Not yet"
    : formatTime(lastRefreshedAt, session.timeZone);

  return h(Box, { flexDirection: "column" },
    h(Text, { bold: true, color: "cyan" }, "Jira pending issues"),
    h(Text, { dimColor: true }, accountDescription),
    h(Text, { dimColor: true }, `Last refreshed: ${refreshed}${loading ? " | Refreshing..." : ""}`),
    h(Text, { dimColor: true }, refreshDescription),
    h(Box, { flexDirection: "row", flexWrap: "wrap", marginTop: 1 },
      ...tabs.map((tab, index) => h(Text, {
        key: tab.accountId ?? "all",
        bold: index === selectedTabIndex,
        color: index === selectedTabIndex ? "black" : undefined,
        backgroundColor: index === selectedTabIndex ? "cyan" : undefined,
        dimColor: index !== selectedTabIndex
      }, ` ${tab.label} `))),
    error ? h(Text, { color: "red" }, `Refresh failed: ${error}`) : null,
    h(Box, { flexDirection: "column", marginTop: 1 },
      h(Text, { bold: true }, header),
      ...(visibleIssues.length > 0 ? rows : [h(Text, { key: "empty", dimColor: true }, loading ? "Loading issues..." : "No pending issues.")]),
      visibleIssues.length > visibleCount
        ? h(Text, { key: "range", dimColor: true }, `Showing ${visibleRange.start + 1}-${visibleRange.end} of ${visibleIssues.length}`)
        : null),
    h(Text, { dimColor: true }, "Left/Right tabs | Up/Down select | r refresh now | q quit"));
}