import { Bodoni_Moda } from "next/font/google";
import { getPublicScoreboardData } from "@/lib/data";
import { LiveScoreboard } from "@/components/scoreboard/live-scoreboard";

const bodoniModa = Bodoni_Moda({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export default async function PublicViewPage() {
  const { event, settings, activeRound, leaderboard } = await getPublicScoreboardData();

  return (
    <LiveScoreboard
      initialEvent={event}
      initialSettings={settings}
      initialRound={activeRound}
      initialLeaderboard={leaderboard}
      isPublicView={true}
      headingFontClassName={bodoniModa.className}
    />
  );
}
