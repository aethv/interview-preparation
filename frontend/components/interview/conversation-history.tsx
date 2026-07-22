'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import type { ConversationMessage } from '@/lib/api/interviews';
import { cn } from '@/lib/utils';

interface ConversationHistoryProps {
  messages: ConversationMessage[] | null | undefined;
  /** Label for assistant turns — "Partner" in practice, "Interviewer" otherwise. */
  agentLabel: string;
  title?: string;
  /** Scroll to the newest message when it changes (live sessions). */
  autoScroll?: boolean;
  emptyText?: string;
  /** Extra controls rendered in the header (e.g. minimize/maximize). */
  headerActions?: ReactNode;
  /** When true, only the header row is shown. */
  collapsed?: boolean;
}

interface TurnCorrection { said?: string; better?: string; why?: string }

/**
 * Renders the persisted transcript.
 *
 * Separate from TranscriptionDisplay, which only shows live LiveKit events and
 * therefore starts empty on every rejoin. This reads what the server stored, so
 * a paused session shows its history again when reopened.
 */
export function ConversationHistory({
  messages,
  agentLabel,
  title = 'Conversation so far',
  autoScroll = false,
  emptyText = 'No messages yet.',
  headerActions,
  collapsed = false,
}: ConversationHistoryProps) {
  const endRef = useRef<HTMLDivElement>(null);

  const visible = (messages ?? []).filter((m) => m.role !== 'system' && m.content);

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visible.length, autoScroll]);

  return (
    <Card className={cn('h-full flex flex-col', collapsed && 'py-0')}>
      <CardContent
        className={cn(
          'p-4 flex flex-col min-h-0',
          collapsed ? 'py-2.5 justify-center' : 'h-full',
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between gap-2 shrink-0',
            !collapsed && 'mb-3',
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-sm truncate">{title}</h3>
            {!collapsed && visible.length > 0 && (
              <span className="text-xs text-muted-foreground shrink-0">
                {visible.length} message{visible.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {headerActions && (
            <div className="flex items-center gap-1 shrink-0">{headerActions}</div>
          )}
        </div>

        {!collapsed &&
          (visible.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{emptyText}</p>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
              {visible.map((msg, idx) => {
                const correction = (msg.metadata as { correction?: TurnCorrection } | undefined)?.correction;
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg ${
                      msg.role === 'user' ? 'bg-primary/10 ml-8' : 'bg-muted mr-8'
                    }`}
                  >
                    <div className="font-semibold text-xs mb-1">
                      {msg.role === 'user' ? 'You' : agentLabel}
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{msg.content}</div>

                    {/* Corrections captured on this turn, shown inline in context */}
                    {correction?.said && correction?.better && (
                      <div className="mt-2 pt-2 border-t border-border/60 text-xs flex items-start gap-1.5 flex-wrap">
                        <span className="text-muted-foreground line-through">{correction.said}</span>
                        <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{correction.better}</span>
                      </div>
                    )}

                    {msg.timestamp && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(msg.timestamp).toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
