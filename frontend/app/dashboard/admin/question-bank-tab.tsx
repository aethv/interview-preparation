'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Plus, Pencil, Trash2, Upload, Link2, RefreshCw,
  ChevronLeft, ChevronRight, Search, X, CheckCircle2, AlertCircle, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { questionBankApi, Question, QuestionPreview, CreateQuestionBody } from '@/lib/api/question_bank';

// ── helpers ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  new:       { label: 'New',       variant: 'default' },
  similar:   { label: 'Similar',   variant: 'secondary' },
  duplicate: { label: 'Duplicate', variant: 'destructive' },
};

const LEVEL_COLORS: Record<string, string> = {
  Junior: 'text-green-600',
  Mid:    'text-blue-600',
  Senior: 'text-purple-600',
  Any:    'text-muted-foreground',
};

// ── QuestionFormDialog ────────────────────────────────────────────────────────

function QuestionFormDialog({
  open,
  onClose,
  initial,
  categories,
  levels,
}: {
  open: boolean;
  onClose: () => void;
  initial: Question | null;
  categories: string[];
  levels: string[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateQuestionBody>({
    category: initial?.category ?? '',
    subcategory: initial?.subcategory ?? '',
    level: initial?.level ?? 'Mid',
    topic: initial?.topic ?? '',
    question: initial?.question ?? '',
    answer: initial?.answer ?? '',
    source: initial?.source ?? '',
  });

  const set = (k: keyof CreateQuestionBody) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () =>
      initial
        ? questionBankApi.update(initial.id, form)
        : questionBankApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questions'] });
      toast.success(initial ? 'Question updated' : 'Question created');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = form.category && form.level && form.topic && form.question && form.answer;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Question' : 'Add Question'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Category *</label>
              <Select value={form.category} onValueChange={set('category')}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Subcategory</label>
              <Input value={form.subcategory ?? ''} onChange={e => set('subcategory')(e.target.value)} placeholder="e.g. Spring Boot, Kafka" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Level *</label>
              <Select value={form.level} onValueChange={set('level')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {levels.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Topic *</label>
              <Input value={form.topic} onChange={e => set('topic')(e.target.value)} placeholder="e.g. HashMap vs Hashtable" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Question *</label>
            <Textarea value={form.question} onChange={e => set('question')(e.target.value)} rows={3} />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Answer *</label>
            <Textarea value={form.answer} onChange={e => set('answer')(e.target.value)} rows={5} className="font-mono text-sm" />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Source (URL or filename)</label>
            <Input value={form.source ?? ''} onChange={e => set('source')(e.target.value)} placeholder="https://..." />
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
type ImportStep = 'input' | 'loading' | 'preview' | 'importing' | 'done';

type ProgressJob = { label: string; status: 'pending' | 'running' | 'done' | 'error' };

const URL_JOBS: ProgressJob[] = [
  { label: 'Launching headless browser (Playwright)',    status: 'pending' },
  { label: 'Navigating to page & executing JavaScript', status: 'pending' },
  { label: 'Scrolling to load lazy content',            status: 'pending' },
  { label: 'Extracting page text',                      status: 'pending' },
  { label: 'Parsing Q&A with GPT (structured output)',  status: 'pending' },
  { label: 'Checking for duplicates (pgvector)',        status: 'pending' },
];

const FILE_JOBS: ProgressJob[] = [
  { label: 'Uploading document',                       status: 'pending' },
  { label: 'Parsing document text (PDF / DOCX / TXT)', status: 'pending' },
  { label: 'Parsing Q&A with GPT (structured output)', status: 'pending' },
  { label: 'Checking for duplicates (pgvector)',       status: 'pending' },
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
        idx === i ? { ...j, status: 'running' }
          : idx < i  ? { ...j, status: 'done' }
          : j
      ));
      idxRef.current = i + 1;
      // variable delays: early steps faster, GPT step longer
      const delays = [1200, 3500, 1000, 800, 0, 0];
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

type EditablePreview = QuestionPreview & { _idx: number };

const INSTRUCTIONS_PLACEHOLDER = `Examples (technical):
• Focus only on Java Core questions, ignore other topics
• The page has a left menu — click Java, Kiến trúc, Messaging to open each section
• Level: treat questions labelled "cơ bản" as Junior, "nâng cao" as Senior

Examples (English learning):
• Extract vocabulary with example sentences; use category "English Vocabulary"
• This is an IELTS speaking page — set level to Advanced, category to "English Speaking"
• Skip meta text like ads or navigation; only extract exercises and explanations`;

function EditableCell({
  value,
  onChange,
  multiline,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  className?: string;
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

function ImportDialog({
  open,
  onClose,
  categories,
  levels,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  levels: string[];
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

  const isLoading = step === 'loading';
  const jobDefs = mode === 'url' ? URL_JOBS : FILE_JOBS;
  const prog = useProgressSim(isLoading, jobDefs);

  // Auto-scroll log panel when new entries arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const reset = () => {
    setStep('input'); setUrl(''); setFile(null); setInstructions('');
    setRows([]); setSelected(new Set()); setResult(null);
    setUploadProgress(0); setExpandedRows(new Set()); setLogs([]);
  };

  const handleClose = () => { reset(); onClose(); };

  const appendLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const extract = async () => {
    setLogs([]);
    setStep('loading');
    try {
      let items: QuestionPreview[];
      if (mode === 'url') {
        items = await questionBankApi.extractFromUrlStream(url, instructions || undefined, appendLog);
      } else {
        appendLog('→ Uploading document…');
        items = await questionBankApi.extractFromFile(file!, instructions || undefined, p => {
          setUploadProgress(p);
          if (p === 100) appendLog('✓ Upload complete — parsing document…');
        });
        appendLog(`✓ Extracted ${items.length} Q&A pairs`);
      }
      prog.finish();
      await new Promise(r => setTimeout(r, 300));
      const editable = items.map((p, i) => ({ ...p, _idx: i }));
      setRows(editable);
      setSelected(new Set(editable.filter(r => r.status !== 'duplicate').map(r => r._idx)));
      setStep('preview');
    } catch (e: unknown) {
      prog.finish(true);
      toast.error(e instanceof Error ? e.message : 'Extraction failed');
      setStep('input');
    }
  };

  const updateRow = (idx: number, patch: Partial<QuestionPreview>) => {
    setRows(prev => prev.map(r => r._idx === idx ? { ...r, ...patch } : r));
  };

  const confirmImport = async () => {
    setStep('importing');
    const toImport = rows.filter(r => selected.has(r._idx));
    try {
      const r = await questionBankApi.confirmImport(toImport);
      setResult(r);
      setStep('done');
      qc.invalidateQueries({ queryKey: ['questions'] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
      setStep('preview');
    }
  };

  const toggleAll = () => {
    const nonDups = rows.filter(r => r.status !== 'duplicate').map(r => r._idx);
    setSelected(selected.size === nonDups.length ? new Set() : new Set(nonDups));
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
      <DialogContent className={`${step === 'preview' ? 'max-w-[92vw]' : 'max-w-2xl'} max-h-[95vh] flex flex-col transition-all duration-300`}>
        <DialogHeader>
          <DialogTitle>Import Questions</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">

        {/* Step: input */}
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
              <div className="space-y-1">
                <label className="text-xs font-medium">Page URL to crawl</label>
                <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://luyenphongvan.online/..." />
                <p className="text-xs text-muted-foreground">
                  Playwright renders the page (JavaScript executed) then GPT extracts Q&A. For pages with JS navigation menus, describe how to find content in the instructions below.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-medium">Upload document (PDF, DOCX, TXT)</label>
                <Input type="file" accept=".pdf,.docx,.txt,.md" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium">
                Extraction instructions <span className="text-muted-foreground font-normal">(optional — guides the LLM)</span>
              </label>
              <Textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                rows={6}
                placeholder={INSTRUCTIONS_PLACEHOLDER}
                className="text-xs font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Works for any domain — technical interviews, English learning, vocabulary, grammar, etc. Describe what to extract, what to skip, how to interpret levels, and which menu items to click if the page uses JS navigation.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={extract} disabled={(mode === 'url' && !url) || (mode === 'file' && !file)}>
                Extract Q&A
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step: loading */}
        {step === 'loading' && (
          <div className="flex flex-col gap-5 py-6 px-1">
            {/* Header */}
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <span className="text-sm font-medium">
                {mode === 'url' ? 'Crawling page and extracting Q&A…' : 'Processing document…'}
              </span>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{prog.pct}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${prog.pct}%` }}
                />
              </div>
              {mode === 'file' && uploadProgress > 0 && uploadProgress < 100 && (
                <p className="text-xs text-muted-foreground">Upload: {uploadProgress}%</p>
              )}
            </div>

            {/* Live log — real events from server */}
            <div className="rounded-md border bg-muted/40 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/60">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium text-muted-foreground">Live log</span>
              </div>
              <div className="h-48 overflow-y-auto p-3 space-y-1 font-mono text-xs">
                {logs.length === 0 && (
                  <p className="text-muted-foreground/60 italic">Waiting for first event…</p>
                )}
                {logs.map((line, i) => (
                  <div
                    key={i}
                    className={`leading-relaxed ${
                      line.startsWith('✗') ? 'text-destructive'
                      : line.startsWith('✓') ? 'text-green-600 dark:text-green-400'
                      : line.startsWith('⚠') ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-foreground'
                    }`}
                  >
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              This may take 20–60 s. You can close the dialog — import will run in background.
            </p>
          </div>
        )}

        {/* Step: preview — editable table */}
        {step === 'preview' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Found <strong>{rows.length}</strong> questions · <strong>{selected.size}</strong> selected · all fields editable
              </p>
              <Button size="sm" variant="ghost" onClick={toggleAll}>
                {selected.size === rows.filter(r => r.status !== 'duplicate').length ? 'Deselect all' : 'Select new/similar'}
              </Button>
            </div>

            <div className="border rounded-md overflow-auto max-h-[68vh]">
              <table className="w-full text-xs border-collapse" style={{ minWidth: '1100px' }}>
                <thead className="bg-muted sticky top-0 z-10">
                  <tr>
                    <th className="w-8 px-2 py-2 text-left border-b"></th>
                    <th className="w-36 px-2 py-2 text-left border-b font-medium">Category</th>
                    <th className="w-24 px-2 py-2 text-left border-b font-medium">Level</th>
                    <th className="w-44 px-2 py-2 text-left border-b font-medium">Topic</th>
                    <th className="min-w-[280px] px-2 py-2 text-left border-b font-medium">Question</th>
                    <th className="min-w-[280px] px-2 py-2 text-left border-b font-medium">Answer</th>
                    <th className="w-24 px-2 py-2 text-left border-b font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const expanded = expandedRows.has(r._idx);
                    return (
                      <tr
                        key={r._idx}
                        className={`border-b last:border-0 align-top ${r.status === 'duplicate' ? 'opacity-50' : ''}`}
                      >
                        {/* Checkbox */}
                        <td className="px-2 py-2">
                          <Checkbox
                            checked={selected.has(r._idx)}
                            disabled={r.status === 'duplicate'}
                            onCheckedChange={() => toggle(r._idx)}
                          />
                        </td>

                        {/* Category */}
                        <td className="px-1 py-1">
                          <select
                            value={r.category}
                            onChange={e => updateRow(r._idx, { category: e.target.value })}
                            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs focus:border-border focus:outline-none focus:bg-background"
                          >
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input
                            value={r.subcategory ?? ''}
                            onChange={e => updateRow(r._idx, { subcategory: e.target.value || null })}
                            placeholder="subcategory"
                            className="mt-0.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground focus:border-border focus:outline-none focus:bg-background"
                          />
                        </td>

                        {/* Level */}
                        <td className="px-1 py-1">
                          <select
                            value={r.level}
                            onChange={e => updateRow(r._idx, { level: e.target.value })}
                            className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold focus:border-border focus:outline-none focus:bg-background ${LEVEL_COLORS[r.level] ?? ''}`}
                          >
                            {levels.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </td>

                        {/* Topic */}
                        <td className="px-1 py-1">
                          <EditableCell
                            value={r.topic}
                            onChange={v => updateRow(r._idx, { topic: v })}
                          />
                        </td>

                        {/* Question */}
                        <td className="px-1 py-1">
                          <EditableCell
                            value={r.question}
                            onChange={v => updateRow(r._idx, { question: v })}
                            multiline={expanded}
                            className={!expanded ? 'line-clamp-2 cursor-pointer' : ''}
                          />
                          <button
                            className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => toggleExpand(r._idx)}
                          >
                            {expanded ? '▲ collapse' : '▼ expand & edit answer'}
                          </button>
                          {expanded && (
                            <div className="mt-1 border-t pt-1">
                              <p className="text-xs text-muted-foreground mb-0.5">Answer:</p>
                              <EditableCell
                                value={r.answer}
                                onChange={v => updateRow(r._idx, { answer: v })}
                                multiline
                              />
                            </div>
                          )}
                        </td>

                        {/* Answer preview (collapsed) */}
                        <td className="px-1 py-1 text-muted-foreground">
                          {!expanded && (
                            <span className="line-clamp-2">{r.answer}</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-2 py-2">
                          <Badge variant={STATUS_BADGE[r.status].variant} className="text-xs whitespace-nowrap">
                            {STATUS_BADGE[r.status].label}
                            {r.similarity_score != null && ` ${(r.similarity_score * 100).toFixed(0)}%`}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('input')}>Back</Button>
              <Button onClick={confirmImport} disabled={selected.size === 0}>
                Import {selected.size} question{selected.size !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step: importing */}
        {step === 'importing' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm text-muted-foreground">Importing and generating embeddings…</p>
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && result && (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <div className="text-center">
              <p className="font-semibold">Import complete</p>
              <p className="text-sm text-muted-foreground">
                {result.imported} imported · {result.skipped} skipped (duplicates)
              </p>
            </div>
            <Button onClick={handleClose}>Done</Button>
          </div>
        )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── QuestionRow ───────────────────────────────────────────────────────────────

function QuestionRow({
  q,
  onEdit,
  onDelete,
}: {
  q: Question;
  onEdit: (q: Question) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b last:border-0 px-4 py-3 space-y-1">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-mono text-muted-foreground">
              {q.category}{q.subcategory ? ` / ${q.subcategory}` : ''}
            </span>
            <span className={`text-xs font-semibold ${LEVEL_COLORS[q.level] ?? ''}`}>{q.level}</span>
            <span className="text-xs text-muted-foreground">{q.topic}</span>
          </div>
          <p className="text-sm font-medium">{q.question}</p>
          {expanded && (
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{q.answer}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded(e => !e)}>
            <Info className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(q)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(q.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main QuestionBankTab ──────────────────────────────────────────────────────

export function QuestionBankTab() {
  const qc = useQueryClient();
  const [filterCategory, setFilterCategory] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<Question | null | 'new'>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Debounce search
  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 400);
  }, []);

  const { data: meta } = useQuery({
    queryKey: ['questions-meta'],
    queryFn: () => questionBankApi.getMeta(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['questions', filterCategory, filterLevel, debouncedSearch, page],
    queryFn: () => questionBankApi.list({
      category: filterCategory || undefined,
      level: filterLevel || undefined,
      search: debouncedSearch || undefined,
      page,
      per_page: 20,
    }),
    placeholderData: prev => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => questionBankApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['questions'] }); toast.success('Deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const categories = meta?.categories ?? [];
  const levels = meta?.levels ?? [];
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search questions…"
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
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterLevel || 'all'} onValueChange={v => { setFilterLevel(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="All levels" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {levels.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>

        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-3.5 w-3.5 mr-1" /> Import
        </Button>
        <Button size="sm" onClick={() => setEditTarget('new')}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">{total} question{total !== 1 ? 's' : ''} total</p>

      {/* List */}
      <Card>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No questions found. Add your first one or import from a URL/document.
          </div>
        ) : (
          <div>
            {items.map(q => (
              <QuestionRow
                key={q.id}
                q={q}
                onEdit={q => setEditTarget(q)}
                onDelete={id => { if (confirm('Delete this question?')) deleteMutation.mutate(id); }}
              />
            ))}
          </div>
        )}
      </Card>

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

      {/* Dialogs */}
      {editTarget !== null && (
        <QuestionFormDialog
          open={true}
          onClose={() => setEditTarget(null)}
          initial={editTarget === 'new' ? null : editTarget}
          categories={categories}
          levels={levels}
        />
      )}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} categories={categories} levels={levels} />
    </div>
  );
}
