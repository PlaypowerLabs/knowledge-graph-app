'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

const STORAGE_KEY = 'kg-viewer:diagnostic-workbench-layout:v2';
const LEGACY_WORKBENCH_KEY = 'kg-viewer:diagnostic-workbench-layout:v1';
const LEGACY_SHELL_KEY = 'kg-viewer:diagnostic-shell-layout:v1';
const STACK_BREAKPOINT = 1080;
const DRAG_MIME = 'application/x-kg-viewer-diagnostic-tab';
const MIN_PANE_SIZE = 240;

export type DiagnosticWorkbenchTab = {
  id: string;
  label: string;
  content: ReactNode;
};

export type DiagnosticWorkbenchPaneNode = {
  type: 'pane';
  id: string;
  tabs: string[];
  activeTabId: string | null;
};

export type DiagnosticWorkbenchSplitNode = {
  type: 'split';
  id: string;
  direction: 'row' | 'column';
  ratio: number;
  first: DiagnosticWorkbenchNode;
  second: DiagnosticWorkbenchNode;
};

export type DiagnosticWorkbenchNode =
  | DiagnosticWorkbenchPaneNode
  | DiagnosticWorkbenchSplitNode;

export type DiagnosticWorkbenchLayout = {
  root: DiagnosticWorkbenchNode;
};

type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

type ResizeState =
  | {
      splitId: string;
      direction: 'row' | 'column';
      rect: DOMRect;
    }
  | null;

type DropPreview = {
  paneId: string;
  zone: DropZone;
} | null;

type Props = {
  tabs: DiagnosticWorkbenchTab[];
  defaultLayout: DiagnosticWorkbenchLayout;
};

type LegacyWorkbenchLayout = {
  groups?: {
    left?: string[];
    rightTop?: string[];
    rightBottom?: string[];
  };
  activeByGroup?: {
    left?: string | null;
    rightTop?: string | null;
    rightBottom?: string | null;
  };
};

