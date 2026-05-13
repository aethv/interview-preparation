'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store/auth-store';
import { adminApi, ConfigEntry, AdminUser, ModelsResponse } from '@/lib/api/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Loader2, Save, RotateCcw, Shield, ShieldOff, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { QuestionBankTab } from './question-bank-tab';

// Group definitions — order matters for display
const CONFIG_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: 'LLM Model',
    keys: ['model'],
  },
  {
    label: 'Temperatures',
    keys: ['temperature_creative', 'temperature_balanced', 'temperature_analytical', 'temperature_question'],
  },
  {
    label: 'System Prompt',
    keys: ['system_prompt'],
  },
  {
    label: 'Interview Flow',
    keys: ['summary_update_interval', 'max_conversation_length_for_summary'],
  },
  {
    label: 'Sandbox',
    keys: ['sandbox_poll_interval_seconds', 'sandbox_stuck_threshold_seconds'],
  },
  {
    label: 'Skill Weights',
    keys: [
      'skill_weight_communication',
      'skill_weight_technical',
      'skill_weight_problem_solving',
      'skill_weight_code_quality',
    ],
  },
  {
    label: 'TTS (Text-to-Speech)',
    keys: ['tts_voice', 'tts_model'],
  },
];

const VENDORS = [{ value: 'openai', label: 'OpenAI' }];

