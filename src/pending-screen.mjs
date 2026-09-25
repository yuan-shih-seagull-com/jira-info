import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { getPendingIssues, normalizeTrackedAccountIds } from "./issues.mjs";
import { createTerminalHyperlink, getJiraIssueUrl } from "./issue-links.mjs";
import { formatWorkingDays, isWithinWorkingHours } from "./refresh-schedule.mjs";
import { getLocalDate, getLocalDayWindow, getWorklogsForDate } from "./worklog.mjs";

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

export function getWorklogColumnWidths(terminalWidth) {
  const hasAuthor = terminalWidth >= 24;
  const overhead = hasAuthor ? 6 : 5;
  const available = Math.max(4, terminalWidth - overhead);
  const widths = {
    author: hasAuthor ? Math.max(4, Math.min(18, Math.floor(available * 0.22))) : 0,
    start: Math.max(1, Math.min(8, Math.floor(available * 0.2))),
    duration: Math.max(1, Math.min(10, Math.floor(available * 0.22))),
    issue: Math.max(1, Math.min(12, Math.floor(available * 0.2)))
  };
  for (const column of ["issue", "duration", "start", "author"]) {
    const minimum = column === "author" ? (hasAuthor ? 4 : 0) : 1;
    while (widths.author + widths.start + widths.duration + widths.issue > available - 1 && widths[column] > minimum) {
      widths[column] -= 1;
    }
  }
  const summary = Math.max(1, available - widths.author - widths.start - widths.duration - widths.issue);
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
  const [selectedTabId, setSelectedTabId] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [worklogDate, setWorklogDate] = useState(() => getLocalDate(Date.now(), session.timeZone));
  const [dateInput, setDateInput] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [worklogReport, setWorklogReport] = useState(null);
  const [worklogLoading, setWorklogLoading] = useState(false);
  const [worklogError, setWorklogError] = useState("");
  const refreshInProgress = useRef(false);
  const worklogRequestId = useRef(0);
  const activeTabRef = useRef(null);
  const colleagueAccountIds = normalizeTrackedAccountIds(trackedAccountIds)
    .filter((accountId) => accountId !== session.accountId);
  const accountIds = colleagueAccountIds.length > 0
    ? normalizeTrackedAccountIds([session.accountId, ...colleagueAccountIds])
    : undefined;
  const worklogAccountIds = accountIds ?? [session.accountId];
  const individualAccountIds = accountIds ?? [session.accountId];
  const displayName = session.profile?.displayName ?? session.accountId;
  const accountNames = new Map(issues
    .filter((issue) => issue.assigneeAccountId && issue.assignee)
    .map((issue) => [issue.assigneeAccountId, issue.assignee]));
  const tabs = [
    { id: "all", kind: "issues", accountId: null, label: "All" },
    ...individualAccountIds.map((accountId) => ({
      id: `account:${accountId}`,
      kind: "issues",
      accountId,
      label: accountId === session.accountId
        ? displayName
        : accountNames.get(accountId) ?? `Account ${accountId.slice(-8)}`
    })),
    { id: "worklogs", kind: "worklogs", accountId: null, label: "Worklogs" }
  ];
  const selectedTabIndex = Math.max(0, tabs.findIndex((tab) => tab.id === selectedTabId));
  const activeTab = tabs[selectedTabIndex];
  activeTabRef.current = activeTab;
  const visibleIssues = activeTab.kind === "issues" ? getIssuesForTab(issues, activeTab.accountId) : [];
  const visibleWorklogs = activeTab.kind === "worklogs" ? worklogReport?.entries ?? [] : [];
  const visibleItems = activeTab.kind === "worklogs" ? visibleWorklogs : visibleIssues;
  const worklogAccountSummaries = worklogReport
    ? worklogAccountIds.map((accountId) => {
      const accountTotal = worklogReport.accountTotals.find((item) => item.accountId === accountId);
      const accountEntries = worklogReport.entries.filter((entry) => entry.authorAccountId === accountId);
      const author = accountEntries.find((entry) => entry.author)?.author;
      const label = accountId === session.accountId
        ? displayName
        : author ?? (accountTotal?.displayName !== accountId
          ? accountTotal?.displayName
          : accountNames.get(accountId) ?? `Account ${accountId.slice(-8)}`);
      return {
        accountId,
        label,
        entryCount: accountTotal?.entryCount ?? 0,
        totalTimeSpent: accountTotal?.totalTimeSpent ?? "0m"
      };
    })
    : [];
  const worklogAccountLabels = new Map(worklogAccountSummaries.map(({ accountId, label }) => [accountId, label]));

  const refreshIssues = async () => {
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
      setIssues(nextIssues);
      const currentTab = activeTabRef.current;
      if (currentTab?.kind === "issues") {
        const nextVisibleIssues = getIssuesForTab(nextIssues, currentTab.accountId);
        setSelectedIndex((index) => Math.min(index, Math.max(0, nextVisibleIssues.length - 1)));
      }
      setLastRefreshedAt(Date.now());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      refreshInProgress.current = false;
      setLoading(false);
    }
  };
  const loadWorklogs = async (date) => {
    const requestId = ++worklogRequestId.current;
    setWorklogLoading(true);
    setWorklogError("");
    setWorklogReport((currentReport) => currentReport?.date === date ? currentReport : null);
    try {
      const report = await getWorklogsForDate({
        callOperation: session.callOperation,
        cloudId: session.cloudId,
        accountId: session.accountId,
        accountIds: worklogAccountIds,
        date,
        timeZone: session.timeZone
      });
      if (requestId !== worklogRequestId.current) {
        return;
      }
      setWorklogReport(report);
      if (activeTabRef.current?.kind === "worklogs") {
        setSelectedIndex((index) => Math.min(index, Math.max(0, report.entries.length - 1)));
      }
      setLastRefreshedAt(Date.now());
    } catch (worklogRefreshError) {
      if (requestId === worklogRequestId.current) {
        setWorklogError(worklogRefreshError instanceof Error ? worklogRefreshError.message : String(worklogRefreshError));
      }
    } finally {
      if (requestId === worklogRequestId.current) {
        setWorklogLoading(false);
      }
    }
  };
  const refreshIssuesRef = useRef(refreshIssues);
  refreshIssuesRef.current = refreshIssues;
  const loadWorklogsRef = useRef(loadWorklogs);
  loadWorklogsRef.current = loadWorklogs;
  const refreshCurrentTab = () => {
    if (activeTabRef.current?.kind === "worklogs") {
      return editingDate ? undefined : loadWorklogsRef.current(worklogDate);
    }
    return refreshIssuesRef.current();
  };
  const refreshRef = useRef(refreshCurrentTab);
  refreshRef.current = refreshCurrentTab;

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

  const selectTab = (index) => {
    const nextTabIndex = Math.max(0, Math.min(tabs.length - 1, index));
    if (nextTabIndex === selectedTabIndex) {
      return;
    }
    const nextTab = tabs[nextTabIndex];
    setSelectedTabId(nextTab.id);
    setSelectedIndex(0);
    setEditingDate(false);
    setDateInput("");
    if (nextTab.kind === "worklogs" && worklogReport?.date !== worklogDate) {
      void loadWorklogsRef.current(worklogDate);
    }
  };

  useInput((input, key) => {
    if (editingDate) {
      if (key.escape) {
        setEditingDate(false);
        setDateInput("");
        setWorklogError("");
      } else if (key.return) {
        try {
          getLocalDayWindow(dateInput, session.timeZone);
          setWorklogDate(dateInput);
          setDateInput("");
          setEditingDate(false);
          setSelectedIndex(0);
          void loadWorklogsRef.current(dateInput);
        } catch (dateError) {
          setWorklogError(dateError instanceof Error ? dateError.message : String(dateError));
        }
      } else if (key.backspace || key.delete) {
        setDateInput((value) => value.slice(0, -1));
        setWorklogError("");
      } else if (input) {
        const dateCharacters = input.replace(/[^0-9-]/g, "");
        if (dateCharacters) {
          setDateInput((value) => `${value}${dateCharacters}`.slice(0, 10));
          setWorklogError("");
        }
      }
      return;
    }
    if (input.toLowerCase() === "q" || key.escape) {
      exit();
    } else if (input.toLowerCase() === "r") {
      void refreshRef.current();
    } else if (input.toLowerCase() === "w") {
      selectTab(tabs.findIndex((tab) => tab.id === "worklogs"));
    } else if (input.toLowerCase() === "d" && activeTab.kind === "worklogs") {
      setDateInput("");
      setEditingDate(true);
      setWorklogError("");
    } else if (key.leftArrow) {
      selectTab(selectedTabIndex - 1);
    } else if (key.rightArrow) {
      selectTab(selectedTabIndex + 1);
    } else if (key.upArrow) {
      setSelectedIndex((index) => getNextSelectionIndex(index, visibleItems.length, -1));
    } else if (key.downArrow) {
      setSelectedIndex((index) => getNextSelectionIndex(index, visibleItems.length, 1));
    }
  });

  const terminalWidth = process.stdout.columns ?? 100;
  const terminalHeight = process.stdout.rows ?? 24;
  const columns = getColumnWidths(terminalWidth);
  const worklogColumns = getWorklogColumnWidths(terminalWidth);
  const visibleCount = Math.max(1, terminalHeight - 10);
  const visibleRange = getVisibleIssueRange(visibleItems.length, selectedIndex, visibleCount);
  const issueCount = `${visibleIssues.length} ${visibleIssues.length === 1 ? "issue" : "issues"}`;
  const accountDescription = activeTab.kind === "worklogs"
    ? `Worklogs for ${worklogAccountIds.length} tracked ${worklogAccountIds.length === 1 ? "account" : "accounts"}`
    : activeTab.accountId !== null
      ? `Assignee: ${activeTab.label} | ${issueCount}`
      : colleagueAccountIds.length > 0
        ? `Tracking ${displayName} + ${colleagueAccountIds.length} ${colleagueAccountIds.length === 1 ? "colleague" : "colleagues"} | ${issueCount}`
        : `Assignee: ${displayName} | ${issueCount}`;
  const activeLoading = activeTab.kind === "worklogs" ? worklogLoading : loading;
  const refreshDescription = refreshSchedule.enabled
    ? `Auto refresh: every ${refreshSchedule.intervalMinutes} min, ${formatWorkingDays(refreshSchedule.workingHours.days)} ${refreshSchedule.workingHours.start}-${refreshSchedule.workingHours.end} (${session.timeZone})`
    : "Auto refresh: off";
  const header = `  ${fitCell("KEY", columns.key)}${columns.assignee > 0 ? ` ${fitCell("ASSIGNEE", columns.assignee)}` : ""} ${fitCell("STATUS", columns.status)} ${fitCell("PRIORITY", columns.priority)} ${fitCell("SUMMARY", columns.summary)}`;
  const worklogHeader = `  ${worklogColumns.author > 0 ? `${fitCell("AUTHOR", worklogColumns.author)} ` : ""}${fitCell("START", worklogColumns.start)} ${fitCell("DURATION", worklogColumns.duration)} ${fitCell("ISSUE", worklogColumns.issue)} ${fitCell("SUMMARY", worklogColumns.summary)}`;
  const issueRows = visibleIssues.slice(visibleRange.start, visibleRange.end).map((issue, index) => {
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
  const worklogRows = visibleWorklogs.slice(visibleRange.start, visibleRange.end).map((entry, index) => {
    const entryIndex = visibleRange.start + index;
    const selected = entryIndex === selectedIndex;
    const issueKey = fitCell(entry.issueKey, worklogColumns.issue).trimEnd();
    const issueKeyCell = session.jiraBaseUrl
      ? `${createTerminalHyperlink(getJiraIssueUrl(session.jiraBaseUrl, entry.issueKey), issueKey)}${" ".repeat(Math.max(0, worklogColumns.issue - issueKey.length))}`
      : fitCell(entry.issueKey, worklogColumns.issue);
    const authorCell = worklogColumns.author > 0
      ? `${fitCell(entry.author || worklogAccountLabels.get(entry.authorAccountId) || entry.authorAccountId, worklogColumns.author)} `
      : "";
    const summary = String(entry.summary).replace(/\s+/g, " ").trim();
    const row = `${selected ? "> " : "  "}${authorCell}${fitCell(entry.localStartTime, worklogColumns.start)} ${fitCell(entry.timeSpent, worklogColumns.duration)} ${issueKeyCell} ${fitCell(summary, worklogColumns.summary)}`;
    return h(Box, { key: entry.worklogId ?? `${entry.issueKey}-${entry.startedAt}-${index}`, backgroundColor: selected ? "blue" : undefined },
      h(Text, { color: selected ? "white" : undefined }, row));
  });
  const rows = activeTab.kind === "worklogs" ? worklogRows : issueRows;
  const refreshed = lastRefreshedAt === null
    ? "Not yet"
    : formatTime(lastRefreshedAt, session.timeZone);

  return h(Box, { flexDirection: "column" },
    h(Text, { bold: true, color: "cyan" }, activeTab.kind === "worklogs" ? "Jira worklogs" : "Jira pending issues"),
    h(Text, { dimColor: true }, accountDescription),
    activeTab.kind === "worklogs"
      ? h(Text, { bold: editingDate }, `Date: ${editingDate ? (dateInput || "YYYY-MM-DD") : `${worklogDate} (${session.timeZone})`}${worklogLoading ? " | Refreshing..." : ""}`)
      : h(Text, { dimColor: true }, `Last refreshed: ${refreshed}${activeLoading ? " | Refreshing..." : ""}`),
    activeTab.kind === "worklogs" && worklogReport
      ? h(Text, { dimColor: true }, `Total: ${worklogReport.totalTimeSpent} (${worklogReport.entryCount} ${worklogReport.entryCount === 1 ? "entry" : "entries"})`)
      : null,
    activeTab.kind === "worklogs" && worklogReport
      ? h(Text, { dimColor: true }, `By account: ${worklogAccountSummaries.map(({ label, totalTimeSpent, entryCount }) => `${label}: ${totalTimeSpent} (${entryCount})`).join(" | ")}`)
      : null,
    h(Text, { dimColor: true }, refreshDescription),
    h(Box, { flexDirection: "row", flexWrap: "wrap", marginTop: 1 },
      ...tabs.map((tab, index) => h(Text, {
        key: tab.id,
        bold: index === selectedTabIndex,
        color: index === selectedTabIndex ? "black" : undefined,
        backgroundColor: index === selectedTabIndex ? "cyan" : undefined,
        dimColor: index !== selectedTabIndex
      }, ` ${tab.label} `))),
    (activeTab.kind === "worklogs" ? worklogError : error)
      ? h(Text, { color: "red" }, `Refresh failed: ${activeTab.kind === "worklogs" ? worklogError : error}`)
      : null,
    h(Box, { flexDirection: "column", marginTop: 1 },
      h(Text, { bold: true }, activeTab.kind === "worklogs" ? worklogHeader : header),
      ...(visibleItems.length > 0 ? rows : [h(Text, { key: "empty", dimColor: true }, activeLoading
        ? (activeTab.kind === "worklogs" ? "Loading worklogs..." : "Loading issues...")
        : (activeTab.kind === "worklogs" ? "No worklogs for this date." : "No pending issues."))]),
      visibleItems.length > visibleCount
        ? h(Text, { key: "range", dimColor: true }, `Showing ${visibleRange.start + 1}-${visibleRange.end} of ${visibleItems.length}`)
        : null),
    h(Text, { dimColor: true }, editingDate
      ? "Type YYYY-MM-DD | Enter load | Esc cancel"
      : activeTab.kind === "worklogs"
        ? "d date | Left/Right tabs | Up/Down select | r refresh | q quit"
        : "Left/Right tabs | w worklogs | Up/Down select | r refresh now | q quit"));
}