export default function DockableDiagnosticShell({ tabs, defaultLayout }: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(1);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [layout, setLayout] = useState<DiagnosticWorkbenchLayout>(defaultLayout);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview>(null);
  const [resizeState, setResizeState] = useState<ResizeState>(null);

  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const isStacked = bounds.width > 0 && bounds.width <= STACK_BREAKPOINT;

  useEffect(() => {
    const element = shellRef.current;
    if (!element) return;

    const updateBounds = (width: number, height: number) => {
      setBounds({ width, height });
      setLayout((current) => sanitizeLayout(current, defaultLayout, tabIds));
    };

    updateBounds(element.clientWidth, element.clientHeight);
    const stored = readStoredLayout(defaultLayout);
    if (stored) {
      setLayout(sanitizeLayout(stored, defaultLayout, tabIds));
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateBounds(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [defaultLayout, tabIds]);

  useEffect(() => {
    if (!resizeState || isStacked) return;

    const handleMove = (event: PointerEvent) => {
      const size =
        resizeState.direction === 'row' ? resizeState.rect.width : resizeState.rect.height;
      if (!size) return;
      const position =
        resizeState.direction === 'row'
          ? event.clientX - resizeState.rect.left
          : event.clientY - resizeState.rect.top;
      const minRatio = Math.min(0.45, MIN_PANE_SIZE / size);
      const ratio = clamp(position / size, minRatio, 1 - minRatio);
      setLayout((current) => updateSplitRatio(current, resizeState.splitId, ratio));
    };

    const handleUp = () => setResizeState(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = resizeState.direction === 'row' ? 'col-resize' : 'row-resize';

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isStacked, resizeState]);

  useEffect(() => {
    writeStoredLayout(layout);
  }, [layout]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = parseStoredLayout(event.newValue);
      if (!next) return;
      setLayout((current) => {
        const sanitized = sanitizeLayout(next, defaultLayout, tabIds);
        return JSON.stringify(current) === JSON.stringify(sanitized) ? current : sanitized;
      });
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [defaultLayout, tabIds]);

  const liveLayout = useMemo(
    () => sanitizeLayout(layout, defaultLayout, tabIds),
    [defaultLayout, layout, tabIds],
  );

  const createId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextIdRef.current++}`;

  const handleActivateTab = (paneId: string, tabId: string) => {
    setLayout((current) => activateTab(current, paneId, tabId));
  };

  const handleTabDragStart = (tabId: string, event: ReactDragEvent<HTMLElement>) => {
    event.dataTransfer.setData(DRAG_MIME, tabId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggedTabId(tabId);
  };

  const handleTabDragEnd = () => {
    setDraggedTabId(null);
    setDropPreview(null);
  };

  const handleDropZoneOver = (
    paneId: string,
    zone: DropZone,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropPreview({ paneId, zone });
  };

  const handleDropZoneLeave = (paneId: string) => {
    setDropPreview((current) => (current?.paneId === paneId ? null : current));
  };

  const handleDropZone = (
    paneId: string,
    zone: DropZone,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const tabId = event.dataTransfer.getData(DRAG_MIME);
    if (!tabId || !tabsById.has(tabId)) return;

    setLayout((current) => moveTab(current, tabId, paneId, zone, createId));
    setDraggedTabId(null);
    setDropPreview(null);
  };

  const beginResize = (
    splitId: string,
    direction: 'row' | 'column',
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (isStacked) return;
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    event.preventDefault();
    setResizeState({
      splitId,
      direction,
      rect: parent.getBoundingClientRect(),
    });
  };

  return (
    <div ref={shellRef} className="diag-workbench">
      <WorkbenchNodeView
        node={liveLayout.root}
        tabsById={tabsById}
        draggedTabId={draggedTabId}
        dropPreview={dropPreview}
        onActivateTab={handleActivateTab}
        onTabDragStart={handleTabDragStart}
        onTabDragEnd={handleTabDragEnd}
        onDropZoneOver={handleDropZoneOver}
        onDropZoneLeave={handleDropZoneLeave}
        onDropZone={handleDropZone}
        onBeginResize={beginResize}
      />
    </div>
  );
}

function WorkbenchNodeView({
  node,
  tabsById,
  draggedTabId,
  dropPreview,
  onActivateTab,
  onTabDragStart,
  onTabDragEnd,
  onDropZoneOver,
  onDropZoneLeave,
  onDropZone,
  onBeginResize,
}: {
  node: DiagnosticWorkbenchNode;
  tabsById: Map<string, DiagnosticWorkbenchTab>;
  draggedTabId: string | null;
  dropPreview: DropPreview;
  onActivateTab: (paneId: string, tabId: string) => void;
  onTabDragStart: (tabId: string, event: ReactDragEvent<HTMLElement>) => void;
  onTabDragEnd: () => void;
  onDropZoneOver: (paneId: string, zone: DropZone, event: ReactDragEvent<HTMLElement>) => void;
  onDropZoneLeave: (paneId: string) => void;
  onDropZone: (paneId: string, zone: DropZone, event: ReactDragEvent<HTMLElement>) => void;
  onBeginResize: (
    splitId: string,
    direction: 'row' | 'column',
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  if (node.type === 'pane') {
    const paneTabs = node.tabs
      .map((tabId) => tabsById.get(tabId))
      .filter(Boolean) as DiagnosticWorkbenchTab[];
    const activeTab = paneTabs.find((tab) => tab.id === node.activeTabId) ?? paneTabs[0] ?? null;
    const activePreviewZone = dropPreview?.paneId === node.id ? dropPreview.zone : null;

    return (
      <section className="diag-pane">
        <div className="diag-pane-tabbar">
          {paneTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              draggable
              className={tab.id === activeTab?.id ? 'diag-pane-tab active' : 'diag-pane-tab'}
              onClick={() => onActivateTab(node.id, tab.id)}
              onDragStart={(event) => onTabDragStart(tab.id, event)}
              onDragEnd={onTabDragEnd}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="diag-pane-body">
          {paneTabs.map((tab) => (
            <div
              key={tab.id}
              className={tab.id === activeTab?.id ? 'diag-pane-content active' : 'diag-pane-content'}
              hidden={tab.id !== activeTab?.id}
              aria-hidden={tab.id !== activeTab?.id}
            >
              {tab.content}
            </div>
          ))}

          {draggedTabId && (
            <div
              className="diag-drop-overlay"
              onDragLeave={() => onDropZoneLeave(node.id)}
            >
              <div
                className={`diag-drop-highlight ${activePreviewZone ? `zone-${activePreviewZone}` : ''}`}
              />
              <DropZoneTarget
                zone="left"
                paneId={node.id}
                onDragOver={onDropZoneOver}
                onDrop={onDropZone}
              />
              <DropZoneTarget
                zone="right"
                paneId={node.id}
                onDragOver={onDropZoneOver}
                onDrop={onDropZone}
              />
              <DropZoneTarget
                zone="top"
                paneId={node.id}
                onDragOver={onDropZoneOver}
                onDrop={onDropZone}
              />
              <DropZoneTarget
                zone="bottom"
                paneId={node.id}
                onDragOver={onDropZoneOver}
                onDrop={onDropZone}
              />
              <DropZoneTarget
                zone="center"
                paneId={node.id}
                onDragOver={onDropZoneOver}
                onDrop={onDropZone}
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className={`diag-split diag-split-${node.direction}`}>
      <div
        className="diag-split-child"
        style={{
          flex: `0 0 ${Math.round(node.ratio * 1000) / 10}%`,
        }}
      >
        <WorkbenchNodeView
          node={node.first}
          tabsById={tabsById}
          draggedTabId={draggedTabId}
          dropPreview={dropPreview}
          onActivateTab={onActivateTab}
          onTabDragStart={onTabDragStart}
          onTabDragEnd={onTabDragEnd}
          onDropZoneOver={onDropZoneOver}
          onDropZoneLeave={onDropZoneLeave}
          onDropZone={onDropZone}
          onBeginResize={onBeginResize}
        />
      </div>

      <button
        type="button"
        className={node.direction === 'row' ? 'diag-split-handle vertical' : 'diag-split-handle horizontal'}
        onPointerDown={(event) => onBeginResize(node.id, node.direction, event)}
        aria-label="Resize workbench split"
      />

      <div
        className="diag-split-child"
        style={{
          flex: '1 1 0%',
        }}
      >
        <WorkbenchNodeView
          node={node.second}
          tabsById={tabsById}
          draggedTabId={draggedTabId}
          dropPreview={dropPreview}
          onActivateTab={onActivateTab}
          onTabDragStart={onTabDragStart}
          onTabDragEnd={onTabDragEnd}
          onDropZoneOver={onDropZoneOver}
          onDropZoneLeave={onDropZoneLeave}
          onDropZone={onDropZone}
          onBeginResize={onBeginResize}
        />
      </div>
    </div>
  );
}

function DropZoneTarget({
  paneId,
  zone,
  onDragOver,
  onDrop,
}: {
  paneId: string;
  zone: DropZone;
  onDragOver: (paneId: string, zone: DropZone, event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (paneId: string, zone: DropZone, event: ReactDragEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className={`diag-drop-target zone-${zone}`}
      onDragOver={(event) => onDragOver(paneId, zone, event)}
      onDrop={(event) => onDrop(paneId, zone, event)}
    />
  );
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function cloneNode(node: DiagnosticWorkbenchNode): DiagnosticWorkbenchNode {
  if (node.type === 'pane') {
    return {
      ...node,
      tabs: [...node.tabs],
    };
  }
  return {
    ...node,
    first: cloneNode(node.first),
    second: cloneNode(node.second),
  };
}

function collectTabs(node: DiagnosticWorkbenchNode): string[] {
  if (node.type === 'pane') return [...node.tabs];
  return [...collectTabs(node.first), ...collectTabs(node.second)];
}

function pruneNode(
  node: DiagnosticWorkbenchNode,
  allowed: Set<string>,
  seen: Set<string>,
): DiagnosticWorkbenchNode | null {
  if (node.type === 'pane') {
    const tabs = node.tabs.filter((tabId) => allowed.has(tabId) && !seen.has(tabId));
    for (const tabId of tabs) seen.add(tabId);
    if (!tabs.length) return null;
    return {
      ...node,
      tabs,
      activeTabId: tabs.includes(node.activeTabId || '') ? node.activeTabId : tabs[0],
    };
  }

  const first = pruneNode(node.first, allowed, seen);
  const second = pruneNode(node.second, allowed, seen);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return {
    ...node,
    ratio: clamp(node.ratio, 0.2, 0.8),
    first,
    second,
  };
}

function addTabToFirstPane(node: DiagnosticWorkbenchNode, tabId: string): DiagnosticWorkbenchNode {
  if (node.type === 'pane') {
    return {
      ...node,
      tabs: [...node.tabs, tabId],
      activeTabId: node.activeTabId ?? tabId,
    };
  }
  return {
    ...node,
    first: addTabToFirstPane(node.first, tabId),
  };
}

function sanitizeLayout(
  layout: DiagnosticWorkbenchLayout,
  defaultLayout: DiagnosticWorkbenchLayout,
  tabIds: string[],
): DiagnosticWorkbenchLayout {
  const allowed = new Set(tabIds);
  const seen = new Set<string>();
  let root = pruneNode(layout.root, allowed, seen);
  if (!root) root = cloneNode(defaultLayout.root);

  const present = new Set(collectTabs(root));
  for (const tabId of tabIds) {
    if (present.has(tabId)) continue;
    root = addTabToFirstPane(root, tabId);
  }

  return { root };
}

function updateSplitRatio(
  layout: DiagnosticWorkbenchLayout,
  splitId: string,
  ratio: number,
): DiagnosticWorkbenchLayout {
  return {
    root: updateSplitRatioInNode(layout.root, splitId, ratio),
  };
}

function updateSplitRatioInNode(
  node: DiagnosticWorkbenchNode,
  splitId: string,
  ratio: number,
): DiagnosticWorkbenchNode {
  if (node.type === 'pane') return node;
  if (node.id === splitId) {
    return {
      ...node,
      ratio: clamp(ratio, 0.15, 0.85),
    };
  }
  return {
    ...node,
    first: updateSplitRatioInNode(node.first, splitId, ratio),
    second: updateSplitRatioInNode(node.second, splitId, ratio),
  };
}

function activateTab(
  layout: DiagnosticWorkbenchLayout,
  paneId: string,
  tabId: string,
): DiagnosticWorkbenchLayout {
  return {
    root: activateTabInNode(layout.root, paneId, tabId),
  };
}

function activateTabInNode(
  node: DiagnosticWorkbenchNode,
  paneId: string,
  tabId: string,
): DiagnosticWorkbenchNode {
  if (node.type === 'pane') {
    if (node.id !== paneId) return node;
    return {
      ...node,
      activeTabId: node.tabs.includes(tabId) ? tabId : node.activeTabId,
    };
  }
  return {
    ...node,
    first: activateTabInNode(node.first, paneId, tabId),
    second: activateTabInNode(node.second, paneId, tabId),
  };
}

function findPaneWithTab(
  node: DiagnosticWorkbenchNode,
  tabId: string,
): { paneId: string; tabCount: number } | null {
  if (node.type === 'pane') {
    return node.tabs.includes(tabId) ? { paneId: node.id, tabCount: node.tabs.length } : null;
  }
  return findPaneWithTab(node.first, tabId) || findPaneWithTab(node.second, tabId);
}

function removeTab(node: DiagnosticWorkbenchNode, tabId: string): DiagnosticWorkbenchNode | null {
  if (node.type === 'pane') {
    if (!node.tabs.includes(tabId)) return node;
    const tabs = node.tabs.filter((current) => current !== tabId);
    if (!tabs.length) return null;
    return {
      ...node,
      tabs,
      activeTabId: node.activeTabId === tabId ? tabs[0] : node.activeTabId,
    };
  }

  const first = removeTab(node.first, tabId);
  const second = removeTab(node.second, tabId);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return {
    ...node,
    first,
    second,
  };
}

function insertTab(
  node: DiagnosticWorkbenchNode,
  paneId: string,
  zone: DropZone,
  tabId: string,
  createId: (prefix: string) => string,
): DiagnosticWorkbenchNode {
  if (node.type === 'pane') {
    if (node.id !== paneId) return node;
    if (zone === 'center') {
      if (node.tabs.includes(tabId)) {
        return {
          ...node,
          activeTabId: tabId,
        };
      }
      return {
        ...node,
        tabs: [...node.tabs, tabId],
        activeTabId: tabId,
      };
    }

    const newPane: DiagnosticWorkbenchPaneNode = {
      type: 'pane',
      id: createId('pane'),
      tabs: [tabId],
      activeTabId: tabId,
    };
    const direction = zone === 'left' || zone === 'right' ? 'row' : 'column';
    const splitBase: Omit<DiagnosticWorkbenchSplitNode, 'first' | 'second'> = {
      type: 'split',
      id: createId('split'),
      direction,
      ratio: 0.5,
    };
    if (zone === 'left' || zone === 'top') {
      return {
        ...splitBase,
        first: newPane,
        second: node,
      };
    }
    return {
      ...splitBase,
      first: node,
      second: newPane,
    };
  }

  return {
    ...node,
    first: insertTab(node.first, paneId, zone, tabId, createId),
    second: insertTab(node.second, paneId, zone, tabId, createId),
  };
}

function moveTab(
  layout: DiagnosticWorkbenchLayout,
  tabId: string,
  targetPaneId: string,
  zone: DropZone,
  createId: (prefix: string) => string,
): DiagnosticWorkbenchLayout {
  const source = findPaneWithTab(layout.root, tabId);
  if (!source) return layout;
  if (source.paneId === targetPaneId && zone === 'center') {
    return activateTab(layout, targetPaneId, tabId);
  }
  if (source.paneId === targetPaneId && zone !== 'center' && source.tabCount <= 1) {
    return layout;
  }

  const rootWithoutTab = removeTab(layout.root, tabId);
  if (!rootWithoutTab) return layout;

  return {
    root: insertTab(rootWithoutTab, targetPaneId, zone, tabId, createId),
  };
}

function readStoredLayout(defaultLayout: DiagnosticWorkbenchLayout) {
  if (typeof window === 'undefined') return null;
  const current = parseStoredLayout(window.localStorage.getItem(STORAGE_KEY));
  if (current) return current;

  const legacyWorkbench = parseLegacyWorkbench(window.localStorage.getItem(LEGACY_WORKBENCH_KEY));
  if (legacyWorkbench) return legacyWorkbench;

  const legacyShell = parseLegacyShell(window.localStorage.getItem(LEGACY_SHELL_KEY));
  if (legacyShell) return legacyShell;

  return defaultLayout;
}

function writeStoredLayout(layout: DiagnosticWorkbenchLayout) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

function parseStoredLayout(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DiagnosticWorkbenchLayout>;
    if (!parsed?.root || !isNode(parsed.root)) return null;
    return parsed as DiagnosticWorkbenchLayout;
  } catch {
    return null;
  }
}

function parseLegacyWorkbench(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as LegacyWorkbenchLayout;
    return legacyGroupsToTree(parsed);
  } catch {
    return null;
  }
}

function parseLegacyShell(value: string | null) {
  if (!value) return null;
  try {
    JSON.parse(value);
    return legacyGroupsToTree({});
  } catch {
    return null;
  }
}

function legacyGroupsToTree(layout: LegacyWorkbenchLayout): DiagnosticWorkbenchLayout {
  const leftTabs = layout.groups?.left?.length ? layout.groups.left : ['question'];
  const topTabs = layout.groups?.rightTop?.length
    ? layout.groups.rightTop
    : ['current', 'why', 'graph'];
  const bottomTabs = layout.groups?.rightBottom?.length ? layout.groups.rightBottom : ['history'];

  return {
    root: {
      type: 'split',
      id: 'legacy-root',
      direction: 'row',
      ratio: 0.62,
      first: {
        type: 'pane',
        id: 'legacy-left',
        tabs: leftTabs,
        activeTabId: layout.activeByGroup?.left ?? leftTabs[0] ?? null,
      },
      second: {
        type: 'split',
        id: 'legacy-right',
        direction: 'column',
        ratio: 0.72,
        first: {
          type: 'pane',
          id: 'legacy-right-top',
          tabs: topTabs,
          activeTabId: layout.activeByGroup?.rightTop ?? topTabs[0] ?? null,
        },
        second: {
          type: 'pane',
          id: 'legacy-right-bottom',
          tabs: bottomTabs,
          activeTabId: layout.activeByGroup?.rightBottom ?? bottomTabs[0] ?? null,
        },
      },
    },
  };
}

function isNode(value: unknown): value is DiagnosticWorkbenchNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as DiagnosticWorkbenchNode;
  if (node.type === 'pane') {
    return Array.isArray(node.tabs);
  }
  if (node.type === 'split') {
    return Boolean(node.first && node.second);
  }
  return false;
}
