import type { Metadata } from "next";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import MeetingCard from "@/components/MeetingCard";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "City Council Coverage",
  description:
    "Woodstock Community News coverage of City Council and Planning Commission meetings — previews, updates, and recaps.",
  alternates: { canonical: "/council" },
};

interface StoryRef {
  id: string;
  title: string;
  slug: string;
  published_at: string;
}

interface CouncilMeeting {
  id: string;
  meeting_type: string;
  meeting_date: string;
  agenda_url: string | null;
  packet_url: string | null;
  minutes_url: string | null;
  preview_story: StoryRef | null;
  update_story: StoryRef | null;
  recap_story: StoryRef | null;
}

async function getCouncilMeetings(): Promise<CouncilMeeting[]> {
  const { data } = await supabase
    .from("council_meetings")
    .select(
      `id, meeting_type, meeting_date,
       agenda_url, packet_url, minutes_url,
       preview_story:stories!council_meetings_preview_story_id_fkey(id, title, slug, published_at),
       update_story:stories!council_meetings_update_story_id_fkey(id, title, slug, published_at),
       recap_story:stories!council_meetings_recap_story_id_fkey(id, title, slug, published_at)`
    )
    .order("meeting_date", { ascending: false })
    .limit(30);

  return (data as unknown as CouncilMeeting[]) || [];
}

export default async function CouncilPage() {
  const meetings = await getCouncilMeetings();

  // Split into upcoming vs. past
  const now = new Date();
  const upcoming = meetings.filter((m) => new Date(m.meeting_date) >= now);
  const past = meetings.filter((m) => new Date(m.meeting_date) < now);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 pb-6 border-b-2 border-[var(--color-accent)]">
        <p className="category-label mb-2">Special Section</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-ink leading-[1.1] tracking-tight">
          City Council Coverage
        </h1>
        <p className="mt-3 font-serif italic text-lg text-gray-600 leading-snug">
          Meeting previews, agenda updates, and recaps for the City of Woodstock
          and Planning Commission.
        </p>
      </header>

      {meetings.length === 0 ? (
        <p className="font-serif text-gray-600">
          No meetings tracked yet.{" "}
          <Link href="/" className="underline hover:text-[var(--color-accent)]">
            Back to home
          </Link>
        </p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="mb-10">
              <h2 className="category-label mb-4">Upcoming Meetings</h2>
              {upcoming.map((m) => (
                <MeetingCard
                  key={m.id}
                  meetingType={m.meeting_type}
                  meetingDate={m.meeting_date}
                  agendaUrl={m.agenda_url}
                  packetUrl={m.packet_url}
                  minutesUrl={m.minutes_url}
                  previewStory={m.preview_story}
                  updateStory={m.update_story}
                  recapStory={m.recap_story}
                />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="category-label mb-4">Past Meetings</h2>
              {past.map((m) => (
                <MeetingCard
                  key={m.id}
                  meetingType={m.meeting_type}
                  meetingDate={m.meeting_date}
                  agendaUrl={m.agenda_url}
                  packetUrl={m.packet_url}
                  minutesUrl={m.minutes_url}
                  previewStory={m.preview_story}
                  updateStory={m.update_story}
                  recapStory={m.recap_story}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
