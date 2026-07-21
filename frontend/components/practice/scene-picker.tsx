'use client';

import { useState } from 'react';
import { Loader2, Play, MapPin, Target, User, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { EnglishTopic, TopicScene } from '@/lib/api/practice_topics';

interface ScenePickerProps {
  topic: EnglishTopic | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (topic: EnglishTopic, scene: TopicScene | null) => void;
  starting: boolean;
}

/** Lets the learner choose which situation to practise before the session starts. */
export function ScenePicker({ topic, open, onOpenChange, onStart, starting }: ScenePickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!topic) return null;

  const scenes = topic.scenes ?? [];
  const selected = scenes.find((s) => s.id === selectedId) ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!starting) { setSelectedId(null); onOpenChange(v); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{topic.title}</DialogTitle>
          <DialogDescription>
            Pick a situation to practise. You&apos;ll speak with an AI partner playing the other role.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {scenes.map((scene) => {
            const isSelected = scene.id === selectedId;
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => setSelectedId(scene.id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                }`}
              >
                <p className="font-medium text-sm mb-1.5">{scene.title}</p>
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
                  {scene.goal && (
                    <span className="flex items-center gap-1.5">
                      <Target className="h-3 w-3 shrink-0" />Goal: {scene.goal}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {/* Always available: the topic's own open-ended scenario */}
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              selectedId === null ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
            }`}
          >
            <p className="font-medium text-sm mb-1">Open conversation</p>
            <p className="text-xs text-muted-foreground line-clamp-2">{topic.scenario_prompt}</p>
          </button>
        </div>

        <Button
          className="w-full"
          onClick={() => onStart(topic, selected)}
          disabled={starting}
        >
          {starting
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <Play className="h-4 w-4 mr-2" />}
          {selected ? `Start: ${selected.title}` : 'Start open conversation'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
