'use client';

import { useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import type { ConversationMessage } from '@/lib/api/interviews';

interface ConversationHistoryProps {
  messages: ConversationMessage[] | null | undefined;
  /** Label for assistant turns — "Partner" in practice, "Interviewer" otherwise. */
  agentLabel: string;
  title?: string;
  /** Scroll to the newest message when it changes (live sessions). */
  autoScroll?: boolean;
  emptyText?: string;
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
}: ConversationHistoryProps) {
  const endRef = useRef<HTMLDivElement>(null);

  const visible = (messages ?? []).filter((m) => m.role !== 'system' && m.content);

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visible.length, autoScroll]);

  return (
    <Card className="h-full">
      <CardContent className="p-4 h-full overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">{title}</h3>
          {visible.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {visible.length} message{visible.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{emptyText}</p>
        ) : (
          <div className="space-y-3">
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
        )}
      </CardContent>
    </Card>
  );
}
