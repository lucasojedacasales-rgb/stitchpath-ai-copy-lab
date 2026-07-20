import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── Embedded thread color databases ──────────────────────────────────────────
// Each entry: [code, name, r, g, b]
const THREAD_DB = {
  brother: [
    ['BLK', 'Black', 0, 0, 0],
    ['WHT', 'White', 255, 255, 255],
    ['RED', 'Red', 222, 37, 53],
    ['DRD', 'Dark Red', 157, 21, 35],
    ['SCR', 'Scarlet', 216, 64, 50],
    ['ORG', 'Orange', 236, 120, 36],
    ['DOG', 'Dark Orange', 209, 88, 15],
    ['YEL', 'Yellow', 254, 215, 0],
    ['DYL', 'Dark Yellow', 215, 175, 0],
    ['LGN', 'Light Green', 131, 196, 78],
    ['GRN', 'Green', 0, 140, 72],
    ['DGN', 'Dark Green', 0, 90, 45],
    ['AQU', 'Aqua', 0, 183, 198],
    ['SKY', 'Sky Blue', 0, 160, 210],
    ['BLU', 'Blue', 0, 85, 164],
    ['DBL', 'Dark Blue', 0, 48, 130],
    ['NVY', 'Navy', 0, 32, 91],
    ['LAV', 'Lavender', 165, 139, 188],
    ['PUR', 'Purple', 102, 51, 153],
    ['DPR', 'Dark Purple', 66, 0, 120],
    ['PNK', 'Pink', 242, 143, 173],
    ['HPK', 'Hot Pink', 228, 0, 120],
    ['DPK', 'Dark Pink', 196, 0, 96],
    ['MGT', 'Magenta', 201, 0, 135],
    ['BRN', 'Brown', 121, 72, 33],
    ['TAN', 'Tan', 186, 142, 89],
    ['BGE', 'Beige', 230, 207, 172],
    ['CRM', 'Cream', 253, 246, 227],
    ['GRY', 'Gray', 140, 140, 140],
    ['LGY', 'Light Gray', 200, 200, 200],
    ['DGY', 'Dark Gray', 80, 80, 80],
    ['SLV', 'Silver', 192, 192, 192],
    ['GLD', 'Gold', 212, 175, 55],
  ],
  janome: [
    ['001', 'Black', 0, 0, 0],
    ['002', 'White', 255, 255, 255],
    ['003', 'Red', 210, 30, 45],
    ['004', 'Dark Red', 150, 15, 30],
    ['005', 'Orange', 230, 110, 30],
    ['006', 'Yellow', 255, 220, 0],
    ['007', 'Light Green', 120, 190, 70],
    ['008', 'Green', 0, 130, 65],
    ['009', 'Dark Green', 0, 80, 40],
    ['010', 'Aqua', 0, 175, 190],
    ['011', 'Light Blue', 100, 160, 215],
    ['012', 'Blue', 0, 80, 155],
    ['013', 'Dark Blue', 0, 40, 120],
    ['014', 'Navy', 0, 25, 80],
    ['015', 'Purple', 95, 45, 145],
    ['016', 'Dark Purple', 60, 0, 110],
    ['017', 'Pink', 240, 135, 165],
    ['018', 'Hot Pink', 220, 0, 115],
    ['019', 'Magenta', 190, 0, 130],
    ['020', 'Brown', 115, 65, 30],
    ['021', 'Tan', 180, 135, 85],
    ['022', 'Beige', 225, 200, 165],
    ['023', 'Gray', 135, 135, 135],
    ['024', 'Silver', 185, 185, 185],
    ['025', 'Gold', 205, 170, 50],
  ],
  madeira: [
    ['1000', 'Black', 0, 0, 0],
    ['1001', 'White', 255, 255, 255],
    ['1002', 'Off White', 245, 240, 220],
    ['1003', 'Cream', 250, 243, 210],
    ['1100', 'Light Yellow', 255, 245, 100],
    ['1101', 'Yellow', 253, 215, 0],
    ['1102', 'Golden Yellow', 240, 185, 0],
    ['1200', 'Light Orange', 255, 165, 80],
    ['1201', 'Orange', 230, 105, 25],
    ['1300', 'Coral', 240, 100, 90],
    ['1301', 'Red', 208, 25, 40],
    ['1302', 'Dark Red', 148, 0, 30],
    ['1400', 'Pink', 245, 140, 170],
    ['1401', 'Hot Pink', 225, 0, 110],
    ['1500', 'Magenta', 195, 0, 128],
    ['1600', 'Lavender', 165, 135, 185],
    ['1601', 'Purple', 98, 48, 148],
    ['1700', 'Light Blue', 105, 165, 218],
    ['1701', 'Blue', 0, 82, 158],
    ['1702', 'Dark Blue', 0, 45, 125],
    ['1703', 'Navy', 0, 28, 85],
    ['1800', 'Aqua', 0, 178, 195],
    ['1900', 'Light Green', 125, 192, 72],
    ['1901', 'Green', 0, 135, 68],
    ['1902', 'Dark Green', 0, 85, 42],
    ['2000', 'Brown', 118, 68, 28],
    ['2001', 'Tan', 183, 138, 83],
    ['2002', 'Beige', 228, 202, 168],
    ['2100', 'Gray', 138, 138, 138],
    ['2101', 'Dark Gray', 75, 75, 75],
    ['2200', 'Silver', 190, 190, 190],
    ['2300', 'Gold', 210, 172, 52],
  ],
  aurifil: [
    ['2000', 'Black', 5, 5, 5],
    ['2021', 'White', 250, 250, 250],
    ['2025', 'Cream', 252, 244, 215],
    ['1135', 'Butter', 255, 240, 140],
    ['2135', 'Yellow', 253, 210, 0],
    ['2140', 'Bright Orange', 240, 115, 20],
    ['2245', 'Light Orange', 248, 158, 78],
    ['2255', 'Coral', 237, 95, 85],
    ['2260', 'Red', 205, 22, 38],
    ['2435', 'Dark Red', 142, 10, 28],
    ['2530', 'Pink', 242, 138, 165],
    ['2535', 'Hot Pink', 220, 0, 105],
    ['2545', 'Magenta', 188, 0, 125],
    ['2560', 'Light Purple', 175, 142, 198],
    ['2570', 'Purple', 100, 50, 152],
    ['2581', 'Dark Purple', 62, 0, 115],
    ['2710', 'Baby Blue', 160, 205, 235],
    ['2715', 'Light Blue', 98, 158, 215],
    ['2720', 'Blue', 0, 78, 152],
    ['2735', 'Dark Blue', 0, 42, 118],
    ['2745', 'Navy', 0, 24, 78],
    ['2805', 'Aqua', 0, 172, 188],
    ['2840', 'Light Green', 128, 188, 68],
    ['2850', 'Green', 0, 128, 62],
    ['2888', 'Dark Green', 0, 82, 38],
    ['2155', 'Brown', 112, 62, 25],
    ['2310', 'Tan', 178, 132, 78],
    ['2315', 'Beige', 222, 198, 162],
    ['2610', 'Gray', 132, 132, 132],
    ['2615', 'Dark Gray', 72, 72, 72],
    ['2620', 'Silver', 188, 188, 188],
    ['2134', 'Gold', 208, 168, 48],
  ],
};

