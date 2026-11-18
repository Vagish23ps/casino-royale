"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Crown, Lock, Mail, ArrowRight, Eye, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/admin/dashboard";
  const errorParam = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(
    errorParam === "unauthorized"
      ? "Access Denied: Your account does not have administrator privileges."
      : null
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      if (!data.user) {
        setErrorMsg("Failed to retrieve user information.");
        setLoading(false);
        return;
      }

      // Verify that the authenticated user's UUID has an admin_profiles record
      const { data: profile, error: profileError } = await supabase
        .from("admin_profiles")
        .select("id, role, display_name")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        // Disallow ordinary authenticated users without an authorized admin profile
        await supabase.auth.signOut();
        setErrorMsg("Access Denied: No administrator profile associated with this account.");
        setLoading(false);
        return;
      }

      // Confirm the user's role and redirect
      if (profile.role === "owner") {
        router.push("/admin/dashboard");
      } else if (profile.role === "organizer" || profile.role === "scorer") {
        router.push(returnTo || "/admin/dashboard");
      } else {
        await supabase.auth.signOut();
        setErrorMsg("Access Denied: Unauthorized role.");
        setLoading(false);
        return;
      }

      router.refresh();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Authentication failed");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-6 z-10 select-none">
      {/* Brand Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gold/15 border border-gold/40 shadow-[0_0_20px_rgba(212,168,67,0.2)] mb-1">
          <Crown className="w-6 h-6 text-gold" />
        </div>
        <h1 className="text-2xl font-bold tracking-wider text-foreground uppercase font-serif">
          CASINO ROYALE
        </h1>
      </div>

      {/* Login Box */}
      <div className="rounded-2xl border border-gold/30 bg-card/90 backdrop-blur-md p-6 sm:p-8 space-y-5 shadow-2xl">
        <div className="space-y-0.5 text-center">
          <h2 className="text-base font-bold text-foreground font-serif uppercase tracking-wider">
            Admin Login
          </h2>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl border border-casino-red/30 bg-casino-red/10 text-casino-red flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-gold/70" />
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@casinoroyale.com"
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:border-gold transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-gold/70" />
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:border-gold transition-colors"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-gold text-charcoal hover:bg-gold-bright font-bold tracking-wider uppercase text-xs shadow-lg shadow-gold/15 gap-2 mt-2 cursor-pointer"
          >
            {loading ? (
              "Signing In..."
            ) : (
              <>
                Sign In
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </form>

        <div className="pt-3 border-t border-border flex items-center justify-center text-xs text-muted-foreground">
          <Link
            href="/public-view"
            className="hover:text-gold flex items-center gap-1.5 text-xs transition-colors"
          >
            <Eye className="w-3.5 h-3.5 text-gold" />
            Live Scoreboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 geo-pattern relative overflow-hidden select-none">
      {/* Corner suit flourishes */}
      <div className="absolute top-8 left-8 text-gold/10 text-6xl font-serif pointer-events-none select-none">
        ♠
      </div>
      <div className="absolute top-8 right-8 text-casino-red/10 text-6xl font-serif pointer-events-none select-none">
        ♥
      </div>
      <div className="absolute bottom-8 left-8 text-emerald/10 text-6xl font-serif pointer-events-none select-none">
        ♦
      </div>
      <div className="absolute bottom-8 right-8 text-[#00e5ff]/10 text-6xl font-serif pointer-events-none select-none">
        ♣
      </div>

      <Suspense fallback={<div className="text-gold font-serif text-sm">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
