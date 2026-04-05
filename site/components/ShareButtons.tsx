"use client";

import { useState } from "react";

interface ShareButtonsProps {
  url: string;
  title: string;
}

export default function ShareButtons({ url, title }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  const twitterHref = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (older browsers / insecure context) — silently ignore
    }
  }

  const btnClass =
    "inline-flex items-center justify-center px-4 py-2 text-[11px] font-sans font-semibold tracking-[0.1em] uppercase text-gray-600 border border-[var(--color-rule)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors";

  return (
    <div className="mt-10 pt-6 border-t border-[var(--color-rule)]">
      <p className="category-label mb-3">Share</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={facebookHref}
          target="_blank"
          rel="noopener noreferrer"
          className={btnClass}
          aria-label="Share on Facebook"
        >
          Facebook
        </a>
        <a
          href={twitterHref}
          target="_blank"
          rel="noopener noreferrer"
          className={btnClass}
          aria-label="Share on X"
        >
          X / Twitter
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className={btnClass}
          aria-label="Copy link to clipboard"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
