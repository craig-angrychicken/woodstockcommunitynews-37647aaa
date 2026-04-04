import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-gray-100 mt-16">
      <div className="mx-auto max-w-4xl px-4 py-10 text-center">
        <Link href="/" className="text-lg font-bold font-serif text-gray-900">
          Woodstock Community News
        </Link>
        <p className="mt-3 text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
          Woodstock Community News provides local reporting on local government,
          public safety, schools, and community organizations in Woodstock, GA. We
          use primary sources and follow the AP Stylebook.
        </p>
        <p className="mt-4 text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Woodstock Community News
        </p>
      </div>
    </footer>
  );
}
