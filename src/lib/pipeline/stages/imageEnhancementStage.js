/**
 * Stage 2: Image Enhancement
 * Input:  ctx.imageUrl, ctx.config, ctx.analysis
 * Output: ctx.enhanced (EnhancedImageResult)
 */

import { preprocessImage } from '../../imagePreprocessor.js';
import { getModeStrategy } from '../../digitizeModes.js';
import { base44 } from '@/api/base44Client';

export async function runImageEnhancement(ctx) {
  const effectiveProfile = ctx.effectiveProfile || ctx.config?.effectiveProfile || null;
  const strategy = getModeStrategy(effectiveProfile?.effectiveBaseEngine || ctx.config.mode || 'hybrid');
  const settings = effectiveProfile?.effectivePreprocessSettings || strategy.preprocess || {};

  if (!settings.enabled) {
    ctx.enhanced = {
      originalUrl:     ctx.imageUrl,
      enhancedUrl:     ctx.imageUrl,
      blob:            null,
      width:           ctx.analysis?.imageWidth  || 0,
      height:          ctx.analysis?.imageHeight || 0,
      appliedSettings: settings,
    };
    return;
  }

  let result;
  try {
    result = await preprocessImage(ctx.imageUrl, settings);
  } catch (err) {
    // Canvas tainted (CORS) or toBlob failed — fallback to original image
    console.warn('[image_enhancement] preprocesado falló, usando imagen original:', err.message);
    ctx.enhanced = {
      originalUrl:     ctx.imageUrl,
      enhancedUrl:     ctx.imageUrl,
      blob:            null,
      width:           ctx.analysis?.imageWidth  || 0,
      height:          ctx.analysis?.imageHeight || 0,
      appliedSettings: settings,
    };
    return;
  }

  // Upload enhanced image so backend/Claude can access it.
  // Convert Blob → File so the SDK serializes multipart correctly (raw Blob → empty object bug).
  let file_url;
  try {
    const file = new File([result.blob], 'enhanced.png', { type: 'image/png' });
    ({ file_url } = await base44.integrations.Core.UploadFile({ file }));
  } catch (err) {
    console.warn('[image_enhancement] subida falló, usando URL local del blob:', err.message);
    file_url = result.url; // fallback to blob object URL
  }

  ctx.enhanced = {
    originalUrl:     ctx.imageUrl,
    enhancedUrl:     file_url,
    blob:            result.blob,
    width:           result.width,
    height:          result.height,
    appliedSettings: settings,
  };
}