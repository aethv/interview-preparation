'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Maximize2, Minimize2, PanelTopOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Which panel (if any) is collapsed to its header. */
export type CollapsedPanel = 'none' | 'top' | 'bottom';

export interface PanelChrome {
  collapsed: boolean;
  maximized: boolean;
  actions: ReactNode;
}

interface VerticalSplitPanelsProps {
  className?: string;
  /** Initial top-panel height as a percent of the container. Default 65. */
  defaultTopPercent?: number;
  /** Minimum percent either panel can shrink to while dragging. Default 15. */
  minPercent?: number;
  top: (chrome: PanelChrome) => ReactNode;
  bottom: (chrome: PanelChrome) => ReactNode;
}

const COLLAPSED_PX = 44;

/**
 * Vertical two-pane layout with a drag handle and minimize/maximize controls.
 * Minimize on one panel is equivalent to maximize on the other (header-only collapse).
 */
export function VerticalSplitPanels({
  className,
  defaultTopPercent = 65,
  minPercent = 15,
  top,
  bottom,
}: VerticalSplitPanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [topPercent, setTopPercent] = useState(defaultTopPercent);
  const [collapsed, setCollapsed] = useState<CollapsedPanel>('none');
  const draggingRef = useRef(false);

  const setSplit = useCallback(() => setCollapsed('none'), []);
  const collapseTop = useCallback(() => setCollapsed('top'), []);
  const collapseBottom = useCallback(() => setCollapsed('bottom'), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (collapsed !== 'none') return;
      e.preventDefault();
      draggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [collapsed],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return;
      const raw = ((e.clientY - rect.top) / rect.height) * 100;
      setTopPercent(Math.min(100 - minPercent, Math.max(minPercent, raw)));
    },
    [minPercent],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const topCollapsed = collapsed === 'top';
  const bottomCollapsed = collapsed === 'bottom';
  const topMaximized = collapsed === 'bottom';
  const bottomMaximized = collapsed === 'top';

  const topStyle =
    collapsed === 'top'
      ? { height: COLLAPSED_PX, flex: 'none' as const }
      : collapsed === 'bottom'
        ? { flex: '1 1 0%', minHeight: 0 }
        : { flex: `0 0 ${topPercent}%`, minHeight: 0 };

  const bottomStyle =
    collapsed === 'bottom'
      ? { height: COLLAPSED_PX, flex: 'none' as const }
      : collapsed === 'top'
        ? { flex: '1 1 0%', minHeight: 0 }
        : { flex: '1 1 0%', minHeight: 0 };

  const topActions = (
    <PanelActions
      collapsed={topCollapsed}
      maximized={topMaximized}
      onMinimize={collapseTop}
      onMaximize={collapseBottom}
      onRestore={setSplit}
      minimizeLabel="Minimize conversation history"
      maximizeLabel="Maximize conversation history"
      restoreLabel="Restore split view"
    />
  );

  const bottomActions = (
    <PanelActions
      collapsed={bottomCollapsed}
      maximized={bottomMaximized}
      onMinimize={collapseBottom}
      onMaximize={collapseTop}
      onRestore={setSplit}
      minimizeLabel="Minimize live conversation"
      maximizeLabel="Maximize live conversation"
      restoreLabel="Restore split view"
    />
  );

  return (
    <div
      ref={containerRef}
      className={cn('flex flex-col min-h-0 h-full', className)}
    >
      <div className="min-h-0 overflow-hidden flex flex-col" style={topStyle}>
        {top({
          collapsed: topCollapsed,
          maximized: topMaximized,
          actions: topActions,
        })}
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(topPercent)}
        aria-valuemin={minPercent}
        aria-valuemax={100 - minPercent}
        aria-label="Resize conversation panels"
        tabIndex={collapsed === 'none' ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (collapsed !== 'none') return;
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setTopPercent((p) => Math.max(minPercent, p - 2));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setTopPercent((p) => Math.min(100 - minPercent, p + 2));
          }
        }}
        className={cn(
          'group relative flex-none h-3 flex items-center justify-center',
          collapsed === 'none'
            ? 'cursor-row-resize'
            : 'cursor-default opacity-40',
        )}
      >
        <div
          className={cn(
            'h-1 w-10 rounded-full bg-border transition-colors',
            collapsed === 'none' && 'group-hover:bg-muted-foreground/40 group-focus-visible:bg-muted-foreground/50',
          )}
        />
      </div>

      <div className="min-h-0 overflow-hidden flex flex-col" style={bottomStyle}>
        {bottom({
          collapsed: bottomCollapsed,
          maximized: bottomMaximized,
          actions: bottomActions,
        })}
      </div>
    </div>
  );
}

function PanelActions({
  collapsed,
  maximized,
  onMinimize,
  onMaximize,
  onRestore,
  minimizeLabel,
  maximizeLabel,
  restoreLabel,
}: {
  collapsed: boolean;
  maximized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onRestore: () => void;
  minimizeLabel: string;
  maximizeLabel: string;
  restoreLabel: string;
}) {
  if (collapsed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onRestore}
        aria-label={restoreLabel}
        title={restoreLabel}
      >
        <PanelTopOpen className="h-3.5 w-3.5" />
      </Button>
    );
  }

  if (maximized) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onRestore}
        aria-label={restoreLabel}
        title={restoreLabel}
      >
        <Minimize2 className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onMinimize}
        aria-label={minimizeLabel}
        title="Minimize"
      >
        <Minimize2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onMaximize}
        aria-label={maximizeLabel}
        title="Maximize"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
