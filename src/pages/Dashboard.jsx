import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Folder, Clock, Layers, Palette, ChevronRight, Search, Trash2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const STATUS_COLORS = {
  draft: 'text-slate-500 bg-slate-800/40',
  processing: 'text-amber-400 bg-amber-900/30',
  ready: 'text-emerald-400 bg-emerald-900/30',
  exported: 'text-cyan-400 bg-cyan-900/30',
};

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.Project.list('-updated_date', 50);
      setProjects(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    try {
      const p = await base44.entities.Project.create({ name: 'Nuevo diseño', step: 1, status: 'draft' });
      navigate(`/editor/${p.id}`);
    } catch (e) {
      console.error('createProject:', e);
    }
  };

  const deleteProject = async (e, id) => {
    e.stopPropagation();
    setProjects(ps => ps.filter(p => p.id !== id));
    try {
      await base44.entities.Project.delete(id);
    } catch (err) {
      // Already deleted or not found — UI already updated, no action needed
      console.warn('deleteProject:', err.message);
    }
  };

  const filtered = projects.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen bg-[#0d0f14] text-white">
      {/* Header */}
      <div className="border-b border-[#1e2130] px-8 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <span className="text-base">🧵</span>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">StitchFlow IA</h1>
              <p className="text-[11px] text-slate-500">Motor de digitalización avanzado</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/reference-learning')}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a] hover:border-violet-500 text-slate-300 text-sm font-medium transition-colors"
              title="Aprendizaje de referencias profesionales"
            >
              ✨ Aprendizaje de referencias
            </button>
            <button
              onClick={() => navigate('/regression')}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a] hover:border-violet-500 text-slate-300 text-sm font-medium transition-colors"
              title="Abrir suite de regresión"
            >
              🧪 Abrir regresión
            </button>
            <button
              onClick={createProject}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" /> Nuevo proyecto
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8">
        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
          <input
            type="text" placeholder="Buscar proyectos..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full max-w-sm bg-[#161a23] border border-[#2a2d3a] rounded-lg pl-9 pr-4 py-2.5 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-500"
          />
        </div>

        <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm text-slate-300">
          <div className="mb-2 font-bold text-emerald-300">Prueba recomendada:</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Exporta primero DSB.</li>
            <li>Si DSB no abre, prueba DST.</li>
            <li>Haz foto de la pantalla de la máquina.</li>
            <li>Comprueba si la máquina muestra tamaño, colores y puntadas.</li>
            <li>No bordar todavía si visualmente ves líneas peligrosas; primero confirmar que lo acepta.</li>
          </ol>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#161a23] border border-[#2a2d3a] flex items-center justify-center text-3xl">🧵</div>
            <div className="text-center">
              <h3 className="text-base font-semibold text-white mb-1">{search ? 'Sin resultados' : 'Sin proyectos aún'}</h3>
              <p className="text-sm text-slate-500">{search ? 'Prueba con otro término' : 'Crea tu primer diseño de bordado'}</p>
            </div>
            {!search && (
              <button onClick={createProject} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">
                <Plus className="w-4 h-4" /> Crear primer proyecto
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(project => (
              <div
                key={project.id}
                onClick={() => navigate(`/editor/${project.id}`)}
                className="group bg-[#161a23] border border-[#2a2d3a] rounded-xl overflow-hidden cursor-pointer hover:border-violet-500/40 hover:bg-[#1a1e2d] transition-all"
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-[#1a1a2e] flex items-center justify-center relative overflow-hidden stitch-canvas-grid">
                  {project.image_url ? (
                    <img src={project.image_url} alt={project.name} className="w-full h-full object-contain" />
                  ) : (
                    <Folder className="w-10 h-10 text-[#2a2d3a]" />
                  )}
                  <div className="absolute top-2 right-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[project.status] || STATUS_COLORS.draft}`}>
                      {project.status || 'draft'}
                    </span>
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-semibold text-white leading-tight truncate pr-2">{project.name}</h3>
                    <button
                      onClick={e => deleteProject(e, project.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-900/30 text-slate-600 hover:text-red-400 transition-all flex-shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-600">
                    {project.total_stitches > 0 && (
                      <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{project.total_stitches.toLocaleString()}</span>
                    )}
                    {project.color_count > 0 && (
                      <span className="flex items-center gap-1"><Palette className="w-3 h-3" />{project.color_count}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-600">
                    <Clock className="w-3 h-3" />
                    {new Date(project.updated_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}