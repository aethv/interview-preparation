'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ConfigEntry } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Pencil, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

// ── Static prompt metadata ─────────────────────────────────────────────────────

type PromptType = 'Scraping' | 'Analysis' | 'Orchestrator';

interface PromptDef {
  id: number;
  name: string;
  key: string;
  variable: string;
  type: PromptType;
  description: string;
  defaultText: string;
}

const PROMPT_DEFINITIONS: PromptDef[] = [
  // Scraping
  {
    id: 1,
    name: 'Browser Planner',
    key: 'prompt_browser_planner',
    variable: '_PLAN_SYSTEM_DEFAULT',
    type: 'Scraping',
    description: 'Plans Playwright steps to reveal page content after navigation',
    defaultText:
      "You are a browser automation planner. The page has already been navigated to. " +
      "Plan the minimal additional Playwright steps to reveal the main content.\n" +
      "Available actions:\n" +
      "- wait_for_selector: wait for a CSS selector to appear\n" +
      "- wait_for_text: wait for visible text to appear on page\n" +
      "- click_text: click the first element containing this visible text\n" +
      "- click_selector: click element matching CSS selector\n" +
      "- scroll: scroll to bottom of page\n" +
      "- wait_ms: pause N milliseconds (target = string of ms, e.g. '2000')\n\n" +
      "Mark optional=true for steps that may not exist on every load " +
      "(cookie banners, overlays, etc). Keep plans to 3–6 steps max.",
  },
  {
    id: 2,
    name: 'Page Analyser',
    key: 'prompt_page_analyser',
    variable: '_ANALYSE_SYSTEM_DEFAULT',
    type: 'Scraping',
    description: 'Classifies page structure as list, single item, or unknown',
    defaultText:
      "You analyze web page content to classify its structure and list its items. " +
      "Set page_type to 'list' when the page contains multiple linked problems/topics/exercises, " +
      "'single' for a single detailed problem or article, 'unknown' otherwise.",
  },
  {
    id: 3,
    name: 'English Extractor',
    key: 'prompt_english_extractor',
    variable: '_ENGLISH_EXTRACT_SYSTEM_DEFAULT',
    type: 'Scraping',
    description: 'Extracts structured English language practice topics from page text',
    defaultText:
      "You are an expert at extracting structured English language practice topics from educational content. Be thorough.",
  },
  {
    id: 4,
    name: 'Code Extractor',
    key: 'prompt_code_extractor',
    variable: '_CODE_EXTRACT_SYSTEM_DEFAULT',
    type: 'Scraping',
    description: 'Extracts structured coding interview problems from page text',
    defaultText:
      "You are an expert at extracting structured coding interview problems from technical content. Be thorough and produce well-structured JSON fields.",
  },
  {
    id: 5,
    name: 'Code Vision',
    key: 'prompt_code_vision',
    variable: '_CODE_VISION_SYSTEM_DEFAULT',
    type: 'Scraping',
    description: 'Extracts coding problems from screenshots — converts diagrams to text',
    defaultText:
      "You are an expert at extracting structured coding interview problems. " +
      "When you see tree, graph, or matrix diagrams in the screenshot, " +
      "convert them to clear text descriptions inside problem_statement so the " +
      "problem is fully understandable without images.",
  },
  {
    id: 6,
    name: 'Stuck Browser Advisor',
    key: 'prompt_stuck_browser',
    variable: '_ask_gpt_next_action',
    type: 'Scraping',
    description: 'Vision prompt: suggests the next browser action when the scraper is stuck',
    defaultText:
      "You are a browser automation assistant. A headless browser got stuck on a web page. " +
      "Analyze the screenshot and suggest ONE specific next action in plain English. " +
      "Be concrete and brief — e.g. 'Click the Verify checkbox', 'Click Accept cookies', " +
      "'The page needs login — enter credentials', 'Select all problems then click Next', " +
      "'This CAPTCHA requires a human to solve the image puzzle'.",
  },
  {
    id: 7,
    name: 'Browser Recovery',
    key: 'prompt_browser_recovery',
    variable: '_plan_recovery_steps',
    type: 'Scraping',
    description: 'Plans recovery steps when the browser is stuck, given a human instruction',
    defaultText:
      "You are a browser automation planner. The browser is currently stuck. " +
      "Plan the minimal Playwright steps to carry out the user's instruction and move past the obstacle. " +
      "Available actions: wait_for_selector, wait_for_text, click_text, click_selector, scroll, wait_ms. " +
      "Mark optional=true if a step may not be needed on every attempt.",
  },
  {
    id: 8,
    name: 'Click Targets',
    key: 'prompt_click_targets',
    variable: '_get_click_targets',
    type: 'Scraping',
    description: 'Extracts menu item labels to click from user navigation instructions',
    defaultText:
      "You extract a list of menu item labels to click from user instructions about web scraping. " +
      "Return only the visible text labels (e.g. category names) that should be clicked. " +
      "If instructions don't mention clicking menus or specific categories, return an empty list.",
  },
  // Analysis
  {
    id: 9,
    name: 'Response Analyzer',
    key: 'prompt_response_analyzer',
    variable: 'analyze_answer',
    type: 'Analysis',
    description: 'Analyzes candidate answer quality and produces structured scoring',
    defaultText:
      "You are an expert interviewer analyzing candidate answers. Provide objective, helpful analysis.",
  },
  {
    id: 10,
    name: 'Feedback Generator',
    key: 'prompt_feedback_generator',
    variable: 'generate_feedback',
    type: 'Analysis',
    description: 'Generates the comprehensive end-of-interview feedback report',
    defaultText:
      "You are an expert interviewer providing comprehensive feedback. Be objective, specific, actionable. " +
      "For code_quality: return empty lists [] when no code submitted, never 'N/A'.",
  },
  {
    id: 11,
    name: 'Code Reviewer',
    key: 'prompt_code_reviewer',
    variable: '_analyze_code_quality',
    type: 'Analysis',
    description: 'Reviews code submissions with detailed constructive feedback',
    defaultText:
      "You are an expert code reviewer analyzing interview code submissions. " +
      "Provide constructive, detailed feedback that helps candidates improve. Be specific and actionable.",
  },
  {
    id: 12,
    name: 'Code Feedback',
    key: 'prompt_code_feedback',
    variable: '_generate_feedback_message',
    type: 'Analysis',
    description: 'Generates the friendly code feedback message delivered to the candidate',
    defaultText:
      "You are a friendly, supportive interviewer providing code feedback. Be encouraging and constructive.",
  },
  {
    id: 13,
    name: 'Code Follow-up',
    key: 'prompt_code_followup',
    variable: '_generate_followup_question',
    type: 'Analysis',
    description: 'Generates follow-up questions after code review',
    defaultText:
      "You are an expert interviewer asking follow-up questions after code review. " +
      "Be conversational and natural. Prefer single, focused questions for clarity, " +
      "but compound questions (with 'and') are acceptable when exploring related technical aspects naturally.",
  },
  // Orchestrator
  {
    id: 14,
    name: 'Persona Generator',
    key: 'prompt_persona_generator',
    variable: 'greeting_node',
    type: 'Orchestrator',
    description: 'Generates a realistic interviewer persona from the job description',
    defaultText:
      "You are generating a realistic interviewer persona. Return only valid JSON.",
  },
  {
    id: 15,
    name: 'Decision Maker',
    key: 'prompt_decision_maker',
    variable: 'decide_next_action_node',
    type: 'Orchestrator',
    description: 'Decides the next interview action (question, followup, closing, etc.)',
    defaultText:
      "You are an experienced interviewer with full autonomy. Make decisions based on what feels natural " +
      "and productive. Trust your judgment - if the conversation is going well, continue. " +
      "If it needs a change, make it. If it feels complete, wrap it up.",
  },
  {
    id: 16,
    name: 'Conversation Summarizer',
    key: 'prompt_summarizer',
    variable: 'summarize_node',
    type: 'Orchestrator',
    description: 'Summarizes conversation history to maintain context across long sessions',
    defaultText:
      "You are a conversation summarizer. Create concise, informative summaries that preserve key context.",
  },
  {
    id: 17,
    name: 'Intent Detector',
    key: 'prompt_intent_detector',
    variable: 'detect_intent',
    type: 'Orchestrator',
    description: 'Detects user intent from a response (write_code, clarify, stop, etc.)',
    defaultText:
      "You are an expert at understanding human intent through conversation analysis. " +
      "Your job is to identify what the user is TRYING TO ACCOMPLISH, not match keywords. " +
      "Think about their GOAL, their PURPOSE, and what ACTION they want. " +
      "Consider the conversation context, the flow, and what would happen if their intent was ignored. " +
      "Be thoughtful and holistic in your analysis.",
  },
];

