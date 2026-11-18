import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import { TooltipProvider } from "@/components/ui/tooltip";

export default async function AdminControlLayout({
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
    redirect("/login?returnTo=/admin/dashboard");
  }

  // Verify that the user has an authorized admin profile
  const { data: profile, error: profileError } = await supabase
    .from("admin_profiles")
    .select("id, role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.role) {
    redirect("/login?error=unauthorized");
  }

  const userDisplayName = profile.display_name || user.email || "Admin";

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden font-sans">
        {/* Desktop Sidebar */}
        <AdminSidebar />

        {/* Main Content Area */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <AdminHeader userEmail={userDisplayName} />

          <main className="flex-1 overflow-y-auto admin-scroll p-4 md:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto w-full">{children}</div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
