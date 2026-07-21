'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  englishTopicsApi, codeTopicsApi, EnglishTopic, CodeTopic,
} from '@/lib/api/practice_topics';
import {
  buildEnglishPracticeJobDescription,
  buildCodePracticeJobDescription,
  fetchAllEnglishTopicsForAdmin,
  fetchAllCodeTopicsForAdmin,
  ENGLISH_PRACTICE_PROMPT_HELP,
  CODE_PRACTICE_PROMPT_HELP,
  ENGLISH_SESSION_TEMPLATE,
  CODE_SESSION_TEMPLATE,
} from '@/lib/practice-session-prompts';
import { ExpandableText } from '@/components/admin/expandable-text';
import { SessionPromptPreview } from '@/components/admin/session-prompt-preview';

function PromptCell({ text, emptyLabel }: { text: string; emptyLabel: string }) {
  if (!text.trim()) {
    return <span className="text-xs text-amber-600 font-medium">{emptyLabel}</span>;
  }
  return <ExpandableText text={text} maxChars={120} />;
}

function EnglishPromptEditDialog({
  topic,
  open,
  onClose,
}: {
  topic: EnglishTopic;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(topic.scenario_prompt);

  const saveMutation = useMutation({
    mutationFn: () => englishTopicsApi.update(topic.id, { scenario_prompt: draft }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['english-topics'] });
      qc.invalidateQueries({ queryKey: ['admin-practice-english-prompts'] });
      toast.success('English prompt saved');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewTopic = { ...topic, scenario_prompt: draft };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{topic.title}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {topic.skill_focus} · {topic.level}
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium">Scenario prompt *</label>
            <p className="text-xs text-muted-foreground">
              Core instructions for this topic — wrapped into the agent session prompt below.
            </p>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
          </div>
          <SessionPromptPreview
            label="Full agent session prompt (used when user starts English practice)"
            value={buildEnglishPracticeJobDescription(previewTopic)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!draft.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CodePromptEditDialog({
  topic,
  open,
  onClose,
}: {
  topic: CodeTopic;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(topic.problem_statement);

  const saveMutation = useMutation({
    mutationFn: () => codeTopicsApi.update(topic.id, { problem_statement: draft }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['code-topics'] });
      qc.invalidateQueries({ queryKey: ['admin-practice-code-prompts'] });
      toast.success('Code prompt saved');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewTopic = { ...topic, problem_statement: draft };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{topic.title}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {topic.category} · {topic.difficulty}
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium">Problem prompt *</label>
            <p className="text-xs text-muted-foreground">
              Problem text for the candidate and AI — wrapped into the agent session prompt below.
            </p>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              className="font-mono text-xs"
            />
          </div>
          <SessionPromptPreview
            label="Full agent session prompt (used when user starts Code practice)"
            value={buildCodePracticeJobDescription(previewTopic)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!draft.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-destructive max-w-md">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function PracticePromptsPanel() {
  const [englishEdit, setEnglishEdit] = useState<EnglishTopic | null>(null);
  const [codeEdit, setCodeEdit] = useState<CodeTopic | null>(null);

  const {
    data: englishItems = [],
    isLoading: englishLoading,
    isError: englishError,
    error: englishErr,
    refetch: refetchEnglish,
  } = useQuery({
    queryKey: ['admin-practice-english-prompts'],
    queryFn: fetchAllEnglishTopicsForAdmin,
  });

  const {
    data: codeItems = [],
    isLoading: codeLoading,
    isError: codeError,
    error: codeErr,
    refetch: refetchCode,
  } = useQuery({
    queryKey: ['admin-practice-code-prompts'],
    queryFn: fetchAllCodeTopicsForAdmin,
  });

  return (
    <div className="space-y-4 mb-8 pb-8 border-b">
      <div>
        <h3 className="text-base font-semibold">Practice session prompts</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Each row shows the <strong>exact prompt</strong> stored on the interview when a user clicks
          Start Practice. Edit the scenario/problem text here or in the topic tabs.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">English practice</p>
            <p className="text-xs text-muted-foreground">{ENGLISH_PRACTICE_PROMPT_HELP}</p>
            <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap leading-relaxed">
              {ENGLISH_SESSION_TEMPLATE}
            </pre>
            <p className="text-xs text-muted-foreground">
              Add or import topics in the Admin <strong>English Topics</strong> tab.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Code practice</p>
            <p className="text-xs text-muted-foreground">{CODE_PRACTICE_PROMPT_HELP}</p>
            <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap leading-relaxed">
              {CODE_SESSION_TEMPLATE}
            </pre>
            <p className="text-xs text-muted-foreground">
              Add or import topics in the Admin <strong>Code Topics</strong> tab.
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="english">
        <TabsList>
          <TabsTrigger value="english">English ({englishItems.length})</TabsTrigger>
          <TabsTrigger value="code">Code ({codeItems.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="english" className="mt-3">
          {englishLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : englishError ? (
            <LoadError
              message={englishErr instanceof Error ? englishErr.message : 'Failed to load English topics'}
              onRetry={() => refetchEnglish()}
            />
          ) : englishItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No English topics yet. Add topics under the English Topics tab — each needs a scenario prompt.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Title</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Meta</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase min-w-[320px]">
                      Agent session prompt (on Start Practice)
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase w-20">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {englishItems.map((t) => {
                    const sessionPrompt = buildEnglishPracticeJobDescription(t);
                    return (
                      <tr key={t.id} className="hover:bg-muted/30 align-top">
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                          {t.title}
                          {!t.is_active && (
                            <span className="ml-1 text-[10px] text-muted-foreground">(inactive)</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {t.skill_focus} · {t.level}
                        </td>
                        <td className="px-3 py-2.5 max-w-lg">
                          <PromptCell text={sessionPrompt} emptyLabel="(empty — edit to add scenario prompt)" />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => setEnglishEdit(t)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="code" className="mt-3">
          {codeLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : codeError ? (
            <LoadError
              message={codeErr instanceof Error ? codeErr.message : 'Failed to load code topics'}
              onRetry={() => refetchCode()}
            />
          ) : codeItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No code topics yet. Add topics under the Code Topics tab — each needs a problem prompt.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Title</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Meta</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase min-w-[320px]">
                      Agent session prompt (on Start Practice)
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase w-20">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {codeItems.map((t) => {
                    const sessionPrompt = buildCodePracticeJobDescription(t);
                    return (
                      <tr key={t.id} className="hover:bg-muted/30 align-top">
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                          {t.title}
                          {!t.is_active && (
                            <span className="ml-1 text-[10px] text-muted-foreground">(inactive)</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {t.category} · {t.difficulty}
                        </td>
                        <td className="px-3 py-2.5 max-w-lg">
                          <PromptCell text={sessionPrompt} emptyLabel="(empty — edit to add problem statement)" />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => setCodeEdit(t)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {englishEdit && (
        <EnglishPromptEditDialog
          key={englishEdit.id}
          topic={englishEdit}
          open
          onClose={() => setEnglishEdit(null)}
        />
      )}
      {codeEdit && (
        <CodePromptEditDialog
          key={codeEdit.id}
          topic={codeEdit}
          open
          onClose={() => setCodeEdit(null)}
        />
      )}
    </div>
  );
}
