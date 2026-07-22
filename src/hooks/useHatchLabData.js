import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

const resources = { tests: 'LabTest', cases: 'LabCase', rules: 'RuleCandidate', evidence: 'Evidence', physicalResults: 'PhysicalResult' };
export default function useHatchLabData() {
  const [data, setData] = useState({ tests: [], cases: [], rules: [], evidence: [], physicalResults: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const entries = await Promise.all(Object.entries(resources).map(async ([key, entity]) => [key, await base44.entities[entity].list('-created_date', 500)]));
      setData(Object.fromEntries(entries));
    } catch (e) { setError(e?.message || 'No se pudieron cargar los datos del laboratorio.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const create = async (key, value) => { await base44.entities[resources[key]].create(value); await reload(); };
  const update = async (key, id, value) => { await base44.entities[resources[key]].update(id, value); await reload(); };
  const remove = async (key, id) => { await base44.entities[resources[key]].delete(id); await reload(); };
  const importMany = async (key, values) => { if (values.length) await base44.entities[resources[key]].bulkCreate(values); await reload(); };
  const upload = async (file) => (await base44.integrations.Core.UploadFile({ file })).file_url;
  return { data, loading, error, create, update, remove, importMany, upload };
}