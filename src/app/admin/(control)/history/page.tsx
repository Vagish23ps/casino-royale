import { getHistoryData } from "@/lib/data";
import { HistoryManager } from "@/components/admin/history-manager";

export default async function HistoryPage() {
  const { transactions, teams, rounds, error } = await getHistoryData();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-casino-red font-serif text-lg">♥</span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-serif uppercase">
            Immutable Score Ledger & Audit Trail
          </h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Complete chronological record of all arithmetic score mutations, authorization IDs, and transaction reversals.
        </p>
      </div>

      <HistoryManager
        initialTransactions={transactions}
        teams={teams}
        rounds={rounds}
        dbError={error}
      />
    </div>
  );
}
