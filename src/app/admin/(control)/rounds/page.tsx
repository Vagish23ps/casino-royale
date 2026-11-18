import { getRoundsManagementData } from "@/lib/data";
import { RoundsManager } from "@/components/admin/rounds-manager";

export default async function RoundsPage() {
  const { activeRounds, deletedRounds, roundStats, error } = await getRoundsManagementData();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-gold font-serif text-lg">♦</span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-serif uppercase">
            Tournament Round Sequencing
          </h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Create, sequence, activate, and mark rounds as completed. Strictly enforces single active round rules.
        </p>
      </div>

      <RoundsManager
        initialActiveRounds={activeRounds}
        initialDeletedRounds={deletedRounds}
        initialStats={roundStats}
        dbError={error}
      />
    </div>
  );
}
