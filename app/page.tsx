import FinanceApp from "@/components/finance-app";
import { summarizeTransactions, transactions } from "@/lib/transactions";

export default function Home() {
  return <FinanceApp initialSummary={summarizeTransactions(transactions)} initialTransactions={transactions} />;
}
