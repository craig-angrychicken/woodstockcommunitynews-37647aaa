import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ArchiveList from "@/components/ArchiveList";

export const revalidate = 3600;

type Props = {
  params: Promise<{ page: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await params;
  const n = Number(page);
  if (!Number.isInteger(n) || n < 2) return {};
  return {
    title: `Archive — Page ${n}`,
    description: `Page ${n} of the Woodstock Community News archive.`,
  };
}

export default async function ArchivePaginatedPage({ params }: Props) {
  const { page } = await params;
  const n = Number(page);

  // Page 1 lives at /archive (not /archive/1). Reject anything non-numeric
  // or <= 1 here.
  if (!Number.isInteger(n) || n < 2) notFound();

  return <ArchiveList page={n} />;
}
