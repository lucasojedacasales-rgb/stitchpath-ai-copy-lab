import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── Built-in machine database ─────────────────────────────────────────────────
const MACHINES = [
  {
    brand: 'Brother',
    model: 'PE800',
    hoop_sizes: [
      { name: '4"×4"', w_mm: 100, h_mm: 100 },
      { name: '5"×7"', w_mm: 130, h_mm: 180 },
    ],
    max_speed_spm: 400,
    formats: ['PES', 'DST', 'EXP', 'JEF'],
    max_colors: 11,
    max_stitches: 500000,
    notes: 'Standalone machine with color LCD. Great for home use.',
  },
  {
    brand: 'Brother',
    model: 'SE1900',
    hoop_sizes: [
      { name: '4"×4"', w_mm: 100, h_mm: 100 },
      { name: '5"×7"', w_mm: 130, h_mm: 180 },
    ],
    max_speed_spm: 400,
    formats: ['PES', 'DST', 'EXP', 'JEF'],
    max_colors: 11,
    max_stitches: 700000,
    notes: 'Combo sewing & embroidery.',
  },
  {
    brand: 'Brother',
    model: 'PR1055X',
    hoop_sizes: [
      { name: '4"×4"', w_mm: 100, h_mm: 100 },
      { name: '6"×8"', w_mm: 150, h_mm: 200 },
      { name: '8"×12"', w_mm: 200, h_mm: 300 },
      { name: '12"×12"', w_mm: 300, h_mm: 300 },
    ],
    max_speed_spm: 1000,
    formats: ['PES', 'DST'],
    max_colors: 10,
    max_stitches: 2000000,
    notes: '10-needle industrial-grade machine.',
  },
  {
    brand: 'Janome',
    model: 'MC9900',
    hoop_sizes: [
      { name: 'A', w_mm: 200, h_mm: 280 },
      { name: 'B', w_mm: 126, h_mm: 110 },
      { name: 'C', w_mm: 50, h_mm: 50 },
    ],
    max_speed_spm: 860,
    formats: ['JEF', 'JEF+', 'DST'],
    max_colors: 10,
    max_stitches: 1000000,
    notes: 'High-end home/semi-pro machine.',
  },
  {
    brand: 'Janome',
    model: 'MC500E',
    hoop_sizes: [
      { name: 'Standard', w_mm: 200, h_mm: 300 },
      { name: 'Square', w_mm: 140, h_mm: 140 },
    ],
    max_speed_spm: 860,
    formats: ['JEF', 'DST'],
    max_colors: 10,
    max_stitches: 800000,
    notes: 'Dedicated embroidery, large hoop.',
  },
  {
    brand: 'Pfaff',
    model: 'Creative 4.5',
    hoop_sizes: [
      { name: 'Large', w_mm: 260, h_mm: 400 },
      { name: 'Medium', w_mm: 145, h_mm: 255 },
      { name: 'Small', w_mm: 100, h_mm: 100 },
    ],
    max_speed_spm: 650,
    formats: ['VP3', 'DST', 'PES'],
    max_colors: 16,
    max_stitches: 1500000,
    notes: 'IDT system for even feed.',
  },
  {
    brand: 'Bernina',
    model: '770 QEE',
    hoop_sizes: [
      { name: 'Mega', w_mm: 255, h_mm: 145 },
      { name: 'Large', w_mm: 150, h_mm: 150 },
      { name: 'Small', w_mm: 72, h_mm: 50 },
    ],
    max_speed_spm: 900,
    formats: ['EXP', 'DST', 'PES'],
    max_colors: 20,
    max_stitches: 999999,
    notes: 'Swiss precision engineering.',
  },
  {
    brand: 'Husqvarna',
    model: 'Designer Epic 2',
    hoop_sizes: [
      { name: 'Mega', w_mm: 360, h_mm: 200 },
      { name: 'Large', w_mm: 240, h_mm: 150 },
      { name: 'Medium', w_mm: 150, h_mm: 150 },
    ],
    max_speed_spm: 1050,
    formats: ['VP3', 'DST', 'PES', 'JEF'],
    max_colors: 24,
    max_stitches: 2000000,
    notes: 'Top-of-line consumer machine.',
  },
  {
    brand: 'Tajima',
    model: 'TMEF-H',
    hoop_sizes: [
      { name: 'Standard', w_mm: 360, h_mm: 500 },
      { name: 'Cap Frame', w_mm: 280, h_mm: 65 },
    ],
    max_speed_spm: 850,
    formats: ['DST', 'DSB'],
    max_colors: 12,
    max_stitches: 9999999,
    notes: 'Commercial multi-head machine.',
  },
  {
    brand: 'Barudan',
    model: 'BEDT-S Series',
    hoop_sizes: [
      { name: 'Large', w_mm: 400, h_mm: 500 },
      { name: 'Standard', w_mm: 200, h_mm: 300 },
    ],
    max_speed_spm: 1200,
    formats: ['DST', 'DSB', 'EXP'],
    max_colors: 15,
    max_stitches: 9999999,
    notes: 'Commercial/industrial multi-head.',
  },
];

