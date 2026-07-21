'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, CheckCircle2, CircleDashed, Languages } from 'lucide-react';

/** Shape returned by GET /interviews/{id}/skills for english_practice sessions. */
export interface EnglishBreakdown {
  session_mode?: string;
  fluency?: { score: number };
  grammar?: { score: number };
  vocabulary?: { score: number };
  task_completion?: { score: number };
  overall?: { score: number };
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  corrections?: { said: string; better: string; why?: string }[];
  vocabulary_used?: string[];
  vocabulary_missed?: string[];
  language_switches?: number;
  phrases_to_learn?: { said: string; better: string; why?: string }[];
}

/** The API wraps the breakdown: { interview_id, ..., skill_breakdown: {...} }. */
interface BreakdownEnvelope { skill_breakdown?: EnglishBreakdown }

/** Pull out the English payload, accepting either the envelope or the inner object. */
export function getEnglishBreakdown(response: unknown): EnglishBreakdown | null {
  if (typeof response !== 'object' || response === null) return null;

  const inner = (response as BreakdownEnvelope).skill_breakdown ?? (response as EnglishBreakdown);
  return inner?.session_mode === 'english_practice' ? inner : null;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function EnglishFeedbackCard({ breakdown }: { breakdown: EnglishBreakdown }) {
  const {
    fluency, grammar, vocabulary, task_completion, overall,
    strengths = [], weaknesses = [], recommendations = [],
    corrections = [], vocabulary_used = [], vocabulary_missed = [],
    phrases_to_learn = [], language_switches = 0,
  } = breakdown;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Language performance</CardTitle>
            {overall && (
              <span className="text-2xl font-semibold tabular-nums">
                {Math.round(overall.score * 100)}%
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScoreBar label="Fluency" score={fluency?.score ?? 0} />
          <ScoreBar label="Grammar" score={grammar?.score ?? 0} />
          <ScoreBar label="Vocabulary" score={vocabulary?.score ?? 0} />
          <ScoreBar label="Task completion" score={task_completion?.score ?? 0} />
          <p className="text-xs text-muted-foreground pt-1">
            Scored against your target level, not against a native speaker.
          </p>
        </CardContent>
      </Card>

      {/* The phrases they reached for and could not find — the highest-value
          takeaway from the session, so it leads. */}
      {phrases_to_learn.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Phrases you needed</CardTitle>
            <p className="text-xs text-muted-foreground">
              You switched out of English {language_switches || phrases_to_learn.length} time
              {(language_switches || phrases_to_learn.length) === 1 ? '' : 's'}. Here is what to say next time.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {phrases_to_learn.map((p, i) => (
              <div key={i} className="text-sm space-y-0.5">
                <p className="text-muted-foreground italic">{p.said}</p>
                <p className="flex items-start gap-1.5">
                  <Languages className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                  <span className="font-medium">{p.better}</span>
                </p>
                {p.why && <p className="text-xs text-muted-foreground">{p.why}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {corrections.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Say it this way</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {corrections.map((c, i) => (
              <div key={i} className="text-sm space-y-1">
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-muted-foreground line-through">{c.said}</span>
                  <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{c.better}</span>
                </div>
                {c.why && <p className="text-xs text-muted-foreground">{c.why}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(vocabulary_used.length > 0 || vocabulary_missed.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Key vocabulary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {vocabulary_used.map((v) => (
              <Badge key={`used-${v}`} variant="default" className="gap-1 font-normal">
                <CheckCircle2 className="h-3 w-3" />{v}
              </Badge>
            ))}
            {vocabulary_missed.map((v) => (
              <Badge key={`missed-${v}`} variant="outline" className="gap-1 font-normal text-muted-foreground">
                <CircleDashed className="h-3 w-3" />{v}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {([
          ['What went well', strengths],
          ['Work on this', weaknesses],
          ['Next steps', recommendations],
        ] as const).map(([title, items]) => items.length > 0 && (
          <Card key={title}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-4">
                {items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
