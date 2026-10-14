import { X } from "lucide-react";
import { MATS, ROUNDS } from "../game/engine";

export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-white/10 bg-[#14181f] p-6 text-slate-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-orange-400">ArmorSim 2D — Field Manual</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <section className="mb-4 space-y-1.5 text-sm text-slate-300">
          <h3 className="font-semibold text-slate-100">How it works</h3>
          <p>
            Armor is a lattice of mass nodes joined by springs. Springs stretch elastically, yield into
            permanent dents past a strain limit, and snap past a tear limit — so plates dent, bulge and
            eventually spall apart realistically under impact.
          </p>
        </section>

        <section className="mb-4 space-y-1.5 text-sm text-slate-300">
          <h3 className="font-semibold text-slate-100">Controls</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Draw Armor</b> — paint the chosen material onto the grid.</li>
            <li><b>Erase</b> — remove nodes. Right-click also erases in any tool.</li>
            <li><b>Draw Bullet</b> — freehand a custom projectile shape, released as a draggable round.</li>
            <li><b>Fling</b> — drag on empty space to fire the selected round, or drag from a drawn bullet to launch it like a slingshot.</li>
            <li><b>Space</b> — pause / resume the simulation.</li>
            <li><b>Pin</b> — new armor painted while this is on is bolted in place (immovable).</li>
          </ul>
        </section>

        <section className="mb-4 space-y-1.5 text-sm text-slate-300">
          <h3 className="font-semibold text-slate-100">Materials</h3>
          <ul className="space-y-1">
            {MATS.map((m) => (
              <li key={m.n} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm border border-white/20" style={{ background: m.c }} />
                <b className="w-20 shrink-0">{m.n}</b>
                <span className="text-slate-400">
                  {m.n === "Steel" && "Balanced strength and toughness, the baseline plate."}
                  {m.n === "Aluminum" && "Light and soft, dents and tears easily."}
                  {m.n === "Ceramic" && "Very hard and stiff, but shatters past its brittle limit."}
                  {m.n === "Kevlar" && "Flexible and very tear-resistant, poor at stopping hard points."}
                  {m.n === "Rubber" && "Highly elastic, absorbs and rebounds impacts."}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-1.5 text-sm text-slate-300">
          <h3 className="font-semibold text-slate-100">Rounds</h3>
          <ul className="space-y-1">
            {ROUNDS.map((r) => (
              <li key={r.n} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full border border-white/20" style={{ background: r.c }} />
                <b className="w-20 shrink-0">{r.n}</b>
                <span className="text-slate-400">{r.desc}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
