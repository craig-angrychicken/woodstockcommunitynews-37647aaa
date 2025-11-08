import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { 
  FileText, 
  Search, 
  Database, 
  MessageSquare, 
  Box,
  Clock,
  HardDrive,
  TrendingUp,
  Calendar
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const Dashboard = () => {
  // Fetch stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [storiesRes, artifactsRes, sourcesRes] = await Promise.all([
        supabase.from('stories').select('*', { count: 'exact', head: false }),
        supabase.from('artifacts').select('size_mb', { count: 'exact', head: false }),
        supabase.from('sources').select('*', { count: 'exact', head: false })
      ]);

      const pendingStories = storiesRes.data?.filter(s => s.status === 'pending').length || 0;
      
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const publishedThisWeek = storiesRes.data?.filter(
        s => s.status === 'published' && new Date(s.published_at) >= oneWeekAgo
      ).length || 0;

      const totalStorageMB = artifactsRes.data?.reduce((sum, a) => sum + Number(a.size_mb), 0) || 0;

      return {
        pendingStories,
        publishedThisWeek,
        totalStorageMB: totalStorageMB.toFixed(2),
        totalSources: sourcesRes.count || 0,
        totalArtifacts: artifactsRes.count || 0
      };
    }
  });

  // Fetch recent activity
  const { data: recentActivity, isLoading: activityLoading } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: async () => {
      const [lastPublished, recentSources] = await Promise.all([
        supabase
          .from('stories')
          .select('title, published_at')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('sources')
          .select('name, created_at, last_fetch_at, items_fetched')
          .order('created_at', { ascending: false })
          .limit(3)
      ]);

      return {
        lastPublished: lastPublished.data,
        recentSources: recentSources.data || []
      };
    }
  });

  const nextAutoRun = new Date();
  nextAutoRun.setDate(nextAutoRun.getDate() + 1);
  nextAutoRun.setHours(6, 0, 0, 0);

  const quickActions = [
    {
      title: "Review Pending Stories",
      description: "Check and publish pending content",
      icon: FileText,
      link: "/stories",
      color: "text-blue-600"
    },
    {
      title: "Run Manual Query",
      description: "Execute custom database queries",
      icon: Search,
      link: "/manual-query",
      color: "text-purple-600"
    },
    {
      title: "Manage Sources",
      description: "Add or configure content sources",
      icon: Database,
      link: "/sources",
      color: "text-green-600"
    },
    {
      title: "Edit Prompts",
      description: "Customize AI generation prompts",
      icon: MessageSquare,
      link: "/prompts",
      color: "text-orange-600"
    },
    {
      title: "View Artifacts",
      description: "Browse generated artifacts",
      icon: Box,
      link: "/artifacts",
      color: "text-pink-600"
    }
  ];

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to Woodstock Wire Admin</p>
      </div>

      {/* Stats Overview */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Stats Overview</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Stories</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{stats?.pendingStories}</div>
                  <p className="text-xs text-muted-foreground">Awaiting review</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Published This Week</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{stats?.publishedThisWeek}</div>
                  <p className="text-xs text-muted-foreground">Last 7 days</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Next Auto-Run</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {nextAutoRun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <p className="text-xs text-muted-foreground">
                {nextAutoRun.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{stats?.totalStorageMB} MB</div>
                  <p className="text-xs text-muted-foreground">of 1000 MB</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.title} to={action.link}>
                <Card className="hover:border-primary transition-all hover:shadow-md cursor-pointer h-full">
                  <CardHeader>
                    <Icon className={`h-8 w-8 mb-2 ${action.color}`} />
                    <CardTitle className="text-base">{action.title}</CardTitle>
                    <CardDescription className="text-sm">
                      {action.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Recent Activity */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
        <Card>
          <CardContent className="pt-6">
            {activityLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ) : (
              <div className="space-y-4">
                {recentActivity?.lastPublished ? (
                  <div className="flex items-start gap-3 pb-3 border-b">
                    <Calendar className="h-5 w-5 text-primary mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Last Published Story</p>
                      <p className="text-sm text-muted-foreground">
                        {recentActivity.lastPublished.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(recentActivity.lastPublished.published_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 pb-3 border-b">
                    <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">No stories published yet</p>
                    </div>
                  </div>
                )}

                {recentActivity?.recentSources && recentActivity.recentSources.length > 0 ? (
                  recentActivity.recentSources.map((source, idx) => (
                    <div key={idx} className="flex items-start gap-3 pb-3 last:pb-0 last:border-0 border-b">
                      <Database className="h-5 w-5 text-primary mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Source: {source.name}</p>
                        {source.last_fetch_at ? (
                          <>
                            <p className="text-sm text-muted-foreground">
                              Last fetch: {source.items_fetched} items
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(source.last_fetch_at).toLocaleString()}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1">
                            Added {new Date(source.created_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex items-start gap-3">
                    <Database className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">No sources added yet</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
};

export default Dashboard;
