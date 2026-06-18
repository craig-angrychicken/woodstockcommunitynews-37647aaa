import { useEffect, useState } from "react";
import { getAccessIdentity, accessLogout, type AccessIdentity } from "@/lib/api";

// Cloudflare Access gates the entire admin SPA, so any request that reaches the
// app is already authenticated. This hook surfaces the Access identity (email /
// name / groups) in place of the old Supabase session, exposing the same shape
// the rest of the SPA reads: { user, loading, isAdmin, signOut }.

export interface AuthUser {
  email: string;
  name?: string;
  groups?: string[];
}

const toUser = (identity: AccessIdentity | null): AuthUser | null => {
  if (!identity) return null;
  // Access always provides an email for authenticated identities; fall back to
  // name if a provider omits it.
  const email = identity.email ?? identity.name;
  if (!email) return null;
  return { email, name: identity.name, groups: identity.groups };
};

// Single-operator admin tool: any valid Access identity is treated as admin.
// If Access groups are present, this still resolves to true (membership is
// already enforced by the Access policy upstream).
const resolveIsAdmin = (user: AuthUser | null): boolean => !!user;

export const useAuth = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getAccessIdentity()
      .then((identity) => {
        if (cancelled) return;
        const u = toUser(identity);
        setUser(u);
        setIsAdmin(resolveIsAdmin(u));
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setIsAdmin(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = () => {
    accessLogout();
  };

  return {
    user,
    loading,
    isAdmin,
    signOut,
  };
};
