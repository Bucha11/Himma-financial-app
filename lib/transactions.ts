import rawTransactions from "@/data/transactions.json";
import { formatMonth, roundCurrency } from "@/lib/format";
import type {
  Category,
  CategorySummary,
  MerchantSummary,
  MonthSummary,
  RecurringMerchant,
  SpendingInsight,
  SpendingSummary,
  Transaction,
  TransactionFilters
} from "@/lib/types";

export const categories: Category[] = [
  "Groceries",
  "Dining",
  "Transport",
  "Utilities",
  "Entertainment",
  "Shopping",
  "Health",
  "Subscriptions",
  "Travel",
  "Transfer"
];

export const transactions = [...(rawTransactions as Transaction[])].sort((a, b) =>
  b.date.localeCompare(a.date)
);

export function filterTransactions(
  rows: Transaction[],
  filters: TransactionFilters
) {
  const search = filters.search?.trim().toLowerCase();

  return rows.filter((transaction) => {
    if (filters.month && !transaction.date.startsWith(filters.month)) {
      return false;
    }

    if (filters.category && filters.category !== "All") {
      if (transaction.category !== filters.category) {
        return false;
      }
    }

    if (filters.includeTransfers === false && transaction.category === "Transfer") {
      return false;
    }

    if (search) {
      const searchable = `${transaction.merchant} ${transaction.category} ${transaction.date}`.toLowerCase();
      if (!searchable.includes(search)) {
        return false;
      }
    }

    return true;
  });
}

export function summarizeTransactions(rows: Transaction[]): SpendingSummary {
  const sortedByDate = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const totalSpend = sum(rows);
  const nonTransferRows = rows.filter((row) => row.category !== "Transfer");
  const totalSpendExcludingTransfers = sum(nonTransferRows);
  const categoriesSummary = summarizeCategories(rows, totalSpend);
  const months = summarizeMonths(rows);
  const topMerchants = summarizeMerchants(rows).slice(0, 8);
  const largestTransactions = [...rows]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  const recurringMerchants = findRecurringMerchants(rows);

  return {
    currency: "AED",
    totalSpend,
    totalSpendExcludingTransfers,
    transactionCount: rows.length,
    dateRange: {
      start: sortedByDate[0]?.date ?? "",
      end: sortedByDate.at(-1)?.date ?? ""
    },
    categories: categoriesSummary,
    months,
    topMerchants,
    largestTransactions,
    recurringMerchants,
    insights: buildInsights({
      categories: categoriesSummary,
      months,
      totalSpend,
      totalSpendExcludingTransfers,
      largestTransactions,
      recurringMerchants
    })
  };
}

function summarizeCategories(rows: Transaction[], totalSpend: number): CategorySummary[] {
  const byCategory = new Map<Category, { amount: number; count: number }>();

  for (const row of rows) {
    const current = byCategory.get(row.category) ?? { amount: 0, count: 0 };
    current.amount += row.amount;
    current.count += 1;
    byCategory.set(row.category, current);
  }

  return Array.from(byCategory.entries())
    .map(([category, value]) => ({
      category,
      amount: roundCurrency(value.amount),
      count: value.count,
      share: totalSpend > 0 ? roundCurrency((value.amount / totalSpend) * 100) : 0
    }))
    .sort((a, b) => b.amount - a.amount);
}

