'use client';

import { Code2, MessageSquare, Languages } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getSessionMode, type SessionModeSource } from '@/lib/interview-session';

/** Flag per language.
 *
 * Deliberately a lookup rather than a locale library: the language list is
 * admin-editable, so an unknown entry must degrade gracefully to a globe icon
 * rather than crash or render a wrong flag.
 */
const LANGUAGE_FLAGS: Record<string, string> = {
  English: '🇬🇧',
  Japanese: '🇯🇵',
  Chinese: '🇨🇳',
  Korean: '🇰🇷',
  Spanish: '🇪🇸',
  French: '🇫🇷',
  German: '🇩🇪',
  Vietnamese: '🇻🇳',
  Italian: '🇮🇹',
  Portuguese: '🇵🇹',
  Russian: '🇷🇺',
  Thai: '🇹🇭',
  Arabic: '🇸🇦',
  Hindi: '🇮🇳',
  Dutch: '🇳🇱',
};

export function getLanguageFlag(language?: string | null): string | null {
  if (!language) return null;
  return LANGUAGE_FLAGS[language] ?? null;
}

/** Read the practice language from a session title like "Japanese: Ramen shop".
 *
 * The interview row does not store the language itself — it lives in the brief —
 * so the title prefix written at creation time is the cheapest reliable source.
 */
export function getLanguageFromTitle(title?: string | null): string | null {
  if (!title) return null;
  const prefix = title.split(':')[0]?.trim();
  return prefix && LANGUAGE_FLAGS[prefix] ? prefix : null;
}

interface SessionTypeBadgeProps {
  session: SessionModeSource;
  /** Explicit language, when the caller has it (topic cards do). */
  language?: string | null;
  className?: string;
}

/** Consistent type marker for a session or topic card. */
export function SessionTypeBadge({ session, language, className }: SessionTypeBadgeProps) {
  const mode = getSessionMode(session);

  if (mode === 'code_practice') {
    return (
      <Badge variant="outline" className={`gap-1 font-normal ${className ?? ''}`}>
        <Code2 className="h-3 w-3" />Code
      </Badge>
    );
  }

  if (mode === 'language_practice') {
    const lang = language || getLanguageFromTitle(session.title) || 'English';
    const flag = getLanguageFlag(lang);
    return (
      <Badge variant="secondary" className={`gap-1 font-normal ${className ?? ''}`}>
        {flag ? <span aria-hidden>{flag}</span> : <Languages className="h-3 w-3" />}
        {lang}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={`gap-1 font-normal ${className ?? ''}`}>
      <MessageSquare className="h-3 w-3" />Interview
    </Badge>
  );
}


/** Icon-only variant for tight spots such as a card header. */
export function SessionTypeIcon({
  session,
  className,
}: {
  session: SessionModeSource;
  className?: string;
}) {
  const mode = getSessionMode(session);

  if (mode === 'code_practice') return <Code2 className={className} />;

  if (mode === 'language_practice') {
    const flag = getLanguageFlag(getLanguageFromTitle(session.title));
    // A flag reads faster than an icon, but only when we recognise the language
    if (flag) {
      return (
        <span className={`inline-flex items-center justify-center ${className ?? ''}`} aria-hidden>
          {flag}
        </span>
      );
    }
    return <Languages className={className} />;
  }

  return <MessageSquare className={className} />;
}
