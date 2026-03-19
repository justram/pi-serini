import { summarizeNumbers } from "./report_markdown_utils";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildEcdfPolyline(
  values: number[],
  xMin: number,
  xMax: number,
  xScale: (value: number) => number,
  yScale: (fraction: number) => number,
): string {
  const sorted = [...values].filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const points: Array<{ x: number; y: number }> = [{ x: xScale(xMin), y: yScale(0) }];
  for (let index = 0; index < sorted.length; index += 1) {
    const value = sorted[index];
    const fraction = (index + 1) / sorted.length;
    points.push({ x: xScale(value), y: yScale(index / sorted.length) });
    points.push({ x: xScale(value), y: yScale(fraction) });
  }
  points.push({ x: xScale(xMax), y: yScale(1) });
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

export function renderEcdfPanelSvg(series: Array<{ title: string; values: number[]; accent: string }>): string {
  const width = 900;
  const height = 584;
  const panelWidth = 374;
  const panelHeight = 212;
  const panelMarginLeft = 58;
  const panelMarginRight = 30;
  const panelMarginTop = 34;
  const panelMarginBottom = 48;
  const chartGapX = 48;
  const chartGapY = 38;
  const outerMarginLeft = 44;
  const outerMarginTop = 50;
  const yTicks = [0, 0.5, 1];

  const panels = series.map((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const originX = outerMarginLeft + col * (panelWidth + chartGapX);
    const originY = outerMarginTop + row * (panelHeight + chartGapY);
    const plotWidth = panelWidth - panelMarginLeft - panelMarginRight;
    const plotHeight = panelHeight - panelMarginTop - panelMarginBottom;
    const safeValues = item.values.filter((value) => Number.isFinite(value) && value >= 0);
    const minValue = safeValues.length > 0 ? Math.min(...safeValues) : 0;
    const maxValue = safeValues.length > 0 ? Math.max(...safeValues) : 1;
    const xMin = Math.max(0, Math.floor(minValue));
    const xMax = Math.max(xMin + 1, Math.ceil(maxValue));
    const xScale = (value: number) => originX + panelMarginLeft + ((value - xMin) / (xMax - xMin)) * plotWidth;
    const yScale = (fraction: number) => originY + panelMarginTop + (1 - fraction) * plotHeight;
    const xTicks = [...new Set([xMin, Math.round((xMin + xMax) / 2), xMax])].sort((a, b) => a - b);
    const gridLines = [
      ...xTicks.map((tick) => {
        const x = xScale(tick);
        return `<line x1="${x.toFixed(1)}" y1="${originY + panelMarginTop}" x2="${x.toFixed(1)}" y2="${originY + panelMarginTop + plotHeight}" stroke="#e2e8f0" stroke-width="1" />`;
      }),
      ...yTicks.map((tick) => {
        const y = yScale(tick);
        return `<line x1="${originX + panelMarginLeft}" y1="${y.toFixed(1)}" x2="${originX + panelMarginLeft + plotWidth}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" />`;
      }),
    ].join("\n");
    const xLabels = xTicks
      .map((tick) => {
        const x = xScale(tick);
        return `<text x="${x.toFixed(1)}" y="${originY + panelHeight - 14}" text-anchor="middle" font-size="10" fill="#64748b">${tick}</text>`;
      })
      .join("\n");
    const yLabels = yTicks
      .map((tick) => {
        const y = yScale(tick);
        return `<text x="${originX + panelMarginLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${tick.toFixed(2)}</text>`;
      })
      .join("\n");
    const polyline = buildEcdfPolyline(safeValues, xMin, xMax, xScale, yScale);

    return `<g>
      <text x="${originX + panelMarginLeft}" y="${originY + 20}" font-size="13" font-weight="700" fill="#0f172a">${escapeXml(item.title)}</text>
      ${gridLines}
      <line x1="${originX + panelMarginLeft}" y1="${originY + panelMarginTop + plotHeight}" x2="${originX + panelMarginLeft + plotWidth}" y2="${originY + panelMarginTop + plotHeight}" stroke="#94a3b8" stroke-width="1.1" />
      <line x1="${originX + panelMarginLeft}" y1="${originY + panelMarginTop}" x2="${originX + panelMarginLeft}" y2="${originY + panelMarginTop + plotHeight}" stroke="#94a3b8" stroke-width="1.1" />
      ${xLabels}
      ${yLabels}
      <polyline fill="none" stroke="${item.accent}" stroke-width="2.5" points="${polyline}" />
    </g>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tool-call ECDF panel">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  <text x="44" y="30" font-size="15" font-weight="700" fill="#0f172a">Tool-call ECDF overview</text>
  ${panels}
</svg>`;
}

function computeBeeswarmPoints(
  values: number[],
  xScale: (value: number) => number,
  centerY: number,
  radius: number,
  maxOffset: number,
): Array<{ value: number; x: number; y: number }> {
  const placed: Array<{ value: number; x: number; y: number }> = [];
  const candidates = [...values]
    .sort((left, right) => left - right)
    .map((value) => ({ value, x: xScale(value) }));
  const step = radius * 1.8;
  const maxLayers = Math.max(1, Math.floor(maxOffset / step));

  for (const candidate of candidates) {
    const offsets = [0];
    for (let layer = 1; layer <= maxLayers; layer += 1) {
      offsets.push(-layer * step, layer * step);
    }

    let chosenY = centerY;
    for (const offset of offsets) {
      const y = centerY + offset;
      const collides = placed.some((point) => {
        const dx = point.x - candidate.x;
        const dy = point.y - y;
        return dx * dx + dy * dy < (radius * 2.2) ** 2;
      });
      if (!collides) {
        chosenY = y;
        break;
      }
    }

    placed.push({ value: candidate.value, x: candidate.x, y: chosenY });
  }

  return placed;
}

function makeNiceStep(roughStep: number): number {
  const exponent = Math.floor(Math.log10(Math.max(roughStep, 1e-9)));
  const magnitude = 10 ** exponent;
  const normalized = roughStep / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export function buildNiceTicks(minValue: number, maxValue: number, targetTickCount = 6): number[] {
  const span = Math.max(1e-9, maxValue - minValue);
  const step = makeNiceStep(span / Math.max(1, targetTickCount - 1));
  const niceMin = Math.floor(minValue / step) * step;
  const niceMax = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let value = niceMin; value <= niceMax + step * 1e-6; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
}

export function buildLogLikeDepthTicks(maxValue: number): number[] {
  const candidates = [0, 10, 100, 1000, 5000, 20000];
  const ticks = candidates.filter((value) => value <= maxValue);
  const nextTick = candidates.find((value) => value >= maxValue);
  if (nextTick !== undefined && !ticks.includes(nextTick)) {
    ticks.push(nextTick);
  }
  if (ticks.length === 0) {
    ticks.push(0, maxValue);
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
}

export function renderBeeswarmPanelSvg(
  title: string,
  axisLabel: string,
  series: Array<{ label: string; values: number[]; accent: string }>,
  options?: {
    minValue?: number;
    maxValue?: number;
    ticks?: number[];
    tickFormatter?: (value: number) => string;
    pointRadius?: number;
    xTransform?: (value: number) => number;
  },
): string {
  const width = 900;
  const rowHeight = 88;
  const height = 82 + rowHeight * series.length;
  const marginTop = 50;
  const marginRight = 44;
  const marginBottom = 54;
  const marginLeft = 156;
  const plotWidth = width - marginLeft - marginRight;
  const globalMin = options?.minValue ?? 0;
  const globalMax = options?.maxValue ?? Math.max(1, ...series.flatMap((item) => item.values));
  const xTransform = options?.xTransform ?? ((value: number) => value);
  const transformedMin = xTransform(globalMin);
  const transformedMax = xTransform(globalMax);
  const domainSpan = Math.max(1e-6, transformedMax - transformedMin);
  const xScale = (value: number) => marginLeft + ((xTransform(value) - transformedMin) / domainSpan) * plotWidth;
  const tickFormatter = options?.tickFormatter ?? ((value: number) => String(value));
  const pointRadius = options?.pointRadius ?? 2.8;
  const xTicks = options?.ticks ?? buildNiceTicks(globalMin, globalMax);

  const tickLines = xTicks
    .map((tick) => {
      const x = xScale(tick);
      return `<line x1="${x.toFixed(1)}" y1="${marginTop}" x2="${x.toFixed(1)}" y2="${height - marginBottom}" stroke="#e2e8f0" stroke-width="1" />`;
    })
    .join("\n");

  const tickLabels = xTicks
    .map((tick) => {
      const x = xScale(tick);
      return `<text x="${x.toFixed(1)}" y="${height - 20}" text-anchor="middle" font-size="10.5" fill="#64748b">${escapeXml(tickFormatter(tick))}</text>`;
    })
    .join("\n");

  const rows = series
    .map((item, index) => {
      const summary = summarizeNumbers(item.values);
      const y = marginTop + index * rowHeight + rowHeight / 2;
      const points = computeBeeswarmPoints(item.values, xScale, y, pointRadius, 24);
      const pointElements = points
        .map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${pointRadius}" fill="${item.accent}" opacity="0.38" />`)
        .join("\n");
      return `<g>
        <text x="${marginLeft - 18}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11.5" fill="#0f172a">${escapeXml(item.label)}</text>
        <line x1="${xScale(summary.min).toFixed(1)}" y1="${y.toFixed(1)}" x2="${xScale(summary.max).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4 3" />
        ${pointElements}
        <line x1="${xScale(summary.p25).toFixed(1)}" y1="${y.toFixed(1)}" x2="${xScale(summary.p75).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${item.accent}" stroke-width="5" stroke-linecap="round" opacity="0.95" />
        <line x1="${xScale(summary.median).toFixed(1)}" y1="${(y - 20).toFixed(1)}" x2="${xScale(summary.median).toFixed(1)}" y2="${(y + 20).toFixed(1)}" stroke="${item.accent}" stroke-width="3" />
        <circle cx="${xScale(summary.mean).toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#ffffff" stroke="${item.accent}" stroke-width="2.5" />
      </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)} beeswarm plots">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  <text x="${marginLeft}" y="30" font-size="15" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
  ${tickLines}
  ${rows}
  <line x1="${marginLeft}" y1="${height - marginBottom}" x2="${width - marginRight}" y2="${height - marginBottom}" stroke="#94a3b8" stroke-width="1.2" />
  ${tickLabels}
  <text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="11.5" fill="#64748b">${escapeXml(axisLabel)}</text>
</svg>`;
}
