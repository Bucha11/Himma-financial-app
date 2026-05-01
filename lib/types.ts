export type Category =
  | "Groceries"
  | "Dining"
  | "Transport"
  | "Utilities"
  | "Entertainment"
  | "Shopping"
  | "Health"
  | "Subscriptions"
  | "Travel"
  | "Transfer";

export type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  currency: "AED";
  category: Category;
  account: "checking";
};

export type TransactionFilters = {
  month?: string;
  category?: Category | "All";
  search?: string;
  includeTransfers?: boolean;
};

export type CategorySummary = {
  category: Category;
  amount: number;
  count: number;
  share: number;
};

export type MonthSummary = {
  month: string;
  amount: number;
  count: number;
};

export type MerchantSummary = {
  merchant: string;
  amount: number;
  count: number;
  category: Category;
};

export type RecurringMerchant = {
  merchant: string;
  category: Category;
  count: number;
  averageAmount: number;
  totalAmount: number;
  dates: string[];
};

export type SpendingInsight = {
  title: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "warning";
};

export type SpendingSummary = {
  currency: "AED";
  totalSpend: number;
  totalSpendExcludingTransfers: number;
  transactionCount: number;
  dateRange: {
    start: string;
    end: string;
  };
  categories: CategorySummary[];
  months: MonthSummary[];
  topMerchants: MerchantSummary[];
  largestTransactions: Transaction[];
  recurringMerchants: RecurringMerchant[];
  insights: SpendingInsight[];
};
