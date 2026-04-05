import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b-2 border-[var(--color-accent)]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-col items-center text-center sm:flex-row sm:items-baseline sm:justify-between sm:text-left">
          <div>
            <Link
              href="/"
              className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink block"
            >
              Woodstock Community News
            </Link>
            <p className="hidden sm:block mt-1 text-xs text-gray-500 font-sans">
              Local news for Woodstock, Georgia — primary sources, AP Stylebook
            </p>
          </div>
          <nav className="mt-3 sm:mt-0 flex gap-6 text-[11px] font-semibold tracking-[0.1em] uppercase text-gray-600 font-sans">
            <Link href="/" className="hover:text-[var(--color-accent)] transition-colors">
              Home
            </Link>
            <Link href="/search" className="hover:text-[var(--color-accent)] transition-colors">
              Search
            </Link>
            <Link href="/about" className="hover:text-[var(--color-accent)] transition-colors">
              About
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
