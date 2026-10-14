import { useEffect, useRef, useState } from "react";
import {
  Brush,
  Eraser,
  PenLine,
  Rocket,
  Pin,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Gauge,
  HelpCircle,
  Trash2,
  Save,
  FolderOpen,
  ChevronDown,
  Waves,
  Shield,
} from "lucide-react";
import { ArmorSimEngine, MATS, ROUNDS, type Stats } from "../game/engine";
import HelpModal from "./HelpModal";

const TOOLS = [
  { label: "Draw armor", icon: Brush },
  { label: "Erase", icon: Eraser },
  { label: "Draw bullet", icon: PenLine },
  { label: "Fling", icon: Rocket },
] as const;

const SPEEDS = [
  { label: "0.1×", v: 0.1 },
  { label: "0.3×", v: 0.3 },
  { label: "1×", v: 1 },
];

const PRESETS = [
  { id: "steel", label: "Steel Plate" },
  { id: "composite", label: "Composite (steel+ceramic)" },
  { id: "spaced", label: "Spaced Armor" },
  { id: "kevlar", label: "Kevlar Vest" },
  { id: "reactive", label: "Layered Reactive" },
  { id: "rubble", label: "Random Rubble" },
];

const STATUS_COLOR: Record<string, string> = {
  "Went through": "text-rose-400",
  Ricochet: "text-amber-300",
  "Stopped in armor": "text-emerald-400",
  Penetrating: "text-orange-400",
  Detonated: "text-rose-400",
  Shattered: "text-rose-300",
  "In flight": "text-sky-300",
  "Ready to fling": "text-slate-300",
  "None yet": "text-slate-500",
};

const defaultStats: Stats = {
  speedMps: 0, torn: 0, status: "None yet", shots: 0, penetrations: 0,
  ricochets: 0, stopped: 0, through: 0, shattered: 0, nodes: 0, fps: 60,
};