function summarizeMonths(rows: Transaction[]): MonthSummary[] {
  const byMonth = new Map<string, { amount: number; count: number }>();

  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const current = byMonth.get(month) ?? { amount: 0, count: 0 };
    current.amount += row.amount;
    current.count += 1;
    byMonth.set(month, current);
  }

  return Array.from(byMonth.entries())
    .map(([month, value]) => ({
      month,
      amount: roundCurrency(value.amount),
      count: value.count
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function summarizeMerchants(rows: Transaction[]): MerchantSummary[] {
  const byMerchant = new Map<string, MerchantSummary>();

  for (const row of rows) {
    const current =
      byMerchant.get(row.merchant) ??
      ({
        merchant: row.merchant,
        amount: 0,
        count: 0,
        category: row.category
      } satisfies MerchantSummary);
    current.amount += row.amount;
    current.count += 1;
    byMerchant.set(row.merchant, current);
  }

  return Array.from(byMerchant.values())
    .map((merchant) => ({
      ...merchant,
      amount: roundCurrency(merchant.amount)
    }))
    .sort((a, b) => b.amount - a.amount);
}

function findRecurringMerchants(rows: Transaction[]): RecurringMerchant[] {
  const byMerchant = new Map<string, Transaction[]>();

  for (const row of rows) {
    const current = byMerchant.get(row.merchant) ?? [];
    current.push(row);
    byMerchant.set(row.merchant, current);
  }

  return Array.from(byMerchant.entries())
    .filter(([, merchantRows]) => merchantRows.length >= 3)
    .map(([merchant, merchantRows]) => {
      const totalAmount = sum(merchantRows);
      return {
        merchant,
        category: merchantRows[0].category,
        count: merchantRows.length,
        averageAmount: roundCurrency(totalAmount / merchantRows.length),
        totalAmount,
        dates: merchantRows.map((row) => row.date).sort()
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .map((merchant) => ({
      ...merchant,
      totalAmount: roundCurrency(merchant.totalAmount)
    }));
}

function buildInsights(input: {
  categories: CategorySummary[];
  months: MonthSummary[];
  totalSpend: number;
  totalSpendExcludingTransfers: number;
  largestTransactions: Transaction[];
  recurringMerchants: RecurringMerchant[];
}): SpendingInsight[] {
  const [topCategory] = input.categories;
  const topNonTransfer = input.categories.find(
    (category) => category.category !== "Transfer"
  );
  const highestMonth = [...input.months].sort((a, b) => b.amount - a.amount)[0];
  const largest = input.largestTransactions[0];
  const transferShare =
    input.totalSpend > 0
      ? ((input.totalSpend - input.totalSpendExcludingTransfers) / input.totalSpend) * 100
      : 0;

  const insights: SpendingInsight[] = [];

  if (topCategory) {
    insights.push({
      title: "Top outflow category",
      value: topCategory.category,
      detail: `${topCategory.category} accounts for ${topCategory.share.toFixed(1)}% of all outflows.`,
      tone: topCategory.category === "Transfer" ? "good" : "neutral"
    });
  }

  if (topNonTransfer) {
    insights.push({
      title: "Largest spending category",
      value: topNonTransfer.category,
      detail: `${topNonTransfer.category} leads non-transfer spend with ${topNonTransfer.count} transactions.`,
      tone: "warning"
    });
  }

  if (highestMonth) {
    insights.push({
      title: "Highest month",
      value: formatMonth(highestMonth.month),
      detail: `${highestMonth.count} transactions made this the most expensive month in the dataset.`,
      tone: "neutral"
    });
  }

  if (largest) {
    insights.push({
      title: "Largest transaction",
      value: largest.merchant,
      detail: `${largest.amount.toFixed(2)} AED on ${largest.date}.`,
      tone: largest.category === "Transfer" ? "good" : "warning"
    });
  }

  if (transferShare > 25) {
    insights.push({
      title: "Savings transfers",
      value: `${transferShare.toFixed(1)}%`,
      detail: "A large share of outflow is transfer activity, so daily spend is clearer when transfers are excluded.",
      tone: "good"
    });
  }

  if (input.recurringMerchants.length > 0) {
    insights.push({
      title: "Recurring merchants",
      value: String(input.recurringMerchants.length),
      detail: "Several merchants appear repeatedly and are good candidates for subscription or bill tracking.",
      tone: "neutral"
    });
  }

  return insights.slice(0, 6);
}

function sum(rows: Transaction[]) {
  return roundCurrency(rows.reduce((total, row) => total + row.amount, 0));
}
