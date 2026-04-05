import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";
import { getAllTopicSlugs } from "@/lib/topics";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: stories } = await supabase
    .from("stories")
    .select("slug, published_at")
    .eq("status", "published")
    .eq("environment", "production")
    .not("slug", "is", null)
    .order("published_at", { ascending: false });

  const storyEntries: MetadataRoute.Sitemap = (stories || []).map((story) => ({
    url: `https://woodstockcommunity.news/${story.slug}`,
    lastModified: new Date(story.published_at),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const topicEntries: MetadataRoute.Sitemap = getAllTopicSlugs().map(
    (slug) => ({
      url: `https://woodstockcommunity.news/topic/${slug}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    })
  );

  return [
    {
      url: "https://woodstockcommunity.news",
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: "https://woodstockcommunity.news/about",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    ...topicEntries,
    ...storyEntries,
  ];
}
