import { cn } from "cn";
import type { LucideIcon } from "lucide-react";

type StatCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: string;
  trend?: {
    value: string;
    positive: boolean;
  };
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-gold",
  trend,
}: StatCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5 art-deco-corner">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            {title}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {value}
            </span>
            {trend && (
              <span
                className={cn(
                  "text-xs font-medium",
                  trend.positive ? "text-emerald" : "text-casino-red"
                )}
              >
                {trend.value}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted/60">
          <Icon className={cn("w-5 h-5", iconColor)} />
        </div>
      </div>
    </div>
  );
}
