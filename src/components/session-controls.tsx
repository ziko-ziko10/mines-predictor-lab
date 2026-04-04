"use client";

import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

interface SessionControlsProps {
  email: string;
  isAdmin?: boolean;
}

export function SessionControls({ email, isAdmin = false }: SessionControlsProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isPending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await supabase.auth.signOut();
      router.refresh();
    });
  }

  return (
    <div className="session-controls">
      <span className="user-pill">Signed in as {email}</span>
      {isAdmin ? <span className="status-pill admin-pill">Admin</span> : null}
      <button type="button" className="secondary-button" onClick={signOut} disabled={isPending}>
        {isPending ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
