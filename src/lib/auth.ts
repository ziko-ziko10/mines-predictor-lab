import type { User } from "@supabase/supabase-js";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthState {
  configured: boolean;
  user: User | null;
  isAdmin: boolean;
}

const BUILT_IN_ADMIN_EMAILS = ["zikoozelzoz@gmail.com"];

function getAdminEmails() {
  const envEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([...BUILT_IN_ADMIN_EMAILS, ...envEmails]));
}

export function isAdminEmail(email: string | null | undefined) {
  if (!email) {
    return false;
  }

  return getAdminEmails().includes(email.trim().toLowerCase());
}

export async function getAuthState(): Promise<AuthState> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      user: null,
      isAdmin: false,
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return {
      configured: true,
      user: null,
      isAdmin: false,
    };
  }

  return {
    configured: true,
    user,
    isAdmin: isAdminEmail(user?.email),
  };
}
