// Topic classification — derives a category from a story's title/subhead
// by keyword match. No DB column; classified at query time.
//
// Order matters: more specific categories come first. A story only ever
// gets one topic (first match wins).

export type TopicSlug =
  | "public-safety"
  | "schools"
  | "government"
  | "arts"
  | "business"
  | "community";

export interface Topic {
  slug: TopicSlug;
  name: string;
  description: string;
  patterns: RegExp[];
}

export const TOPICS: Topic[] = [
  {
    slug: "public-safety",
    name: "Public Safety",
    description:
      "Police, sheriff, fire department, and emergency services coverage.",
    patterns: [
      /\b(police|sheriff|deputy|deputies|arrest|suspect|crime|investigation)\b/i,
      /\b(fire department|firefighter|wildfire|ems|paramedic|rescue)\b/i,
      /\b(traffic|crash|collision)\b/i,
    ],
  },
  {
    slug: "schools",
    name: "Schools",
    description:
      "Cherokee County School District news, students, and classrooms.",
    patterns: [
      /\b(ccsd|school district|elementary|middle school|high school|classroom|teacher|student|chorus|graduation)\b/i,
      /\bcherokee county schools?\b/i,
    ],
  },
  {
    slug: "government",
    name: "Government",
    description:
      "City of Woodstock, Cherokee County government, and local policy.",
    patterns: [
      /\b(city council|mayor|ordinance|zoning|city of woodstock|county commission|budget|permit|tax|millage)\b/i,
    ],
  },
  {
    slug: "arts",
    name: "Arts & Culture",
    description:
      "Concerts, festivals, galleries, performances, and cultural events.",
    patterns: [
      /\b(concert|festival|performance|exhibit|gallery|theater|theatre|symphony)\b/i,
      /\b(woodstock arts|abbey road|tribute show)\b/i,
      /\bart show\b/i,
    ],
  },
  {
    slug: "business",
    name: "Business",
    description:
      "Local businesses, economic development, and the Chamber of Commerce.",
    patterns: [
      /\b(chamber of commerce|grand opening|ribbon cutting|small business|opens? in|downtown woodstock)\b/i,
    ],
  },
  {
    slug: "community",
    name: "Community",
    description: "Community events, nonprofits, and neighborhood news.",
    // Catch-all fallback — matched last via findTopic()
    patterns: [/.*/],
  },
];

export function findTopic(text: string): Topic {
  const haystack = text.toLowerCase();
  for (const topic of TOPICS) {
    if (topic.slug === "community") continue; // fallback
    if (topic.patterns.some((p) => p.test(haystack))) return topic;
  }
  return TOPICS[TOPICS.length - 1]; // community
}

export function getTopicBySlug(slug: string): Topic | null {
  return TOPICS.find((t) => t.slug === slug) ?? null;
}

export function getAllTopicSlugs(): TopicSlug[] {
  return TOPICS.map((t) => t.slug);
}
