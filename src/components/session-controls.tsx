"use client";

import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

interface SessionControlsProps {
  email: string;
}

export function SessionControls({ email }: SessionControlsProps) {
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
      <button type="button" className="secondary-button" onClick={signOut} disabled={isPending}>
        {isPending ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
