import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';

const ReferenceLearningPanel = lazy(() => import('@/components/referenceLearning/ReferenceLearningPanel'));

export default function ReferenceLearningPage() {
  return (
    <div className="min-h-screen bg-[#0d0f14] text-white">
      <header className="border-b border-[#1e2130] bg-[#0a0c12] sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link to="/" className="p-1.5 rounded-lg hover:bg-[#1e2130] text-slate-500 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <h1 className="text-sm font-bold">Aprendizaje de Referencias</h1>
            <span className="text-[10px] text-amber-400 bg-amber-900/20 border border-amber-500/30 rounded px-1.5 py-0.5">
              Modo diagnóstico
            </span>
          </div>
        </div>
      </header>
      <div className="p-4 max-w-6xl mx-auto">
        <Suspense fallback={<div className="flex min-h-64 items-center justify-center gap-3 text-xs text-slate-400"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /> Cargando herramientas de aprendizaje…</div>}>
          <ReferenceLearningPanel />
        </Suspense>
      </div>
    </div>
  );
}