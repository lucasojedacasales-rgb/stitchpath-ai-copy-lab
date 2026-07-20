export async function normalizeBackendFileResponse(responseData, responseMeta = {}) {
  const status = responseMeta.status ?? responseData?.status ?? null;
  const raw = responseData?.data !== undefined ? responseData.data : responseData;
  const diagnostics = buildDiagnostics(raw, status);

  if (raw instanceof Blob) {
    const bytes = new Uint8Array(await raw.arrayBuffer());
    ensureBinaryLooksValid(bytes, diagnostics);
    return { blob: raw, bytes, diagnostics: { ...diagnostics, detectedType: 'Blob' } };
  }
  if (raw instanceof ArrayBuffer) {
    const bytes = new Uint8Array(raw);
    ensureBinaryLooksValid(bytes, diagnostics);
    return { blob: new Blob([bytes], { type: 'application/octet-stream' }), bytes, diagnostics: { ...diagnostics, detectedType: 'ArrayBuffer' } };
  }
  if (raw instanceof Uint8Array) {
    ensureBinaryLooksValid(raw, diagnostics);
    return { blob: new Blob([raw], { type: 'application/octet-stream' }), bytes: raw, diagnostics: { ...diagnostics, detectedType: 'Uint8Array' } };
  }

  const backendError = getBackendError(raw);
  if (backendError) throw invalidBase64Error('Backend devolvió error en vez de archivo', { ...diagnostics, backendError });

  let value = extractBase64Candidate(raw);
  if (typeof value !== 'string') throw invalidBase64Error('Backend no devolvió base64 válido', diagnostics);

  const parsedJson = parseJsonString(value);
  if (parsedJson) {
    const jsonError = getBackendError(parsedJson);
    if (jsonError) throw invalidBase64Error('Backend devolvió JSON de error', { ...diagnostics, backendError: jsonError });
    value = extractBase64Candidate(parsedJson);
  }

  if (typeof value !== 'string') throw invalidBase64Error('Backend no devolvió base64 válido', diagnostics);
  const clean = cleanBase64(value);
  if (!isValidBase64(clean)) throw invalidBase64Error('Backend no devolvió base64 válido', diagnostics);

  const bytes = decodeBase64ToBytes(clean, diagnostics);
  ensureBinaryLooksValid(bytes, diagnostics);
  if (looksLikeBase64Text(bytes)) throw invalidBase64Error('Backend devolvió base64 doble o texto base64 sin decodificar', diagnostics);

  return {
    blob: new Blob([bytes], { type: 'application/octet-stream' }),
    bytes,
    diagnostics: { ...diagnostics, detectedType: diagnostics.detectedType || typeof raw, base64Length: clean.length },
  };
}

function extractBase64Candidate(raw) {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return raw.file_base64 || raw.base64 || raw.data || null;
  return null;
}

function parseJsonString(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function cleanBase64(value) {
  let text = String(value || '').trim();
  const comma = text.indexOf(',');
  if (/^data:.*;base64,/i.test(text) && comma !== -1) text = text.slice(comma + 1);
  text = text.replace(/\s+/g, '');
  const remainder = text.length % 4;
  if (remainder === 2) text += '==';
  else if (remainder === 3) text += '=';
  return text;
}

function isValidBase64(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.length % 4 !== 0) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function decodeBase64ToBytes(value, diagnostics) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (error) {
    throw invalidBase64Error('Backend no devolvió base64 válido', { ...diagnostics, backendError: error.message });
  }
}

function getBackendError(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return raw.error || raw.message || raw.details?.message || raw.details?.error || null;
}

function ensureBinaryLooksValid(bytes, diagnostics) {
  if (!bytes || bytes.length === 0) throw invalidBase64Error('Backend no devolvió base64 válido', diagnostics);
  const text = asciiSample(bytes, 200).trim().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html')) throw invalidBase64Error('Backend devolvió HTML en vez de archivo binario', diagnostics);
  if (text.startsWith('{') || text.startsWith('[') || text.includes('"error"')) throw invalidBase64Error('Backend devolvió JSON de error en vez de archivo binario', diagnostics);
}

function looksLikeBase64Text(bytes) {
  if (!bytes || bytes.length < 80) return false;
  const sample = asciiSample(bytes, Math.min(300, bytes.length)).trim();
  return /^[A-Za-z0-9+/=\r\n]+$/.test(sample) && !sample.includes('LA:') && sample.length > 80;
}

function asciiSample(bytes, max) {
  return Array.from(bytes.slice(0, max)).map(b => (b >= 32 && b <= 126) || b === 10 || b === 13 ? String.fromCharCode(b) : '.').join('');
}

function buildDiagnostics(raw, status) {
  return {
    status,
    typeofData: typeof raw,
    keys: raw && typeof raw === 'object' && !(raw instanceof Blob) && !(raw instanceof ArrayBuffer) && !(raw instanceof Uint8Array) ? Object.keys(raw) : [],
    first200Chars: typeof raw === 'string' ? raw.slice(0, 200) : '',
    backendError: getBackendError(raw),
  };
}

function invalidBase64Error(message, diagnostics) {
  const parts = [message, `typeof=${diagnostics.typeofData}`];
  if (diagnostics.status) parts.push(`status=${diagnostics.status}`);
  if (diagnostics.keys?.length) parts.push(`keys=${diagnostics.keys.join(',')}`);
  if (diagnostics.backendError) parts.push(`backend=${diagnostics.backendError}`);
  if (diagnostics.first200Chars) parts.push(`primeros200=${diagnostics.first200Chars}`);
  const error = new Error(parts.join(' · '));
  error.diagnostics = diagnostics;
  return error;
}