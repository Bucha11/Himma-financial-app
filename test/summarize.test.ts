import assert from "node:assert/strict";
import test from "node:test";
import { filterTransactions, summarizeTransactions, transactions } from "../lib/transactions";

test("summarizeTransactions reports the dataset totals", () => {
  const summary = summarizeTransactions(transactions);
  assert.equal(summary.transactionCount, 100);
  assert.equal(summary.totalSpend, 29722.2);
  assert.equal(summary.totalSpendExcludingTransfers, 20722.2);
  assert.deepEqual(summary.dateRange, { start: "2025-01-03", end: "2025-03-31" });
});

test("summarizeTransactions ranks Transfer first by amount and Shopping second", () => {
  const summary = summarizeTransactions(transactions);
  assert.equal(summary.categories[0].category, "Transfer");
  assert.equal(summary.categories[0].amount, 9000);
  assert.equal(summary.categories[1].category, "Shopping");
  assert.equal(summary.categories[1].amount, 4486);
});

test("summarizeTransactions exposes monthly totals matching the sample data", () => {
  const summary = summarizeTransactions(transactions);
  const byMonth = Object.fromEntries(summary.months.map((row) => [row.month, row.amount]));
  assert.equal(byMonth["2025-01"], 7734.97);
  assert.equal(byMonth["2025-02"], 10410.17);
  assert.equal(byMonth["2025-03"], 11577.06);
});

test("summarizeTransactions surfaces a non-Transfer headline category in insights", () => {
  const summary = summarizeTransactions(transactions);
  const largestSpending = summary.insights.find((insight) => insight.title === "Largest spending category");
  assert.ok(largestSpending);
  assert.notEqual(largestSpending.value, "Transfer");
});

test("summarizeTransactions identifies recurring merchants (>= 3 occurrences)", () => {
  const summary = summarizeTransactions(transactions);
  for (const merchant of summary.recurringMerchants) {
    assert.ok(merchant.count >= 3, `${merchant.merchant} appears ${merchant.count} times`);
  }
  assert.ok(summary.recurringMerchants.length > 0);
});

test("filterTransactions filters by month, category and includeTransfers", () => {
  const marchDining = filterTransactions(transactions, { month: "2025-03", category: "Dining" });
  assert.ok(marchDining.length > 0);
  for (const row of marchDining) {
    assert.equal(row.category, "Dining");
    assert.equal(row.date.startsWith("2025-03"), true);
  }

  const noTransfers = filterTransactions(transactions, { includeTransfers: false });
  assert.equal(noTransfers.some((row) => row.category === "Transfer"), false);
});

test("filterTransactions search is case-insensitive on merchant", () => {
  const result = filterTransactions(transactions, { search: "carrefour" });
  assert.ok(result.length > 0);
  for (const row of result) {
    assert.ok(row.merchant.toLowerCase().includes("carrefour") || row.category.toLowerCase().includes("carrefour"));
  }
});

test("filterTransactions returns empty for unknown month without throwing", () => {
  const result = filterTransactions(transactions, { month: "2099-12" });
  assert.deepEqual(result, []);
});
