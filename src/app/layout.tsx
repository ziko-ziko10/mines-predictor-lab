import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { SessionControls } from "@/components/session-controls";
import { getAuthState } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Mines Predictor Lab",
  description: "Track predictions, log win/loss outcomes, and analyze cell risk per mine count on a 5x5 board.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const auth = await getAuthState();

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand-mark">
              <span className="brand-name">Mines Predictor Lab</span>
              <small>Private prediction workspace</small>
            </Link>
            <nav className="topnav">
              <Link href="/">Predict</Link>
              <Link href="/logs">Logs</Link>
              <Link href="/analytics">Analytics</Link>
            </nav>
            <div className="topbar-right">
              {!auth.configured ? <span className="status-pill">Add Supabase auth envs</span> : null}
              {auth.configured && auth.user?.email ? <SessionControls email={auth.user.email} /> : null}
              {auth.configured && !auth.user ? <span className="status-pill">Password sign-in required</span> : null}
            </div>
          </header>

          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