// ── Validation logic ──────────────────────────────────────────────────────────

function validateDesign(machine, design) {
  const errors = [];
  const warnings = [];

  const { stitch_count, color_count, width_mm, height_mm, format } = design;

  // Hoop size check
  if (width_mm && height_mm) {
    const fitsHoop = machine.hoop_sizes.some(h => h.w_mm >= width_mm && h.h_mm >= height_mm);
    if (!fitsHoop) {
      errors.push(`Design ${width_mm}×${height_mm}mm does not fit any hoop. Max available: ${machine.hoop_sizes.map(h => `${h.name} (${h.w_mm}×${h.h_mm}mm)`).join(', ')}`);
    } else {
      // Warn if design is >85% of hoop
      const bestHoop = machine.hoop_sizes.find(h => h.w_mm >= width_mm && h.h_mm >= height_mm);
      if (bestHoop && (width_mm / bestHoop.w_mm > 0.85 || height_mm / bestHoop.h_mm > 0.85)) {
        warnings.push(`Design fills >85% of hoop "${bestHoop.name}" — leave margin for framing.`);
      }
    }
  }

  // Color count check
  if (color_count && color_count > machine.max_colors) {
    errors.push(`Design uses ${color_count} colors but machine supports max ${machine.max_colors}.`);
  }

  // Stitch count check
  if (stitch_count && stitch_count > machine.max_stitches) {
    errors.push(`Design has ${stitch_count.toLocaleString()} stitches but machine max is ${machine.max_stitches.toLocaleString()}.`);
  } else if (stitch_count && stitch_count > machine.max_stitches * 0.9) {
    warnings.push(`Design uses ${Math.round(stitch_count / machine.max_stitches * 100)}% of machine stitch capacity.`);
  }

  // Format check
  if (format && !machine.formats.map(f => f.toUpperCase()).includes(format.toUpperCase())) {
    errors.push(`Format "${format}" not supported. Machine supports: ${machine.formats.join(', ')}.`);
  }

  // Estimate time at max speed
  const estimatedMinutes = stitch_count ? Math.round((stitch_count / (machine.max_speed_spm * 60)) * 1.25) : null;
  // ×1.25 accounts for stops, trims, color changes

  return { errors, warnings, estimatedMinutes, valid: errors.length === 0 };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, brand, model, design } = body;

    // ── List all machines (optionally filter by brand) ────────────────────────
    if (action === 'list') {
      const machines = brand
        ? MACHINES.filter(m => m.brand.toLowerCase() === brand.toLowerCase())
        : MACHINES;
      return Response.json({ machines, count: machines.length });
    }

    // ── Get one machine profile ───────────────────────────────────────────────
    if (action === 'get') {
      if (!model) return Response.json({ error: 'model required' }, { status: 400 });
      const machine = MACHINES.find(m => m.model.toLowerCase() === model.toLowerCase());
      if (!machine) return Response.json({ error: `Machine "${model}" not found.` }, { status: 404 });
      return Response.json({ machine });
    }

    // ── Validate design against machine profile ───────────────────────────────
    if (action === 'validate') {
      if (!model) return Response.json({ error: 'model required' }, { status: 400 });
      if (!design) return Response.json({ error: 'design object required' }, { status: 400 });

      const machine = MACHINES.find(m => m.model.toLowerCase() === model.toLowerCase());
      if (!machine) return Response.json({ error: `Machine "${model}" not found.` }, { status: 404 });

      const result = validateDesign(machine, design);
      return Response.json({ machine: { brand: machine.brand, model: machine.model }, ...result });
    }

    // ── Find compatible machines for a design ─────────────────────────────────
    if (action === 'find_compatible') {
      if (!design) return Response.json({ error: 'design object required' }, { status: 400 });

      const results = MACHINES.map(m => {
        const v = validateDesign(m, design);
        return {
          brand: m.brand,
          model: m.model,
          valid: v.valid,
          warnings: v.warnings,
          errors: v.errors,
          estimatedMinutes: v.estimatedMinutes,
          formats: m.formats,
          hoop_sizes: m.hoop_sizes,
        };
      });

      const compatible = results.filter(r => r.valid);
      const incompatible = results.filter(r => !r.valid);

      return Response.json({ compatible, incompatible, total: MACHINES.length });
    }

    return Response.json({ error: 'action must be list | get | validate | find_compatible' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});