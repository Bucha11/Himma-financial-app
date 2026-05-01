"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, formatMonth } from "@/lib/format";
import { categories, filterTransactions, summarizeTransactions } from "@/lib/transactions";
import type { Category, SpendingSummary, Transaction } from "@/lib/types";

type Props = {
  initialSummary: SpendingSummary;
  initialTransactions: Transaction[];
};

type AskResponse = {
  answer: string;
  supportingFacts: string[];
  matchedTransactions: string[];
  error?: string;
};

type Turn =
  | { kind: "user"; question: string }
  | {
      kind: "assistant";
      answer: string;
      supportingFacts: string[];
      matchedTransactions: string[];
    }
  | { kind: "error"; message: string };

const exampleQuestions = [
  "How much did I spend on dining in March?",
  "What's my biggest non-transfer expense category?",
  "Which merchants look recurring?",
  "Why was March more expensive?"
];

export default function FinanceApp({ initialSummary, initialTransactions }: Props) {
  const [month, setMonth] = useState("All");
  const [category, setCategory] = useState<Category | "All">("All");
  const [search, setSearch] = useState("");
  const [includeTransfers, setIncludeTransfers] = useState(true);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [providerInfo, setProviderInfo] = useState<{ configured: boolean; model: string | null } | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const months = initialSummary.months.map((item) => item.month);
  const transactionsById = useMemo(
    () => new Map(initialTransactions.map((row) => [row.id, row])),
    [initialTransactions]
  );

  const scopedTransactions = useMemo(
    () =>
      month === "All"
        ? initialTransactions
        : filterTransactions(initialTransactions, { month }),
    [initialTransactions, month]
  );

  const scopedSummary: SpendingSummary = useMemo(
    () => (month === "All" ? initialSummary : summarizeTransactions(scopedTransactions)),
    [initialSummary, month, scopedTransactions]
  );

  const headlineCategory =
    scopedSummary.categories.find((item) => item.category !== "Transfer") ??
    scopedSummary.categories[0];

  const scopeLabel = month === "All" ? "all months" : formatMonth(month);

  const filteredTransactions = useMemo(
    () =>
      filterTransactions(scopedTransactions, {
        category,
        search,
        includeTransfers
      }),
    [category, includeTransfers, scopedTransactions, search]
  );

  const filteredTotal = useMemo(
    () => filteredTransactions.reduce((total, row) => total + row.amount, 0),
    [filteredTransactions]
  );

  const filtersActive =
    category !== "All" || search.trim().length > 0 || !includeTransfers;

  const dateRangeDays = useMemo(() => {
    const { start, end } = scopedSummary.dateRange;
    if (!start || !end) return 1;
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(1, Math.round(ms / 86400000) + 1);
  }, [scopedSummary.dateRange]);

  const avgPerDay = scopedSummary.totalSpendExcludingTransfers / dateRangeDays;

  useEffect(() => {
    if (turns.length === 0 || !isChatOpen) {
      return;
    }
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, isAsking, isChatOpen]);

  useEffect(() => {
    fetch("/api/provider")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && typeof data.configured === "boolean") {
          setProviderInfo(data);
        }
      })
      .catch(() => {});
  }, []);

  async function askQuestion(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isAsking) {
      return;
    }

    const nextTurns: Turn[] = [...turns, { kind: "user", question: trimmed }];
    setTurns(nextTurns);
    setQuestion("");
    setIsAsking(true);

    const history = nextTurns
      .filter(
        (turn): turn is Extract<Turn, { kind: "user" | "assistant" }> =>
          turn.kind === "user" || turn.kind === "assistant"
      )
      .map((turn) =>
        turn.kind === "user"
          ? { role: "user" as const, content: turn.question }
          : { role: "assistant" as const, content: turn.answer }
      );

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
        signal: AbortSignal.timeout(30_000)
      });

      const data = (await response.json().catch(() => null)) as AskResponse | null;
      if (!response.ok || !data) {
        const message = data?.error ?? `Request failed (${response.status}).`;
        setTurns((prev) => [...prev, { kind: "error", message }]);
        return;
      }
      setTurns((prev) => [
        ...prev,
        {
          kind: "assistant",
          answer: data.answer,
          supportingFacts: data.supportingFacts ?? [],
          matchedTransactions: data.matchedTransactions ?? []
        }
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error.";
      setTurns((prev) => [
        ...prev,
        { kind: "error", message: `Could not reach the AI service: ${message}` }
      ]);
    } finally {
      setIsAsking(false);
    }
  }

  function clearConversation() {
    setTurns([]);
    setQuestion("");
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Personal finance</p>
          <h1>Spending dashboard</h1>
        </div>
        <div className="scope-badge" aria-live="polite">
          <span className="scope-badge-label">Showing</span>
          <strong>{scopeLabel}</strong>
          {month === "All" ? (
            <span className="scope-badge-range">
              {initialSummary.dateRange.start} → {initialSummary.dateRange.end}
            </span>
          ) : (
            <button
              type="button"
              className="scope-clear"
              onClick={() => setMonth("All")}
              aria-label="Clear month filter"
            >
              ×
            </button>
          )}
        </div>
      </section>

      <section className="metric-grid" aria-label="Spending summary">
        <Metric title="Total outflow" value={formatMoney(scopedSummary.totalSpend)} detail={`${scopedSummary.transactionCount} transactions · ${scopeLabel}`} />
        <Metric title="Total spend" value={formatMoney(scopedSummary.totalSpendExcludingTransfers)} detail="Excludes savings transfers" />
        <Metric title="Top spend category" value={headlineCategory?.category ?? "-"} detail={headlineCategory ? `${headlineCategory.share.toFixed(1)}% of outflow · excludes transfers` : "No data"} />
        {filtersActive ? (
          <Metric
            title="Filtered total"
            value={formatMoney(filteredTotal)}
            detail={`${filteredTransactions.length} matching rows`}
          />
        ) : (
          <Metric
            title="Avg / day"
            value={formatMoney(avgPerDay)}
            detail={`${dateRangeDays} days · excludes transfers`}
          />
        )}
      </section>

      <section className="charts-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Spend by category</h2>
              <p>Transfers are shown separately so consumption is easy to compare. Scoped to {scopeLabel}.</p>
            </div>
          </div>
          <div className="bar-list">
            {scopedSummary.categories.map((item) => (
              <div className="bar-row" key={item.category}>
                <div className="bar-label">
                  <span>{item.category}</span>
                  <strong>{formatMoney(item.amount)}</strong>
                </div>
                <div className="bar-track">
                  <div className={`bar-fill category-${item.category.toLowerCase()}`} style={{ width: `${item.share}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Monthly trend</h2>
              <p>Click a month to filter.</p>
            </div>
          </div>
          <div className="month-stack">
            {initialSummary.months.map((item) => {
              const max = Math.max(...initialSummary.months.map((entry) => entry.amount));
              const isActive = month === item.month;
              return (
                <button
                  type="button"
                  className={`month-row month-row-button${isActive ? " month-row-active" : ""}`}
                  key={item.month}
                  onClick={() => setMonth(isActive ? "All" : item.month)}
                  aria-pressed={isActive}
                  title={isActive ? "Click to show all months" : `Filter to ${formatMonth(item.month)}`}
                >
                  <div>
                    <span>{formatMonth(item.month)}</span>
                    <strong className="month-row-amount">
                      {formatMoney(item.amount)}
                      <span className="month-row-chevron" aria-hidden="true">
                        {isActive ? "✓" : "›"}
                      </span>
                    </strong>
                  </div>
                  <div className="bar-track">
                    <div className="month-fill" style={{ width: `${(item.amount / max) * 100}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel insights-band">
        <div className="panel-header">
          <div>
            <h2>Insights</h2>
            <p>Useful signals from the transaction set.</p>
          </div>
        </div>
        <div className="insight-grid">
          {initialSummary.insights.map((insight) => (
            <article className={`insight insight-${insight.tone}`} key={insight.title}>
              <span>{insight.title}</span>
              <strong>{insight.value}</strong>
              <p>{insight.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel transactions-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Transactions</h2>
            <p>Showing {scopeLabel} · use the header to change month.</p>
          </div>
          <div className="filters">
            <select aria-label="Filter by month" value={month} onChange={(event) => setMonth(event.target.value)}>
              <option value="All">All months</option>
              {months.map((item) => (
                <option value={item} key={item}>
                  {formatMonth(item)}
                </option>
              ))}
            </select>
            <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value as Category | "All")}>
              <option value="All">All categories</option>
              {categories.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
            <input aria-label="Search merchant" placeholder="Search merchant" value={search} onChange={(event) => setSearch(event.target.value)} />
            <label className="toggle">
              <input type="checkbox" checked={includeTransfers} onChange={(event) => setIncludeTransfers(event.target.checked)} />
              Transfers
            </label>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Merchant</th>
                <th>Category</th>
                <th>Account</th>
                <th className="amount-cell">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.date}</td>
                  <td>{transaction.merchant}</td>
                  <td>
                    <span className="category-pill">{transaction.category}</span>
                  </td>
                  <td>{transaction.account}</td>
                  <td className="amount-cell">{formatMoney(transaction.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className={`chat-widget${isChatOpen ? " chat-widget-open" : ""}`}>
        {isChatOpen ? (
          <div className="chat-widget-panel" role="dialog" aria-label="Spending assistant">
            <header className="chat-widget-header">
              <div>
                <h3>Ask about spending</h3>
                <p>
                  Follow-ups remember the prior turns.
                  {providerInfo?.configured ? (
                    <>
                      {" "}
                      <span className="provider-tag provider-openai">
                        OpenAI · {providerInfo.model}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="chat-widget-actions">
                {turns.length > 0 ? (
                  <button type="button" className="link-button" onClick={clearConversation}>
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  className="chat-widget-close"
                  aria-label="Minimize chat"
                  onClick={() => setIsChatOpen(false)}
                >
                  ×
                </button>
              </div>
            </header>

            <div className="ask-panel-body">
              <div className="chat-thread" aria-live="polite" aria-busy={isAsking}>
                {turns.length === 0 && !isAsking ? (
                  providerInfo && !providerInfo.configured ? (
                    <div className="chat-empty">
                      <p className="chat-empty-title">AI not configured</p>
                      <p className="chat-empty-hint">
                        Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the dev server to enable Q&A.
                        The dashboard, charts, and filters work fully without it.
                      </p>
                    </div>
                  ) : (
                    <div className="chat-empty">
                      <p className="chat-empty-title">Try one of these</p>
                      <div className="question-chips" role="list" aria-label="Example questions">
                        {exampleQuestions.map((item) => (
                          <button key={item} type="button" role="listitem" onClick={() => setQuestion(item)}>
                            {item}
                          </button>
                        ))}
                      </div>
                      <p className="chat-empty-hint">
                        Answers cite the exact transactions used. Follow-ups remember the context of the prior turn.
                      </p>
                    </div>
                  )
                ) : null}
                {turns.map((turn, index) => {
                  if (turn.kind === "user") {
                    return (
                      <div className="chat-turn chat-user" key={`u-${index}`}>
                        <span className="chat-role">You</span>
                        <p>{turn.question}</p>
                      </div>
                    );
                  }
                  if (turn.kind === "error") {
                    return (
                      <div className="chat-turn chat-error" key={`e-${index}`} role="alert">
                        <span className="chat-role">Error</span>
                        <p>{turn.message}</p>
                      </div>
                    );
                  }
                  return (
                    <div className="chat-turn chat-assistant" key={`a-${index}`}>
                      <span className="chat-role">Assistant</span>
                      <p className="chat-answer">{turn.answer}</p>
                      {turn.supportingFacts.length > 0 ? (
                        <ul className="chat-facts">
                          {turn.supportingFacts.map((fact) => (
                            <li key={fact}>{fact}</li>
                          ))}
                        </ul>
                      ) : null}
                      {turn.matchedTransactions.length > 0 ? (
                        <div className="matched-list">
                          <p className="matched-title">
                            Cited transactions ({turn.matchedTransactions.length})
                          </p>
                          <ul>
                            {turn.matchedTransactions.map((id) => {
                              const transaction = transactionsById.get(id);
                              if (!transaction) {
                                return null;
                              }
                              return (
                                <li key={id} className="matched-row">
                                  <span className="matched-date">{transaction.date}</span>
                                  <span className="matched-merchant">{transaction.merchant}</span>
                                  <span className="matched-category">{transaction.category}</span>
                                  <span className="matched-amount">{formatMoney(transaction.amount)}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {isAsking ? (
                  <div className="chat-turn chat-assistant chat-loading">
                    <span className="chat-role">Assistant</span>
                    <span className="dot-flash" aria-hidden="true">
                      <span /><span /><span />
                    </span>
                  </div>
                ) : null}
                <div ref={threadEndRef} />
              </div>

              <form className="ask-form" onSubmit={askQuestion}>
                <label htmlFor="ask-input" className="visually-hidden">
                  Ask a question about your spending
                </label>
                <input
                  id="ask-input"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder={
                    turns.length > 0
                      ? "Ask a follow-up — e.g. \"and February?\""
                      : "What do you want to know?"
                  }
                  autoComplete="off"
                />
                <button
                  disabled={
                    isAsking ||
                    question.trim().length === 0 ||
                    (providerInfo !== null && !providerInfo.configured)
                  }
                >
                  {isAsking ? "..." : "Ask"}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="chat-widget-fab"
            onClick={() => setIsChatOpen(true)}
            aria-label="Open spending assistant"
          >
            <span className="chat-widget-fab-icon" aria-hidden="true">💬</span>
            <span className="chat-widget-fab-text">
              {turns.length > 0 ? "Resume chat" : "Ask AI"}
            </span>
            {turns.length > 0 ? (
              <span className="chat-widget-fab-badge" aria-hidden="true">
                {turns.filter((t) => t.kind === "assistant").length}
              </span>
            ) : null}
          </button>
        )}
      </aside>
    </main>
  );
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