export default function ArmorSimGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ArmorSimEngine | null>(null);

  const [tool, setTool] = useState(0);
  const [mat, setMat] = useState(0);
  const [rnd, setRnd] = useState(0);
  const [brush, setBrush] = useState(3);
  const [pinOn, setPinOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [gravity, setGravity] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(defaultStats);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new ArmorSimEngine(canvasRef.current);
    engineRef.current = engine;
    engine.onStats(setStats);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) setPaused(engine.togglePaused());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      engine.destroy();
    };
  }, []);

  useEffect(() => {
    if (!saveMsg) return;
    const id = setTimeout(() => setSaveMsg(null), 1800);
    return () => clearTimeout(id);
  }, [saveMsg]);

  const e = () => engineRef.current;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0a0d11] text-slate-200">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#12161d]/95 px-3 py-2 shadow-sm">
        <div className="mr-2 flex items-center gap-1.5 pr-2">
          <Shield size={18} className="text-orange-400" />
          <span className="text-sm font-semibold tracking-tight text-slate-100">ArmorSim 2D</span>
        </div>

        <Group label="Tool">
          {TOOLS.map((t, i) => (
            <IconButton key={t.label} active={tool === i} label={t.label} onClick={() => { setTool(i); e()?.setTool(i as 0 | 1 | 2 | 3); }}>
              <t.icon size={15} />
            </IconButton>
          ))}
        </Group>

        <Group label="Material">
          {MATS.map((m, i) => (
            <button
              key={m.n}
              onClick={() => { setMat(i); e()?.setMaterial(i); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition ${mat === i ? "bg-orange-500 text-white" : "text-slate-300 hover:bg-white/10"}`}
              title={m.n}
            >
              <span className="h-2.5 w-2.5 rounded-sm border border-black/20" style={{ background: m.c }} />
              {m.n}
            </button>
          ))}
        </Group>

        <Group label="Round">
          {ROUNDS.map((r, i) => (
            <button
              key={r.n}
              onClick={() => { setRnd(i); e()?.setRound(i); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition ${rnd === i ? "bg-orange-500 text-white" : "text-slate-300 hover:bg-white/10"}`}
              title={r.desc}
            >
              <span className="h-2.5 w-2.5 rounded-full border border-black/20" style={{ background: r.c }} />
              {r.n}
            </button>
          ))}
        </Group>

        <label className="flex items-center gap-2 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-400">
          Brush
          <input
            type="range" min={1} max={6} value={brush}
            onChange={(ev) => { const v = +ev.target.value; setBrush(v); e()?.setBrush(v); }}
            className="w-20 accent-orange-500"
          />
        </label>

        <ToggleButton active={pinOn} onClick={() => { const v = !pinOn; setPinOn(v); e()?.setPin(v); }} title="Newly drawn armor becomes fixed, like a bolted frame">
          <Pin size={14} /> Pin {pinOn ? "on" : "off"}
        </ToggleButton>

        <ToggleButton active={gravity} onClick={() => { const v = !gravity; setGravity(v); e()?.setGravity(v); }} title="Toggle gravity on bullets and debris">
          <Waves size={14} /> Gravity {gravity ? "on" : "off"}
        </ToggleButton>

        <Group label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              onClick={() => { setSpeed(s.v); e()?.setSpeed(s.v); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition ${speed === s.v ? "bg-orange-500 text-white" : "text-slate-300 hover:bg-white/10"}`}
            >
              {s.label}
            </button>
          ))}
        </Group>

        <IconButton active={paused} label={paused ? "Resume" : "Pause"} onClick={() => setPaused(e()!.togglePaused())}>
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </IconButton>

        <IconButton active={muted} label={muted ? "Unmute" : "Mute"} onClick={() => { const v = !muted; setMuted(v); e()?.setMuted(v); }}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </IconButton>

        <div className="relative">
          <button
            onClick={() => setShowScenarios((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10"
          >
            Scenarios <ChevronDown size={13} />
          </button>
          {showScenarios && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-md border border-white/10 bg-[#171c24] py-1 shadow-xl">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { e()?.preset(p.id); setShowScenarios(false); }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-orange-500/20 hover:text-orange-200"
                >
                  {p.label}
                </button>
              ))}
              <div className="my-1 border-t border-white/10" />
              <button
                onClick={() => { e()?.save(); setSaveMsg("Armor saved"); setShowScenarios(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-white/10"
              >
                <Save size={13} /> Save current armor
              </button>
              <button
                onClick={() => { const ok = e()?.load(); setSaveMsg(ok ? "Armor loaded" : "No save found"); setShowScenarios(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-white/10"
              >
                <FolderOpen size={13} /> Load saved armor
              </button>
            </div>
          )}
        </div>

        <IconButton label="Clear everything" onClick={() => e()?.clear()}>
          <Trash2 size={15} />
        </IconButton>

        <div className="ml-auto flex items-center gap-2">
          {saveMsg && <span className="rounded-md bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300">{saveMsg}</span>}
          <IconButton label="Help" onClick={() => setShowHelp(true)}>
            <HelpCircle size={15} />
          </IconButton>
        </div>
      </div>

      {/* Canvas area */}
      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair touch-none" />

        {/* Stats overlay */}
        <div className="pointer-events-none absolute right-3 top-3 w-52 rounded-lg border border-white/10 bg-[#12161d]/85 p-3 text-xs text-slate-300 shadow-lg backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5">
            <span className="flex items-center gap-1 font-semibold text-slate-100"><Gauge size={13} /> Telemetry</span>
            <span className="text-slate-500">{stats.fps} fps</span>
          </div>
          <Row label="Status" value={<span className={STATUS_COLOR[stats.status] ?? "text-slate-300"}>{stats.status}</span>} />
          <Row label="Speed" value={`${stats.speedMps} m/s`} />
          <Row label="Shots fired" value={stats.shots} />
          <Row label="Went through" value={stats.through} />
          <Row label="Ricochets" value={stats.ricochets} />
          <Row label="Stopped" value={stats.stopped} />
          <Row label="Detonated" value={stats.penetrations} />
          <Row label="Shattered" value={stats.shattered} />
          <Row label="Links torn" value={stats.torn} />
          <Row label="Armor nodes" value={stats.nodes} />
        </div>
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-white/10" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function IconButton({ children, label, active, onClick }: { children: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs transition ${active ? "bg-orange-500 text-white border-orange-500" : "text-slate-300 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}

function ToggleButton({ children, active, onClick, title }: { children: React.ReactNode; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${active ? "border-orange-500 bg-orange-500/20 text-orange-300" : "border-white/10 text-slate-300 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium tabular-nums text-slate-200">{value}</span>
    </div>
  );
}
