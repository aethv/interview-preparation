'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, Upload, Loader2, Globe, FileJson, ChevronDown } from 'lucide-react';
import { adminApi, type AdminDataset, type ImportSummary } from '@/lib/api/admin';

interface DataTransferButtonsProps {
  dataset: AdminDataset;
  /** Human name used in filenames and messages, e.g. "language-topics". */
  label: string;
  /** Query keys to refresh after a successful import. */
  invalidateKeys?: string[];
  size?: 'sm' | 'default';
  /**
   * The tab's existing crawler import, if it has one. Supplying this merges
   * both sources under a single Import menu, so a tab never shows two buttons
   * that both say "Import".
   */
  crawlerImport?: { label: string; onSelect: () => void };
}

/**
 * Export / import a single admin dataset as JSON.
 *
 * Import merges and skips duplicates — it never deletes or overwrites — so the
 * buttons need no destructive confirmation.
 */
export function DataTransferButtons({
  dataset,
  label,
  invalidateKeys = [],
  size = 'sm',
  crawlerImport,
}: DataTransferButtonsProps) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await adminApi.exportDataset(dataset);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${label}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.count} item${data.count === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const importMutation = useMutation({
    mutationFn: async (file: File): Promise<ImportSummary> => {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON.');
      }
      return adminApi.importDataset(dataset, payload);
    },
    onSuccess: (summary) => {
      invalidateKeys.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));

      const parts = [`${summary.imported} imported`];
      if (summary.skipped) parts.push(`${summary.skipped} already present`);
      if (summary.invalid) parts.push(`${summary.invalid} invalid`);
      if (summary.embedded !== undefined) parts.push(`${summary.embedded} embedded`);

      if (summary.imported === 0 && summary.skipped > 0) {
        toast.info(`Nothing new — ${parts.join(', ')}`);
      } else {
        toast.success(parts.join(', '));
      }

      if (summary.errors?.length) {
        toast.warning(summary.errors[0]);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so re-selecting the same file fires change again
          e.target.value = '';
          if (file) importMutation.mutate(file);
        }}
      />
      <Button
        size={size}
        variant="outline"
        onClick={handleExport}
        disabled={exporting}
        title="Download this list as JSON"
      >
        {exporting
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Download className="h-3.5 w-3.5" />}
        <span className="ml-1">Export</span>
      </Button>
      {crawlerImport ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size={size} variant="outline" disabled={importMutation.isPending}>
              {importMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Upload className="h-3.5 w-3.5" />}
              <span className="mx-1">Import</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={crawlerImport.onSelect}>
              <Globe className="h-3.5 w-3.5 mr-2" />
              {crawlerImport.label}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
              <FileJson className="h-3.5 w-3.5 mr-2" />
              From JSON export
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          size={size}
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={importMutation.isPending}
          title="Merge a JSON export into this list (duplicates are skipped)"
        >
          {importMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Upload className="h-3.5 w-3.5" />}
          <span className="ml-1">Import</span>
        </Button>
      )}
    </>
  );
}
