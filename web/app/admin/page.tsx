"use client";

import { AppShell } from "@/components/AppShell";
import { AdminPanel } from "@/components/AdminPanel";
import { useMe } from "@/lib/hooks";

export default function AdminPage() {
  const me = useMe();
  const canAdmin = me.data?.permissions.includes("admin.users") ?? false;

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Administration</h1>
        <p className="text-sm text-slate-500">
          Define access profiles (what each type of user can see) and assign a profile to each user
          by email. Owners see less; accountants and administrative staff see more.
        </p>
      </div>
      {me.isLoading ? null : canAdmin ? (
        <AdminPanel />
      ) : (
        <p className="text-sm text-amber-600">You need the «admin.users» permission.</p>
      )}
    </AppShell>
  );
}
