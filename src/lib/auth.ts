import type { User } from "@supabase/supabase-js";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthState {
  configured: boolean;
  user: User | null;
}

export async function getAuthState(): Promise<AuthState> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      user: null,
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
    };
  }

  return {
    configured: true,
    user,
  };
}
