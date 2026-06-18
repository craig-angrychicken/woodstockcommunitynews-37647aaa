import { useEffect, useState } from "react";
import { getAccessIdentity, type AccessIdentity } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export const ProtectedRoute = ({ children, requireAdmin = false }: ProtectedRouteProps) => {
  // Cloudflare Access gates the entire SPA, so an anonymous user never reaches
  // this component. We only need to confirm an Access identity is present and,
  // for admin-only routes, that the identity qualifies as admin.
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<AccessIdentity | null>(null);

  useEffect(() => {
    let active = true;
    getAccessIdentity()
      .then((id) => {
        if (active) setIdentity(id);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Treat any valid Access identity as admin for this single-operator tool,
  // unless Access groups are present to scope it further.
  const isAdmin = !!identity && (!identity.groups?.length || identity.groups.includes("admin"));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-8 w-48" />
        </div>
      </div>
    );
  }

  if (requireAdmin && !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-2">Access Denied</h1>
          <p className="text-muted-foreground">You need admin privileges to access this page.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