function ModelSelector({
  entry,
  onSave,
  isSaving,
}: {
  entry: ConfigEntry;
  onSave: (key: string, value: unknown) => void;
  isSaving: boolean;
}) {
  const [vendor, setVendor] = useState('openai');
  const [selectedModel, setSelectedModel] = useState((entry.value as string) ?? '');

  const isDirty = selectedModel !== entry.value;

  const { data, isLoading, isRefetching, refetch } = useQuery<ModelsResponse>({
    queryKey: ['admin-models', vendor],
    queryFn: () => adminApi.getModels(vendor),
  });

  const models = data?.models ?? [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium font-mono">{entry.key}</p>
          {entry.description && (
            <p className="text-xs text-muted-foreground">{entry.description}</p>
          )}
        </div>
        {isDirty && (
          <Button
            size="sm"
            onClick={() => onSave(entry.key, selectedModel)}
            disabled={isSaving || !selectedModel}
            className="ml-4 shrink-0"
          >
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            <span className="ml-1">Save</span>
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Select value={vendor} onValueChange={(v) => setVendor(v)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VENDORS.map((v) => (
              <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={selectedModel}
          onValueChange={setSelectedModel}
          disabled={isLoading || isRefetching || models.length === 0}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={isLoading || isRefetching ? 'Loading models…' : 'Select model…'} />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="outline"
          onClick={() => refetch()}
          disabled={isLoading || isRefetching}
          title="Refresh model list"
        >
          {isLoading || isRefetching
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function ConfigField({
  entry,
  onSave,
  isSaving,
}: {
  entry: ConfigEntry;
  onSave: (key: string, value: unknown) => void;
  isSaving: boolean;
}) {
  const isString = typeof entry.value === 'string';
  const isNumber = typeof entry.value === 'number';
  const isLongText = isString && (entry.value as string).length > 100;

  const [draft, setDraft] = useState(
    isNumber ? String(entry.value) : (entry.value as string)
  );
  const isDirty = draft !== (isNumber ? String(entry.value) : entry.value);

  const handleSave = () => {
    const parsed = isNumber ? parseFloat(draft) : draft;
    if (isNumber && isNaN(parsed as number)) {
      toast.error('Value must be a number');
      return;
    }
    onSave(entry.key, parsed);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium font-mono">{entry.key}</p>
          {entry.description && (
            <p className="text-xs text-muted-foreground">{entry.description}</p>
          )}
        </div>
        {isDirty && (
          <Button size="sm" onClick={handleSave} disabled={isSaving} className="ml-4 shrink-0">
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            <span className="ml-1">Save</span>
          </Button>
        )}
      </div>
      {isLongText ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          className="font-mono text-sm"
        />
      ) : (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type={isNumber ? 'number' : 'text'}
          step={isNumber ? 'any' : undefined}
          className="font-mono text-sm"
        />
      )}
    </div>
  );
}

function ConfigGroup({
  label,
  entries,
  onSave,
  savingKey,
}: {
  label: string;
  entries: ConfigEntry[];
  onSave: (key: string, value: unknown) => void;
  savingKey: string | null;
}) {
  const [open, setOpen] = useState(true);
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none py-3"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{label}</CardTitle>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-5 pt-0">
          {entries.map((entry, i) => (
            <div key={entry.key}>
              {i > 0 && <Separator className="mb-5" />}
              {entry.key === 'model' ? (
                <ModelSelector
                  entry={entry}
                  onSave={onSave}
                  isSaving={savingKey === entry.key}
                />
              ) : (
                <ConfigField
                  entry={entry}
                  onSave={onSave}
                  isSaving={savingKey === entry.key}
                />
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers(),
  });

  const promote = useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: number; isAdmin: boolean }) =>
      adminApi.updateUser(userId, isAdmin),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(`${updated.email} is now ${updated.is_admin ? 'an admin' : 'a regular user'}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {users?.map((u) => (
        <Card key={u.id}>
          <CardContent className="flex items-center justify-between py-3">
            <div>
              <p className="font-medium">{u.email}</p>
              <p className="text-sm text-muted-foreground">{u.full_name ?? 'No name'} · joined {new Date(u.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-3">
              {u.is_admin && <Badge variant="secondary">Admin</Badge>}
              {!u.is_active && <Badge variant="destructive">Inactive</Badge>}
              <Button
                size="sm"
                variant={u.is_admin ? 'outline' : 'default'}
                disabled={promote.isPending}
                onClick={() => promote.mutate({ userId: u.id, isAdmin: !u.is_admin })}
              >
                {promote.isPending && promote.variables?.userId === u.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : u.is_admin ? (
                  <><ShieldOff className="h-3 w-3 mr-1" />Revoke admin</>
                ) : (
                  <><Shield className="h-3 w-3 mr-1" />Make admin</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthStore();
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Guard: redirect non-admins
  useEffect(() => {
    if (!authLoading && user && !user.is_admin) {
      router.replace('/dashboard');
    }
  }, [user, authLoading, router]);

  const { data: configs, isLoading: configLoading } = useQuery<ConfigEntry[]>({
    queryKey: ['admin-config'],
    queryFn: () => adminApi.getConfig(),
    enabled: !!user?.is_admin,
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      adminApi.updateConfig(key, value),
    onSuccess: (updated) => {
      qc.setQueryData<ConfigEntry[]>(['admin-config'], (old) =>
        old?.map((c) => (c.key === updated.key ? updated : c)) ?? []
      );
      toast.success(`"${updated.key}" updated`);
      setSavingKey(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setSavingKey(null);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => adminApi.resetConfig(),
    onSuccess: (data) => {
      qc.setQueryData(['admin-config'], data);
      toast.success('Config reset to defaults');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = (key: string, value: unknown) => {
    setSavingKey(key);
    updateMutation.mutate({ key, value });
  };

  if (authLoading || !user) return null;
  if (!user.is_admin) return null;

  const configMap = new Map(configs?.map((c) => [c.key, c]) ?? []);

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-muted-foreground text-sm">Configure agent behaviour and manage users</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={resetMutation.isPending}
          onClick={() => resetMutation.mutate()}
        >
          {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
          Reset to defaults
        </Button>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Agent Config</TabsTrigger>
          <TabsTrigger value="questions">Question Bank</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4 mt-4">
          {configLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            CONFIG_GROUPS.map((group) => {
              const entries = group.keys
                .map((k) => configMap.get(k))
                .filter(Boolean) as ConfigEntry[];
              return (
                <ConfigGroup
                  key={group.label}
                  label={group.label}
                  entries={entries}
                  onSave={handleSave}
                  savingKey={savingKey}
                />
              );
            })
          )}
        </TabsContent>

        <TabsContent value="questions" className="mt-4">
          <QuestionBankTab />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
