'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Target, MapPin, User, Bot, CheckCircle2, Circle, ArrowRight, Loader2, Languages,
} from 'lucide-react';
import { interviewsApi, type EnglishSessionState } from '@/lib/api/interviews';

const PHASES = ['warm-up', 'scenario', 'stretch', 'wrap-up'] as const;

function PhaseTrack({ current }: { current: string }) {
  const activeIndex = PHASES.indexOf(current as typeof PHASES[number]);

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, i) => (
        <div key={phase} className="flex-1">
          <div
            className={`h-1 rounded-full ${i <= activeIndex ? 'bg-primary' : 'bg-muted'}`}
          />
          <p className={`text-[10px] mt-1 capitalize ${
            i === activeIndex ? 'text-foreground font-medium' : 'text-muted-foreground'
          }`}>
            {phase}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Side panel shown during English practice, in place of the code sandbox.
 * Polls a computed endpoint (no LLM calls) while the session is running.
 */
export function EnglishSessionPanel({
  interviewId,
  isActive,
}: {
  interviewId: number;
  isActive: boolean;
}) {
  const { data, isLoading } = useQuery<EnglishSessionState>({
    queryKey: ['session-state', interviewId],
    queryFn: () => interviewsApi.getSessionState(interviewId),
    enabled: !!interviewId,
    // Only poll while the conversation is live
    refetchInterval: isActive ? 3000 : false,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { scene, vocabulary = [], corrections = [], language_switches = [] } = data;
  const language = data.target_language || 'English';

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">
              {scene?.title || `${language} practice`}
            </CardTitle>
            <Badge variant="outline" className="text-xs font-normal shrink-0">
              {data.level}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <PhaseTrack current={data.phase} />
          <p className="text-xs text-muted-foreground">{data.phase_hint}</p>

          {data.objective && (
            <div className="flex items-start gap-2 text-xs pt-1">
              <Target className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
              <span><span className="font-medium">Your goal:</span> {data.objective}</span>
            </div>
          )}

          {scene && (
            <div className="grid gap-1 text-xs text-muted-foreground">
              {scene.setting && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 shrink-0" />{scene.setting}
                </span>
              )}
              {scene.your_role && (
                <span className="flex items-center gap-1.5">
                  <User className="h-3 w-3 shrink-0" />You: {scene.your_role}
                </span>
              )}
              {scene.ai_role && (
                <span className="flex items-center gap-1.5">
                  <Bot className="h-3 w-3 shrink-0" />Partner: {scene.ai_role}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {vocabulary.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Try to use these</CardTitle>
              <span className="text-xs text-muted-foreground tabular-nums">
                {data.vocabulary_used_count}/{vocabulary.length}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {vocabulary.map((item) => (
              <div
                key={item.word}
                className={`flex items-center gap-2 text-sm ${
                  item.used ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {item.used
                  ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  : <Circle className="h-3.5 w-3.5 shrink-0" />}
                <span className={item.used ? 'line-through decoration-primary/40' : ''}>
                  {item.word}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {language_switches.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Say this in {language}</CardTitle>
              {data.english_only_streak > 0 && (
                <span className="text-xs text-muted-foreground">
                  {data.english_only_streak} turn{data.english_only_streak === 1 ? '' : 's'} in {language}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {language_switches.slice().reverse().map((item, i) => (
              <div key={i} className="text-sm space-y-0.5">
                <p className="text-muted-foreground italic">{item.said}</p>
                {item.english_version ? (
                  <p className="flex items-start gap-1.5">
                    <Languages className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                    <span className="font-medium">{item.english_version}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Have a go at this one in {language}.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Say it this way</CardTitle>
        </CardHeader>
        <CardContent>
          {corrections.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing to correct yet. Suggestions appear here as you talk.
            </p>
          ) : (
            <div className="space-y-3">
              {corrections.slice().reverse().map((c, i) => (
                <div key={i} className="text-sm space-y-0.5">
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-muted-foreground line-through">{c.said}</span>
                    <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{c.better}</span>
                  </div>
                  {c.why && <p className="text-xs text-muted-foreground">{c.why}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
