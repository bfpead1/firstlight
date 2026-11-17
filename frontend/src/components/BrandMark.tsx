import type { SVGProps } from "react";

/**
 * The Firstlight symbol (public/brand/firstlight-symbol.svg) cropped to the mark itself,
 * so it reads at sidebar size. Uses the accent colour, so it follows light and dark mode.
 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="9 19 46 30" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M 15 37 A 17 17 0 0 1 49 37 Z" />
      <rect x="10" y="43" width="44" height="5" rx="2.5" />
    </svg>
  );
}
