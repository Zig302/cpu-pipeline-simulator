"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { benchmarkCsv, benchmarkScenarios, createBenchmarkReport, type BenchmarkKind, type BenchmarkReport } from "./benchmark";
import { BUILT_IN_PRESETS, CUSTOM_PRESET_STORAGE_KEY, DEFAULT_CONFIGURATION, configurationSummary, parseCustomPresets, serializeCustomPresets, type ConfigurationPreset, type ConfigurationValidation, type ProcessorConfiguration } from "./configuration";
import { examples } from "./examples";
import { LearningCenter } from "./LearningCenter";
import { lessons, type Lesson } from "./learning";
import { createProject, createTrace, downloadJson, downloadText, parseProject, type ProjectDocument } from "./project";
import { createSimulator } from "./wasm";
import type { AssemblyResult, CoreEvent, CoreSimulator, CpuState, InitialState, PipelineSlot, ReferenceComparison, StageName, TimelineFrame } from "./types";

const STAGES: StageName[] = ["IF", "ID", "EX", "MEM1", "MEM2", "WB"];
const TABS = ["Registers", "Memory", "Pipeline regs", "Predictor", "Cache", "Statistics", "Event log"] as const;
type Tab = typeof TABS[number];
type Density = "comfortable" | "compact";

const hex = (value: number, digits = 8) => `0x${(value >>> 0).toString(16).padStart(digits, "0")}`;
const signed = (value: number) => value | 0;
const initialSource = examples[7].source;
const escapeHtml=(value:string)=>value.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]!));
const highlightAssembly=(source:string)=>source.split("\n").map(line=>{const pattern=/(#.*|\/\/.*)|\b(r(?:[0-9]|[12][0-9]|3[01]))\b|\b(ADD|SUB|MUL|ADDI|AND|OR|XOR|SLL|SRL|SLT|LW|SW|BEQ|BNE|BLT|J|JAL|JR|LUI|NOP|HALT|LI|MOV|B|RET)\b|(-?0x[0-9a-f]+|-?\d+)|([A-Za-z_]\w*:)/gi;let out="",last=0,m:RegExpExecArray|null;while((m=pattern.exec(line))){out+=escapeHtml(line.slice(last,m.index));const kind=m[1]?"comment":m[2]?"register":m[3]?"opcode":m[4]?"number":"label";out+=`<span class="tok-${kind}">${escapeHtml(m[0])}</span>`;last=pattern.lastIndex;}return out+escapeHtml(line.slice(last));}).join("\n");

function describeSlot(slot: PipelineSlot): string {
  const registerValue=(reg:number,value:number)=>`r${reg} = ${hex(value)} (${signed(value)})`;
  const sources=[slot.usesRs1?registerValue(slot.rs1,slot.rs1Value):"",slot.usesRs2?registerValue(slot.rs2,slot.rs2Value):""].filter(Boolean);
  const lead=`${slot.stage} is processing dynamic instruction #${slot.id}: ${slot.assembly}.`;
  if(slot.stage==="IF")return `IF is preparing the instruction at ${hex(slot.pc,4)}. Instruction memory supplies its raw word while the next-PC logic selects the following fetch.`;
  if(slot.stage==="ID")return `${lead} ${sources.length?`The register file reads ${sources.join(" and ")}.`:"This instruction does not read the register file."} The decoded immediate is ${slot.immediate}.`;
  if(slot.stage==="EX")return `${lead} ${sources.length?`Latched register values: ${sources.join(" and ")}. `:""}The effective EX inputs are ${hex(slot.operandA)} and ${hex(slot.operandB)}, producing ${hex(slot.aluResult)}.`;
  if(slot.stage.startsWith("MEM")){
    if(slot.isLoad)return `${lead} The load accesses ${hex(slot.memoryAddress)}${slot.stage==="MEM2"?" and completes when it advances to WB.":" and is moving toward MEM2 completion."}`;
    if(slot.isStore)return `${lead} The store targets ${hex(slot.memoryAddress)} with data ${hex(slot.memoryData)}${slot.stage==="MEM2"?"; memory is updated on the next cycle step.":"."}`;
    return `${lead} No data-memory access is required; the ALU result ${hex(slot.aluResult)} is passing through ${slot.stage}.`;
  }
  if(slot.writesRd&&slot.rd!==0)return `${lead} ${hex(slot.writeValue)} (${signed(slot.writeValue)}) is ready for r${slot.rd}; the register file commits it on the next cycle step.`;
  return `${lead} It will retire on the next cycle step without writing a general-purpose register.`;
}

function Metric({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return <div className={`metric ${accent ? "metric-accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function StageCard({ slot, selected, onSelect }: { slot: PipelineSlot; selected: boolean; onSelect: () => void }) {
  const state = !slot.valid ? "empty" : slot.squashed ? "flushed" : slot.stalled ? "stalled" : slot.bubble ? "bubble" : "active";
  return <button className={`stage-card stage-${state} ${selected ? "selected" : ""}`} onClick={onSelect} aria-label={`${slot.stage} pipeline stage`}>
    <div className="stage-head"><span className="stage-name">{slot.stage}</span><span className={`stage-status ${state}`}>{state}</span></div>
    {slot.valid ? <>
      <div className="instruction-id">{slot.stage === "IF" ? "NEXT" : `#${slot.id}`} <span>{hex(slot.pc, 4)}</span></div>
      <div className="stage-asm">{slot.assembly || slot.op}</div>
      <div className="stage-values">
        {slot.rd > 0 && <span>rd <b>r{slot.rd}</b></span>}
        {(slot.stage === "EX" || slot.stage === "MEM1") && <span>ALU <b>{hex(slot.aluResult)}</b></span>}
        {(slot.memRead || slot.memWrite) && <span>addr <b>{hex(slot.memoryAddress)}</b></span>}
      </div>
    </> : <div className="stage-empty">{slot.bubble ? "Inserted bubble" : slot.stage === "IF" ? "Next instruction fetch" : "No valid instruction"}</div>}
  </button>;
}

function Editor({ source, setSource, errors, pipelineLines, breakpoints, toggleBreakpoint, currentLine, dirty }: {
  source: string; setSource: (s: string) => void; errors: AssemblyResult["errors"];
  pipelineLines: Set<number>; breakpoints: Set<number>; toggleBreakpoint: (line: number) => void; currentLine: number; dirty: boolean;
}) {
  const lines = source.split("\n");
  const highlightRef=useRef<HTMLPreElement|null>(null);
  return <div className="editor-shell">
    <div className="editor-title"><span>PROGRAM.S</span><span className={`editor-state ${dirty ? "dirty" : "synced"}`}>{dirty ? "Changes not assembled" : "Loaded in CPU"}</span><span className="editor-meta">{lines.length} lines · RISC-32</span></div>
    <div className="editor-body">
      <div className="gutter" aria-label="Breakpoint gutter">
        {lines.map((_, i) => { const line=i+1; const hasError=errors.some(e=>e.line===line); return <button key={line} className={`${breakpoints.has(line)?"bp":""} ${pipelineLines.has(line)?"in-pipe":""} ${currentLine===line?"at-pc":""} ${hasError?"has-error":""}`} onClick={()=>toggleBreakpoint(line)} title={`Toggle breakpoint on source line ${line}`}><i />{line}</button>; })}
      </div>
      <div className="code-layer"><pre ref={highlightRef} aria-hidden="true" dangerouslySetInnerHTML={{__html:highlightAssembly(source)+"\n"}}/><textarea value={source} onChange={e=>setSource(e.target.value)} onScroll={e=>{if(highlightRef.current){highlightRef.current.scrollTop=e.currentTarget.scrollTop;highlightRef.current.scrollLeft=e.currentTarget.scrollLeft;}}} spellCheck={false} aria-label="Assembly source editor" /></div>
    </div>
    {errors.length > 0 && <div className="assembly-errors">{errors.map((e,i)=><div key={i}><b>Line {e.line}</b> {e.message}</div>)}</div>}
  </div>;
}

function Timeline({ frames, onSelect }: { frames: TimelineFrame[]; onSelect: (slot: PipelineSlot) => void }) {
  const data = useMemo(() => {
    const ids = new Map<number,{asm:string,pc:number,cells:Map<number,PipelineSlot>}>();
    frames.forEach(frame => frame.stages.forEach(slot => { if (!slot.valid || slot.stage === "IF" || !slot.id) return; const row=ids.get(slot.id) ?? {asm:slot.assembly,pc:slot.pc,cells:new Map()}; row.cells.set(frame.cycle,slot); ids.set(slot.id,row); }));
    return [...ids.entries()].sort((a,b)=>a[0]-b[0]).slice(-40);
  },[frames]);
  const cycles = frames.slice(-28).map(f=>f.cycle);
  return <div className="timeline-wrap">
    <div className="section-heading"><div><span className="eyebrow">EXECUTION HISTORY</span><h2>Pipeline timeline</h2></div><span className="section-note">Click a cell to inspect it</span></div>
    <div className="timeline-scroll">
      <table className="timeline"><thead><tr><th>Dynamic instruction</th>{cycles.map(c=><th key={c}>C{c}</th>)}</tr></thead>
      <tbody>{data.length ? data.map(([id,row])=><tr key={id}><td><b>#{id}</b><span>{row.asm}</span></td>{cycles.map(c=>{const s=row.cells.get(c);return <td key={c}>{s&&<button className={`tl-cell tl-${s.stage.toLowerCase()} ${s.stalled?"stalled":""} ${s.squashed?"squashed":""}`} onClick={()=>onSelect(s)} title={`${row.asm} · ${s.stage} · cycle ${c}`}>{s.stalled?`${s.stage}×`:s.stage.replace("MEM","M")}</button>}</td>})}</tr>) : <tr><td colSpan={cycles.length+1} className="empty-table">Step a cycle to start the timeline.</td></tr>}</tbody></table>
    </div>
  </div>;
}

function Inspector({ tab, state, simulator, refresh, memoryAddress, setMemoryAddress, paused }: { tab: Tab; state: CpuState; simulator: CoreSimulator; refresh: () => void; memoryAddress: number; setMemoryAddress: (a:number)=>void; paused:boolean }) {
  const [editValue,setEditValue]=useState("0");
  const [editMessage,setEditMessage]=useState("");
  const memory = (()=>{ try{return JSON.parse(simulator.readMemory(memoryAddress,64)) as number[];}catch{return [];} })();
  if(tab==="Registers") return <div className="register-grid">{state.registers.map((v,i)=><button key={i} disabled={!paused||i===0} className={i===0?"zero":""} title={paused?`Signed: ${signed(v)} · Binary: ${(v>>>0).toString(2).padStart(32,"0")} · Double-click to edit`:"Pause execution to edit registers"} onDoubleClick={()=>{if(!paused)return;const x=window.prompt(`Set r${i}`,String(signed(v)));if(x!==null){simulator.setRegister(i,Number(x)>>>0);refresh();}}}><span>r{i}</span><b>{hex(v)}</b><small>{signed(v)}</small></button>)}</div>;
  if(tab==="Memory") return <div className="memory-panel"><div className="memory-toolbar"><label>Address <input value={hex(memoryAddress)} onChange={e=>setMemoryAddress(Number(e.target.value)||0)} /></label><label>Word value <input disabled={!paused} value={editValue} onChange={e=>setEditValue(e.target.value)} /></label><button disabled={!paused} onClick={()=>{const v=Number(editValue)>>>0;const ok=simulator.writeMemory(memoryAddress,[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255].join(","));setEditMessage(ok?`Wrote ${hex(v)} at ${hex(memoryAddress)}.`:"Memory edit was rejected; check the address and value.");if(ok)refresh();}}>Write word</button></div>{editMessage&&<p className="memory-edit-message" role="status">{editMessage}</p>}<div className="hex-dump">{memory.map((v,i)=><span key={i} className={i<4?"recent":""}><small>{(i%16===0)?hex(memoryAddress+i,4):""}</small>{v.toString(16).padStart(2,"0")}</span>)}</div></div>;
  if(tab==="Pipeline regs") return <div className="pipeline-table">{state.pipeline.map(s=><div key={s.stage}><h4>{s.stage}<span>{s.valid?`#${s.id}`:"invalid"}</span></h4><dl><dt>PC / raw</dt><dd>{hex(s.pc)} · {hex(s.raw)}</dd><dt>Operands</dt><dd>A {hex(s.operandA)} · B {hex(s.operandB)}</dd><dt>ALU / write</dt><dd>{hex(s.aluResult)} · {hex(s.writeValue)}</dd><dt>Control</dt><dd>{s.regWrite?"RegWrite ":""}{s.memRead?"MemRead ":""}{s.memWrite?"MemWrite":""}</dd></dl></div>)}</div>;
  if(tab==="Predictor") return <table className="data-table"><thead><tr><th>Index</th><th>PC tag</th><th>State</th><th>Predict</th><th>Recent</th></tr></thead><tbody>{state.predictorTable.map(r=><tr key={r.index} className={!r.valid?"muted":""}><td>{r.index}</td><td>{r.valid?hex(r.pc,4):"—"}</td><td><span className="counter">{r.state.toString(2).padStart(2,"0")}</span></td><td>{r.valid?(r.prediction?"TAKEN":"NOT TAKEN"):"—"}</td><td>{r.valid?(r.recentTaken?"T":"N"):"—"}</td></tr>)}</tbody></table>;
  if(tab==="Cache") {const c=state.cache;const total=c.hits+c.misses;return <><div className="mini-stats"><Metric label="Reads" value={c.reads}/><Metric label="Writes" value={c.writes}/><Metric label="Hit rate" value={`${total?(100*c.hits/total).toFixed(1):"0.0"}%`}/><Metric label="Writebacks" value={c.dirtyWritebacks}/></div>{c.totalSets>c.sets.length&&<p className="cache-preview-note">Showing {c.sets.length} of {c.totalSets} sets to keep cycle stepping responsive.</p>}<div className="cache-sets">{c.sets.map((set,si)=>{const setIndex=c.visibleSetIndices[si]??si;return <div className="cache-set" key={setIndex}><h4>SET {setIndex}</h4>{set.map((l,wi)=><div className={l.valid?"valid":""} key={wi}><span>W{wi}</span><b>{l.valid?`tag ${hex(l.tag,2)}`:"invalid"}</b><i>{l.dirty?"DIRTY":"clean"}</i><code>{l.preview}</code></div>)}</div>})}</div></>}
  if(tab==="Statistics") {const s=state.statistics;const rows=[['Total cycles',s.cycles],['Fetched instructions',s.fetched],['Retired instructions',s.retired],['CPI',s.cpi.toFixed(3)],['IPC',s.ipc.toFixed(3)],['Useful utilization',`${s.cycles?(100*s.retired/(s.cycles*6)).toFixed(1):0}%`],['All stall cycles',s.stallCycles],['Data-hazard stalls',s.dataStallCycles],['Memory stalls',s.memoryStallCycles],['Control penalty',s.controlPenalty],['Forwarding events',s.forwardingEvents],['Flushed instructions',s.flushedInstructions],['Branches',s.branches],['Correct predictions',s.correctPredictions],['Mispredictions',s.mispredictions],['Prediction accuracy',`${s.branches?(100*s.correctPredictions/s.branches).toFixed(1):"0.0"}%`],['Register writes',s.registerWrites],['Memory writes',s.memoryWrites]];return <div className="stats-list">{rows.map(([k,v])=><div key={String(k)}><span>{k}</span><b>{v}</b></div>)}</div>}
  return <div className="event-list">{state.events.length?state.events.slice().reverse().map((e,i)=><div key={i} className={`event event-${e.type}`}><span>{e.type}</span><p>{e.message}</p><small>C{e.cycle} · {e.stage||"core"}</small></div>):<div className="empty-state">No events in the current cycle.</div>}</div>;
}

export default function CpuLab() {
  const coreRef=useRef<CoreSimulator|null>(null);
  const importRef=useRef<HTMLInputElement|null>(null);
  const [simulator,setSimulator]=useState<CoreSimulator|null>(null);
  const [state,setState]=useState<CpuState|null>(null); const [timeline,setTimeline]=useState<TimelineFrame[]>([]);
  const [source,setSource]=useState(initialSource); const [loadedSource,setLoadedSource]=useState(initialSource); const [sourceDirty,setSourceDirty]=useState(false); const [assembly,setAssembly]=useState<AssemblyResult>({ok:true,words:[],sourceLines:[],errors:[]});
  const [error,setError]=useState(""); const [running,setRunning]=useState(false); const [speed,setSpeed]=useState(8); const [density,setDensity]=useState<Density>("comfortable");
  const [draftConfiguration,setDraftConfiguration]=useState<ProcessorConfiguration>(DEFAULT_CONFIGURATION); const [configurationErrors,setConfigurationErrors]=useState<string[]>([]);
  const [activeTab,setActiveTab]=useState<Tab>("Registers"); const [selectedSlot,setSelectedSlot]=useState<PipelineSlot|null>(null); const [selectedStage,setSelectedStage]=useState<StageName|null>(null); const [selectedEvent,setSelectedEvent]=useState<CoreEvent|null>(null);
  const [breakpointLines,setBreakpointLines]=useState(new Set<number>()); const [memoryAddress,setMemoryAddress]=useState(0x400); const [exampleId,setExampleId]=useState("loop"); const [guideOpen,setGuideOpen]=useState(false);
  const [projectName,setProjectName]=useState("Pipeline Lab project"); const [projectMessage,setProjectMessage]=useState("");
  const [learningOpen,setLearningOpen]=useState(false); const [activeLessonId,setActiveLessonId]=useState(lessons[0].id); const [reference,setReference]=useState<ReferenceComparison|null>(null);
  const [benchmark,setBenchmark]=useState<BenchmarkReport|null>(null); const [benchmarking,setBenchmarking]=useState(false); const [benchmarkError,setBenchmarkError]=useState("");
  const [customPresets,setCustomPresets]=useState<ConfigurationPreset[]>([]); const [selectedPresetId,setSelectedPresetId]=useState(BUILT_IN_PRESETS[0].id); const [presetName,setPresetName]=useState(""); const [presetMessage,setPresetMessage]=useState("");

  const refresh=useCallback(()=>{const c=coreRef.current;if(!c)return;const next=JSON.parse(c.getState()) as CpuState;setState(next);setTimeline(JSON.parse(c.getTimeline()));setReference(next.halted||next.faulted?JSON.parse(c.compareReference()) as ReferenceComparison:null);},[]);
  const activeConfiguration=state?.configuration??DEFAULT_CONFIGURATION; const {forwarding,cacheEnabled}=activeConfiguration;
  const availablePresets=useMemo(()=>[...BUILT_IN_PRESETS,...customPresets],[customPresets]);
  const loadWithConfiguration=useCallback((text:string,nextConfig:ProjectDocument["configuration"],lines:number[]=[]):boolean=>{const c=coreRef.current;if(!c)return false;const configurationText=JSON.stringify(nextConfig);const validation=JSON.parse(c.validateConfigurationJson(configurationText)) as ConfigurationValidation;if(!validation.ok){setConfigurationErrors(validation.errors);setProjectMessage(`Configuration rejected: ${validation.errors[0]??"invalid values"}`);return false;}const result=JSON.parse(c.assemble(text)) as AssemblyResult;setAssembly(result);setSource(text);setRunning(false);if(!result.ok){setSourceDirty(true);return false;}c.loadProgram(text);const applied=JSON.parse(c.applyConfigurationJson(configurationText)) as ConfigurationValidation;if(!applied.ok){setConfigurationErrors(applied.errors);return false;}const current=JSON.parse(c.getState()) as CpuState;for(const address of current.breakpoints)c.setBreakpoint(address,false);setDraftConfiguration(applied.configuration);setConfigurationErrors([]);setLoadedSource(text);setSourceDirty(false);setSelectedSlot(null);setSelectedStage(null);setSelectedEvent(null);setReference(null);const validLines=new Set<number>();for(const line of lines){const index=result.sourceLines.findIndex(value=>value===line);if(index>=0){validLines.add(line);c.setBreakpoint(index*4,true);}}setBreakpointLines(validLines);refresh();return true;},[refresh]);
  const assembleSource=useCallback((text:string)=>loadWithConfiguration(text,draftConfiguration),[draftConfiguration,loadWithConfiguration]);
  const assembleProgram=useCallback(()=>assembleSource(source),[assembleSource,source]);

  useEffect(()=>{let live=true;createSimulator().then(c=>{if(!live){c.delete();return;}coreRef.current=c;setSimulator(c);setAssembly(JSON.parse(c.assemble(initialSource)));c.loadProgram(initialSource);c.applyConfigurationJson(JSON.stringify(DEFAULT_CONFIGURATION));try{const saved=parseCustomPresets(window.localStorage.getItem(CUSTOM_PRESET_STORAGE_KEY));const valid=saved.filter(preset=>(JSON.parse(c.validateConfigurationJson(JSON.stringify(preset.configuration))) as ConfigurationValidation).ok);setCustomPresets(valid);if(valid.length!==saved.length){window.localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY,serializeCustomPresets(valid));setPresetMessage(`Ignored ${saved.length-valid.length} invalid saved preset${saved.length-valid.length===1?"":"s"}.`);}}catch(error){setPresetMessage(error instanceof Error?error.message:String(error));}refresh();}).catch(e=>setError(e.message));return()=>{live=false;coreRef.current?.delete();coreRef.current=null;setSimulator(null);};},[refresh]);
  useEffect(()=>{if(!running||!coreRef.current)return;const delay=Math.max(30,1050-speed*100);const id=window.setInterval(()=>{const c=coreRef.current;if(!c)return;c.stepCycle();setSelectedEvent(null);refresh();const s=JSON.parse(c.getState()) as CpuState;if(s.halted||s.faulted||s.status==="breakpoint")setRunning(false);},delay);return()=>window.clearInterval(id);},[running,speed,refresh]);
  useEffect(()=>{if(!guideOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setGuideOpen(false);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[guideOpen]);

  const act=useCallback((fn:(c:CoreSimulator)=>void)=>{const c=coreRef.current;if(!c)return;fn(c);setSelectedEvent(null);refresh();},[refresh]);
  const projectDocument=useCallback(()=>createProject(projectName,source,activeConfiguration,[...breakpointLines].sort((a,b)=>a-b)),[projectName,source,activeConfiguration,breakpointLines]);
  const saveProjectFile=useCallback(()=>{downloadJson(`${projectName.trim().replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase()||"pipeline-lab"}.pipeline.json`,projectDocument());setProjectMessage("Project downloaded.");},[projectDocument,projectName]);
  const saveBrowserDraft=useCallback(()=>{window.localStorage.setItem("pipeline-lab-project",JSON.stringify(projectDocument()));setProjectMessage("Project saved in this browser.");},[projectDocument]);
  const applyProject=useCallback((project:ProjectDocument)=>{setProjectName(project.name);setExampleId("custom");const loaded=loadWithConfiguration(project.source,project.configuration,project.breakpointLines);setProjectMessage(loaded?`Loaded ${project.name}.`:"The project could not be loaded; check configuration and assembly errors.");},[loadWithConfiguration]);
  const restoreBrowserDraft=useCallback(()=>{try{const text=window.localStorage.getItem("pipeline-lab-project");if(!text)throw new Error("No browser-saved project exists yet.");applyProject(parseProject(text));}catch(error){setProjectMessage(error instanceof Error?error.message:String(error));}},[applyProject]);
  const importProject=useCallback(async(file:File)=>{try{applyProject(parseProject(await file.text()));}catch(error){setProjectMessage(error instanceof Error?error.message:String(error));}},[applyProject]);
  const exportTrace=useCallback(()=>{if(!state)return;downloadJson("pipeline-lab-trace.json",createTrace(loadedSource,state,timeline,reference));setProjectMessage("Execution trace downloaded.");},[state,loadedSource,timeline,reference]);
  const updateDraftConfiguration=<K extends keyof ProcessorConfiguration>(key:K,value:ProcessorConfiguration[K])=>{setDraftConfiguration(current=>({...current,[key]:value}));setConfigurationErrors([]);setPresetMessage("");};
  const loadSelectedPreset=useCallback(()=>{const preset=availablePresets.find(item=>item.id===selectedPresetId);if(!preset)return;setDraftConfiguration({...preset.configuration});setConfigurationErrors([]);setPresetMessage(`Loaded ${preset.name}; apply to reset the processor.`);},[availablePresets,selectedPresetId]);
  const saveCustomPreset=useCallback(()=>{const c=coreRef.current;const name=presetName.trim();if(!c||!name){setPresetMessage("Enter a preset name first.");return;}const validation=JSON.parse(c.validateConfigurationJson(JSON.stringify(draftConfiguration))) as ConfigurationValidation;if(!validation.ok){setConfigurationErrors(validation.errors);setPresetMessage("Fix the configuration before saving it.");return;}const matching=customPresets.find(item=>item.name.toLowerCase()===name.toLowerCase());const preset:ConfigurationPreset={id:matching?.id??`custom-${Date.now().toString(36)}`,name:name.slice(0,60),description:"Saved in this browser.",builtIn:false,configuration:validation.configuration};const next=matching?customPresets.map(item=>item.id===matching.id?preset:item):[...customPresets,preset].slice(-20);window.localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY,serializeCustomPresets(next));setCustomPresets(next);setSelectedPresetId(preset.id);setPresetName("");setPresetMessage(matching?`Updated ${preset.name}.`:`Saved ${preset.name}.`);},[customPresets,draftConfiguration,presetName]);
  const deleteCustomPreset=useCallback(()=>{const selected=customPresets.find(item=>item.id===selectedPresetId);if(!selected){setPresetMessage("Built-in presets cannot be deleted.");return;}const next=customPresets.filter(item=>item.id!==selected.id);window.localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY,serializeCustomPresets(next));setCustomPresets(next);setSelectedPresetId(BUILT_IN_PRESETS[0].id);setPresetMessage(`Deleted ${selected.name}.`);},[customPresets,selectedPresetId]);
  const loadLesson=useCallback((lesson:Lesson)=>{const example=examples.find(item=>item.id===lesson.exampleId);if(!example)return;const next={...activeConfiguration,...lesson.configuration};setActiveLessonId(lesson.id);setExampleId(example.id);setProjectName(lesson.title);loadWithConfiguration(example.source,next);},[activeConfiguration,loadWithConfiguration]);
  const runBenchmark=useCallback(async(kind:BenchmarkKind)=>{
    setBenchmarking(true); setBenchmark(null); setBenchmarkError("");
    try {
      const initial=JSON.parse(coreRef.current?.getInitialState()??'{"registers":[],"memory":[]}') as InitialState;
      const runs=[];
      for(const scenario of benchmarkScenarios(kind,activeConfiguration,availablePresets)){
        const c=await createSimulator();
        try {
          c.loadProgram(loadedSource); const applied=JSON.parse(c.applyConfigurationJson(JSON.stringify(scenario.configuration))) as ConfigurationValidation;if(!applied.ok)throw new Error(applied.errors.join(" "));
          initial.registers.forEach((value,index)=>c.setRegister(index,value));for(let address=0;address<initial.memory.length;address+=4096)c.writeMemory(address,initial.memory.slice(address,address+4096).join(","));
          c.runUntilCompletion(100000);
          const result=JSON.parse(c.getState()) as CpuState;
          const referenceResult=JSON.parse(c.compareReference()) as ReferenceComparison;
          runs.push({id:scenario.id,label:scenario.label,configuration:scenario.configuration,statistics:result.statistics,cache:{reads:result.cache.reads,writes:result.cache.writes,hits:result.cache.hits,misses:result.cache.misses,dirtyWritebacks:result.cache.dirtyWritebacks},architecturalMatch:referenceResult.matches});
        } finally { c.delete(); }
      }
      const titles:Record<BenchmarkKind,string>={suite:"Release performance matrix",forwarding:"Forwarding benchmark",prediction:"Branch predictor benchmark",cache:"Data-cache benchmark",custom:"Preset microarchitecture benchmark"};
      setBenchmark(createBenchmarkReport(titles[kind],kind,loadedSource,runs));
    } catch (error) {
      const message=`Benchmark failed: ${error instanceof Error?error.message:String(error)}`;setProjectMessage(message);setBenchmarkError(message);
    } finally { setBenchmarking(false); }
  },[activeConfiguration,availablePresets,loadedSource]);
  const exportBenchmark=useCallback((format:"json"|"csv")=>{if(!benchmark)return;if(format==="json")downloadJson("pipeline-lab-benchmark.json",benchmark);else downloadText("pipeline-lab-benchmark.csv",benchmarkCsv(benchmark),"text/csv");},[benchmark]);
  const closeLearning=useCallback(()=>setLearningOpen(false),[]);
  useEffect(()=>{const handle=(event:KeyboardEvent)=>{const target=event.target as HTMLElement|null;const editing=!!target?.closest("input, textarea, select, [contenteditable=true]");if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){event.preventDefault();assembleProgram();return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();saveProjectFile();return;}if(editing)return;if(event.key==="F10"){event.preventDefault();act(c=>event.shiftKey?c.stepInstruction():c.stepCycle());return;}if(event.key==="?"){event.preventDefault();setGuideOpen(true);}};window.addEventListener("keydown",handle);return()=>window.removeEventListener("keydown",handle);},[act,assembleProgram,saveProjectFile]);
  const pipelineLines=new Set(state?.pipeline.filter(s=>s.valid).map(s=>s.sourceLine));
  const addressForLine=(line:number)=>{const index=assembly.sourceLines.findIndex(value=>value===line);return index<0?null:index*4;};
  const currentLine=assembly.sourceLines[Math.floor((state?.pc??0)/4)]??0;
  const virtualIf:PipelineSlot=useMemo(()=>{const pc=state?.pc??0;const index=Math.floor(pc/4);const sourceLine=assembly.sourceLines[index]??0;const assemblyText=sourceLine>0?(loadedSource.split("\n")[sourceLine-1]?.trim()??""):"";return {stage:"IF",valid:!!state&&!state.halted&&!state.faulted&&index<assembly.words.length,stalled:false,bubble:false,squashed:false,id:0,pc,raw:assembly.words[index]??0,op:"FETCH",assembly:assemblyText||"instruction fetch",sourceLine,rs1:0,rs2:0,rd:0,usesRs1:false,usesRs2:false,writesRd:false,isLoad:false,isStore:false,immediate:0,rs1Value:0,rs2Value:0,operandA:0,operandB:0,aluResult:0,memoryAddress:0,memoryData:0,writeValue:0,regWrite:false,memRead:false,memWrite:false,predictedTaken:false,predictedTarget:pc+4,actualTaken:false,actualTarget:pc+4,mispredicted:false};},[state,assembly,loadedSource]);
  const slots=[virtualIf,...(state?.pipeline??[])];
  const selectedExample=examples.find(e=>e.id===exampleId);
  const selectedPreset=availablePresets.find(item=>item.id===selectedPresetId);
  const cacheWayBytes=draftConfiguration.cacheBlockSize*draftConfiguration.cacheAssociativity;
  const cacheSetCount=cacheWayBytes>0&&draftConfiguration.cacheCapacity%cacheWayBytes===0?draftConfiguration.cacheCapacity/cacheWayBytes:0;
  const executionDisabled=sourceDirty||!assembly.ok;
  const activeSlot=selectedStage?slots.find(slot=>slot.stage===selectedStage)??null:selectedSlot;
  const explanation=selectedEvent?.message ?? (activeSlot?.valid ? describeSlot(activeSlot) : selectedStage?`${selectedStage} is empty in the current cycle.`:"Select a stage, timeline cell, or event to see the exact values and decision that produced it.");

  if(error)return <main className="boot-error"><div><span>WASM INITIALIZATION FAILED</span><h1>Pipeline Lab could not start</h1><p>{error}</p><code>npm run wasm</code><small>Build the Emscripten module, then reload. The interface never substitutes a TypeScript CPU model.</small></div></main>;
  if(!state)return <main className="loading"><div className="cpu-loader"><i/><i/><i/><i/><i/><i/></div><p>INITIALIZING C++ CORE</p></main>;

  const st=state.statistics;const branchAccuracy=st.branches?100*st.correctPredictions/st.branches:0;
  return <main className={`lab density-${density}`}>
    <a className="skip-link" href="#simulator-workspace">Skip to simulator workspace</a>
    <header className="toolbar">
      <div className="brand"><div className="brand-mark"><i/><i/><i/><i/></div><div><h1>PIPELINE <b>LAB</b></h1><span>RISC-32 · 6 STAGE</span></div></div>
      <div className="toolbar-actions" aria-label="Simulator controls">
        <div className="control-group"><span>Program</span><button className="primary" onClick={assembleProgram} title="Assemble the editor text, load it into the CPU, and reset">Assemble</button><button onClick={()=>act(c=>{c.reset();setRunning(false);})} disabled={executionDisabled} title="Reset the currently loaded program with its applied configuration">Reset</button></div>
        <div className="control-group"><span>Execute</span><button className={running?"danger":"run"} disabled={executionDisabled} onClick={()=>setRunning(v=>!v)} title="Run continuously at the selected speed">{running?"Pause":"Run"}</button><button disabled={executionDisabled||running} onClick={()=>act(c=>c.stepCycle())} title="Advance exactly one clock cycle">Step cycle</button><button disabled={executionDisabled||running} onClick={()=>act(c=>c.stepInstruction())} title="Advance until one instruction retires">Step instruction</button></div>
        <details className="more-controls"><summary>More</summary><div><button disabled={executionDisabled||running} onClick={()=>act(c=>c.restorePreviousCycle())}><b>Undo cycle</b><small>Restore the previous CPU snapshot</small></button><button disabled={executionDisabled||running} onClick={()=>act(c=>c.runUntilBreakpoint(100000))}><b>Run to breakpoint</b><small>Stop before a marked source line</small></button><button disabled={executionDisabled||running} onClick={()=>act(c=>c.runUntilCompletion(100000))}><b>Run to completion</b><small>Run until HALT, fault, or limit</small></button><button onClick={saveProjectFile}><b>Download project</b><small>Save source, configuration, and breakpoints</small></button><button onClick={()=>importRef.current?.click()}><b>Import project</b><small>Open a .pipeline.json project</small></button><button onClick={saveBrowserDraft}><b>Save browser draft</b><small>Keep a private copy on this device</small></button><button onClick={restoreBrowserDraft}><b>Restore browser draft</b><small>Load the last device-local project</small></button><button onClick={exportTrace}><b>Export execution trace</b><small>Download timeline, events, and final state</small></button><label>Project name<input value={projectName} maxLength={100} onChange={e=>setProjectName(e.target.value)}/></label><label>Execution speed<input type="range" min="1" max="10" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/></label><label className="density-control">Interface density<select aria-label="Interface density" value={density} onChange={e=>setDensity(e.target.value as Density)}><option value="comfortable">Comfortable · larger</option><option value="compact">Compact · original</option></select></label>{projectMessage&&<p className="project-message" role="status">{projectMessage}</p>}</div></details>
      </div>
      <div className="run-status" aria-live="polite"><Metric label="Cycle" value={st.cycles}/><Metric label="Retired" value={st.retired}/><Metric label="CPI" value={st.cpi.toFixed(2)}/><div className={`status-pill status-${state.status}`}><i/>{state.status}</div><button className="learn-button" onClick={()=>setLearningOpen(true)} aria-haspopup="dialog">Learn</button><button className="guide-button" onClick={()=>setGuideOpen(true)} aria-haspopup="dialog">Guide</button></div>
    </header>
    <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json,.pipeline.json" aria-label="Import Pipeline Lab project" onChange={e=>{const file=e.target.files?.[0];if(file)void importProject(file);e.currentTarget.value="";}}/>

    {forwarding==="manual"&&<div className="manual-warning"><b>MANUAL HAZARD MODE</b> Automatic dependency stalls are disabled. This configuration intentionally permits architecturally incorrect results unless the program is scheduled with NOPs.</div>}
    <section className="workspace" id="simulator-workspace" tabIndex={-1}>
      <aside className="left-column">
        <div className="example-picker"><label>Program<select value={exampleId} onChange={e=>{const x=examples.find(v=>v.id===e.target.value);if(!x)return;setExampleId(x.id);assembleSource(x.source);}}><option value="custom">Custom program</option>{examples.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><p>{selectedExample?.focus??"Your edited source. Assemble it before execution."}</p><small>Selecting an example loads it into the CPU immediately.</small></div>
        <Editor source={source} dirty={sourceDirty} setSource={text=>{setSource(text);setExampleId("custom");setSourceDirty(true);setRunning(false);}} errors={assembly.errors} pipelineLines={pipelineLines} breakpoints={breakpointLines} currentLine={currentLine} toggleBreakpoint={line=>{const address=addressForLine(line);if(address===null)return;const next=new Set(breakpointLines);const enabled=!next.has(line);if(enabled)next.add(line);else next.delete(line);setBreakpointLines(next);act(c=>c.setBreakpoint(address,enabled));}}/>
        <details className="configuration"><summary><span><b>Processor configuration</b><small>{configurationSummary(activeConfiguration)}</small></span><i>⌄</i></summary><div className="configuration-body">
          <div className="preset-panel"><label>Microarchitecture preset<select value={selectedPresetId} onChange={e=>setSelectedPresetId(e.target.value)}>{BUILT_IN_PRESETS.map(preset=><option value={preset.id} key={preset.id}>{preset.name}</option>)}{customPresets.length>0&&<optgroup label="Saved in this browser">{customPresets.map(preset=><option value={preset.id} key={preset.id}>{preset.name}</option>)}</optgroup>}</select></label><p>{selectedPreset?.description}</p><div><button type="button" onClick={loadSelectedPreset}>Load preset</button><button type="button" onClick={deleteCustomPreset} disabled={selectedPreset?.builtIn!==false}>Delete saved</button></div><label>New preset name<input value={presetName} maxLength={60} placeholder="My cache experiment" onChange={e=>setPresetName(e.target.value)}/></label><button type="button" onClick={saveCustomPreset}>Save current settings</button>{presetMessage&&<small className="preset-message" role="status">{presetMessage}</small>}</div>
          <label>Hazard handling<select value={draftConfiguration.forwarding} onChange={e=>updateDraftConfiguration("forwarding",e.target.value as ProcessorConfiguration["forwarding"])}><option value="full">Full forwarding</option><option value="none">No forwarding</option><option value="manual">Manual / unsafe</option></select></label>
          <label>Branch predictor<select value={draftConfiguration.predictor} onChange={e=>updateDraftConfiguration("predictor",e.target.value as ProcessorConfiguration["predictor"])}><option value="always-not-taken">Always not taken</option><option value="always-taken">Always taken</option><option value="one-bit">One-bit table</option><option value="two-bit">Two-bit saturating</option></select></label>
          <label>Predictor entries<input type="number" min="1" max="1024" step="1" value={draftConfiguration.predictorEntries} onChange={e=>updateDraftConfiguration("predictorEntries",Number(e.target.value))}/><small>Power of two · 1–1024</small></label>
          <label className="switch"><span><b>Educational data cache</b><small>LRU · write-back · write-allocate</small></span><input type="checkbox" checked={draftConfiguration.cacheEnabled} onChange={e=>updateDraftConfiguration("cacheEnabled",e.target.checked)}/><i/></label>
          <div className="cache-config-grid">
            <label>Capacity (bytes)<input type="number" min="16" max="65536" value={draftConfiguration.cacheCapacity} onChange={e=>updateDraftConfiguration("cacheCapacity",Number(e.target.value))}/></label>
            <label>Block size (bytes)<input type="number" min="4" max="256" value={draftConfiguration.cacheBlockSize} onChange={e=>updateDraftConfiguration("cacheBlockSize",Number(e.target.value))}/></label>
            <label>Associativity (ways)<input type="number" min="1" max="16" value={draftConfiguration.cacheAssociativity} onChange={e=>updateDraftConfiguration("cacheAssociativity",Number(e.target.value))}/></label>
            <label>Hit latency<input type="number" min="1" max="20" value={draftConfiguration.cacheHitLatency} onChange={e=>updateDraftConfiguration("cacheHitLatency",Number(e.target.value))}/></label>
            <label>Miss penalty<input type="number" min="1" max="1000" value={draftConfiguration.cacheMissPenalty} onChange={e=>updateDraftConfiguration("cacheMissPenalty",Number(e.target.value))}/></label>
          </div>
          <div className="configuration-preview"><b>{cacheSetCount||"—"} sets</b><span>{draftConfiguration.cacheAssociativity} ways × {draftConfiguration.cacheBlockSize} B · hit {draftConfiguration.cacheHitLatency} · miss +{draftConfiguration.cacheMissPenalty}</span></div>
          {configurationErrors.length>0&&<div className="configuration-errors" role="alert"><b>Configuration not applied</b>{configurationErrors.map(message=><span key={message}>{message}</span>)}</div>}
          <p>Settings are validated by the C++ core. Changes take effect only after applying and resetting.</p><button className="apply-configuration" onClick={assembleProgram}>Apply & reset processor</button>
        </div></details>
      </aside>

      <section className="main-column">
        <div className="pipeline-panel"><div className="section-heading"><div><span className="eyebrow">CURRENT CYCLE · {st.cycles}</span><h2>Six-stage pipeline</h2></div><div className="legend"><span><i className="normal"/>active</span><span><i className="stall"/>stalled</span><span><i className="forward"/>forward</span><span><i className="flush"/>flushed</span></div></div>
          <div className="stage-flow">{STAGES.map((name,i)=><div className="stage-item" key={name}><StageCard slot={slots[i]??virtualIf} selected={selectedStage===name} onSelect={()=>{setSelectedStage(name);setSelectedSlot(slots[i]);setSelectedEvent(null);}}/>{i<5&&<div className="stage-arrow">→<small>{name==="EX"?"result":name==="MEM2"?"data":"latch"}</small></div>}</div>)}</div>
          <div className="forwarding-strip"><span>FORWARDING NETWORK</span><div><i/><b>EX/MEM1 → EX</b></div><div><i/><b>MEM1/MEM2 → EX</b></div><div><i/><b>MEM2/WB → EX</b></div><em>{st.forwardingEvents} events</em></div>
        </div>
        <Timeline frames={timeline} onSelect={s=>{setSelectedStage(null);setSelectedSlot(s);setSelectedEvent(null);}}/>
        <div className="lower-grid">
          <div className="datapath"><div className="section-heading compact"><div><span className="eyebrow">EDUCATIONAL VIEW</span><h2>Active datapath</h2></div><span className="section-note">Select a pipeline stage to update values</span></div><div className="datapath-canvas">
            <div className="dp-node pc"><span>PC</span><b>{hex(state.pc,4)}</b></div><div className="path-arrow a1">→</div><div className="dp-node imem"><span>Instruction memory</span><small>Fetch one 32-bit word</small></div><div className="path-arrow a2">→</div><div className="dp-node regs"><span>Register file</span><small>Read rs1 and rs2</small></div><div className="path-arrow a3">→</div><div className="dp-node alu"><span>ALU</span><b>{activeSlot?.valid?hex(activeSlot.aluResult):"—"}</b></div><div className="path-arrow a4">→</div><div className="dp-node dmem"><span>{cacheEnabled?"Data cache":"Data memory"}</span><small>MEM1 → MEM2</small></div><div className="dp-node branch"><span>Branch unit</span><small>Resolve direction in EX</small></div><div className="dp-node hazard"><span>Hazard unit</span><small>{forwarding} mode</small></div><div className="dp-node fwd"><span>Forwarding unit</span><small>{st.forwardingEvents} selections</small></div>
          </div></div>
          <div className="explanation"><div className="section-heading compact"><div><span className="eyebrow">WHY THIS HAPPENED</span><h2>Explanation</h2></div></div><p>{explanation}</p>{state.events.length>0&&<div className="current-events">{state.events.map((e,i)=><button key={i} onClick={()=>{setSelectedEvent(e);setSelectedStage(null);setSelectedSlot(null);}}><i className={`event-dot ${e.type}`}/><span>{e.message}</span><b>{e.stage||"CORE"}</b></button>)}</div>}{reference&&<div className={`correctness-card ${reference.matches?"matches":"differs"}`}><b>{reference.matches?"✓ Architectural result verified":"Reference mismatch found"}</b><span>{reference.message}</span>{reference.differences.slice(0,3).map(item=><code key={item.register}>r{item.register}: got {signed(item.actual)}, expected {signed(item.expected)}</code>)}{reference.memoryDifferences.slice(0,3).map(item=><code key={`m-${item.address}`}>{hex(item.address,4)}: got {item.actual}, expected {item.expected}</code>)}{!reference.matches&&<button onClick={()=>{setActiveLessonId("manual-correctness");setLearningOpen(true);}}>Explain this mismatch</button>}</div>}<div className="principle"><b>Timing rule</b><span>Loads become forwardable from MEM1/MEM2 while executing their MEM2 completion cycle. A directly dependent instruction therefore needs one bubble.</span></div></div>
        </div>
        <section className="inspectors"><div className="inspector-heading"><div><span className="eyebrow">ARCHITECTURAL STATE</span><h2>State inspectors</h2></div><span>Pause execution to edit registers or memory</span></div><div className="inspector-tabs" role="tablist" aria-label="Processor state inspectors">{TABS.map(t=>{const id=t.toLowerCase().replaceAll(" ","-");return <button id={`tab-${id}`} aria-controls="inspector-panel" role="tab" aria-selected={activeTab===t} className={activeTab===t?"active":""} onClick={()=>setActiveTab(t)} key={t}>{t}{t==="Event log"&&state.events.length>0?<b>{state.events.length}</b>:null}</button>})}</div><div id="inspector-panel" className="inspector-content" role="tabpanel" aria-labelledby={`tab-${activeTab.toLowerCase().replaceAll(" ","-")}`}>{simulator&&<Inspector tab={activeTab} state={state} simulator={simulator} refresh={refresh} memoryAddress={memoryAddress} setMemoryAddress={setMemoryAddress} paused={!running}/>}</div></section>
      </section>
    </section>
    {guideOpen&&<div className="guide-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setGuideOpen(false);}}><section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title"><button className="guide-close" onClick={()=>setGuideOpen(false)} aria-label="Close guide">×</button><span className="eyebrow">QUICK START</span><h2 id="guide-title">How to use Pipeline Lab</h2><p className="guide-intro">Choose an example or write assembly, then watch the C++ processor advance one clock at a time. The source shown in the editor is always the program loaded in the CPU unless the editor displays “Changes not assembled.”</p><div className="guide-grid"><article><b>1. Load a program</b><p>Example programs assemble automatically. For your own edits, click <strong>Assemble</strong>. Red line messages identify invalid syntax.</p></article><article><b>2. Execute precisely</b><p><strong>Run</strong> animates cycles. <strong>Step cycle</strong> advances one clock. <strong>Step instruction</strong> advances until one instruction retires.</p></article><article><b>3. Inspect the pipeline</b><p>Click a stage or timeline cell to populate the Explanation panel with operands, results, hazards, forwarding, stalls, and flushes.</p></article><article><b>4. Use breakpoints</b><p>Click a source line number, then choose <strong>More → Run to breakpoint</strong>. Undo restores the previous deterministic cycle.</p></article><article><b>5. Compare configurations</b><p>Open Processor configuration to load or save presets and tune predictor/cache geometry. The C++ core validates settings before Apply & reset; Performance → Current + presets compares them.</p></article><article><b>6. Adjust readability</b><p>Choose <strong>More → Interface density</strong>. Comfortable uses larger text and roomier diagrams; Compact restores the original dense workbench.</p></article></div><div className="guide-tip"><b>Best first lesson</b><span>Load “Load-use hazard,” step cycle-by-cycle, and click the stalled timeline cell to see why one bubble is required.</span></div></section></div>}
    <LearningCenter open={learningOpen} state={state} reference={reference} activeLessonId={activeLessonId} benchmark={benchmark} benchmarking={benchmarking} benchmarkError={benchmarkError} benchmarkPresetCount={availablePresets.length} onClose={closeLearning} onLoadLesson={loadLesson} onRunBenchmark={runBenchmark} onExportBenchmark={exportBenchmark}/>
    <footer><span>C++20 / WebAssembly core</span><span>IF → ID → EX → MEM1 → MEM2 → WB</span><span>Branch accuracy {branchAccuracy.toFixed(1)}%</span></footer>
  </main>;
}
