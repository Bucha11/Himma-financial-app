import { NextResponse } from "next/server";
import { summarizeTransactions, transactions } from "@/lib/transactions";

export function GET() {
  return NextResponse.json(summarizeTransactions(transactions));
}