// ── Type badge ─────────────────────────────────────────────────────────────────

const TYPE_VARIANTS: Record<PromptType, string> = {
  Scraping:     'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  Analysis:     'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  Orchestrator: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

function TypeBadge({ type }: { type: PromptType }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TYPE_VARIANTS[type]}`}>
      {type}
    </span>
  );
}

// ── Expandable text cell ───────────────────────────────────────────────────────

function ExpandableText({ text, maxChars = 80 }: { text: string; maxChars?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const needsTrunc = text.length > maxChars;
  return (
    <span className="text-xs leading-relaxed">
      {expanded || !needsTrunc ? text : text.slice(0, maxChars)}
      {needsTrunc && (
        <>
          {!expanded && '…'}
          {' '}
          <button
            className="text-blue-500 hover:underline whitespace-nowrap font-medium"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          >
            {expanded ? 'less' : 'more'}
          </button>
        </>
      )}
    </span>
  );
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

type SortKey = 'id' | 'name' | 'variable' | 'type' | 'description' | 'prompt';
type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="ml-1 h-3 w-3 text-muted-foreground inline" />;
  return dir === 'asc'
    ? <ChevronUp className="ml-1 h-3 w-3 inline" />
    : <ChevronDown className="ml-1 h-3 w-3 inline" />;
}

// ── Edit dialog ────────────────────────────────────────────────────────────────

function EditDialog({
  prompt,
  currentValue,
  open,
  onClose,
  onSave,
  isSaving,
}: {
  prompt: PromptDef;
  currentValue: string;
  open: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
  isSaving: boolean;
}) {
  const [draft, setDraft] = useState(currentValue);
  const isDirty = draft !== currentValue;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {prompt.name}
            <TypeBadge type={prompt.type} />
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{prompt.description}</p>
          <p className="text-xs font-mono text-muted-foreground">key: {prompt.key}</p>
        </DialogHeader>

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          className="font-mono text-sm resize-y"
        />

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => onSave(draft)} disabled={!isDirty || isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

const SORTABLE_COLS: { key: SortKey; label: string }[] = [
  { key: 'id',          label: '#' },
  { key: 'name',        label: 'Name' },
  { key: 'variable',    label: 'Variable' },
  { key: 'type',        label: 'Type' },
  { key: 'description', label: 'Description' },
  { key: 'prompt',      label: 'Prompt' },
];

export function PromptsTab() {
  const qc = useQueryClient();
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editing, setEditing] = useState<PromptDef | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const { data: configs, isLoading } = useQuery<ConfigEntry[]>({
    queryKey: ['admin-config'],
    queryFn: () => adminApi.getConfig(),
    staleTime: 0,
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      adminApi.updateConfig(key, value),
    onSuccess: (updated) => {
      qc.setQueryData<ConfigEntry[]>(['admin-config'], (old) =>
        old?.map((c) => (c.key === updated.key ? updated : c)) ?? []
      );
      toast.success(`"${updated.key}" saved`);
      setSavingKey(null);
      setEditing(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setSavingKey(null);
    },
  });

  const configMap = useMemo(
    () => new Map(configs?.map((c) => [c.key, c]) ?? []),
    [configs],
  );

  // resolve prompt value: prefer DB, fall back to bundled default
  const resolveValue = (def: PromptDef) =>
    (configMap.get(def.key)?.value as string | undefined) ?? def.defaultText;

  const sorted = useMemo(() => {
    return [...PROMPT_DEFINITIONS].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'id') {
        cmp = a.id - b.id;
      } else if (sortKey === 'prompt') {
        cmp = (configMap.get(a.key)?.value as string ?? a.defaultText)
          .localeCompare(configMap.get(b.key)?.value as string ?? b.defaultText);
      } else {
        cmp = String(a[sortKey as keyof PromptDef]).localeCompare(
          String(b[sortKey as keyof PromptDef]),
        );
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [sortKey, sortDir, configMap]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const thClass =
    'px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide ' +
    'cursor-pointer select-none hover:text-foreground whitespace-nowrap';

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <>
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {SORTABLE_COLS.map(({ key, label }) => (
                <th key={key} className={thClass} onClick={() => toggleSort(key)}>
                  {label}
                  <SortIcon active={sortKey === key} dir={sortDir} />
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((prompt) => {
              const promptText = resolveValue(prompt);
              return (
                <tr key={prompt.key} className="hover:bg-muted/30 transition-colors align-top">
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{prompt.id}</td>
                  <td className="px-3 py-2.5 font-medium whitespace-nowrap">{prompt.name}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{prompt.variable}</td>
                  <td className="px-3 py-2.5"><TypeBadge type={prompt.type} /></td>
                  <td className="px-3 py-2.5 max-w-[200px]">
                    <ExpandableText text={prompt.description} maxChars={60} />
                  </td>
                  <td className="px-3 py-2.5 max-w-[260px]">
                    <ExpandableText text={promptText} maxChars={80} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1"
                      onClick={() => setEditing(prompt)}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDialog
          key={editing.key}
          prompt={editing}
          currentValue={resolveValue(editing)}
          open
          onClose={() => setEditing(null)}
          onSave={(value) => { setSavingKey(editing.key); updateMutation.mutate({ key: editing.key, value }); }}
          isSaving={savingKey === editing.key}
        />
      )}
    </>
  );
}
