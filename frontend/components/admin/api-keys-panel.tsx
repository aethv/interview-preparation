'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminApi, SecretStatus } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Save, Trash2, KeyRound, CheckCircle2, AlertCircle, X,
} from 'lucide-react';

function SourceBadge({ source }: { source: SecretStatus['source'] }) {
  if (source === 'stored') {
    return <Badge variant="default" className="text-xs font-normal">Saved here</Badge>;
  }
  if (source === 'environment') {
    return <Badge variant="secondary" className="text-xs font-normal">From .env</Badge>;
  }
  return <Badge variant="destructive" className="text-xs font-normal">Not set</Badge>;
}

function SecretRow({ secret }: { secret: SecretStatus }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-secrets'] });
    // The model list depends on the OpenAI key
    qc.invalidateQueries({ queryKey: ['admin-models'] });
  };

  const save = useMutation({
    mutationFn: () => adminApi.updateSecret(secret.name, value.trim()),
    onSuccess: () => {
      // Never keep the plaintext in component state after saving
      setValue('');
      setEditing(false);
      setTestResult(null);
      refresh();
      toast.success(`${secret.label} saved`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => adminApi.deleteSecret(secret.name),
    onSuccess: () => {
      refresh();
      toast.success(`${secret.label} removed — using ${secret.env_var} again`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => adminApi.testSecret(secret.name),
    onSuccess: (res) => setTestResult(res),
    onError: (e: Error) => setTestResult({ ok: false, detail: e.message }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{secret.label}</p>
            <SourceBadge source={secret.source} />
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {secret.masked || `not configured — set ${secret.env_var} or save one here`}
          </p>
          {secret.updated_by && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Updated by {secret.updated_by}
              {secret.updated_at ? ` on ${new Date(secret.updated_at).toLocaleDateString()}` : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {secret.source === 'stored' ? 'Replace' : 'Set key'}
            </Button>
          )}
          {secret.is_set && (
            <Button
              size="sm" variant="ghost"
              onClick={() => test.mutate()} disabled={test.isPending}
            >
              {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
            </Button>
          )}
          {secret.source === 'stored' && (
            <Button
              size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => remove.mutate()} disabled={remove.isPending}
              title={`Remove stored key and fall back to ${secret.env_var}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Paste the ${secret.label}…`}
            className="h-9 font-mono text-xs"
          />
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={value.trim().length < 8 || save.isPending}
          >
            {save.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Save className="h-3.5 w-3.5" />}
            <span className="ml-1">Save</span>
          </Button>
          <Button
            size="icon" variant="ghost" className="h-8 w-8"
            onClick={() => { setEditing(false); setValue(''); }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {testResult && (
        <p className={`text-xs flex items-center gap-1.5 ${
          testResult.ok ? 'text-green-600' : 'text-destructive'
        }`}>
          {testResult.ok
            ? <CheckCircle2 className="h-3.5 w-3.5" />
            : <AlertCircle className="h-3.5 w-3.5" />}
          {testResult.detail}
        </p>
      )}
    </div>
  );
}

/** Admin panel for third-party API keys. Values are encrypted at rest and
 *  never returned by the API — only a masked preview is ever displayed. */
export function ApiKeysPanel() {
  const { data: secrets, isLoading } = useQuery({
    queryKey: ['admin-secrets'],
    queryFn: () => adminApi.listSecrets(),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" />API Keys
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Keys saved here are encrypted and take precedence over the .env file.
          They are shown masked and can never be read back.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          secrets?.map((secret, i) => (
            <div key={secret.name}>
              {i > 0 && <Separator className="mb-5" />}
              <SecretRow secret={secret} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
