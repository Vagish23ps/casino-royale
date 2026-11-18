import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  // Verify that the authenticated user's UUID has an authorized admin_profiles record
  const { data: profile, error: profileError } = await supabase
    .from("admin_profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.role) {
    // Ordinary authenticated users without an authorized admin profile are blocked
    redirect("/login?error=unauthorized");
  }

  return <>{children}</>;
}
