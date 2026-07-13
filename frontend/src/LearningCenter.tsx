"use client";

import { useEffect, useRef, useState } from "react";
import { bestRun, type BenchmarkKind, type BenchmarkReport } from "./benchmark";
import { checkpointIndex, isaReference, lessons, type Lesson } from "./learning";
import type { CpuState, ReferenceComparison, Stats } from "./types";

interface Props {
  open: boolean;
  state: CpuState;
  reference: ReferenceComparison | null;
  activeLessonId: string;
  benchmark: BenchmarkReport | null;
  benchmarking: boolean;
  benchmarkError: string;
  benchmarkPresetCount: number;
  onClose: () => void;
  onLoadLesson: (lesson: Lesson) => void;
  onRunBenchmark: (kind: BenchmarkKind) => void;
  onExportBenchmark: (format: "json" | "csv") => void;
}

export function LearningCenter({ open, state, reference, activeLessonId, benchmark, benchmarking, benchmarkError, benchmarkPresetCount, onClose, onLoadLesson, onRunBenchmark, onExportBenchmark }: Props) {
  const [tab, setTab] = useState<"Lessons" | "ISA" | "Performance">("Lessons");
  const [query, setQuery] = useState("");
  const [benchmarkKind, setBenchmarkKind] = useState<BenchmarkKind>("suite");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open) return; closeRef.current?.focus(); const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [open, onClose]);
  if (!open) return null;
  const active = lessons.find(lesson => lesson.id === activeLessonId) ?? lessons[0];
  const nextCheckpoint = checkpointIndex(active, state, reference);
  const searchTerms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleIsa = isaReference.filter(entry => {const haystack=`${entry.mnemonic} ${entry.syntax} ${entry.description}`.toLowerCase();return searchTerms.every(term=>haystack.includes(term));});
  return <div className="learn-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="learn-modal" role="dialog" aria-modal="true" aria-labelledby="learn-title">
      <header><div><span className="eyebrow">LEARNING CENTER</span><h2 id="learn-title">Learn the pipeline by doing</h2></div><button ref={closeRef} onClick={onClose} aria-label="Close learning center">×</button></header>
      <nav aria-label="Learning center sections">{(["Lessons", "ISA", "Performance"] as const).map(name => <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>{name}</button>)}</nav>
      {tab === "Lessons" && <div className="lesson-layout"><aside>{lessons.map(lesson => { const index = checkpointIndex(lesson, state, reference); return <button key={lesson.id} className={active.id === lesson.id ? "active" : ""} onClick={() => onLoadLesson(lesson)}><b>{lesson.title}</b><span>{index < 0 ? "Complete" : `${Math.max(0, index)} / ${lesson.checkpoints.length}`}</span></button>; })}</aside><article className="lesson-detail"><span className="lesson-kicker">GUIDED LAB</span><h3>{active.title}</h3><p>{active.summary}</p><ol>{active.checkpoints.map((checkpoint, index) => { const passed = checkpoint.passed(state, reference); const current = index === nextCheckpoint; return <li key={checkpoint.title} aria-current={current ? "step" : undefined} className={`${passed ? "passed" : ""} ${current ? "current" : ""}`}><i aria-hidden="true">{passed ? "✓" : index + 1}</i><div><b>{checkpoint.title}</b><span>{checkpoint.instruction}</span></div></li>; })}</ol><button className="lesson-load" onClick={() => onLoadLesson(active)}>Restart this lesson</button></article></div>}
      {tab === "ISA" && <div className="isa-panel"><label>Search instructions<input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Try LW, branch, immediate…" /></label><div className="isa-list">{visibleIsa.map(entry => <article key={entry.mnemonic}><span>{entry.format}</span><div><b>{entry.mnemonic}</b><code>{entry.syntax}</code><p>{entry.description}</p></div></article>)}</div></div>}
      {tab === "Performance" && <div className="compare-panel"><div className="compare-intro"><h3>Performance Lab</h3><p>Run the same program through independent C++ simulators, verify architectural equivalence, and compare microarchitectural cost.</p><label>Benchmark suite<select value={benchmarkKind} onChange={event => setBenchmarkKind(event.target.value as BenchmarkKind)}><option value="suite">Release matrix · 4 configurations</option><option value="forwarding">Forwarding · 2 configurations</option><option value="prediction">Predictors · 3 configurations</option><option value="cache">Cache · 2 configurations</option><option value="custom">Current + presets · {benchmarkPresetCount + 1} configurations</option></select></label><button onClick={() => onRunBenchmark(benchmarkKind)} disabled={benchmarking}>{benchmarking ? "Running benchmark…" : "Run benchmark"}</button>{benchmark&&<div className="benchmark-export"><button onClick={()=>onExportBenchmark("json")}>Export JSON</button><button onClick={()=>onExportBenchmark("csv")}>Export CSV</button></div>}</div>{benchmark ? <PerformanceResults report={benchmark} /> : <div className="compare-empty">Run a benchmark to compare cycles, CPI, stalls, branch recovery, cache behavior, and architectural equivalence.</div>}</div>}
      {tab === "Performance" && benchmarkError && <p className="benchmark-error" role="alert">{benchmarkError}</p>}
    </section>
  </div>;
}

function PerformanceResults({ report }: { report: BenchmarkReport }) {
  const fastest=bestRun(report);const maximum=Math.max(...report.runs.map(run=>run.statistics.cycles),1);
  const rows: Array<[string, (stats: Stats) => string | number]> = [["Cycles", stats=>stats.cycles],["CPI", stats=>stats.cpi.toFixed(2)],["Data stalls", stats=>stats.dataStallCycles],["Memory stalls", stats=>stats.memoryStallCycles],["Mispredictions", stats=>stats.mispredictions]];
  return <div className="performance-results"><div className="performance-summary"><span>FASTEST CONFIGURATION</span><b>{fastest?.label??"—"}</b><small>{fastest?.statistics.cycles??0} cycles · all {report.runs.every(run=>run.architecturalMatch)?"architecturally verified":"results require review"}</small></div><div className="performance-bars" aria-label="Cycle comparison chart">{report.runs.map(run=><div key={run.id}><span>{run.label}</span><i><b style={{width:`${Math.max(5,100*run.statistics.cycles/maximum)}%`}}/></i><strong>{run.statistics.cycles}</strong></div>)}</div><div className="performance-table"><div className="performance-head"><span>Configuration</span>{rows.map(([label])=><b key={label}>{label}</b>)}<b>Cache H/M</b><b>Verified</b></div>{report.runs.map(run=><div className="performance-row" key={run.id}><span>{run.label}</span>{rows.map(([label,read])=><b key={label}>{read(run.statistics)}</b>)}<b>{run.cache.hits}/{run.cache.misses}</b><b className={run.architecturalMatch?"verified":"unverified"}>{run.architecturalMatch?"Yes":"No"}</b></div>)}</div></div>;
}
