import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t-2 border-[var(--color-accent)] mt-20">
      <div className="mx-auto max-w-6xl px-4 py-10 text-center">
        <Link
          href="/"
          className="font-display text-xl font-semibold text-ink"
        >
          Woodstock Community News
        </Link>
        <p className="mt-3 font-serif italic text-sm text-gray-600 max-w-md mx-auto leading-relaxed">
          Local reporting on government, public safety, schools, and community
          organizations in Woodstock, GA. Primary sources. AP Stylebook.
        </p>
        <p className="mt-4 text-[11px] font-sans tracking-[0.1em] uppercase text-gray-400">
          &copy; {new Date().getFullYear()} Woodstock Community News
        </p>
      </div>
    </footer>
  );
}
