export default function ValidationModeSelector({ value = 'universal', onChange }) {
  const modes = [
    ['universal', 'Universal'],
    ['format', 'Formato'],
    ['machine_profile', 'Máquina'],
    ['ce01_strict', 'CE01 estricto'],
  ];
  return (
    <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-2">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Validación</div>
      <div className="grid grid-cols-2 gap-1">
        {modes.map(([id, label]) => (
          <button key={id} onClick={() => onChange(id)} className={`rounded-md px-2 py-1.5 text-[10px] font-bold transition-colors ${value === id ? 'bg-violet-600 text-white' : 'border border-[#2a2d3a] text-slate-500 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-slate-600">Por defecto universal. CE01 estricto solo para pruebas específicas.</p>
    </div>
  );
}