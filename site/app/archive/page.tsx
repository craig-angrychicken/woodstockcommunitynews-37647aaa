import type { Metadata } from "next";
import ArchiveList from "@/components/ArchiveList";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Archive",
  description:
    "Browse every story published by Woodstock Community News, in reverse chronological order.",
};

export default function ArchivePage() {
  return <ArchiveList page={1} />;
}
