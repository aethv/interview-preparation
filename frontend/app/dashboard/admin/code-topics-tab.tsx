'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Plus, Pencil, Trash2, Upload, Link2,
  ChevronLeft, ChevronRight, Search, X, CheckCircle2, AlertCircle, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  codeTopicsApi, CodeTopic, CodeTopicPreview, CodeAIFillResponse,
  PageDiscovery, BrowserPlanStep, BrowserStepStatus, NeedsHumanEvent,
} from '@/lib/api/practice_topics';

// ── Progress sim ───────────────────────────────────────────────────────────────

type ProgressJob = { label: string; status: 'pending' | 'running' | 'done' | 'error' };

const URL_JOBS: ProgressJob[] = [
  { label: 'Launching headless browser (Playwright)', status: 'pending' },
  { label: 'Navigating to page & executing JavaScript', status: 'pending' },
  { label: 'Extracting page text', status: 'pending' },
  { label: 'Extracting problems with GPT', status: 'pending' },
];

const FILE_JOBS: ProgressJob[] = [
  { label: 'Uploading document', status: 'pending' },
  { label: 'Parsing document text', status: 'pending' },
  { label: 'Extracting problems with GPT', status: 'pending' },
];

function useProgressSim(active: boolean, jobs: ProgressJob[]) {
  const [state, setState] = useState<ProgressJob[]>(() => jobs.map(j => ({ ...j })));
  const idxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      setState(jobs.map(j => ({ ...j })));
      idxRef.current = 0;
      return;
    }
    const advance = () => {
      const i = idxRef.current;
      if (i >= jobs.length) return;
      setState(prev => prev.map((j, idx) =>
        idx === i ? { ...j, status: 'running' } : idx < i ? { ...j, status: 'done' } : j
      ));
      idxRef.current = i + 1;
      const delays = [1200, 3500, 800, 0];
      const delay = delays[i] ?? 1000;
      if (delay > 0) timerRef.current = setTimeout(advance, delay);
    };
    advance();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const finish = (error?: boolean) => {
    setState(prev => prev.map((j, idx) => ({
      ...j,
      status: error && idx === idxRef.current - 1 ? 'error' : idx < idxRef.current ? 'done' : j.status,
    })));
  };

  const pct = Math.round((state.filter(j => j.status === 'done').length / jobs.length) * 100);
  return { state, finish, pct };
}

function JobStatusIcon({ status }: { status: ProgressJob['status'] }) {
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />;
  if (status === 'error') return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
  return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />;
}

// ── Review rubric helpers ──────────────────────────────────────────────────────

interface RubricFields {
  expected_complexity: string;
  edge_cases: string;
  common_mistakes: string;
  bonus: string;
}

function parseRubric(raw: string | null): RubricFields {
  if (!raw) return { expected_complexity: '', edge_cases: '', common_mistakes: '', bonus: '' };
  try {
    const obj = JSON.parse(raw);
    return {
      expected_complexity: obj.expected_complexity ?? '',
      edge_cases: Array.isArray(obj.edge_cases) ? obj.edge_cases.join('\n') : (obj.edge_cases ?? ''),
      common_mistakes: Array.isArray(obj.common_mistakes) ? obj.common_mistakes.join('\n') : (obj.common_mistakes ?? ''),
      bonus: Array.isArray(obj.bonus) ? obj.bonus.join('\n') : (obj.bonus ?? ''),
    };
  } catch {
    return { expected_complexity: '', edge_cases: '', common_mistakes: '', bonus: '' };
  }
}

function serializeRubric(fields: RubricFields): string | null {
  if (!fields.expected_complexity && !fields.edge_cases && !fields.common_mistakes && !fields.bonus) return null;
  return JSON.stringify({
    expected_complexity: fields.expected_complexity,
    edge_cases: fields.edge_cases.split('\n').filter(Boolean),
    common_mistakes: fields.common_mistakes.split('\n').filter(Boolean),
    bonus: fields.bonus.split('\n').filter(Boolean),
  });
}

function parseHints(raw: string | null): string {
  if (!raw) return '';
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.join('\n') : raw;
  } catch {
    return raw;
  }
}

function serializeHints(text: string): string | null {
  if (!text.trim()) return null;
  return JSON.stringify(text.split('\n').filter(Boolean));
}

// ── CodeTopicFormDialog ────────────────────────────────────────────────────────

type TopicFormState = Omit<CodeTopic, 'id' | 'created_at' | 'updated_at'>;

