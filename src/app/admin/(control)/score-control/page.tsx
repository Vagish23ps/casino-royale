import { getScoreControlData } from "@/lib/data";
import { ScoreControlManager } from "@/components/admin/score-control-manager";

export default async function ScoreControlPage() {
  const { rounds, teams, teamScores, allowNegativeScores, error } = await getScoreControlData();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-gold font-serif text-lg">♣</span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-serif uppercase">
            Tournament Score Control Center
          </h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Perform atomic scoring updates across all registered syndicates with full arithmetic verification and ledger persistence.
        </p>
      </div>

      <ScoreControlManager
        initialRounds={rounds}
        initialTeams={teams}
        initialScores={teamScores}
        allowNegativeScores={allowNegativeScores}
        dbError={error}
      />
    </div>
  );
}
