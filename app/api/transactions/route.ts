import { NextRequest, NextResponse } from "next/server";
import { categories, filterTransactions, transactions } from "@/lib/transactions";
import type { Category, TransactionFilters } from "@/lib/types";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const categoryParam = params.get("category");
  const includeTransfers = params.get("includeTransfers");

  const filters: TransactionFilters = {
    month: params.get("month") || undefined,
    category:
      categoryParam && isCategory(categoryParam) ? categoryParam : categoryParam === "All" ? "All" : undefined,
    search: params.get("search") || undefined,
    includeTransfers: includeTransfers === null ? undefined : includeTransfers === "true"
  };

  return NextResponse.json({
    transactions: filterTransactions(transactions, filters),
    categories
  });
}

function isCategory(value: string): value is Category {
  return categories.includes(value as Category);
}
