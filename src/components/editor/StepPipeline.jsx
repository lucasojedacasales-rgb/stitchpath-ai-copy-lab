import { Check } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'Subir imagen', desc: 'Carga tu diseño' },
  { id: 2, label: 'Vectorizar', desc: 'IA extrae objetos' },
  { id: 3, label: 'Ajustar', desc: 'Modifica puntadas' },
  { id: 4, label: 'Simular', desc: 'Previsualiza' },
  { id: 5, label: 'Exportar', desc: 'DST, PES, JEF...' },
];

export default function StepPipeline({ currentStep }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const done = currentStep > step.id;
        const active = currentStep === step.id;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
                ${done ? 'bg-emerald-500 text-white' : active ? 'bg-violet-600 text-white ring-2 ring-violet-400/40' : 'bg-[#1e2130] text-slate-500 border border-[#2a2d3a]'}`}>
                {done ? <Check className="w-3 h-3" /> : step.id}
              </div>
              <div className="hidden sm:flex flex-col items-center mt-1">
                <span className={`text-[10px] font-semibold whitespace-nowrap ${active ? 'text-violet-400' : done ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {step.label}
                </span>
              </div>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`w-8 h-px mx-1 transition-all ${done ? 'bg-emerald-500/50' : 'bg-[#2a2d3a]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}