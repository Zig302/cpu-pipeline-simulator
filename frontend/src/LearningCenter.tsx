"use client";

import { useEffect, useRef, useState } from "react";
import { checkpointIndex, isaReference, lessons, type Lesson } from "./learning";
import type { CpuState, ReferenceComparison, Stats } from "./types";

export interface ComparisonResult {
  title: string;
  left: { label: string; statistics: Stats };
  right: { label: string; statistics: Stats };
}

interface Props {
  open: boolean;
  state: CpuState;
  reference: ReferenceComparison | null;
  activeLessonId: string;
  comparison: ComparisonResult | null;
  comparing: boolean;
  onClose: () => void;
  onLoadLesson: (lesson: Lesson) => void;
  onRunComparison: (kind: "forwarding" | "prediction") => void;
}

export function LearningCenter({ open, state, reference, activeLessonId, comparison, comparing, onClose, onLoadLesson, onRunComparison }: Props) {
  const [tab, setTab] = useState<"Lessons" | "ISA" | "Compare">("Lessons");
  const [query, setQuery] = useState("");
  const [comparisonKind, setComparisonKind] = useState<"forwarding" | "prediction">("forwarding");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open) return; closeRef.current?.focus(); const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [open, onClose]);
  if (!open) return null;
  const active = lessons.find(lesson => lesson.id === activeLessonId) ?? lessons[0];
  const nextCheckpoint = checkpointIndex(active, state, reference);
  const visibleIsa = isaReference.filter(entry => `${entry.mnemonic} ${entry.syntax} ${entry.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="learn-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="learn-modal" role="dialog" aria-modal="true" aria-labelledby="learn-title">
      <header><div><span className="eyebrow">LEARNING CENTER</span><h2 id="learn-title">Learn the pipeline by doing</h2></div><button ref={closeRef} onClick={onClose} aria-label="Close learning center">×</button></header>
      <nav aria-label="Learning center sections">{(["Lessons", "ISA", "Compare"] as const).map(name => <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>{name}</button>)}</nav>
      {tab === "Lessons" && <div className="lesson-layout"><aside>{lessons.map(lesson => { const index = checkpointIndex(lesson, state, reference); return <button key={lesson.id} className={active.id === lesson.id ? "active" : ""} onClick={() => onLoadLesson(lesson)}><b>{lesson.title}</b><span>{index < 0 ? "Complete" : `${Math.max(0, index)} / ${lesson.checkpoints.length}`}</span></button>; })}</aside><article className="lesson-detail"><span className="lesson-kicker">GUIDED LAB</span><h3>{active.title}</h3><p>{active.summary}</p><ol>{active.checkpoints.map((checkpoint, index) => { const passed = checkpoint.passed(state, reference); const current = index === nextCheckpoint; return <li key={checkpoint.title} aria-current={current ? "step" : undefined} className={`${passed ? "passed" : ""} ${current ? "current" : ""}`}><i aria-hidden="true">{passed ? "✓" : index + 1}</i><div><b>{checkpoint.title}</b><span>{checkpoint.instruction}</span></div></li>; })}</ol><button className="lesson-load" onClick={() => onLoadLesson(active)}>Restart this lesson</button></article></div>}
      {tab === "ISA" && <div className="isa-panel"><label>Search instructions<input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Try LW, branch, immediate…" /></label><div className="isa-list">{visibleIsa.map(entry => <article key={entry.mnemonic}><span>{entry.format}</span><div><b>{entry.mnemonic}</b><code>{entry.syntax}</code><p>{entry.description}</p></div></article>)}</div></div>}
      {tab === "Compare" && <div className="compare-panel"><div className="compare-intro"><h3>Run the same C++ program twice</h3><p>Only the processor configuration changes. Architectural behavior still comes from the WebAssembly core.</p><label>Comparison<select value={comparisonKind} onChange={event => setComparisonKind(event.target.value as "forwarding" | "prediction")}><option value="forwarding">Full vs no forwarding</option><option value="prediction">Two-bit vs always-not-taken</option></select></label><button onClick={() => onRunComparison(comparisonKind)} disabled={comparing}>{comparing ? "Running…" : "Run comparison"}</button></div>{comparison ? <ComparisonTable result={comparison} /> : <div className="compare-empty">Run a comparison to see cycle, CPI, stall, forwarding, and branch-prediction differences.</div>}</div>}
    </section>
  </div>;
}

function ComparisonTable({ result }: { result: ComparisonResult }) {
  const rows: Array<[string, (stats: Stats) => string | number]> = [
    ["Cycles", stats => stats.cycles], ["Retired", stats => stats.retired], ["CPI", stats => stats.cpi.toFixed(2)], ["Data stalls", stats => stats.dataStallCycles], ["Forwarding events", stats => stats.forwardingEvents], ["Mispredictions", stats => stats.mispredictions], ["Flushed", stats => stats.flushedInstructions],
  ];
  return <div className="comparison-results"><h3>{result.title}</h3><div className="comparison-head"><span>Metric</span><b>{result.left.label}</b><b>{result.right.label}</b></div>{rows.map(([label, read]) => <div className="comparison-row" key={label}><span>{label}</span><b>{read(result.left.statistics)}</b><b>{read(result.right.statistics)}</b></div>)}</div>;
}
