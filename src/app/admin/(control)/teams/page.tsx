import { getTeamsManagementData } from "@/lib/data";
import { TeamsManager } from "@/components/admin/teams-manager";

export default async function TeamsPage() {
  const { activeTeams, deletedTeams, teamScores, error } = await getTeamsManagementData();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-gold font-serif text-lg">♠</span>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-serif uppercase">
            VIP Team & Syndicate Management
          </h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Enroll participating tournament teams, configure liveries, track round performance, and manage soft deletions.
        </p>
      </div>

      <TeamsManager
        initialActiveTeams={activeTeams}
        initialDeletedTeams={deletedTeams}
        initialScores={teamScores}
        dbError={error}
      />
    </div>
  );
}