function CodeTopicFormDialog({
  open, onClose, initial, categories, difficulties, languageOptions,
}: {
  open: boolean;
  onClose: () => void;
  initial: CodeTopic | null;
  categories: string[];
  difficulties: string[];
  languageOptions: string[];
}) {
  const qc = useQueryClient();
  const rubricInit = parseRubric(initial?.review_rubric ?? null);
  const hintsInit = parseHints(initial?.discussion_hints ?? null);

  const [form, setForm] = useState<TopicFormState>({
    title: initial?.title ?? '',
    category: initial?.category ?? (categories[0] ?? ''),
    difficulty: initial?.difficulty ?? 'Mid',
    languages: initial?.languages ?? 'any',
    problem_statement: initial?.problem_statement ?? '',
    discussion_hints: initial?.discussion_hints ?? null,
    review_rubric: initial?.review_rubric ?? null,
    reference_solution: initial?.reference_solution ?? null,
    source: initial?.source ?? null,
    is_active: initial?.is_active ?? true,
  });

  const [hintsText, setHintsText] = useState(hintsInit);
  const [rubric, setRubric] = useState<RubricFields>(rubricInit);
  const [aiFilling, setAiFilling] = useState(false);
  const [pastedImage, setPastedImage] = useState<string | null>(null);

  const set = (k: keyof TopicFormState) => (v: string | boolean | null) =>
    setForm(f => ({ ...f, [k]: v }));

  // Capture Ctrl+V image paste while dialog is open
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
      if (!item) return;
      const blob = item.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = (reader.result as string).split(',')[1];
        setPastedImage(b64);
        toast.success('Screenshot pasted — click AI Fill to extract all fields');
      };
      reader.readAsDataURL(blob);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open]);

  const handleAiFill = async () => {
    setAiFilling(true);
    try {
      if (pastedImage) {
        // Vision path — extract ALL fields from screenshot
        const result = await codeTopicsApi.aiFillFromImage(pastedImage);
        if (result.title) set('title')(result.title);
        if (result.category) set('category')(result.category);
        if (result.difficulty) set('difficulty')(result.difficulty);
        if (result.languages) set('languages')(result.languages);
        if (result.problem_statement) set('problem_statement')(result.problem_statement);
        if (result.discussion_hints) setHintsText(parseHints(result.discussion_hints));
        if (result.review_rubric) setRubric(parseRubric(result.review_rubric));
        if (result.reference_solution) set('reference_solution')(result.reference_solution);
        setPastedImage(null);
        toast.success('AI filled all fields from screenshot');
      } else {
        // Text path — use title + category + difficulty
        if (!form.title) { toast.error('Enter a title first'); setAiFilling(false); return; }
        const result: CodeAIFillResponse = await codeTopicsApi.aiFill(
          form.title, form.category, form.difficulty, form.languages,
        );
        if (result.problem_statement) set('problem_statement')(result.problem_statement);
        if (result.discussion_hints) setHintsText(parseHints(result.discussion_hints));
        if (result.review_rubric) setRubric(parseRubric(result.review_rubric));
        if (result.reference_solution) set('reference_solution')(result.reference_solution);
        toast.success('AI filled the topic fields');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'AI fill failed');
    } finally {
      setAiFilling(false);
    }
  };

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        discussion_hints: serializeHints(hintsText),
        review_rubric: serializeRubric(rubric),
      };
      return initial
        ? codeTopicsApi.update(initial.id, payload)
        : codeTopicsApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['code-topics'] });
      toast.success(initial ? 'Topic updated' : 'Topic created');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = form.title && form.category && form.difficulty && form.problem_statement;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col">
        <DialogHeader className="pb-0">
          <div className="flex items-center justify-between pr-6 gap-3">
            <div>
              <DialogTitle>{initial ? 'Edit Code Topic' : 'Add Code Topic'}</DialogTitle>
              {!pastedImage && (
                <p className="text-xs text-muted-foreground mt-0.5">Tip: paste a screenshot (Ctrl+V) then click AI Fill to auto-extract all fields</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {pastedImage && (
                <div className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/jpeg;base64,${pastedImage}`} alt="Pasted screenshot" className="h-10 w-auto rounded border object-contain" />
                  <button
                    onClick={() => setPastedImage(null)}
                    className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                  <div className="absolute -bottom-5 left-0 text-[10px] text-purple-600 whitespace-nowrap">screenshot ready</div>
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleAiFill}
                disabled={(!form.title && !pastedImage) || aiFilling}
                className="gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50 hover:text-purple-700"
                title={pastedImage ? 'Extract all fields from pasted screenshot' : 'Fill fields with AI (paste a screenshot first for best results)'}
              >
                {aiFilling
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="h-3.5 w-3.5" />}
                AI Fill{pastedImage ? ' (image)' : ''}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="basic" className="space-y-4">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="problem">Problem</TabsTrigger>
              <TabsTrigger value="hints">Hints</TabsTrigger>
              <TabsTrigger value="rubric">Rubric</TabsTrigger>
              <TabsTrigger value="solution">Solution</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 px-1">
              <div className="space-y-1">
                <label className="text-xs font-medium">Title *</label>
                <Input value={form.title} onChange={e => set('title')(e.target.value)} placeholder="e.g. Two Sum, LRU Cache" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Category *</label>
                  <Select value={form.category} onValueChange={v => set('category')(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Difficulty *</label>
                  <Select value={form.difficulty} onValueChange={v => set('difficulty')(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {difficulties.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Languages</label>
                <Input value={form.languages} onChange={e => set('languages')(e.target.value)} placeholder="python,javascript or any" />
                <p className="text-xs text-muted-foreground">Comma-separated or &quot;any&quot;</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Source URL</label>
                <Input value={form.source ?? ''} onChange={e => set('source')(e.target.value || null)} placeholder="https://leetcode.com/problems/…" />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="code_is_active"
                  checked={form.is_active}
                  onCheckedChange={v => set('is_active')(!!v)}
                />
                <label htmlFor="code_is_active" className="text-xs font-medium cursor-pointer">Active</label>
              </div>
            </TabsContent>

            <TabsContent value="problem" className="px-1">
              <div className="space-y-1">
                <label className="text-xs font-medium">Problem Statement *</label>
                <Textarea
                  value={form.problem_statement}
                  onChange={e => set('problem_statement')(e.target.value)}
                  rows={14}
                  className="font-mono text-xs"
                  placeholder="Full problem description with constraints and examples…"
                />
              </div>
            </TabsContent>

            <TabsContent value="hints" className="px-1">
              <div className="space-y-1">
                <label className="text-xs font-medium">Discussion Hints</label>
                <p className="text-xs text-muted-foreground">One hint per line — the agent asks these to guide the candidate.</p>
                <Textarea
                  value={hintsText}
                  onChange={e => setHintsText(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                  placeholder={"What is the brute force approach?\nCan we use a hash map here?\nWhat edge cases should we consider?"}
                />
              </div>
            </TabsContent>

            <TabsContent value="rubric" className="space-y-3 px-1">
              <div className="space-y-1">
                <label className="text-xs font-medium">Expected Complexity</label>
                <Input
                  value={rubric.expected_complexity}
                  onChange={e => setRubric(r => ({ ...r, expected_complexity: e.target.value }))}
                  placeholder="e.g. O(n) time, O(1) space"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Edge Cases <span className="text-muted-foreground font-normal">(one per line)</span></label>
                <Textarea
                  value={rubric.edge_cases}
                  onChange={e => setRubric(r => ({ ...r, edge_cases: e.target.value }))}
                  rows={4}
                  className="font-mono text-xs"
                  placeholder={"Empty array\nDuplicate elements\nNegative numbers"}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Common Mistakes <span className="text-muted-foreground font-normal">(one per line)</span></label>
                <Textarea
                  value={rubric.common_mistakes}
                  onChange={e => setRubric(r => ({ ...r, common_mistakes: e.target.value }))}
                  rows={4}
                  className="font-mono text-xs"
                  placeholder={"Off-by-one errors\nNot handling overflow\nO(n²) instead of O(n)"}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Bonus Criteria <span className="text-muted-foreground font-normal">(one per line)</span></label>
                <Textarea
                  value={rubric.bonus}
                  onChange={e => setRubric(r => ({ ...r, bonus: e.target.value }))}
                  rows={3}
                  className="font-mono text-xs"
                  placeholder={"Discusses trade-offs\nMentions follow-up improvements"}
                />
              </div>
            </TabsContent>

            <TabsContent value="solution" className="px-1">
              <div className="space-y-1">
                <label className="text-xs font-medium">Reference Solution</label>
                <p className="text-xs text-muted-foreground">Never shown to candidate — used by the agent during REVIEW phase only.</p>
                <Textarea
                  value={form.reference_solution ?? ''}
                  onChange={e => set('reference_solution')(e.target.value || null)}
                  rows={16}
                  className="font-mono text-xs"
                  placeholder="def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        …"
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {initial ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ImportDialog ──────────────────────────────────────────────────────────────

type ImportMode = 'url' | 'file';
type ImportStep = 'input' | 'discovering' | 'needs_human' | 'confirm_discovery' | 'loading' | 'preview' | 'importing' | 'done';
type EditablePreview = CodeTopicPreview & { _idx: number };

function CodeImportDialog({
  open, onClose, categories, difficulties,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  difficulties: string[];
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<ImportMode>('url');
  const [step, setStep] = useState<ImportStep>('input');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [instructions, setInstructions] = useState('');
  const [rows, setRows] = useState<EditablePreview[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [discovery, setDiscovery] = useState<PageDiscovery | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [planSteps, setPlanSteps] = useState<BrowserStepStatus[]>([]);
  const [needsHuman, setNeedsHuman] = useState<NeedsHumanEvent | null>(null);
  const [humanInstruction, setHumanInstruction] = useState('');
  const [cookies, setCookies] = useState('');
  const [showCookies, setShowCookies] = useState(false);
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const isLoading = step === 'loading' || step === 'discovering';
  const jobDefs = mode === 'url' ? URL_JOBS : FILE_JOBS;
  const prog = useProgressSim(isLoading, jobDefs);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const reset = () => {
    setStep('input'); setUrl(''); setFile(null); setInstructions('');
    setRows([]); setSelected(new Set()); setResult(null);
    setUploadProgress(0); setExpandedRow(null); setLogs([]);
    setDiscovery(null); setSelectedItems(new Set());
    setPlanSteps([]); setNeedsHuman(null); setHumanInstruction('');
    setCookies(''); setShowCookies(false); setLiveScreenshot(null);
    sessionIdRef.current = null;
  };

  const handleClose = () => { reset(); onClose(); };
  const appendLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const discover = async () => {
    if (!url) return;
    setLogs([]);
    setPlanSteps([]);
    setNeedsHuman(null);
    sessionIdRef.current = null;
    setStep('discovering');
    try {
      const data = await codeTopicsApi.discoverStream(
        url,
        undefined,
        cookies || undefined,
        appendLog,
        (steps, reasoning) => {
          appendLog(`→ ${reasoning}`);
          setPlanSteps(steps.map(s => ({ ...s, status: 'pending' })));
        },
        (index, status, description, error, screenshot_b64) => {
          setPlanSteps(prev => prev.map((s, i) => i === index ? { ...s, status, error, screenshot_b64 } : s));
          if (status === 'running') appendLog(`→ ${description}`);
          else if (status === 'done') appendLog(`✓ ${description}`);
          else if (status === 'failed') appendLog(`✗ ${description}${error ? `: ${error}` : ''}`);
          else if (status === 'skipped') appendLog(`⤼ ${description} (skipped)`);
        },
        (sessionId) => { sessionIdRef.current = sessionId; },
        (event) => { setNeedsHuman(event); setLiveScreenshot(event.screenshot_b64); },
        () => { setNeedsHuman(null); },
        (sc) => setLiveScreenshot(sc),
      );
      setDiscovery(data);
      // If the discover phase already extracted form fields inline, skip to preview directly
      if (data.form_data && data.form_data.length > 0) {
        appendLog(`✓ Inline extraction complete — ${data.form_data.length} problem(s) ready, skipping second browser`);
        const editable = (data.form_data as CodeTopicPreview[]).map((p, i) => ({ ...p, _idx: i }));
        setRows(editable);
        setSelected(new Set(editable.map(r => r._idx)));
        setStep('preview');
      } else {
        setSelectedItems(new Set(data.items.map((_, i) => i)));
        setStep('confirm_discovery');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Discovery failed');
      setStep('input');
    }
  };

  const sendFeedback = async () => {
    if (!sessionIdRef.current || !needsHuman) return;
    const instr = humanInstruction.trim() || needsHuman.gpt_suggestion;
    setHumanInstruction('');
    try {
      await codeTopicsApi.sendDiscoverFeedback(sessionIdRef.current, instr);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to send instruction');
    }
  };

  const buildExtractionParams = () => {
    if (!discovery || discovery.page_type !== 'list' || selectedItems.size === 0) {
      return { finalInstructions: instructions, itemUrls: [] as string[] };
    }
    const chosen = discovery.items.filter((_, i) => selectedItems.has(i));
    // Collect resolved individual URLs where available
    const itemUrls = chosen.map(it => it.url).filter((u): u is string => !!u);
    // Build instruction list for GPT (still useful even when URLs are present)
    const itemList = chosen.map(it => `- ${it.identifier ? `${it.identifier}. ` : ''}${it.title}`).join('\n');
    const base = instructions ? `${instructions}\n\n` : '';
    const finalInstructions = `${base}Extract ONLY these specific problems (${chosen.length} selected):\n${itemList}`;
    return { finalInstructions, itemUrls };
  };

  const extract = async () => {
    setStep('loading');
    appendLog('─────────────────────────────');
    const { finalInstructions, itemUrls } = mode === 'url' ? buildExtractionParams() : { finalInstructions: instructions, itemUrls: [] as string[] };
    try {
      let items: CodeTopicPreview[];
      if (mode === 'url') {
        if (itemUrls.length > 0) {
          appendLog(`→ Crawling ${itemUrls.length} individual problem page(s)…`);
        }
        items = await codeTopicsApi.extractFromUrlStream(url, finalInstructions || undefined, itemUrls, appendLog);
      } else {
        appendLog('→ Uploading document…');
        items = await codeTopicsApi.extractFromFile(file!, instructions || undefined, p => {
          setUploadProgress(p);
          if (p === 100) appendLog('✓ Upload complete — parsing document…');
        });
        appendLog(`✓ Extracted ${items.length} problem(s)`);
      }
      prog.finish();
      await new Promise(r => setTimeout(r, 300));
      const editable = items.map((p, i) => ({ ...p, _idx: i }));
      setRows(editable);
      setSelected(new Set(editable.map(r => r._idx)));
      setStep('preview');
    } catch (e: unknown) {
      prog.finish(true);
      toast.error(e instanceof Error ? e.message : 'Extraction failed');
      setStep('input');
    }
  };

  const updateRow = (idx: number, patch: Partial<CodeTopicPreview>) => {
    setRows(prev => prev.map(r => r._idx === idx ? { ...r, ...patch } : r));
  };

  const confirmImport = async () => {
    setStep('importing');
    const toImport = rows.filter(r => selected.has(r._idx));
    try {
      const r = await codeTopicsApi.confirmImport(toImport);
      setResult(r);
      setStep('done');
      qc.invalidateQueries({ queryKey: ['code-topics'] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
      setStep('preview');
    }
  };

  const toggleAll = () => {
    setSelected(selected.size === rows.length ? new Set() : new Set(rows.map(r => r._idx)));
  };

  const toggle = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setSelected(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={`max-w-4xl max-h-[95vh] flex flex-col transition-all duration-300`}>
        <DialogHeader>
          <DialogTitle>Import Code Topics</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">

          {step === 'input' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button size="sm" variant={mode === 'url' ? 'default' : 'outline'} onClick={() => setMode('url')}>
                  <Link2 className="h-3 w-3 mr-1" /> URL
                </Button>
                <Button size="sm" variant={mode === 'file' ? 'default' : 'outline'} onClick={() => setMode('file')}>
                  <Upload className="h-3 w-3 mr-1" /> File
                </Button>
              </div>

              {mode === 'url' ? (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Page URL to crawl</label>
                    <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://leetcode.com/problems/two-sum/…" />
                  </div>
                  {/* Cookie injection for sites with bot protection */}
                  <div>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      onClick={() => setShowCookies(v => !v)}
                    >
                      <span>{showCookies ? '▾' : '▸'}</span>
                      Paste cookies to bypass login / bot protection
                      {cookies && <span className="ml-1 text-green-600">✓</span>}
                    </button>
                    {showCookies && (
                      <div className="mt-1.5 space-y-1">
                        <Textarea
                          value={cookies}
                          onChange={e => setCookies(e.target.value)}
                          rows={3}
                          className="text-xs font-mono"
                          placeholder={'Paste cookies here — Netscape format, JSON array, or name=value; name2=value2\n\nGet from: DevTools → Application → Cookies → right-click → Copy all'}
                        />
                        <p className="text-xs text-muted-foreground">
                          Cookies are sent directly to Playwright and never stored.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Upload document (PDF, DOCX, TXT)</label>
                  <Input type="file" accept=".pdf,.docx,.txt,.md" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium">
                  Extraction instructions <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Textarea
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  rows={4}
                  className="text-xs font-mono"
                  placeholder={"Examples:\n• Extract as a single problem\n• Fill discussion_hints with 3-4 clarifying questions\n• Set difficulty to Senior for this LeetCode Hard"}
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                {mode === 'url' ? (
                  <Button onClick={() => discover()} disabled={!url}>
                    <Search className="h-3.5 w-3.5 mr-1.5" /> Discover
                  </Button>
                ) : (
                  <Button onClick={extract} disabled={!file}>
                    Extract Problems
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}

          {step === 'discovering' && (
            <div className="flex flex-col gap-3">
              {/* URL + instructions recap */}
              <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground shrink-0">URL</span>
                  <span className="text-xs font-mono truncate text-foreground">{url}</span>
                </div>
                {instructions && (
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground shrink-0 mt-px">Instructions</span>
                    <span className="text-xs text-muted-foreground line-clamp-2">{instructions}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-4 min-h-[460px]">
                {/* Left: log */}
                <div className="flex flex-col gap-2 w-64 shrink-0">
                  <div className="flex items-center gap-2">
                    {needsHuman
                      ? <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
                      : <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                    <p className="text-sm font-medium">{needsHuman ? 'Waiting for instruction…' : 'Browsing page…'}</p>
                  </div>
                  <div className="rounded-md border bg-muted/40 overflow-hidden flex-1 flex flex-col">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/60 shrink-0">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs font-medium text-muted-foreground">Live log</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-xs">
                      {logs.length === 0 && <p className="text-muted-foreground/60 italic">Starting…</p>}
                      {logs.map((line, i) => (
                        <div key={i} className={`leading-relaxed ${line.startsWith('✗') ? 'text-destructive' : line.startsWith('✓') ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                          {line}
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  </div>
                </div>

                {/* Right: live screenshot */}
                <div className="flex-1 flex flex-col gap-2 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs font-medium text-muted-foreground">Live browser view</span>
                  </div>
                  <div className="rounded-md border overflow-hidden bg-muted/30 flex-1 flex items-center justify-center">
                    {liveScreenshot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`data:image/jpeg;base64,${liveScreenshot}`} alt="Live browser" className="w-full h-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground/50 p-4">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <p className="text-xs text-center">Screenshot appears after first action</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Needs-human panel — shown inline below, doesn't hide the view above */}
              {needsHuman && (
                <div className="rounded-md border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-950/20 p-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">Browser needs help</p>
                    <p className="text-xs text-muted-foreground">{needsHuman.message}</p>
                  </div>
                  <div className="flex gap-2 items-start">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 text-purple-500 shrink-0" />
                        <label className="text-xs font-medium">Instruction — edit if needed, then continue</label>
                      </div>
                      <Textarea
                        value={humanInstruction}
                        onChange={e => setHumanInstruction(e.target.value)}
                        rows={2}
                        className="text-xs font-mono"
                        placeholder={needsHuman.gpt_suggestion}
                      />
                      {!humanInstruction && (
                        <button className="text-xs text-purple-600 hover:underline" onClick={() => setHumanInstruction(needsHuman.gpt_suggestion)}>
                          Use GPT suggestion
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 pt-5 shrink-0">
                      <Button size="sm" onClick={sendFeedback}>Continue</Button>
                      <Button size="sm" variant="outline" onClick={() => { setNeedsHuman(null); setStep('input'); }}>Cancel</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'confirm_discovery' && discovery && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="text-sm font-semibold">{discovery.page_title}</p>
                <p className="text-xs text-muted-foreground">{discovery.description}</p>
                {discovery.page_type === 'list' && (
                  <p className="text-xs text-primary font-medium">
                    {selectedItems.size} / {discovery.items.length} problem{discovery.items.length !== 1 ? 's' : ''} selected
                  </p>
                )}
              </div>

              {discovery.page_type === 'list' && discovery.items.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">Select problems to extract</label>
                    <Button size="sm" variant="ghost" className="h-6 text-xs"
                      onClick={() => setSelectedItems(
                        selectedItems.size === discovery.items.length
                          ? new Set()
                          : new Set(discovery.items.map((_, i) => i))
                      )}>
                      {selectedItems.size === discovery.items.length ? 'Deselect all' : 'Select all'}
                    </Button>
                  </div>
                  <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                    {discovery.items.map((item, i) => (
                      <label key={i} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedItems.has(i)}
                          onChange={() => {
                            const next = new Set(selectedItems);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            setSelectedItems(next);
                          }}
                          className="rounded"
                        />
                        <span className="text-xs flex-1 min-w-0">
                          {item.identifier && <span className="text-muted-foreground mr-1">{item.identifier}.</span>}
                          <span className="font-medium">{item.title}</span>
                          {item.difficulty && (
                            <span className={`ml-2 text-xs font-semibold ${item.difficulty.toLowerCase().includes('easy') ? 'text-green-600' : item.difficulty.toLowerCase().includes('hard') ? 'text-red-500' : 'text-yellow-600'}`}>
                              {item.difficulty}
                            </span>
                          )}
                          {item.url
                            ? <span className="ml-2 text-[10px] text-green-600 font-mono">✓ link</span>
                            : <span className="ml-2 text-[10px] text-muted-foreground/50">no link</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                  {(() => {
                    const withUrl = discovery.items.filter(it => it.url).length;
                    return withUrl > 0 ? (
                      <p className="text-xs text-green-600">
                        {withUrl}/{discovery.items.length} problems have direct links — those will be crawled individually for full content.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No direct problem links found — GPT will extract from the list page text.
                      </p>
                    );
                  })()}
                </div>
              )}

              {discovery.page_type === 'single' && (
                <p className="text-sm text-muted-foreground">This appears to be a single problem page — it will be extracted directly.</p>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium">Additional instructions <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Textarea
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  rows={3}
                  className="text-xs font-mono"
                  placeholder="e.g. Set difficulty to Senior for Hard problems"
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setStep('input')}>Back</Button>
                <Button
                  onClick={() => extract()}
                  disabled={discovery.page_type === 'list' && selectedItems.size === 0}
                >
                  {(() => {
                    if (discovery.page_type !== 'list' || selectedItems.size === 0) return 'Extract Problem';
                    const chosen = discovery.items.filter((_, i) => selectedItems.has(i));
                    const withUrl = chosen.filter(it => it.url).length;
                    const label = `${selectedItems.size} Problem${selectedItems.size !== 1 ? 's' : ''}`;
                    return withUrl > 0 ? `Crawl & Extract ${label}` : `Extract ${label}`;
                  })()}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'loading' && (
            <div className="flex flex-col gap-3 py-2 px-1">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                <span className="text-sm font-medium">
                  {mode === 'url' ? 'Extracting problems with GPT…' : 'Processing document…'}
                </span>
              </div>

              {mode === 'file' && uploadProgress > 0 && uploadProgress < 100 && (
                <p className="text-xs text-muted-foreground">Upload: {uploadProgress}%</p>
              )}

              {/* Full continuous log — includes discovery context + extract progress */}
              <div className="rounded-md border bg-muted/40 overflow-hidden flex-1">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/60 shrink-0">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs font-medium text-muted-foreground">Live log</span>
                </div>
                <div className="h-[420px] overflow-y-auto p-3 space-y-0.5 font-mono text-xs">
                  {logs.length === 0 && <p className="text-muted-foreground/60 italic">Waiting for first event…</p>}
                  {logs.map((line, i) => (
                    <div key={i} className={`leading-relaxed ${line.startsWith('✗') ? 'text-destructive' :
                        line.startsWith('✓') ? 'text-green-600 dark:text-green-400' :
                          line === '─────────────────────────────' ? 'text-muted-foreground/30 py-1' :
                            'text-foreground'
                      }`}>
                      {line}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Found <strong>{rows.length}</strong> problem(s) · <strong>{selected.size}</strong> selected
                </p>
                <Button size="sm" variant="ghost" onClick={toggleAll}>
                  {selected.size === rows.length ? 'Deselect all' : 'Select all'}
                </Button>
              </div>

              <div className="border rounded-md overflow-auto max-h-[65vh]">
                <table className="w-full text-xs border-collapse" style={{ minWidth: '800px' }}>
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr>
                      <th className="w-8 px-2 py-2 text-left border-b"></th>
                      <th className="w-44 px-2 py-2 text-left border-b font-medium">Title</th>
                      <th className="w-32 px-2 py-2 text-left border-b font-medium">Category</th>
                      <th className="w-24 px-2 py-2 text-left border-b font-medium">Difficulty</th>
                      <th className="w-24 px-2 py-2 text-left border-b font-medium">Languages</th>
                      <th className="min-w-[250px] px-2 py-2 text-left border-b font-medium">Problem (truncated)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const expanded = expandedRow === r._idx;
                      return (
                        <tr key={r._idx} className="border-b last:border-0 align-top">
                          <td className="px-2 py-2">
                            <Checkbox checked={selected.has(r._idx)} onCheckedChange={() => toggle(r._idx)} />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={r.title}
                              onChange={e => updateRow(r._idx, { title: e.target.value })}
                              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <select
                              value={r.category}
                              onChange={e => updateRow(r._idx, { category: e.target.value })}
                              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background"
                            >
                              {categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <select
                              value={r.difficulty}
                              onChange={e => updateRow(r._idx, { difficulty: e.target.value })}
                              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background"
                            >
                              {difficulties.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={r.languages}
                              onChange={e => updateRow(r._idx, { languages: e.target.value })}
                              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background"
                            />
                          </td>
                          <td className="px-1 py-1">
                            {!expanded ? (
                              <>
                                <p className="line-clamp-2 text-xs text-muted-foreground">{r.problem_statement}</p>
                                <button
                                  className="mt-0.5 text-xs text-primary hover:underline"
                                  onClick={() => setExpandedRow(r._idx)}
                                >
                                  ▼ expand &amp; edit all fields
                                </button>
                              </>
                            ) : (
                              <div className="space-y-2">
                                <button
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => setExpandedRow(null)}
                                >
                                  ▲ collapse
                                </button>
                                <div className="space-y-1">
                                  <p className="text-xs font-medium">Problem Statement</p>
                                  <textarea
                                    value={r.problem_statement}
                                    onChange={e => updateRow(r._idx, { problem_statement: e.target.value })}
                                    rows={5}
                                    className="w-full resize-none rounded border bg-background px-2 py-1 text-xs font-mono focus:outline-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs font-medium">Discussion Hints (JSON)</p>
                                  <textarea
                                    value={r.discussion_hints ?? ''}
                                    onChange={e => updateRow(r._idx, { discussion_hints: e.target.value || null })}
                                    rows={3}
                                    className="w-full resize-none rounded border bg-background px-2 py-1 text-xs font-mono focus:outline-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs font-medium">Review Rubric (JSON)</p>
                                  <textarea
                                    value={r.review_rubric ?? ''}
                                    onChange={e => updateRow(r._idx, { review_rubric: e.target.value || null })}
                                    rows={3}
                                    className="w-full resize-none rounded border bg-background px-2 py-1 text-xs font-mono focus:outline-none"
                                  />
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(discovery ? 'confirm_discovery' : 'input')}>Back</Button>
                <Button onClick={confirmImport} disabled={selected.size === 0}>
                  Import {selected.size} problem{selected.size !== 1 ? 's' : ''}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm text-muted-foreground">Saving problems…</p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <div className="text-center">
                <p className="font-semibold">Import complete</p>
                <p className="text-sm text-muted-foreground">{result.imported} imported</p>
              </div>
              <Button onClick={handleClose}>Done</Button>
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

type SortKey = 'title' | 'category' | 'difficulty' | 'languages';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <span className="ml-1 text-muted-foreground/30">↕</span>;
  return <span className="ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span>;
}

const DIFF_ORDER: Record<string, number> = { Beginner: 0, Mid: 1, Senior: 2 };
const DIFF_BADGE: Record<string, string> = {
  Beginner: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  Mid: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Senior: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
};

// ── Main CodeTopicsTab ─────────────────────────────────────────────────────────

export function CodeTopicsTab() {
  const qc = useQueryClient();
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<CodeTopic | null | 'new'>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'title', dir: 'asc' });
  const [deleting, setDeleting] = useState(false);

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 400);
  }, []);

  const { data: meta } = useQuery({
    queryKey: ['code-topics-meta'],
    queryFn: () => codeTopicsApi.getMeta(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['code-topics', filterCategory, filterDifficulty, debouncedSearch, page],
    queryFn: () => codeTopicsApi.list({
      category: filterCategory || undefined,
      difficulty: filterDifficulty || undefined,
      search: debouncedSearch || undefined,
      page,
      per_page: 50,
    }),
    placeholderData: prev => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => codeTopicsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['code-topics'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const categories = meta?.categories ?? [];
  const difficulties = meta?.difficulties ?? [];
  const languageOptions = meta?.languages ?? [];
  const rawItems = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  // Client-side sort on the current page
  const items = [...rawItems].sort((a, b) => {
    let av: string | number = '';
    let bv: string | number = '';
    if (sort.key === 'difficulty') { av = DIFF_ORDER[a.difficulty] ?? 99; bv = DIFF_ORDER[b.difficulty] ?? 99; }
    else { av = (a[sort.key] ?? '').toLowerCase(); bv = (b[sort.key] ?? '').toLowerCase(); }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1;
    if (av > bv) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleSort = (key: SortKey) => {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const allIds = items.map(t => t.id);
  const allChecked = allIds.length > 0 && allIds.every(id => checkedIds.has(id));
  const someChecked = allIds.some(id => checkedIds.has(id));

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds(prev => { const next = new Set(prev); allIds.forEach(id => next.delete(id)); return next; });
    } else {
      setCheckedIds(prev => new Set([...prev, ...allIds]));
    }
  };

  const toggleOne = (id: number) => {
    setCheckedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const deleteSelected = async () => {
    if (!confirm(`Delete ${checkedIds.size} selected problem(s)?`)) return;
    setDeleting(true);
    const ids = [...checkedIds];
    try {
      await Promise.all(ids.map(id => codeTopicsApi.delete(id)));
      setCheckedIds(new Set());
      qc.invalidateQueries({ queryKey: ['code-topics'] });
      toast.success(`Deleted ${ids.length} problem(s)`);
    } catch {
      toast.error('Some deletions failed');
    } finally {
      setDeleting(false);
    }
  };

  const Th = ({ col, children, className = '' }: { col: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      className={`px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground whitespace-nowrap ${className}`}
      onClick={() => toggleSort(col)}
    >
      {children}<SortIcon col={col} sort={sort} />
    </th>
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search problems…"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            className="pl-8 h-9"
          />
          {search && (
            <button className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => { setSearch(''); setDebouncedSearch(''); }}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select value={filterCategory || 'all'} onValueChange={v => { setFilterCategory(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterDifficulty || 'all'} onValueChange={v => { setFilterDifficulty(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="All levels" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {difficulties.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 ml-auto">
          {checkedIds.size > 0 && (
            <Button size="sm" variant="destructive" onClick={deleteSelected} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
              Delete {checkedIds.size}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Import
          </Button>
          <Button size="sm" onClick={() => setEditTarget('new')}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {total} problem{total !== 1 ? 's' : ''} total
        {checkedIds.size > 0 && <span className="ml-2 text-foreground font-medium">· {checkedIds.size} selected</span>}
      </p>

      {/* Table */}
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 780 }}>
          <thead className="bg-muted/60 sticky top-0 z-10 border-b">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                  ref={(el) => {
                    if (el) (el as any).indeterminate = someChecked && !allChecked;
                  }}
                />
              </th>
              <Th col="category" className="w-36">Category</Th>
              <Th col="difficulty" className="w-24">Level</Th>
              <Th col="languages" className="w-28">Languages</Th>
              <Th col="title" className="w-52">Name</Th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</th>
              <th className="w-20 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">No code topics found. Add your first one or import from a URL.</td></tr>
            ) : items.map(t => (
              <tr
                key={t.id}
                className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${checkedIds.has(t.id) ? 'bg-primary/5' : ''}`}
              >
                <td className="px-3 py-2.5">
                  <Checkbox checked={checkedIds.has(t.id)} onCheckedChange={() => toggleOne(t.id)} aria-label={`Select ${t.title}`} />
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-xs font-mono text-muted-foreground">{t.category}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${DIFF_BADGE[t.difficulty] ?? ''}`}>
                    {t.difficulty}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">{t.languages === 'any' ? '—' : t.languages}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm leading-tight">{t.title}</span>
                    {!t.is_active && <Badge variant="outline" className="text-[10px] py-0 px-1">Off</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2.5 max-w-xs">
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{t.problem_statement}</p>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditTarget(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => { if (confirm('Delete this problem?')) deleteMutation.mutate(t.id); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="icon" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
          <Button size="icon" variant="outline" disabled={page === pages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {editTarget !== null && (
        <CodeTopicFormDialog
          open={true}
          onClose={() => setEditTarget(null)}
          initial={editTarget === 'new' ? null : editTarget}
          categories={categories}
          difficulties={difficulties}
          languageOptions={languageOptions}
        />
      )}
      <CodeImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        categories={categories}
        difficulties={difficulties}
      />
    </div>
  );
}
