"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "cn";
import {
  Menu,
  LogOut,
  Crown,
  LayoutDashboard,
  Users,
  CircleDot,
  Crosshair,
  History,
  X,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";

const mobileNavItems = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/teams", label: "Teams", icon: Users },
  { href: "/admin/rounds", label: "Rounds", icon: CircleDot },
  { href: "/admin/score-control", label: "Score Control", icon: Crosshair },
  { href: "/admin/history", label: "History", icon: History },
];

function getPageTitle(pathname: string | null): string {
  if (!pathname) return "Dashboard";
  const segment = pathname.split("/").pop();
  const titles: Record<string, string> = {
    dashboard: "Dashboard",
    teams: "Teams",
    rounds: "Rounds",
    "score-control": "Score Control",
    history: "History",
  };
  return titles[segment ?? ""] ?? "Dashboard";
}

export function AdminHeader({
  userEmail,
}: {
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const pageTitle = getPageTitle(pathname);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const initials = userEmail
    ? userEmail.substring(0, 2).toUpperCase()
    : "AD";

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* Left: Mobile menu + Page title */}
      <div className="flex items-center gap-3">
        {/* Mobile nav trigger */}
        <Sheet>
          <SheetTrigger
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "lg:hidden text-muted-foreground cursor-pointer"
            )}
          >
            <Menu className="w-5 h-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-[260px] p-0 bg-sidebar border-r border-border">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            {/* Mobile brand */}
            <div className="flex items-center justify-between px-4 h-16 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gold/10">
                  <Crown className="w-5 h-5 text-gold" />
                </div>
                <div>
                  <h1 className="text-sm font-bold tracking-wider text-foreground font-serif uppercase">
                    CASINO ROYALE
                  </h1>
                </div>
              </div>
              <SheetClose
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-sm" }),
                  "text-muted-foreground cursor-pointer"
                )}
              >
                <X className="w-4 h-4" />
              </SheetClose>
            </div>

            {/* Mobile nav links */}
            <nav className="py-4 px-3 space-y-1">
              {mobileNavItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin/dashboard" &&
                    pathname?.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <SheetClose
                    key={item.href}
                    render={
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative",
                          isActive
                            ? "bg-gold/10 text-gold"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gold" />
                        )}
                        <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-gold" : "")} />
                        <span>{item.label}</span>
                      </Link>
                    }
                  />
                );
              })}

              <div className="pt-4 border-t border-border mt-4">
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-casino-red hover:bg-casino-red/10 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Logout</span>
                </button>
              </div>
            </nav>
          </SheetContent>
        </Sheet>

        {/* Page title */}
        <div>
          <h2 className="text-lg font-semibold text-foreground tracking-tight font-serif uppercase">
            {pageTitle}
          </h2>
        </div>
      </div>

      {/* Right: User / Logout */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "gap-2 px-2 text-muted-foreground hover:text-foreground cursor-pointer"
            )}
          >
            <Avatar className="w-7 h-7">
              <AvatarFallback className="bg-gold/10 text-gold text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden sm:inline text-sm font-medium truncate max-w-[140px]">
              {userEmail ?? "Admin"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="gap-2 text-casino-red cursor-pointer"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
