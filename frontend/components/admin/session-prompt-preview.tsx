'use client';

interface SessionPromptPreviewProps {
  label?: string;
  value: string;
}

/** Read-only preview of the full prompt sent to the AI interviewer. */
export function SessionPromptPreview({
  label = 'Agent session prompt (sent when user starts practice)',
  value,
}: SessionPromptPreviewProps) {
  if (!value.trim()) return null;
  return (
    <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
        {value}
      </pre>
    </div>
  );
}
