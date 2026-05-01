import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const transactions = JSON.parse(readFileSync(new URL("../data/transactions.json", import.meta.url), "utf8"));

function sum(rows) {
  return Math.round(rows.reduce((total, row) => total + row.amount, 0) * 100) / 100;
}

test("sample data has the expected shape and date range", () => {
  assert.equal(transactions.length, 100);
  assert.equal(transactions[0].date, "2025-01-03");
  assert.equal(transactions.at(-1).date, "2025-03-31");
  assert.deepEqual([...new Set(transactions.map((row) => row.currency))], ["AED"]);
});

test("category totals match the supplied dataset", () => {
  const byCategory = new Map();

  for (const transaction of transactions) {
    byCategory.set(
      transaction.category,
      Math.round(((byCategory.get(transaction.category) ?? 0) + transaction.amount) * 100) / 100
    );
  }

  assert.equal(byCategory.get("Transfer"), 9000);
  assert.equal(byCategory.get("Shopping"), 4486);
  assert.equal(byCategory.get("Dining"), 3104.5);
  assert.equal(byCategory.get("Subscriptions"), 362.9);
});

test("monthly totals capture the March spending spike", () => {
  const byMonth = new Map();

  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7);
    byMonth.set(month, Math.round(((byMonth.get(month) ?? 0) + transaction.amount) * 100) / 100);
  }

  assert.equal(byMonth.get("2025-01"), 7734.97);
  assert.equal(byMonth.get("2025-02"), 10410.17);
  assert.equal(byMonth.get("2025-03"), 11577.06);
  assert.equal(Math.max(...byMonth.values()), byMonth.get("2025-03"));
});

test("non-transfer spend excludes savings movements", () => {
  const total = sum(transactions);
  const withoutTransfers = sum(transactions.filter((row) => row.category !== "Transfer"));

  assert.equal(total, 29722.2);
  assert.equal(withoutTransfers, 20722.2);
});
