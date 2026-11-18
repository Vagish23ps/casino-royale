"use client";

import { cn } from "cn";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

type ConnectionStatusProps = {
  status: "connected" | "disconnected" | "connecting";
  className?: string;
};

export function ConnectionStatus({ status, className }: ConnectionStatusProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
        status === "connected" && "bg-emerald/10 text-emerald",
        status === "disconnected" && "bg-casino-red/10 text-casino-red",
        status === "connecting" && "bg-gold/10 text-gold",
        className
      )}
    >
      {status === "connected" && <Wifi className="w-3 h-3" />}
      {status === "disconnected" && <WifiOff className="w-3 h-3" />}
      {status === "connecting" && (
        <Loader2 className="w-3 h-3 animate-spin" />
      )}
      <span className="capitalize">{status}</span>
    </div>
  );
}
