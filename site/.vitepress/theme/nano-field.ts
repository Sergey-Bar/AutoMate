export const ASSEMBLY_DURATION = 3.6;
export const ASSEMBLY_END = 4.15;
export type SwarmPalette = { foreground: string; muted: string; edge: string; background: string };
export type SwarmBounds = { width: number; height: number; contentWidth: number; inset: number };

// Independent seeded coordinates avoid the visible striping of correlated sequences.
function seeds() {
  let state = 41729;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: 12000 }, (_, index) => ({
    u: random(),
    v: random(),
    phase: random() * Math.PI * 2,
    lane: Math.floor(random() * 6),
    jitter: random() - 0.5,
    size: 0.65 + random() * 1.2,
    layer: index % 4,
  }));
}
let field: ReturnType<typeof seeds> | undefined;
export function constructionEdge(v: number, progress: number, width: number): number {
  const p = Math.max(0, Math.min(1, progress));
  const travel = p * p * (3 - 2 * p);
  const amplitude = Math.min(75, width * 0.1) * Math.sin(p * Math.PI);
  return (
    -100 +
    travel * (width + 200) +
    amplitude * (Math.sin(v * 8 + p * 4) + Math.sin(v * 19 - p * 3) * 0.3)
  );
}

export function paintSwarm(
  ctx: CanvasRenderingContext2D,
  bounds: SwarmBounds,
  palette: SwarmPalette,
  elapsed: number,
  stride = 1,
): void {
  const { width, height, contentWidth, inset } = bounds;
  ctx.clearRect(0, 0, width, height);
  if (elapsed >= ASSEMBLY_END || width <= 0 || height <= 0) return;
  const progress = Math.max(0, Math.min(1, elapsed / ASSEMBLY_DURATION));
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.background;
  ctx.beginPath();
  ctx.moveTo(inset + contentWidth, 0);
  for (let y = 0; y <= height + 4; y += 4) {
    const edge = constructionEdge(y / height, progress, contentWidth);
    ctx.lineTo(inset + Math.max(0, Math.min(contentWidth, edge)), y);
  }
  ctx.lineTo(inset + contentWidth, height);
  ctx.closePath();
  ctx.fill();
  if (elapsed < 0) return;
  field ??= seeds();
  const fade = Math.min(1, elapsed * 5) * Math.min(1, (ASSEMBLY_END - elapsed) * 2.5);
  // A continuous skin forms at the leading edge before resolving into the page.
  // Its facets share the same frontier as the reveal mask: no detached glitter.
  const skinWidth = Math.min(66, contentWidth * 0.09);
  ctx.fillStyle = palette.muted;
  ctx.globalAlpha = fade * 0.32;
  ctx.beginPath();
  for (let y = 0; y <= height + 4; y += 4) {
    const edge = inset + constructionEdge(y / height, progress, contentWidth);
    if (y === 0) ctx.moveTo(edge, y);
    else ctx.lineTo(edge, y);
  }
  for (let y = height + 4; y >= 0; y -= 4) {
    const edge = inset + constructionEdge(y / height, progress, contentWidth);
    const taper = skinWidth * (0.7 + Math.sin(y * 0.025 + elapsed * 2) * 0.3);
    ctx.lineTo(edge - taper, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.foreground;
  ctx.lineWidth = 0.55;
  ctx.globalAlpha = fade * 0.4;
  ctx.beginPath();
  for (let y = 3; y < height; y += 7) {
    const edge = inset + constructionEdge(y / height, progress, contentWidth);
    for (let column = 0; column < 7; column++) {
      const x = edge - column * 7 - (Math.floor(y / 7) % 2) * 3.5;
      const shear = Math.sin(y * 0.03 + elapsed * 2) * 2;
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x + shear, y - 2);
      ctx.lineTo(x + 3, y);
      ctx.lineTo(x - shear, y + 2);
    }
  }
  ctx.stroke();
  const colors = [palette.edge, palette.muted, palette.foreground, palette.foreground];
  // Four batched fills, instead of 12,000 fill/style changes per frame.
  for (let layer = 0; layer < 4; layer++) {
    ctx.fillStyle = colors[layer] ?? palette.foreground;
    ctx.globalAlpha = fade * ([0.3, 0.48, 0.48, 0.8][layer] ?? 1);
    ctx.beginPath();
    for (let i = layer; i < field.length; i += 4 * stride) {
      const bot = field[i];
      if (!bot) continue;
      const travel = (bot.u + elapsed * (0.19 + layer * 0.035)) % 1;
      const join = Math.pow(travel, 3);
      const edge = inset + constructionEdge(bot.v, progress, contentWidth);
      const origin = -100 - bot.u * 120;
      const x = origin + (edge - origin) * travel;
      const ribbon = (bot.lane + 0.5) / 6 + Math.sin(x * 0.006 - elapsed * 1.9 + bot.lane) * 0.13;
      const streamY = (ribbon + bot.jitter * 0.065) * height;
      const y = streamY * (1 - join) + bot.v * height * join;
      const flutter = Math.sin(bot.phase + elapsed * 4 + x * 0.012) * 9 * (1 - join);
      const size = bot.size * (0.7 + layer * 0.2);
      ctx.rect(x, y + flutter, size * (2.8 - join * 1.8), size);
      // A second dense layer packs into the advancing edge, like small plates locking in.
      if (i % 3 === 0) {
        const frontX = edge - bot.u * 52;
        ctx.rect(frontX, bot.v * height, size * 1.4, size);
      }
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
