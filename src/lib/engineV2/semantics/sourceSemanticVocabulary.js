export const SOURCE_SEMANTIC_CONCEPTS = Object.freeze({
  background: 'background',
  primary_shape: 'primary_shape',
  secondary_shape: 'secondary_shape',
  internal_feature: 'internal_feature',
  highlight: 'highlight',
  negative_space: 'negative_space',
  dark_mark: 'dark_mark',
  outline_intent: 'outline_intent',
  planning_neutral: 'planning_neutral',
});

const ENTRIES = [
  ['background', 'background', 'en'], ['backdrop', 'background', 'en'], ['fondo', 'background', 'es'], ['trasfondo', 'background', 'es'],
  ['body', 'primary_shape', 'en'], ['character', 'primary_shape', 'en'], ['object', 'primary_shape', 'en'], ['main', 'primary_shape', 'en'],
  ['cuerpo', 'primary_shape', 'es'], ['personaje', 'primary_shape', 'es'], ['objeto', 'primary_shape', 'es'], ['principal', 'primary_shape', 'es'],
  ['face', 'secondary_shape', 'en'], ['belly', 'secondary_shape', 'en'], ['foot', 'secondary_shape', 'en'], ['feet', 'secondary_shape', 'en'],
  ['arm', 'secondary_shape', 'en'], ['hand', 'secondary_shape', 'en'], ['accent', 'secondary_shape', 'en'], ['shadow', 'secondary_shape', 'en'],
  ['cara', 'secondary_shape', 'es'], ['rostro', 'secondary_shape', 'es'], ['barriga', 'secondary_shape', 'es'], ['vientre', 'secondary_shape', 'es'],
  ['pie', 'secondary_shape', 'es'], ['pies', 'secondary_shape', 'es'], ['brazo', 'secondary_shape', 'es'], ['brazos', 'secondary_shape', 'es'],
  ['mano', 'secondary_shape', 'es'], ['manos', 'secondary_shape', 'es'], ['acento', 'secondary_shape', 'es'], ['sombra', 'secondary_shape', 'es'],
  ['eye', 'internal_feature', 'en'], ['eyes', 'internal_feature', 'en'], ['pupil', 'internal_feature', 'en'], ['mouth', 'internal_feature', 'en'],
  ['nose', 'internal_feature', 'en'], ['nostril', 'internal_feature', 'en'], ['cheek', 'internal_feature', 'en'], ['detail', 'internal_feature', 'en'],
  ['ojo', 'internal_feature', 'es'], ['ojos', 'internal_feature', 'es'], ['pupila', 'internal_feature', 'es'], ['pupilas', 'internal_feature', 'es'],
  ['boca', 'internal_feature', 'es'], ['nariz', 'internal_feature', 'es'], ['fosa', 'internal_feature', 'es'], ['fosas', 'internal_feature', 'es'],
  ['mejilla', 'internal_feature', 'es'], ['mejillas', 'internal_feature', 'es'], ['detalle', 'internal_feature', 'es'], ['detalles', 'internal_feature', 'es'],
  ['highlight', 'highlight', 'en'], ['shine', 'highlight', 'en'], ['light', 'highlight', 'en'],
  ['brillo', 'highlight', 'es'], ['reflejo', 'highlight', 'es'], ['luz', 'highlight', 'es'],
  ['negative', 'negative_space', 'en'], ['negative space', 'negative_space', 'en'], ['hole', 'negative_space', 'en'], ['cutout', 'negative_space', 'en'], ['void', 'negative_space', 'en'],
  ['negativo', 'negative_space', 'es'], ['espacio negativo', 'negative_space', 'es'], ['hueco', 'negative_space', 'es'], ['agujero', 'negative_space', 'es'], ['recorte', 'negative_space', 'es'], ['vacio', 'negative_space', 'es'],
  ['stroke', 'dark_mark', 'en'], ['line', 'dark_mark', 'en'], ['dark mark', 'dark_mark', 'en'], ['dark detail', 'dark_mark', 'en'],
  ['trazo', 'dark_mark', 'es'], ['linea', 'dark_mark', 'es'], ['marca oscura', 'dark_mark', 'es'], ['detalle oscuro', 'dark_mark', 'es'],
  ['outline', 'outline_intent', 'en'], ['border', 'outline_intent', 'en'], ['outer border', 'outline_intent', 'en'], ['outer outline', 'outline_intent', 'en'], ['silhouette', 'outline_intent', 'en'],
  ['contorno', 'outline_intent', 'es'], ['borde', 'outline_intent', 'es'], ['borde exterior', 'outline_intent', 'es'], ['contorno interior', 'outline_intent', 'es'], ['silueta', 'outline_intent', 'es'],
  ['inner outline', 'outline_intent', 'en'], ['inner border', 'outline_intent', 'en'],
  ['fill', 'planning_neutral', 'neutral'], ['relleno', 'planning_neutral', 'neutral'], ['satin', 'planning_neutral', 'neutral'],
  ['saten', 'planning_neutral', 'neutral'], ['running', 'planning_neutral', 'neutral'], ['corrida', 'planning_neutral', 'neutral'], ['tatami', 'planning_neutral', 'neutral'],
];

export const CONTROLLED_SOURCE_SEMANTIC_VOCABULARY = Object.freeze(ENTRIES.map(([term, concept, language]) => Object.freeze({ term, concept, language })));

const LOOKUP = new Map(CONTROLLED_SOURCE_SEMANTIC_VOCABULARY.map(entry => [entry.term, entry]));
const MAX_WORDS = Math.max(...CONTROLLED_SOURCE_SEMANTIC_VOCABULARY.map(entry => entry.term.split(' ').length));

export function normalizeControlledSemanticText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchControlledSemanticTerms(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const originalWords = value.replace(/[_-]+/g, ' ').match(/[\p{L}\p{N}]+/gu) || [];
  const words = originalWords.map(normalizeControlledSemanticText).filter(Boolean);
  const matches = [];
  for (let index = 0; index < words.length; index += 1) {
    for (let length = Math.min(MAX_WORDS, words.length - index); length >= 1; length -= 1) {
      const normalizedToken = words.slice(index, index + length).join(' ');
      const entry = LOOKUP.get(normalizedToken);
      if (!entry) continue;
      matches.push({
        language: entry.language,
        originalToken: originalWords.slice(index, index + length).join(' '),
        normalizedToken,
        concept: entry.concept,
        sourceValue: value,
      });
      index += length - 1;
      break;
    }
  }
  return matches;
}

export function isOutlineIntentConcept(concept) {
  return concept === SOURCE_SEMANTIC_CONCEPTS.outline_intent;
}
