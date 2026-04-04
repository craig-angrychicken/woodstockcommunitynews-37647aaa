import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b border-gray-100">
      <div className="mx-auto max-w-4xl px-4 py-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <Link href="/" className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 font-serif">
          Woodstock Community News
        </Link>
        <nav className="flex gap-6 text-sm font-medium text-gray-600">
          <Link href="/" className="hover:text-gray-900 transition-colors">
            Home
          </Link>
          <Link href="/about" className="hover:text-gray-900 transition-colors">
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}
