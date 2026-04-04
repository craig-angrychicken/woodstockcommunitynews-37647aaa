import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Community journalism powered by AI, guided by AP standards. Learn about Woodstock Community News.",
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-gray-900">
          About
        </h1>
      </header>

      <div className="border-t-[3px] border-gray-900 pt-5 mb-8">
        <p className="text-xl font-bold tracking-tight">
          Woodstock Community News
        </p>
        <p className="mt-1 text-gray-500">Woodstock, Georgia</p>
        <p className="mt-1 text-gray-500 italic text-sm">
          The Woodstock Community News Staff
        </p>
        <p className="mt-1 text-gray-400 text-sm">
          Community journalism powered by AI, guided by AP standards
        </p>
      </div>

      <hr className="my-8 border-gray-200" />

      <section className="mb-8">
        <h2 className="font-serif text-xl font-bold text-gray-900 mb-4">
          Who We Are
        </h2>
        <p className="mb-4 leading-relaxed">
          Woodstock Community News is a local news publication covering
          Woodstock, Georgia. We believe that every community deserves quality
          journalism, even when traditional newsrooms can no longer provide it.
        </p>
        <p className="leading-relaxed">
          We are not a replacement for professional journalists. We are a
          complement, built to cover the primary source beats that local papers
          once staffed but increasingly do not.
        </p>
      </section>

      <hr className="my-8 border-gray-200" />

      <section className="mb-8">
        <h2 className="font-serif text-xl font-bold text-gray-900 mb-4">
          Why We Exist
        </h2>
        <p className="mb-4 leading-relaxed">
          Local news is disappearing. The United States has lost more than 2,500
          newspapers since 2005. The communities most affected are often
          mid-sized and fast-growing cities, places like Woodstock, where civic
          life is active and consequential but coverage is thin.
        </p>
        <p className="mb-4 leading-relaxed">
          Woodstock is a growing city with an engaged local government and a
          community that genuinely cares about where it lives. Quality local
          journalism isn&apos;t the responsibility of local or regional
          government, but market forces have reduced both the amount and quality
          of coverage available.
        </p>
        <p className="leading-relaxed">
          We built Woodstock Community News to help bridge that gap. Informed
          citizens make stronger neighbors, better voters, and more engaged
          members of their community. When people know what&apos;s happening
          around them, they show up to meetings, to elections, to the
          conversations that shape where they live.
        </p>
      </section>

      <hr className="my-8 border-gray-200" />

      <section className="mb-8">
        <h2 className="font-serif text-xl font-bold text-gray-900 mb-4">
          How We Work: Transparency About AI
        </h2>
        <p className="mb-4 leading-relaxed">
          We want to be fully transparent about how our journalism is produced.
        </p>
        <p className="mb-4 leading-relaxed">
          Stories on this site are drafted by artificial intelligence
          (specifically, large language models) working from primary sources.
          Those sources include public records, official government documents,
          press releases from local agencies, RSS feeds from official channels,
          and official social media accounts of government bodies and public
          agencies. We do not generate content from rumors, unverified claims, or
          unofficial sources. We do not copy or use information from other
          journalistic outlets. We focus exclusively on primary source material
          directly from the sources in the communities we cover.
        </p>
        <p className="mb-4 leading-relaxed">
          Every story passes through an automated fact-check that compares
          published claims against source documents before publication. Every
          story then undergoes an AI editorial review.
        </p>
        <p className="mb-4 leading-relaxed">
          We do not generate opinion. We do not speculate. We do not
          editorialize. If a source document is ambiguous, we say so. If we
          cannot confirm a fact from primary sources, we do not include it.
        </p>
        <p className="leading-relaxed">
          This process is not perfect. No journalism is. But it is structured,
          sourced, and supervised.
        </p>
      </section>

      <hr className="my-8 border-gray-200" />

      <section className="mb-8">
        <h2 className="font-serif text-xl font-bold text-gray-900 mb-4">
          Our Standards
        </h2>
        <p className="mb-4 leading-relaxed">
          We follow Associated Press style.
        </p>
        <p className="mb-4 leading-relaxed">
          We report from primary sources only. We do not relay secondhand
          accounts or unverified claims.
        </p>
        <p className="mb-4 leading-relaxed">
          We do not editorialize. Our job is to surface what is already public,
          not to tell readers what to think about it.
        </p>
        <p className="mb-4 leading-relaxed">
          When facts are disputed, we say so explicitly and cite the dispute.
        </p>
        <p className="mb-4 leading-relaxed">
          We correct errors promptly and visibly. Corrections are noted in the
          body of the story, not buried or deleted.
        </p>
        <p className="leading-relaxed">
          We do not cover stories we cannot source. If we cannot point to a
          primary document, we do not publish.
        </p>
      </section>

      <hr className="my-8 border-gray-200" />

      <section className="mb-8">
        <h2 className="font-serif text-xl font-bold text-gray-900 mb-4">
          What We Are Not
        </h2>
        <p className="mb-4 leading-relaxed">
          We are not a replacement for professional journalism.
        </p>
        <p className="mb-4 leading-relaxed">
          We do not do investigative reporting. We do not cultivate sources,
          conduct interviews, or do the on-the-ground work that accountability
          journalism requires. That work is irreplaceable, and we do not claim to
          replicate it.
        </p>
        <p className="mb-4 leading-relaxed">
          We do not editorialize, endorse, or advocate.
        </p>
        <p className="leading-relaxed">
          We exist to do one thing: surface public information about Woodstock
          and make it readable, accessible, and available to the people who live
          here.
        </p>
      </section>

      <hr className="my-8 border-gray-200" />

      <p className="text-sm text-gray-500 italic">
        Woodstock Community News is an independent publication. It is not
        affiliated with any government agency, political party, business, or
        advocacy organization.
      </p>
    </article>
  );
}
