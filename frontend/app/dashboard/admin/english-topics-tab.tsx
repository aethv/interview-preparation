'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Plus, Pencil, Trash2, Upload, Link2,
  ChevronLeft, ChevronRight, Search, X, CheckCircle2, AlertCircle, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  englishTopicsApi, EnglishTopic, EnglishTopicPreview, EnglishAIFillResponse,
  PageDiscovery, BrowserPlanStep, BrowserStepStatus, NeedsHumanEvent,
} from '@/lib/api/practice_topics';

// ── Progress sim (shared pattern) ─────────────────────────────────────────────

type ProgressJob = { label: string; status: 'pending' | 'running' | 'done' | 'error' };

const URL_JOBS: ProgressJob[] = [
  { label: 'Launching headless browser (Playwright)',    status: 'pending' },
  { label: 'Navigating to page & executing JavaScript', status: 'pending' },
  { label: 'Extracting page text',                      status: 'pending' },
  { label: 'Extracting topics with GPT',                status: 'pending' },
];

const FILE_JOBS: ProgressJob[] = [
  { label: 'Uploading document',                        status: 'pending' },
  { label: 'Parsing document text',                     status: 'pending' },
  { label: 'Extracting topics with GPT',                status: 'pending' },
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
  if (status === 'done')    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />;
  if (status === 'error')   return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
  return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />;
}

