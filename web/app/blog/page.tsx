"use client";

import { AppShell } from "@/components/AppShell";
import { BlogView } from "@/components/BlogView";

export default function BlogPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Blog</h1>
        <p className="text-sm text-slate-500">
          Project log. Every finding that matters, numbered and dated. Entries cannot be edited or
          deleted — a correction is a new entry that cites the one it replaces.
        </p>
      </div>
      <BlogView />
    </AppShell>
  );
}
