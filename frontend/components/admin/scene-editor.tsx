'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { TopicScene } from '@/lib/api/practice_topics';

/** Derive a stable, unique slug id from the scene title. */
function slugify(title: string, existing: string[]): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    || 'scene';
  if (!existing.includes(base)) return base;

  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

interface SceneEditorProps {
  scenes: TopicScene[];
  onChange: (scenes: TopicScene[]) => void;
  maxScenes?: number;
}

/** Admin editor for the scenes a learner can pick between on a topic. */
export function SceneEditor({ scenes, onChange, maxScenes = 6 }: SceneEditorProps) {
  const update = (index: number, patch: Partial<TopicScene>) => {
    onChange(scenes.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const add = () => {
    onChange([...scenes, {
      id: slugify('scene', scenes.map(s => s.id)),
      title: '', your_role: '', ai_role: '', setting: '', goal: '', opening_line: '',
    }]);
  };

  const remove = (index: number) => onChange(scenes.filter((_, i) => i !== index));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  // Keep the slug in step with the title until an admin has typed a real title,
  // so ids stay readable without ever colliding.
  const retitle = (index: number, title: string) => {
    const otherIds = scenes.filter((_, i) => i !== index).map(s => s.id);
    update(index, { title, id: slugify(title, otherIds) });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs font-medium">Scenes</label>
          <p className="text-xs text-muted-foreground">
            Situations the learner picks between before starting. Leave empty to always
            use the scenario prompt as-is.
          </p>
        </div>
        <Button
          type="button" size="sm" variant="outline"
          onClick={add} disabled={scenes.length >= maxScenes}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />Add scene
        </Button>
      </div>

      {scenes.map((scene, i) => (
        <div key={i} className="rounded border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={scene.title}
              onChange={e => retitle(i, e.target.value)}
              placeholder="Scene title, e.g. Ordering at the counter"
              className="h-8 text-xs font-medium"
            />
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0"
              onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0"
              onClick={() => move(i, 1)} disabled={i === scenes.length - 1} title="Move down">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0"
              onClick={() => remove(i)} title="Remove scene">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={scene.your_role}
              onChange={e => update(i, { your_role: e.target.value })}
              placeholder="Learner plays… e.g. a customer"
              className="h-8 text-xs"
            />
            <Input
              value={scene.ai_role}
              onChange={e => update(i, { ai_role: e.target.value })}
              placeholder="AI plays… e.g. a busy barista"
              className="h-8 text-xs"
            />
            <Input
              value={scene.setting}
              onChange={e => update(i, { setting: e.target.value })}
              placeholder="Setting, e.g. a London cafe at 8am"
              className="h-8 text-xs"
            />
            <Input
              value={scene.goal}
              onChange={e => update(i, { goal: e.target.value })}
              placeholder="Learner's goal, e.g. order and pay"
              className="h-8 text-xs"
            />
          </div>

          <Textarea
            value={scene.opening_line}
            onChange={e => update(i, { opening_line: e.target.value })}
            rows={2}
            placeholder="Opening line the AI says to start the scene…"
            className="text-xs"
          />
          <p className="text-xs text-muted-foreground font-mono">id: {scene.id}</p>
        </div>
      ))}
    </div>
  );
}