function EditableCell({
  value, onChange, multiline, className,
}: {
  value: string; onChange: (v: string) => void; multiline?: boolean; className?: string;
}) {
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className={`w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background ${className ?? ''}`}
      />
    );
  }
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background ${className ?? ''}`}
    />
  );
}

// ── EnglishTopicFormDialog ─────────────────────────────────────────────────────

type TopicFormState = Omit<EnglishTopic, 'id' | 'created_at' | 'updated_at'>;

function EnglishTopicFormDialog({
  open, onClose, initial, skillFocusOptions, levelOptions,
}: {
  open: boolean;
  onClose: () => void;
  initial: EnglishTopic | null;
  skillFocusOptions: string[];
  levelOptions: string[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<TopicFormState>({
    title: initial?.title ?? '',
    skill_focus: initial?.skill_focus ?? (skillFocusOptions[0] ?? ''),
    level: initial?.level ?? 'Any',
    scenario_prompt: initial?.scenario_prompt ?? '',
    key_vocabulary: initial?.key_vocabulary ?? '',
    evaluation_criteria: initial?.evaluation_criteria ?? '',
    source: initial?.source ?? '',
    is_active: initial?.is_active ?? true,
  });
  const [aiFilling, setAiFilling] = useState(false);

  const set = (k: keyof TopicFormState) => (v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const handleAiFill = async () => {
    if (!form.title) { toast.error('Enter a title first'); return; }
    setAiFilling(true);
    try {
      const result: EnglishAIFillResponse = await englishTopicsApi.aiFill(form.title, form.skill_focus, form.level);
      setForm(f => ({
        ...f,
        scenario_prompt: result.scenario_prompt || f.scenario_prompt,
        key_vocabulary: result.key_vocabulary ?? f.key_vocabulary,
        evaluation_criteria: result.evaluation_criteria ?? f.evaluation_criteria,
      }));
      toast.success('AI filled the topic fields');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'AI fill failed');
    } finally {
      setAiFilling(false);
    }
  };

  const mutation = useMutation({
    mutationFn: () =>
      initial
        ? englishTopicsApi.update(initial.id, form)
        : englishTopicsApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['english-topics'] });
      toast.success(initial ? 'Topic updated' : 'Topic created');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = form.title && form.skill_focus && form.level && form.scenario_prompt;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle>{initial ? 'Edit English Topic' : 'Add English Topic'}</DialogTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAiFill}
              disabled={!form.title || aiFilling}
              className="gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50 hover:text-purple-700"
            >
              {aiFilling
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              AI Fill
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium">Title *</label>
            <Input value={form.title} onChange={e => set('title')(e.target.value)} placeholder="e.g. Describing a memorable trip" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Skill Focus *</label>
              <Select value={form.skill_focus} onValueChange={v => set('skill_focus')(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {skillFocusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Level *</label>
              <Select value={form.level} onValueChange={v => set('level')(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {levelOptions.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Scenario Prompt *</label>
            <Textarea
              value={form.scenario_prompt}
              onChange={e => set('scenario_prompt')(e.target.value)}
              rows={5}
              placeholder="Full prompt the agent uses to open the session…"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Key Vocabulary <span className="text-muted-foreground font-normal">(comma-separated)</span></label>
            <Textarea
              value={form.key_vocabulary ?? ''}
              onChange={e => set('key_vocabulary')(e.target.value)}
              rows={2}
              placeholder="e.g. itinerary, accommodation, breathtaking scenery"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Evaluation Criteria</label>
            <Textarea
              value={form.evaluation_criteria ?? ''}
              onChange={e => set('evaluation_criteria')(e.target.value)}
              rows={2}
              placeholder="e.g. Fluency, vocabulary range, grammatical accuracy"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Source URL</label>
            <Input value={form.source ?? ''} onChange={e => set('source')(e.target.value)} placeholder="https://…" />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_active"
              checked={form.is_active}
              onCheckedChange={v => set('is_active')(!!v)}
            />
            <label htmlFor="is_active" className="text-xs font-medium cursor-pointer">Active</label>
          </div>
        </div>

        <DialogFooter>
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
type EditablePreview = EnglishTopicPreview & { _idx: number };

function EnglishImportDialog({
  open, onClose, skillFocusOptions, levelOptions,
}: {
  open: boolean;
  onClose: () => void;
  skillFocusOptions: string[];
  levelOptions: string[];
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
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
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
    setUploadProgress(0); setExpandedRows(new Set()); setLogs([]);
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
      const data = await englishTopicsApi.discoverStream(
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
      if (data.form_data && data.form_data.length > 0) {
        appendLog(`✓ Inline extraction complete — ${data.form_data.length} topic(s) ready, skipping second browser`);
        const editable = (data.form_data as EnglishTopicPreview[]).map((p, i) => ({ ...p, _idx: i }));
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
      await englishTopicsApi.sendDiscoverFeedback(sessionIdRef.current, instr);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to send instruction');
    }
  };

  const buildExtractionParams = () => {
    if (!discovery || discovery.page_type !== 'list' || selectedItems.size === 0) {
      return { finalInstructions: instructions, itemUrls: [] as string[] };
    }
    const chosen = discovery.items.filter((_, i) => selectedItems.has(i));
    const itemUrls = chosen.map(it => it.url).filter((u): u is string => !!u);
    const itemList = chosen.map(it => `- ${it.title}`).join('\n');
    const base = instructions ? `${instructions}\n\n` : '';
    const finalInstructions = `${base}Extract ONLY these specific topics (${chosen.length} selected):\n${itemList}`;
    return { finalInstructions, itemUrls };
  };

  const extract = async () => {
    setStep('loading');
    appendLog('─────────────────────────────');
    const { finalInstructions, itemUrls } = mode === 'url' ? buildExtractionParams() : { finalInstructions: instructions, itemUrls: [] as string[] };
    try {
      let items: EnglishTopicPreview[];
      if (mode === 'url') {
        if (itemUrls.length > 0) appendLog(`→ Crawling ${itemUrls.length} individual page(s)…`);
        items = await englishTopicsApi.extractFromUrlStream(url, finalInstructions || undefined, itemUrls, appendLog);
      } else {
        appendLog('→ Uploading document…');
        items = await englishTopicsApi.extractFromFile(file!, instructions || undefined, p => {
          setUploadProgress(p);
          if (p === 100) appendLog('✓ Upload complete — parsing document…');
        });
        appendLog(`✓ Extracted ${items.length} topic(s)`);
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

  const updateRow = (idx: number, patch: Partial<EnglishTopicPreview>) => {
    setRows(prev => prev.map(r => r._idx === idx ? { ...r, ...patch } : r));
  };

  const confirmImport = async () => {
    setStep('importing');
    const toImport = rows.filter(r => selected.has(r._idx));
    try {
      const r = await englishTopicsApi.confirmImport(toImport);
      setResult(r);
      setStep('done');
      qc.invalidateQueries({ queryKey: ['english-topics'] });
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

  const toggleExpand = (idx: number) => {
    const next = new Set(expandedRows);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setExpandedRows(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={`${step === 'preview' ? 'max-w-[92vw]' : step === 'discovering' ? 'max-w-[85vw]' : 'max-w-4xl'} max-h-[95vh] flex flex-col transition-all duration-300`}>
        <DialogHeader>
          <DialogTitle>Import English Topics</DialogTitle>
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
                  <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://ielts.org/take-a-test/…" />
                </div>
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
                placeholder={`Examples:\n• Set skill_focus to Speaking for all topics\n• Level: IELTS topics = Advanced\n• Extract each topic as a separate entry`}
                className="text-xs font-mono"
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
                  Extract Topics
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

            {/* Needs-human panel — inline below, log + screenshot stay visible */}
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
                  {selectedItems.size} / {discovery.items.length} topic{discovery.items.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {discovery.page_type === 'list' && discovery.items.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">Select topics to extract</label>
                  <Button size="sm" variant="ghost" className="h-6 text-xs"
                    onClick={() => setSelectedItems(
                      selectedItems.size === discovery.items.length
                        ? new Set()
                        : new Set(discovery.items.map((_, i) => i))
                    )}>
                    {selectedItems.size === discovery.items.length ? 'Deselect all' : 'Select all'}
                  </Button>
                </div>
                <div className="border rounded-md divide-y max-h-60 overflow-y-auto">
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
                      <span className="text-xs font-medium flex-1 min-w-0">{item.title}</span>
                      {item.difficulty && (
                        <span className="text-xs text-muted-foreground shrink-0">{item.difficulty}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {discovery.page_type === 'single' && (
              <p className="text-sm text-muted-foreground">This appears to be a single topic page — it will be extracted directly.</p>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium">Additional instructions <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                rows={3}
                className="text-xs font-mono"
                placeholder="e.g. Set skill_focus to Speaking for all topics"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('input')}>Back</Button>
              <Button
                onClick={() => extract()}
                disabled={discovery.page_type === 'list' && selectedItems.size === 0}
              >
                {(() => {
                  if (discovery.page_type !== 'list' || selectedItems.size === 0) return 'Extract Topic';
                  const chosen = discovery.items.filter((_, i) => selectedItems.has(i));
                  const withUrl = chosen.filter(it => it.url).length;
                  const label = `${selectedItems.size} Topic${selectedItems.size !== 1 ? 's' : ''}`;
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
                {mode === 'url' ? 'Extracting topics with GPT…' : 'Processing document…'}
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
                  <div key={i} className={`leading-relaxed ${
                    line.startsWith('✗') ? 'text-destructive' :
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
                Found <strong>{rows.length}</strong> topic(s) · <strong>{selected.size}</strong> selected · all fields editable
              </p>
              <Button size="sm" variant="ghost" onClick={toggleAll}>
                {selected.size === rows.length ? 'Deselect all' : 'Select all'}
              </Button>
            </div>

            <div className="border rounded-md overflow-auto max-h-[65vh]">
              <table className="w-full text-xs border-collapse" style={{ minWidth: '900px' }}>
                <thead className="bg-muted sticky top-0 z-10">
                  <tr>
                    <th className="w-8 px-2 py-2 text-left border-b"></th>
                    <th className="w-40 px-2 py-2 text-left border-b font-medium">Title</th>
                    <th className="w-28 px-2 py-2 text-left border-b font-medium">Skill</th>
                    <th className="w-24 px-2 py-2 text-left border-b font-medium">Level</th>
                    <th className="min-w-[300px] px-2 py-2 text-left border-b font-medium">Scenario Prompt</th>
                    <th className="w-32 px-2 py-2 text-left border-b font-medium">Key Vocab</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const expanded = expandedRows.has(r._idx);
                    return (
                      <tr key={r._idx} className="border-b last:border-0 align-top">
                        <td className="px-2 py-2">
                          <Checkbox checked={selected.has(r._idx)} onCheckedChange={() => toggle(r._idx)} />
                        </td>
                        <td className="px-1 py-1">
                          <EditableCell value={r.title} onChange={v => updateRow(r._idx, { title: v })} />
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={r.skill_focus}
                            onChange={e => updateRow(r._idx, { skill_focus: e.target.value })}
                            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background"
                          >
                            {skillFocusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={r.level}
                            onChange={e => updateRow(r._idx, { level: e.target.value })}
                            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background"
                          >
                            {levelOptions.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <EditableCell
                            value={r.scenario_prompt}
                            onChange={v => updateRow(r._idx, { scenario_prompt: v })}
                            multiline={expanded}
                            className={!expanded ? 'line-clamp-2 cursor-pointer' : ''}
                          />
                          <button
                            className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => toggleExpand(r._idx)}
                          >
                            {expanded ? '▲ collapse' : '▼ expand'}
                          </button>
                          {expanded && (
                            <div className="mt-1 border-t pt-1">
                              <p className="text-xs text-muted-foreground mb-0.5">Evaluation Criteria:</p>
                              <EditableCell
                                value={r.evaluation_criteria ?? ''}
                                onChange={v => updateRow(r._idx, { evaluation_criteria: v || null })}
                                multiline
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <EditableCell
                            value={r.key_vocabulary ?? ''}
                            onChange={v => updateRow(r._idx, { key_vocabulary: v || null })}
                            multiline={expanded}
                          />
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
                Import {selected.size} topic{selected.size !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm text-muted-foreground">Saving topics…</p>
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

// ── Main EnglishTopicsTab ──────────────────────────────────────────────────────

export function EnglishTopicsTab() {
  const qc = useQueryClient();
  const [filterSkill, setFilterSkill] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<EnglishTopic | null | 'new'>(null);
  const [importOpen, setImportOpen] = useState(false);

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 400);
  }, []);

  const { data: meta } = useQuery({
    queryKey: ['english-topics-meta'],
    queryFn: () => englishTopicsApi.getMeta(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['english-topics', filterSkill, filterLevel, debouncedSearch, page],
    queryFn: () => englishTopicsApi.list({
      skill_focus: filterSkill || undefined,
      level: filterLevel || undefined,
      search: debouncedSearch || undefined,
      page,
      per_page: 20,
    }),
    placeholderData: prev => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => englishTopicsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['english-topics'] }); toast.success('Deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const skillFocusOptions = meta?.skill_focus_options ?? [];
  const levelOptions = meta?.level_options ?? [];
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const LEVEL_BADGE: Record<string, string> = {
    Beginner: 'bg-green-100 text-green-800',
    Intermediate: 'bg-blue-100 text-blue-800',
    Advanced: 'bg-purple-100 text-purple-800',
    Any: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search topics…"
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

        <Select value={filterSkill || 'all'} onValueChange={v => { setFilterSkill(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All skills" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All skills</SelectItem>
            {skillFocusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterLevel || 'all'} onValueChange={v => { setFilterLevel(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="All levels" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {levelOptions.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>

        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-3.5 w-3.5 mr-1" /> Import
        </Button>
        <Button size="sm" onClick={() => setEditTarget('new')}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{total} topic{total !== 1 ? 's' : ''} total</p>

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No English topics found. Add your first one or import from a URL.
          </div>
        ) : (
          <div>
            {items.map(t => (
              <div key={t.id} className="border-b last:border-0 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-mono text-muted-foreground">{t.skill_focus}</span>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${LEVEL_BADGE[t.level] ?? ''}`}>{t.level}</span>
                      {!t.is_active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.scenario_prompt}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditTarget(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => { if (confirm('Delete this topic?')) deleteMutation.mutate(t.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
        <EnglishTopicFormDialog
          open={true}
          onClose={() => setEditTarget(null)}
          initial={editTarget === 'new' ? null : editTarget}
          skillFocusOptions={skillFocusOptions}
          levelOptions={levelOptions}
        />
      )}
      <EnglishImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        skillFocusOptions={skillFocusOptions}
        levelOptions={levelOptions}
      />
    </div>
  );
}
