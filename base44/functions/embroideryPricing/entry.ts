import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── Thread pricing database (USD per 1000m spool) ────────────────────────────
const THREAD_PRICING = {
  brother:  { price_per_spool: 4.50,  meters_per_spool: 1000, stitches_per_meter: 10 },
  janome:   { price_per_spool: 5.00,  meters_per_spool: 1000, stitches_per_meter: 10 },
  madeira:  { price_per_spool: 6.50,  meters_per_spool: 1000, stitches_per_meter: 10 },
  aurifil:  { price_per_spool: 14.00, meters_per_spool: 1300, stitches_per_meter: 10 },
  default:  { price_per_spool: 5.00,  meters_per_spool: 1000, stitches_per_meter: 10 },
};

// ── Commercial machine rates ──────────────────────────────────────────────────
// Average commercial embroidery machine: 800 SPM, runs ~70% efficiency
const COMMERCIAL_SPM = 800;
const EFFICIENCY = 0.70;
// Color change adds ~30s each (thread trimming + repositioning)
const COLOR_CHANGE_SECONDS = 30;
// Setup time per job (hooping, alignment): ~5 min
const SETUP_MINUTES = 5;

// ── Pricing tiers (stitches → labor USD) ─────────────────────────────────────
// Typical commercial pricing: ~$1.00–$1.50 per 1000 stitches + setup
const LABOR_PER_1000_STITCHES = 1.20; // USD
const SETUP_FEE = 8.00; // USD fixed per design
const DIGITIZING_FEE = 25.00; // USD one-time for new design
const OVERHEAD_FACTOR = 1.25; // 25% overhead (electricity, maintenance)

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      stitch_count,
      color_count = 1,
      color_changes = 0,
      thread_brand = 'default',
      quantity = 1,
      include_digitizing = false,
      design_name = 'Untitled',
    } = body;

    if (!stitch_count || stitch_count <= 0) {
      return Response.json({ error: 'stitch_count required and must be > 0' }, { status: 400 });
    }

    const brand = thread_brand.toLowerCase();
    const threadData = THREAD_PRICING[brand] || THREAD_PRICING.default;

    // ── Thread cost ───────────────────────────────────────────────────────────
    const actualColorChanges = color_changes || Math.max(0, color_count - 1);
    const stitchingMeters = (stitch_count * 2.5) / 1000;
    const wasteMeters = actualColorChanges * 2.0;
    const totalMeters = stitchingMeters + wasteMeters;
    const pricePerMeter = threadData.price_per_spool / threadData.meters_per_spool;
    const threadCostUSD = Math.round(totalMeters * pricePerMeter * OVERHEAD_FACTOR * 100) / 100;

    // ── Machine time ──────────────────────────────────────────────────────────
    const stitchSeconds = stitch_count / (COMMERCIAL_SPM * EFFICIENCY);
    const colorChangeSeconds = actualColorChanges * COLOR_CHANGE_SECONDS;
    const totalMachineSeconds = stitchSeconds + colorChangeSeconds;
    const totalMachineMinutes = totalMachineSeconds / 60;
    const totalJobMinutes = totalMachineMinutes + SETUP_MINUTES;

    // Per piece
    const laborCostPerPiece = (stitch_count / 1000) * LABOR_PER_1000_STITCHES;
    const setupCostPerPiece = SETUP_FEE / quantity;
    const digitizingCostPerPiece = include_digitizing ? DIGITIZING_FEE / quantity : 0;

    const costPerPiece = threadCostUSD + laborCostPerPiece + setupCostPerPiece + digitizingCostPerPiece;
    const totalCost = costPerPiece * quantity;

    // Suggested retail (2.5× for shop markup)
    const suggestedRetailPerPiece = costPerPiece * 2.5;

    // ── Breakdown ─────────────────────────────────────────────────────────────
    const breakdown = {
      thread: {
        brand: brand === 'default' ? 'generic' : brand,
        meters_stitching: parseFloat(stitchingMeters.toFixed(2)),
        meters_waste: parseFloat(wasteMeters.toFixed(2)),
        meters_total: parseFloat(totalMeters.toFixed(2)),
        cost_usd: parseFloat(threadCostUSD.toFixed(2)),
      },
      labor: {
        cost_per_1000_stitches: LABOR_PER_1000_STITCHES,
        cost_usd: parseFloat(laborCostPerPiece.toFixed(2)),
      },
      setup: {
        cost_usd: parseFloat(setupCostPerPiece.toFixed(2)),
        note: `$${SETUP_FEE} setup divided by ${quantity} piece(s)`,
      },
      ...(include_digitizing && {
        digitizing: {
          cost_usd: parseFloat(digitizingCostPerPiece.toFixed(2)),
          note: `$${DIGITIZING_FEE} one-time fee divided by ${quantity} piece(s)`,
        },
      }),
    };

    return Response.json({
      design_name,
      input: { stitch_count, color_count, color_changes, thread_brand: brand, quantity },
      timing: {
        machine_minutes: parseFloat(totalMachineMinutes.toFixed(1)),
        job_minutes: parseFloat(totalJobMinutes.toFixed(1)),
        machine_minutes_label: formatMinutes(totalMachineMinutes),
        job_minutes_label: formatMinutes(totalJobMinutes),
      },
      cost: {
        per_piece_usd: parseFloat(costPerPiece.toFixed(2)),
        total_usd: parseFloat(totalCost.toFixed(2)),
        suggested_retail_usd: parseFloat(suggestedRetailPerPiece.toFixed(2)),
        currency: 'USD',
      },
      breakdown,
      notes: [
        `Based on commercial machine running at ${COMMERCIAL_SPM} SPM with ${Math.round(EFFICIENCY * 100)}% efficiency.`,
        `Thread cost includes ${Math.round((OVERHEAD_FACTOR - 1) * 100)}% overhead.`,
        'Prices are estimates; actual costs depend on your region and supplier.',
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function formatMinutes(mins) {
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${h}h ${m}min`;
}