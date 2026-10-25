import React from 'react';
import { encode } from 'uqr';

/**
 * A QR code as an inline SVG of `currentColor` modules, so it takes its colour from the
 * theme tokens like any other glyph and never carries a colour literal.
 *
 * One `<path>` for every dark module rather than a `<rect>` each: a pairing URL is a
 * version-4 code, about 1,000 modules, and one path is one DOM node.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** What the code opens, for a screen reader. The text itself is shown beside it. */
  label: string;
  className?: string;
}): React.ReactElement {
  const { data, size } = encode(value, { ecc: 'M', border: 2 });
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${String(x)} ${String(y)}h1v1h-1z` : '')))
    .join('');
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className={className}
      data-testid="qr-code"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
