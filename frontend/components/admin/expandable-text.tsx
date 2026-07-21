'use client';

import { useState } from 'react';

export function ExpandableText({ text, maxChars = 80 }: { text: string; maxChars?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const needsTrunc = text.length > maxChars;
  return (
    <span className="text-xs leading-relaxed whitespace-pre-wrap">
      {expanded || !needsTrunc ? text : text.slice(0, maxChars)}
      {needsTrunc && (
        <>
          {!expanded && '…'}
          {' '}
          <button
            type="button"
            className="text-blue-500 hover:underline whitespace-nowrap font-medium"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? 'less' : 'more'}
          </button>
        </>
      )}
    </span>
  );
}
