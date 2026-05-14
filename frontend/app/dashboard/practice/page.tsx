'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Play, Search, X, ChevronLeft, ChevronRight,
  BookOpen, Code2, Mic, PenLine, Ear, BookMarked, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { interviewsApi } from '@/lib/api/interviews';
import {
  practiceApi, EnglishTopic, CodeTopic,
} from '@/lib/api/practice_topics';

// ── Skill icons ────────────────────────────────────────────────────────────────

const SKILL_ICON: Record<string, React.ReactNode> = {
  Speaking:   <Mic className="h-3.5 w-3.5" />,
  Writing:    <PenLine className="h-3.5 w-3.5" />,
  Listening:  <Ear className="h-3.5 w-3.5" />,
  Grammar:    <BookMarked className="h-3.5 w-3.5" />,
  Vocabulary: <BookOpen className="h-3.5 w-3.5" />,
};

const LEVEL_COLOR: Record<string, string> = {
  Beginner:     'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  Intermediate: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  Advanced:     'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  Any:          'bg-muted text-muted-foreground',
  Mid:          'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  Senior:       'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

// ── English topic card ─────────────────────────────────────────────────────────

function EnglishTopicCard({ topic, onStart, starting }: {
  topic: EnglishTopic;
  onStart: (topic: EnglishTopic) => void;
  starting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {SKILL_ICON[topic.skill_focus]}
                {topic.skill_focus}
              </span>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${LEVEL_COLOR[topic.level] ?? ''}`}>
                {topic.level}
              </span>
            </div>
            <CardTitle className="text-base leading-snug">{topic.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-sm text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>
          {topic.scenario_prompt}
        </p>
        {topic.scenario_prompt.length > 120 && (
          <button
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show more</>}
          </button>
        )}

        {topic.key_vocabulary && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Key vocabulary:</span> {topic.key_vocabulary}
          </p>
        )}

        <Button
          className="w-full"
          size="sm"
          onClick={() => onStart(topic)}
          disabled={starting}
        >
          {starting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-2" />
          )}
          Start Practice
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Code topic card ────────────────────────────────────────────────────────────

function CodeTopicCard({ topic, onStart, starting }: {
  topic: CodeTopic;
  onStart: (topic: CodeTopic) => void;
  starting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <Badge variant="outline" className="text-xs font-normal">{topic.category}</Badge>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${LEVEL_COLOR[topic.difficulty] ?? ''}`}>
                {topic.difficulty}
              </span>
              {topic.languages !== 'any' && (
                <span className="text-xs text-muted-foreground">{topic.languages}</span>
              )}
            </div>
            <CardTitle className="text-base leading-snug">{topic.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-sm text-muted-foreground font-mono whitespace-pre-wrap ${expanded ? '' : 'line-clamp-3'}`}>
          {topic.problem_statement}
        </p>
        {topic.problem_statement.length > 150 && (
          <button
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show more</>}
          </button>
        )}

        <Button
          className="w-full"
          size="sm"
          onClick={() => onStart(topic)}
          disabled={starting}
        >
          {starting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-2" />
          )}
          Start Practice
        </Button>
      </CardContent>
    </Card>
  );
}

// ── English tab ────────────────────────────────────────────────────────────────

function EnglishPracticeTab() {
  const router = useRouter();
  const [filterSkill, setFilterSkill] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [startingId, setStartingId] = useState<number | null>(null);

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 400);
  }, []);

  const { data: meta } = useQuery({
    queryKey: ['practice-english-meta'],
    queryFn: () => practiceApi.getEnglishMeta(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['practice-english', filterSkill, filterLevel, debouncedSearch, page],
    queryFn: () => practiceApi.listEnglishTopics({
      skill_focus: filterSkill || undefined,
      level: filterLevel || undefined,
      search: debouncedSearch || undefined,
      page,
      per_page: 12,
    }),
    placeholderData: prev => prev,
  });

  const startMutation = useMutation({
    mutationFn: (topic: EnglishTopic) =>
      interviewsApi.create({
        title: `English: ${topic.title}`,
        job_description: `[ENGLISH PRACTICE]\nSkill: ${topic.skill_focus} | Level: ${topic.level}\n\n${topic.scenario_prompt}${topic.key_vocabulary ? `\n\nKey vocabulary: ${topic.key_vocabulary}` : ''}${topic.evaluation_criteria ? `\n\nEvaluation criteria: ${topic.evaluation_criteria}` : ''}`,
      }),
    onSuccess: (interview, topic) => {
      toast.success(`Starting "${topic.title}"…`);
      router.push(`/dashboard/interviews/${interview.id}`);
    },
    onError: (e: Error) => {
      setStartingId(null);
      toast.error(e.message);
    },
  });

  const handleStart = (topic: EnglishTopic) => {
    setStartingId(topic.id);
    startMutation.mutate(topic);
  };

  const skillOptions = meta?.skill_focus_options ?? [];
  const levelOptions = meta?.level_options ?? [];
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  return (
    <div className="space-y-4">
      {/* Filters */}
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
            {skillOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterLevel || 'all'} onValueChange={v => { setFilterLevel(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="All levels" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {levelOptions.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">{total} topic{total !== 1 ? 's' : ''} available</p>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
            <p className="text-muted-foreground">No English topics available yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Ask your admin to add topics in the admin panel.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(t => (
            <EnglishTopicCard
              key={t.id}
              topic={t}
              onStart={handleStart}
              starting={startingId === t.id && startMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button size="icon" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
          <Button size="icon" variant="outline" disabled={page === pages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Code tab ───────────────────────────────────────────────────────────────────

function CodePracticeTab() {
  const router = useRouter();
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [startingId, setStartingId] = useState<number | null>(null);

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 400);
  }, []);

  const { data: meta } = useQuery({
    queryKey: ['practice-code-meta'],
    queryFn: () => practiceApi.getCodeMeta(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['practice-code', filterCategory, filterDifficulty, debouncedSearch, page],
    queryFn: () => practiceApi.listCodeTopics({
      category: filterCategory || undefined,
      difficulty: filterDifficulty || undefined,
      search: debouncedSearch || undefined,
      page,
      per_page: 12,
    }),
    placeholderData: prev => prev,
  });

  const startMutation = useMutation({
    mutationFn: (topic: CodeTopic) =>
      interviewsApi.create({
        title: `Code: ${topic.title}`,
        job_description: `[CODE PRACTICE]\nCategory: ${topic.category} | Difficulty: ${topic.difficulty} | Languages: ${topic.languages}\n\n${topic.problem_statement}${topic.discussion_hints ? `\n\nDiscussion hints (JSON): ${topic.discussion_hints}` : ''}${topic.review_rubric ? `\n\nReview rubric (JSON): ${topic.review_rubric}` : ''}${topic.reference_solution ? `\n\nReference solution (agent-only): ${topic.reference_solution}` : ''}`,
      }),
    onSuccess: (interview, topic) => {
      toast.success(`Starting "${topic.title}"…`);
      router.push(`/dashboard/interviews/${interview.id}`);
    },
    onError: (e: Error) => {
      setStartingId(null);
      toast.error(e.message);
    },
  });

  const handleStart = (topic: CodeTopic) => {
    setStartingId(topic.id);
    startMutation.mutate(topic);
  };

  const categories = meta?.categories ?? [];
  const difficulties = meta?.difficulties ?? [];
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  return (
    <div className="space-y-4">
      {/* Filters */}
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
      </div>

      <p className="text-xs text-muted-foreground">{total} problem{total !== 1 ? 's' : ''} available</p>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Code2 className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
            <p className="text-muted-foreground">No code topics available yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Ask your admin to add problems in the admin panel.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(t => (
            <CodeTopicCard
              key={t.id}
              topic={t}
              onStart={handleStart}
              starting={startingId === t.id && startMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button size="icon" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
          <Button size="icon" variant="outline" disabled={page === pages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PracticePage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Practice</h1>
        <p className="text-muted-foreground mt-2">
          Choose a topic and start an AI-guided practice session.
        </p>
      </div>

      <Tabs defaultValue="english">
        <TabsList>
          <TabsTrigger value="english" className="flex items-center gap-1.5">
            <BookOpen className="h-4 w-4" />
            English
          </TabsTrigger>
          <TabsTrigger value="code" className="flex items-center gap-1.5">
            <Code2 className="h-4 w-4" />
            Coding
          </TabsTrigger>
        </TabsList>

        <TabsContent value="english" className="mt-4">
          <EnglishPracticeTab />
        </TabsContent>

        <TabsContent value="code" className="mt-4">
          <CodePracticeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