// ── LAB color conversion ──────────────────────────────────────────────────────

function rgbToLab(r, g, b) {
  // sRGB → linear
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const rl = lin(r), gl = lin(g), bl = lin(b);

  // Linear RGB → XYZ (D65)
  const X = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const Y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const Z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

  // XYZ → Lab (D65 white: Xn=0.95047, Yn=1.0, Zn=1.08883)
  const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y / 1.0), fz = f(Z / 1.08883);

  return [
    116 * fy - 16,     // L
    500 * (fx - fy),   // a
    200 * (fy - fz),   // b
  ];
}

function deltaE(lab1, lab2) {
  // CIE76 ΔE
  return Math.sqrt(
    (lab1[0] - lab2[0]) ** 2 +
    (lab1[1] - lab2[1]) ** 2 +
    (lab1[2] - lab2[2]) ** 2
  );
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, brand, hex, top_n = 3 } = body;

    // ── A: List all colors for a brand ───────────────────────────────────────
    if (action === 'list') {
      const brandKey = (brand || 'brother').toLowerCase();
      if (!THREAD_DB[brandKey]) {
        return Response.json({ error: `Unknown brand. Available: ${Object.keys(THREAD_DB).join(', ')}` }, { status: 400 });
      }

      // Check cache first
      const cached = await base44.asServiceRole.entities.ThreadColorCache.filter({ brand: brandKey });
      if (cached.length > 0) {
        return Response.json({ brand: brandKey, colors: cached, source: 'cache', count: cached.length });
      }

      // Build + cache
      const toInsert = THREAD_DB[brandKey].map(([code, name, r, g, b]) => {
        const [L, A, B] = rgbToLab(r, g, b);
        const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        return { brand: brandKey, code, name, hex, r, g, b, L, A, B };
      });

      await base44.asServiceRole.entities.ThreadColorCache.bulkCreate(toInsert);
      return Response.json({ brand: brandKey, colors: toInsert, source: 'generated', count: toInsert.length });
    }

    // ── B: Match hex → closest thread colors ─────────────────────────────────
    if (action === 'match') {
      if (!hex) return Response.json({ error: 'hex required for match' }, { status: 400 });
      const brandKey = (brand || 'brother').toLowerCase();
      if (!THREAD_DB[brandKey]) {
        return Response.json({ error: `Unknown brand. Available: ${Object.keys(THREAD_DB).join(', ')}` }, { status: 400 });
      }

      const [qr, qg, qb] = hexToRgb(hex);
      const qLab = rgbToLab(qr, qg, qb);

      const db = THREAD_DB[brandKey];
      const scored = db.map(([code, name, r, g, b]) => {
        const lab = rgbToLab(r, g, b);
        const dE = deltaE(qLab, lab);
        const threadHex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        return { code, name, hex: threadHex, r, g, b, deltaE: parseFloat(dE.toFixed(2)) };
      });

      scored.sort((a, b) => a.deltaE - b.deltaE);
      const topMatches = scored.slice(0, Math.min(top_n, 10));

      return Response.json({
        query_hex: hex,
        brand: brandKey,
        matches: topMatches,
      });
    }

    // ── C: Match against ALL brands ───────────────────────────────────────────
    if (action === 'match_all') {
      if (!hex) return Response.json({ error: 'hex required for match_all' }, { status: 400 });
      const [qr, qg, qb] = hexToRgb(hex);
      const qLab = rgbToLab(qr, qg, qb);
      const results = {};

      for (const [brandKey, db] of Object.entries(THREAD_DB)) {
        const scored = db.map(([code, name, r, g, b]) => {
          const lab = rgbToLab(r, g, b);
          const dE = deltaE(qLab, lab);
          const threadHex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
          return { code, name, hex: threadHex, deltaE: parseFloat(dE.toFixed(2)) };
        });
        scored.sort((a, b) => a.deltaE - b.deltaE);
        results[brandKey] = scored.slice(0, top_n);
      }

      return Response.json({ query_hex: hex, results });
    }

    return Response.json({ error: 'action must be list | match | match_all' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});