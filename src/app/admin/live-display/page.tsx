import { getPublicScoreboardData } from "@/lib/data";
import { LiveScoreboard } from "@/components/scoreboard/live-scoreboard";

export default async function LiveDisplayPage() {
  const { event, settings, activeRound, leaderboard } = await getPublicScoreboardData();

  return (
    <LiveScoreboard
      initialEvent={event}
      initialSettings={settings}
      initialRound={activeRound}
      initialLeaderboard={leaderboard}
    />
  );
}
