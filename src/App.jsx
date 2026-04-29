import React, { useState, useRef, useEffect, useCallback } from 'react';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { 
  Upload, 
  Download, 
  Layers, 
  Settings, 
  Box as BoxIcon, 
  Edit3, 
  Pipette, 
  Undo, 
  Redo, 
  Trash2,
  PaintBucket, 
  Zap, 
  GripVertical,
  Maximize2,
  Plus,
  Minus,
  Hand,
  Image as ImageIcon,
  ImagePlus,
  FilePlus,
  AlertCircle,
  Gamepad,
  Move,
  DownloadCloud,
  Square,
  Copy,
  ClipboardPaste,
  FileJson,
  FolderOpen,
  X as CloseIcon,
  User,
  Clock,
  FileText,
  Circle,
  ChevronUp,
  ChevronDown,
  Lock,
  Unlock,
  Paintbrush,
  ScanLine,
  Grid,
  MoreVertical
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

// --- 定数 ---
const MAX_UNDO = 15;
const MIN_CANVAS_SIZE = 1;
const MAX_RESOLUTION = 500;
const DEFAULT_TARGET_COLOR_COUNT = 8;
const SIMILAR_COLOR_DISTANCE_THRESHOLD = 0.04;
const COLOR_MIX_BASE_COUNT = 4;
const COLOR_MIX_RATIO_STEPS = 10;
const COLOR_MIX_GOOD_MATCH_THRESHOLD = 0.04;
const LAYER_JUMP_HIGHLIGHT_MS = 2200;
const LAYER_SORT_OPTIONS = [
  { value: 'current', label: 'Current Order' },
  { value: 'usage-desc', label: 'Usage Count (High to Low)' },
  { value: 'usage-asc', label: 'Usage Count (Low to High)' },
  { value: 'hue-asc', label: 'Hue (Low to High)' },
  { value: 'hue-desc', label: 'Hue (High to Low)' },
];
const apiKey = ""; 

const TRANSPARENT_COLOR = [255, 0, 255];
const TRANSPARENT_KEY = JSON.stringify(TRANSPARENT_COLOR);

const srgbToLinear = (channel) => {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

const linearToSrgb = (channel) => {
  const clamped = Math.max(0, Math.min(1, channel));
  const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, srgb)) * 255);
};

const rgbToOklab = (rgb) => {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
};

const getOklabDistance = (left, right) => Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);

const oklabToRgb = (oklab) => {
  const l = oklab.l + 0.3963377774 * oklab.a + 0.2158037573 * oklab.b;
  const m = oklab.l - 0.1055613458 * oklab.a - 0.0638541728 * oklab.b;
  const s = oklab.l - 0.0894841775 * oklab.a - 1.2914855480 * oklab.b;

  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;

  return [
    linearToSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    linearToSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    linearToSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3),
  ];
};

const rgbToHex = (rgb) => `#${rgb.map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const normalizeHexColor = (value) => {
  const raw = `${value || ''}`.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) return `#${raw.split('').map((char) => char + char).join('').toUpperCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
};

const hexToRgb = (value) => {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;
  return [1, 3, 5].map((index) => parseInt(normalized.slice(index, index + 2), 16));
};

const getLinearRgb = (rgb) => rgb.map((channel) => srgbToLinear(channel));

const mixLinearRgb = (colors, weights) => {
  const mixed = [0, 0, 0];
  colors.forEach((color, index) => {
    mixed[0] += color[0] * weights[index];
    mixed[1] += color[1] * weights[index];
    mixed[2] += color[2] * weights[index];
  });
  return mixed;
};

const formatRgbLabel = (rgb) => `RGB(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const formatMixRecipe = (components) => components.map(({ index, ratio }) => `Base ${index + 1} ${Math.round(ratio * 100)}%`).join(' + ');

const dedupeRgbList = (colors) => {
  const unique = [];
  const seen = new Set();
  colors.forEach((rgb) => {
    const hex = rgbToHex(rgb);
    if (seen.has(hex)) return;
    seen.add(hex);
    unique.push(rgb);
  });
  return unique;
};

const suggestIdealMixBaseColors = (pixels, targetCount = COLOR_MIX_BASE_COUNT) => {
  if (!pixels) return [];
  const entries = Array.from(collectUniqueColorStats(pixels).values()).map((info) => ({
    rgb: info.color,
    weight: info.count,
    oklab: rgbToOklab(info.color),
  })).sort((left, right) => right.weight - left.weight);

  if (entries.length === 0) return [];
  if (entries.length <= targetCount) return entries.map((entry) => entry.rgb);

  let centroids = entries.slice(0, targetCount).map((entry) => ({ ...entry.oklab }));
  let clusterWeights = centroids.map(() => 0);

  for (let iteration = 0; iteration < 8; iteration++) {
    const accumulators = centroids.map(() => ({ weight: 0, l: 0, a: 0, b: 0 }));

    entries.forEach((entry) => {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centroids.forEach((centroid, index) => {
        const distance = getOklabDistance(entry.oklab, centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });

      const bucket = accumulators[bestIndex];
      bucket.weight += entry.weight;
      bucket.l += entry.oklab.l * entry.weight;
      bucket.a += entry.oklab.a * entry.weight;
      bucket.b += entry.oklab.b * entry.weight;
    });

    centroids = centroids.map((centroid, index) => {
      const bucket = accumulators[index];
      if (bucket.weight === 0) return centroid;
      return {
        l: bucket.l / bucket.weight,
        a: bucket.a / bucket.weight,
        b: bucket.b / bucket.weight,
      };
    });
    clusterWeights = accumulators.map((bucket) => bucket.weight);
  }

  const suggested = centroids
    .map((centroid, index) => ({ rgb: oklabToRgb(centroid), weight: clusterWeights[index] || 0 }))
    .sort((left, right) => right.weight - left.weight)
    .map((entry) => entry.rgb);

  const deduped = dedupeRgbList(suggested);
  if (deduped.length >= targetCount) return deduped.slice(0, targetCount);

  const supplements = entries.map((entry) => entry.rgb).filter((rgb) => !deduped.some((candidate) => rgbToHex(candidate) === rgbToHex(rgb)));
  return [...deduped, ...supplements].slice(0, targetCount);
};

const buildMixCandidates = (baseColors) => {
  const linearBaseColors = baseColors.map((rgb) => getLinearRgb(rgb));
  const candidates = [];

  const pushCandidate = (components) => {
    const colors = components.map(({ index }) => linearBaseColors[index]);
    const weights = components.map(({ ratio }) => ratio);
    const linearRgb = mixLinearRgb(colors, weights);
    const mixedRgb = linearRgb.map((channel) => linearToSrgb(channel));
    candidates.push({
      components,
      mixedRgb,
      mixedOklab: rgbToOklab(mixedRgb),
      recipeLabel: formatMixRecipe(components),
    });
  };

  baseColors.forEach((_, index) => pushCandidate([{ index, ratio: 1 }]));

  for (let left = 0; left < baseColors.length; left++) {
    for (let right = left + 1; right < baseColors.length; right++) {
      for (let step = 1; step < COLOR_MIX_RATIO_STEPS; step++) {
        pushCandidate([
          { index: left, ratio: step / COLOR_MIX_RATIO_STEPS },
          { index: right, ratio: (COLOR_MIX_RATIO_STEPS - step) / COLOR_MIX_RATIO_STEPS },
        ]);
      }
    }
  }

  for (let first = 0; first < baseColors.length; first++) {
    for (let second = first + 1; second < baseColors.length; second++) {
      for (let third = second + 1; third < baseColors.length; third++) {
        for (let left = 1; left < COLOR_MIX_RATIO_STEPS - 1; left++) {
          for (let middle = 1; middle < COLOR_MIX_RATIO_STEPS - left; middle++) {
            const right = COLOR_MIX_RATIO_STEPS - left - middle;
            if (right < 1) continue;
            pushCandidate([
              { index: first, ratio: left / COLOR_MIX_RATIO_STEPS },
              { index: second, ratio: middle / COLOR_MIX_RATIO_STEPS },
              { index: third, ratio: right / COLOR_MIX_RATIO_STEPS },
            ]);
          }
        }
      }
    }
  }

  return candidates;
};

const buildColorMixAdvisorResult = (pixels, layerOrder, baseColors) => {
  if (!pixels || baseColors.length === 0) return null;
  const colorStats = collectUniqueColorStats(pixels);
  const candidates = buildMixCandidates(baseColors);
  if (candidates.length === 0) return null;

  const layers = layerOrder.filter((key) => colorStats.has(key)).map((key, index) => {
    const { color, count } = colorStats.get(key);
    const targetOklab = rgbToOklab(color);
    let bestCandidate = null;
    let bestError = Number.POSITIVE_INFINITY;

    candidates.forEach((candidate) => {
      const error = getOklabDistance(targetOklab, candidate.mixedOklab);
      if (error < bestError) {
        bestError = error;
        bestCandidate = candidate;
      }
    });

    return {
      key,
      layerNumber: index + 1,
      targetRgb: color,
      usageCount: count,
      recipeLabel: bestCandidate.recipeLabel,
      mixedRgb: bestCandidate.mixedRgb,
      error: bestError,
    };
  });

  if (layers.length === 0) return null;

  const errors = layers.map((layer) => layer.error);
  return {
    baseColors,
    layers,
    summary: {
      layerCount: layers.length,
      maxError: Math.max(...errors),
      averageError: errors.reduce((sum, value) => sum + value, 0) / errors.length,
      withinThresholdCount: layers.filter((layer) => layer.error <= COLOR_MIX_GOOD_MATCH_THRESHOLD).length,
    },
  };
};

const buildAppliedColorMixState = (pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings, advisorResult) => {
  if (!pixels || !advisorResult?.layers?.length) return null;

  const replacementMap = new Map(advisorResult.layers.map((layer) => [layer.key, JSON.stringify(layer.mixedRgb)]));
  const nextPixels = pixels.map((row) => row.map((pixel) => {
    if (!Array.isArray(pixel)) return pixel;
    const key = JSON.stringify(pixel);
    const replacementKey = replacementMap.get(key);
    return replacementKey ? JSON.parse(replacementKey) : pixel;
  }));

  const nextLayerOrder = [];
  const seenKeys = new Set();
  layerOrder.forEach((key) => {
    const replacementKey = replacementMap.get(key) || key;
    if (replacementKey === TRANSPARENT_KEY || seenKeys.has(replacementKey)) return;
    seenKeys.add(replacementKey);
    nextLayerOrder.push(replacementKey);
  });

  const nextLayerHeightAdjustments = {};
  const nextLayerSmoothingSettings = {};
  layerOrder.forEach((key) => {
    const replacementKey = replacementMap.get(key) || key;
    if (!(replacementKey in nextLayerHeightAdjustments) && key in layerHeightAdjustments) nextLayerHeightAdjustments[replacementKey] = layerHeightAdjustments[key];
    if (!(replacementKey in nextLayerSmoothingSettings) && key in layerSmoothingSettings) nextLayerSmoothingSettings[replacementKey] = layerSmoothingSettings[key];
  });

  return {
    nextPixels,
    nextLayerOrder,
    nextLayerHeightAdjustments,
    nextLayerSmoothingSettings,
  };
};

const buildLayerColorEditState = (pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings, sourceKey, nextRgb) => {
  if (!pixels || !sourceKey || !Array.isArray(nextRgb)) return null;
  const targetKey = JSON.stringify(nextRgb);
  if (sourceKey === targetKey) return null;

  const nextPixels = pixels.map((row) => row.map((pixel) => JSON.stringify(pixel) === sourceKey ? [...nextRgb] : pixel));
  const hasExistingTargetLayer = layerOrder.includes(targetKey);

  let nextLayerOrder;
  let nextLayerHeightAdjustments;
  let nextLayerSmoothingSettings;

  if (hasExistingTargetLayer) {
    nextLayerOrder = layerOrder.filter((key) => key !== sourceKey);
    nextLayerHeightAdjustments = Object.fromEntries(Object.entries(layerHeightAdjustments).filter(([key]) => key !== sourceKey));
    nextLayerSmoothingSettings = Object.fromEntries(Object.entries(layerSmoothingSettings).filter(([key]) => key !== sourceKey));
  } else {
    nextLayerOrder = layerOrder.map((key) => key === sourceKey ? targetKey : key);
    nextLayerHeightAdjustments = Object.fromEntries(
      Object.entries(layerHeightAdjustments).map(([key, value]) => [key === sourceKey ? targetKey : key, value])
    );
    nextLayerSmoothingSettings = Object.fromEntries(
      Object.entries(layerSmoothingSettings).map(([key, value]) => [key === sourceKey ? targetKey : key, value])
    );
  }

  return {
    nextPixels,
    nextLayerOrder,
    nextLayerHeightAdjustments,
    nextLayerSmoothingSettings,
    targetKey,
    merged: hasExistingTargetLayer,
  };
};

const rgbToHslLike = (rgb) => {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (delta > 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    switch (max) {
      case r:
        hue = 60 * (((g - b) / delta) % 6);
        break;
      case g:
        hue = 60 * (((b - r) / delta) + 2);
        break;
      default:
        hue = 60 * (((r - g) / delta) + 4);
        break;
    }
    if (hue < 0) hue += 360;
  }

  return { hue, saturation, lightness };
};

const createColorGrouper = (size) => {
  const parent = Array.from({ length: size }, (_, index) => index);

  const find = (index) => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };

  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  return { find, union };
};

const collectUniqueColorStats = (pixels) => {
  const stats = new Map();
  let scanIndex = 0;

  pixels.forEach((row) => row.forEach((pixel) => {
    if (!Array.isArray(pixel)) return;
    const key = JSON.stringify(pixel);
    if (key === TRANSPARENT_KEY) return;
    if (!stats.has(key)) stats.set(key, { color: pixel, count: 0, firstIndex: scanIndex });
    stats.get(key).count += 1;
    scanIndex += 1;
  }));

  return stats;
};

const getSortedLayerOrder = (layerOrder, pixels, mode) => {
  if (mode === 'current' || !pixels || layerOrder.length < 2) return layerOrder;

  const colorStats = collectUniqueColorStats(pixels);
  const originalIndex = new Map(layerOrder.map((key, index) => [key, index]));
  const enriched = layerOrder.map((key) => {
    const color = JSON.parse(key);
    const stats = colorStats.get(key);
    const hsl = rgbToHslLike(color);
    return {
      key,
      usageCount: stats?.count || 0,
      hue: hsl.hue,
      saturation: hsl.saturation,
      lightness: hsl.lightness,
    };
  });

  const sorted = [...enriched].sort((left, right) => {
    if (mode === 'usage-desc' && right.usageCount !== left.usageCount) return right.usageCount - left.usageCount;
    if (mode === 'usage-asc' && left.usageCount !== right.usageCount) return left.usageCount - right.usageCount;
    if (mode === 'hue-asc' || mode === 'hue-desc') {
      const leftIsAchromatic = left.saturation < 0.05;
      const rightIsAchromatic = right.saturation < 0.05;
      if (leftIsAchromatic !== rightIsAchromatic) return leftIsAchromatic ? 1 : -1;
      if (!leftIsAchromatic && left.hue !== right.hue) return mode === 'hue-asc' ? left.hue - right.hue : right.hue - left.hue;
      if (left.lightness !== right.lightness) return left.lightness - right.lightness;
    }

    const orderDiff = (originalIndex.get(left.key) ?? 0) - (originalIndex.get(right.key) ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return left.key.localeCompare(right.key);
  });

  return sorted.map((entry) => entry.key);
};

const getRepresentativeKey = (keys, colorStats, layerOrderIndex) => [...keys].sort((left, right) => {
  const leftInfo = colorStats.get(left);
  const rightInfo = colorStats.get(right);
  if (rightInfo.count !== leftInfo.count) return rightInfo.count - leftInfo.count;
  const leftLayerIndex = layerOrderIndex.has(left) ? layerOrderIndex.get(left) : Number.POSITIVE_INFINITY;
  const rightLayerIndex = layerOrderIndex.has(right) ? layerOrderIndex.get(right) : Number.POSITIVE_INFINITY;
  if (leftLayerIndex !== rightLayerIndex) return leftLayerIndex - rightLayerIndex;
  return leftInfo.firstIndex - rightInfo.firstIndex;
})[0];

const buildColorStateFromGroups = (pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings, colorStats, groupedKeys) => {
  const entries = Array.from(colorStats.entries());
  const layerOrderIndex = new Map(layerOrder.map((key, index) => [key, index]));

  const replacementMap = new Map();
  const representativeKeys = new Set();
  let mergedGroups = 0;

  groupedKeys.forEach((keys) => {
    if (keys.length === 1) {
      representativeKeys.add(keys[0]);
      replacementMap.set(keys[0], keys[0]);
      return;
    }

    mergedGroups += 1;
    const representativeKey = getRepresentativeKey(keys, colorStats, layerOrderIndex);
    representativeKeys.add(representativeKey);
    keys.forEach((key) => replacementMap.set(key, representativeKey));
  });

  if (mergedGroups === 0) return null;

  const nextPixels = pixels.map((row) => row.map((pixel) => {
    if (!Array.isArray(pixel)) return pixel;
    const key = JSON.stringify(pixel);
    const replacementKey = replacementMap.get(key);
    return replacementKey ? JSON.parse(replacementKey) : pixel;
  }));

  const nextLayerOrder = [
    ...layerOrder.filter((key) => representativeKeys.has(key)),
    ...entries.map(([key]) => key).filter((key) => representativeKeys.has(key) && !layerOrder.includes(key)),
  ];

  const nextLayerHeightAdjustments = Object.fromEntries(
    Object.entries(layerHeightAdjustments).filter(([key]) => representativeKeys.has(key))
  );
  const nextLayerSmoothingSettings = Object.fromEntries(
    Object.entries(layerSmoothingSettings).filter(([key]) => representativeKeys.has(key))
  );

  return {
    nextPixels,
    nextLayerOrder,
    nextLayerHeightAdjustments,
    nextLayerSmoothingSettings,
    beforeCount: entries.length,
    afterCount: representativeKeys.size,
    replacementMap,
  };
};

const buildMergedColorState = (pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings) => {
  if (!pixels) return null;

  const colorStats = collectUniqueColorStats(pixels);
  const entries = Array.from(colorStats.entries());
  if (entries.length < 2) return null;

  const grouper = createColorGrouper(entries.length);
  const oklabColors = entries.map(([, info]) => rgbToOklab(info.color));

  for (let left = 0; left < entries.length; left++) {
    for (let right = left + 1; right < entries.length; right++) {
      if (getOklabDistance(oklabColors[left], oklabColors[right]) <= SIMILAR_COLOR_DISTANCE_THRESHOLD) {
        grouper.union(left, right);
      }
    }
  }

  const groupedKeys = [];
  const groupMap = new Map();
  entries.forEach(([key], index) => {
    const root = grouper.find(index);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root).push(key);
  });
  groupMap.forEach((keys) => groupedKeys.push(keys));

  return buildColorStateFromGroups(pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings, colorStats, groupedKeys);
};

const buildReducedColorState = (pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings, targetCount) => {
  if (!pixels) return null;

  const colorStats = collectUniqueColorStats(pixels);
  const entries = Array.from(colorStats.entries());
  if (entries.length < 2 || targetCount >= entries.length) return null;

  let clusters = entries.map(([key, info]) => {
    const centroid = rgbToOklab(info.color);
    return { keys: [key], weight: info.count, centroid };
  });

  while (clusters.length > targetCount) {
    let bestLeft = 0;
    let bestRight = 1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let left = 0; left < clusters.length; left++) {
      for (let right = left + 1; right < clusters.length; right++) {
        const distance = getOklabDistance(clusters[left].centroid, clusters[right].centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLeft = left;
          bestRight = right;
        }
      }
    }

    const leftCluster = clusters[bestLeft];
    const rightCluster = clusters[bestRight];
    const mergedWeight = leftCluster.weight + rightCluster.weight;
    const mergedCluster = {
      keys: [...leftCluster.keys, ...rightCluster.keys],
      weight: mergedWeight,
      centroid: {
        l: (leftCluster.centroid.l * leftCluster.weight + rightCluster.centroid.l * rightCluster.weight) / mergedWeight,
        a: (leftCluster.centroid.a * leftCluster.weight + rightCluster.centroid.a * rightCluster.weight) / mergedWeight,
        b: (leftCluster.centroid.b * leftCluster.weight + rightCluster.centroid.b * rightCluster.weight) / mergedWeight,
      },
    };

    clusters = clusters.filter((_, index) => index !== bestLeft && index !== bestRight);
    clusters.push(mergedCluster);
  }

  return buildColorStateFromGroups(
    pixels,
    layerOrder,
    layerHeightAdjustments,
    layerSmoothingSettings,
    colorStats,
    clusters.map((cluster) => cluster.keys)
  );
};

// --- ユーティリティ: 経路簡略化 (Ramer-Douglas-Peucker) ---
const getDistance = (p, p1, p2) => {
  if (p1.x === p2.x && p1.y === p2.y) return Math.hypot(p.x - p1.x, p.y - p1.y);
  const l2 = Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2);
  let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (p1.x + t * (p2.x - p1.x)), p.y - (p1.y + t * (p2.y - p1.y)));
};

const rdpSimplify = (points, tolerance) => {
  if (points.length <= 2) return points;
  let maxDist = 0; let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = getDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, index + 1), tolerance);
    const right = rdpSimplify(points.slice(index), tolerance);
    return [...left.slice(0, left.length - 1), ...right];
  } else return [points[0], points[points.length - 1]];
};

const isPointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const calculateArea = (pts) => {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].y; area -= pts[j].y * pts[i].x;
  }
  return area / 2;
};

// スムージング処理
const smoothPath = (points, toleranceMm, dotSize) => {
  const tolerance = toleranceMm / dotSize;
  if (points.length < 3 || tolerance <= 0) return points;
  
  // Step 1: 簡略化
  let simplified = rdpSimplify(points, tolerance);
  
  // Step 2: スプライン補間 (滑らかさが目立つように)
  if (toleranceMm > 0.05 && simplified.length >= 3) {
    const points3d = simplified.map(p => new THREE.Vector3(p.x, p.y, 0));
    const curve = new THREE.CatmullRomCurve3(points3d, true, 'centripetal');
    simplified = curve.getPoints(Math.max(simplified.length * 5, 20)).map(p => ({ x: p.x, y: p.y }));
  }
  return simplified;
};

// 2Dポリゴンオフセット (簡易版)
const offsetPolygon = (points, offsetMm, dotSize) => {
  const offset = offsetMm / dotSize;
  if (Math.abs(offset) < 0.0001 || points.length < 3) return points;
  
  const result = [];
  const len = points.length;
  for (let i = 0; i < len; i++) {
    const prev = points[(i + len - 1) % len];
    const curr = points[i];
    const next = points[(i + 1) % len];

    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };

    const l1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const l2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    if (l1 < 1e-6 || l2 < 1e-6) { result.push(curr); continue; }

    const n1 = { x: v1.x / l1, y: v1.y / l1 };
    const n2 = { x: v2.x / l2, y: v2.y / l2 };

    // 法線 (CWで外向きになるように反転が必要な場合があるが、まずは標準)
    // グリッド空間 (y-down) で CW なら (-dy, dx) は内向き
    const norm1 = { x: n1.y, y: -n1.x };
    const norm2 = { x: n2.y, y: -n2.x };

    const bisector = { x: norm1.x + norm2.x, y: norm1.y + norm2.y };
    const bl = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
    
    if (bl < 1e-6) {
       result.push({ x: curr.x + norm1.x * offset, y: curr.y + norm1.y * offset });
    } else {
       const nb = { x: bisector.x / bl, y: bisector.y / bl };
       const cosHalfAngle = norm1.x * nb.x + norm1.y * nb.y;
       const d = offset / Math.max(0.1, cosHalfAngle);
       result.push({ x: curr.x + nb.x * d, y: curr.y + nb.y * d });
    }
  }
  return result;
};

// 指定した色の集合（和集合）の輪郭を抽出
const getUnionContours = (pixels, targetColorKeys) => {
  const h = pixels.length; const w = pixels[0].length;
  const edges = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = JSON.stringify(pixels[y][x]);
      if (!targetColorKeys.has(color)) continue;
      
      const checkExt = (ny, nx) => {
        if (ny < 0 || ny >= h || nx < 0 || nx >= w) return true;
        return JSON.stringify(pixels[ny][nx]) === TRANSPARENT_KEY;
      };

      // Top
      if (y === 0 || !targetColorKeys.has(JSON.stringify(pixels[y - 1][x]))) {
        edges.push({ p1: { x, y }, p2: { x: x + 1, y }, isExternal: checkExt(y - 1, x) });
      }
      // Bottom
      if (y === h - 1 || !targetColorKeys.has(JSON.stringify(pixels[y + 1][x]))) {
        edges.push({ p1: { x: x + 1, y: y + 1 }, p2: { x, y: y + 1 }, isExternal: checkExt(y + 1, x) });
      }
      // Left
      if (x === 0 || !targetColorKeys.has(JSON.stringify(pixels[y][x - 1]))) {
        edges.push({ p1: { x, y: y + 1 }, p2: { x, y }, isExternal: checkExt(y, x - 1) });
      }
      // Right
      if (x === w - 1 || !targetColorKeys.has(JSON.stringify(pixels[y][x + 1]))) {
        edges.push({ p1: { x: x + 1, y }, p2: { x: x + 1, y: y + 1 }, isExternal: checkExt(y, x + 1) });
      }
    }
  }

  const contours = []; const used = new Array(edges.length).fill(false);
  const edgeMap = new Map();
  edges.forEach((e, idx) => {
    const key = `${e.p1.x},${e.p1.y}`;
    if (!edgeMap.has(key)) edgeMap.set(key, []);
    edgeMap.get(key).push(idx);
  });

  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const currentContour = []; let currentIdx = i;
    while (currentIdx !== -1) {
      const e = edges[currentIdx];
      // 他の色との境界（!isExternal）が含まれるセグメントは滑らかにしないためのフラグを保持
      currentContour.push({ x: e.p1.x, y: e.p1.y, isExternal: e.isExternal });
      used[currentIdx] = true;
      const nextKey = `${e.p2.x},${e.p2.y}`;
      let nextIdx = -1;
      const candidates = edgeMap.get(nextKey);
      if (candidates) {
        for (let j = 0; j < candidates.length; j++) {
          if (!used[candidates[j]]) { nextIdx = candidates[j]; break; }
        }
      }
      currentIdx = nextIdx;
    }
    if (currentContour.length > 1) contours.push(currentContour);
  }
  return contours;
};

// --- ヘルパー関数 ---
const getFormattedDate = (format = "compact") => {
  const now = new Date(); const pad = (n) => n.toString().padStart(2, '0');
  const y = now.getFullYear(); const m = pad(now.getMonth() + 1); const d = pad(now.getDate());
  const h = pad(now.getHours()); const min = pad(now.getMinutes()); const s = pad(now.getSeconds());
  if (format === "filename") return `${y}${m}${d}_${h}${min}${s}`;
  if (format === "display") return `${y}/${m}/${d} ${h}:${min}:${s}`;
  return `${y}${m}${d}${h}${min}${s}`;
};

const getFilledPixelBounds = (pixels) => {
  if (!pixels) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  pixels.forEach((row, y) => row.forEach((pixel, x) => {
    if (!Array.isArray(pixel) || JSON.stringify(pixel) === TRANSPARENT_KEY) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }));

  if (!Number.isFinite(minX)) return null;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radiusX = Math.max(centerX - minX, maxX - centerX);
  const radiusY = Math.max(centerY - minY, maxY - centerY);

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX,
    centerY,
    radiusX,
    radiusY,
    maxRadius: Math.max(radiusX, radiusY),
  };
};

const createSquarePixels = (size) => Array.from({ length: size }, () => Array.from({ length: size }, () => [...TRANSPARENT_COLOR]));

const resizeSquarePixels = (pixels, nextSize) => {
  const nextPixels = createSquarePixels(nextSize);
  if (!pixels) return { nextPixels, discardedFilledCount: 0 };

  let discardedFilledCount = 0;
  pixels.forEach((row, y) => row.forEach((pixel, x) => {
    if (x < nextSize && y < nextSize) {
      nextPixels[y][x] = [...pixel];
      return;
    }
    if (JSON.stringify(pixel) !== TRANSPARENT_KEY) discardedFilledCount += 1;
  }));

  return { nextPixels, discardedFilledCount };
};

const trimPixelsToSquare = (pixels, padding = 0) => {
  const bounds = getFilledPixelBounds(pixels);
  if (!bounds) return null;

  const safePadding = Math.max(0, Number.parseInt(padding, 10) || 0);
  const contentWidth = bounds.maxX - bounds.minX + 1;
  const contentHeight = bounds.maxY - bounds.minY + 1;
  const nextSize = Math.max(contentWidth, contentHeight) + safePadding * 2;
  const nextPixels = createSquarePixels(nextSize);
  const offsetX = Math.floor((nextSize - contentWidth) / 2);
  const offsetY = Math.floor((nextSize - contentHeight) / 2);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      nextPixels[y - bounds.minY + offsetY][x - bounds.minX + offsetX] = [...pixels[y][x]];
    }
  }

  return { nextPixels, nextSize, padding: safePadding };
};

const blurActiveElement = () => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
};

const buildGifFrameSources = async (arrayBuffer) => {
  const gif = parseGIF(arrayBuffer);
  const frames = decompressFrames(gif, true);
  const width = gif.lsd.width;
  const height = gif.lsd.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  let previousFrame = null;
  let restoreImageData = null;

  return frames.map((frame) => {
    if (previousFrame?.disposalType === 2) {
      ctx.clearRect(previousFrame.dims.left, previousFrame.dims.top, previousFrame.dims.width, previousFrame.dims.height);
    } else if (previousFrame?.disposalType === 3 && restoreImageData) {
      ctx.putImageData(restoreImageData, 0, 0);
    }

    restoreImageData = frame.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;
    const imageData = new ImageData(frame.patch, frame.dims.width, frame.dims.height);
    ctx.putImageData(imageData, frame.dims.left, frame.dims.top);
    previousFrame = frame;

    return canvas.toDataURL('image/png');
  });
};

const NavItem = ({ id, icon: Icon, label, isActive, onClick }) => (
  <button onClick={() => onClick(id)} className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 transition-all rounded-lg ${isActive ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}>
    <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
    <span className={`text-[8px] font-bold ${isActive ? 'opacity-100' : 'opacity-70'}`}>{label}</span>
  </button>
);

const App = () => {
  const [activeTab, setActiveTab] = useState('editor'); const [gridSize, setGridSize] = useState(32);
  const [projectName, setProjectName] = useState(""); const [outputFileName, setOutputFileName] = useState("");
  const [author, setAuthor] = useState(""); const [createdAt, setCreatedAt] = useState("");
  const [originalFilePath, setOriginalFilePath] = useState("");
  const [dotSize, setDotSize] = useState(1.0); const [layerThickness, setLayerThickness] = useState(1.0); 
  const [baseThickness, setBaseThickness] = useState(0.0); const [padSensitivity, setPadSensitivity] = useState(1); 
  const [pixels, setPixels] = useState(null); const [sourceImage, setSourceImage] = useState(null);
  const [history, setHistory] = useState({ stack: [], step: -1 });
  const [tool, setTool] = useState('hand'); const [currentColor, setCurrentColor] = useState([255, 0, 0]);
  const [brushSize, setBrushSize] = useState(1); const [zoom, setZoom] = useState(1.0);
  const [pipZoom, setPipZoom] = useState(1.0); const [isTransparentMode, setIsTransparentMode] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false); const [showGrid, setShowGrid] = useState(false);
  const [useVirtualPad, setUseVirtualPad] = useState(false); const [isCanvasLocked, setIsCanvasLocked] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 }); const [isPlotting, setIsPlotting] = useState(false);
  const [selection, setSelection] = useState(null); const [clipboard, setClipboard] = useState(null);
  const [layerOrder, setLayerOrder] = useState([]); const [layerHeightAdjustments, setLayerHeightAdjustments] = useState({});
  const [layerSmoothingSettings, setLayerSmoothingSettings] = useState({});
  const [showConfirmModal, setShowConfirmModal] = useState(false); const [showCanvasAdjustModal, setShowCanvasAdjustModal] = useState(false); const [isExporting, setIsExporting] = useState(false); 
  const [statusMessage, setStatusMessage] = useState(""); const [showSampleOffsetControls, setShowSampleOffsetControls] = useState(false);
  const [sampleOffsetX, setSampleOffsetX] = useState(0); const [sampleOffsetY, setSampleOffsetY] = useState(0);
  const [isResolutionToolbarVisible, setIsResolutionToolbarVisible] = useState(true);
  const [isBrushToolbarVisible, setIsBrushToolbarVisible] = useState(true); const [isToolSelectorVisible, setIsToolSelectorVisible] = useState(true);
  const [gifFrames, setGifFrames] = useState([]);
  const [selectedGifFrameIndex, setSelectedGifFrameIndex] = useState(0);
  const [canvasAdjustSizeInput, setCanvasAdjustSizeInput] = useState('32');
  const [canvasAdjustPaddingInput, setCanvasAdjustPaddingInput] = useState('2');
  const [pendingCanvasResize, setPendingCanvasResize] = useState(null);
  const [targetColorCount, setTargetColorCount] = useState(DEFAULT_TARGET_COLOR_COUNT);
  const [layerSortMode, setLayerSortMode] = useState('current');
  const [suggestedMixBaseColors, setSuggestedMixBaseColors] = useState([]);
  const [customMixBaseHexes, setCustomMixBaseHexes] = useState(['', '', '', '']);
  const [colorMixAdvisorResult, setColorMixAdvisorResult] = useState(null);
  const [selected3DLayer, setSelected3DLayer] = useState(null);
  const [is3DLayerMoveMode, setIs3DLayerMoveMode] = useState(false);
  const [draft3DLayerOrder, setDraft3DLayerOrder] = useState([]);
  const [pendingLayerColors, setPendingLayerColors] = useState({});
  const [jumpHighlightedLayer, setJumpHighlightedLayer] = useState(null);
  const [canvasLayerJumpColor, setCanvasLayerJumpColor] = useState(null);
  
  const handleLayerHeightChange = (colorStr, key, delta) => setLayerHeightAdjustments(prev => {
    const current = prev[colorStr] || { plus: 0, minus: 0 };
    const normalized = typeof current === 'number' ? { plus: current, minus: 0 } : current;
    return { ...prev, [colorStr]: { ...normalized, [key]: Math.max(key === 'plus' ? -layerThickness : 0, normalized[key] + delta) } };
  });
  const handleSmoothingChange = (colorStr, key, value) => setLayerSmoothingSettings(prev => ({ ...prev, [colorStr]: { ...(prev[colorStr] || { smoothOuter: false, smoothInner: false, tolerance: 0.1, offset: 0 }), [key]: value } }));

  const editorCanvasRef = useRef(null); const scrollContainerRef = useRef(null); const canvasWrapperRef = useRef(null); const originalImageContainerRef = useRef(null);
  const threeRef = useRef(null); const sceneRef = useRef(null); const isDrawingRef = useRef(false);
  const threeCameraPositionRef = useRef(null); const threeControlsTargetRef = useRef(null);
  const threePointerStateRef = useRef({ active: false, moved: false, x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 }); const pinchZoomRef = useRef({ active: false, startDistance: 0, startZoom: 1, anchorX: 0, anchorY: 0, midpointX: 0, midpointY: 0 });
  const originalDragRef = useRef({ active: false, x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const lastTrackpadPosRef = useRef({ x: 0, y: 0 }); const cursorSubPixelRef = useRef({ x: 0, y: 0 }); const zoomRef = useRef(zoom);
  const safariGestureScaleRef = useRef(1);
  const layerRowRefs = useRef({});
  const layerJumpHighlightTimeoutRef = useRef(null);
  const isLoadingRef = useRef(false); const pixelsRef = useRef(null); const toolbarRef = useRef(null);
  const layerOrderRef = useRef(layerOrder); const layerHeightAdjustmentsRef = useRef(layerHeightAdjustments); const layerSmoothingSettingsRef = useRef(layerSmoothingSettings);
  const suppressSourceReprocessRef = useRef(false);
  
  useEffect(() => { pixelsRef.current = pixels; }, [pixels]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { layerOrderRef.current = layerOrder; }, [layerOrder]);
  useEffect(() => { layerHeightAdjustmentsRef.current = layerHeightAdjustments; }, [layerHeightAdjustments]);
  useEffect(() => { layerSmoothingSettingsRef.current = layerSmoothingSettings; }, [layerSmoothingSettings]);
  useEffect(() => { if (!projectName && !isLoadingRef.current) { const def = getFormattedDate("compact"); setProjectName(def); setOutputFileName(def); } }, []);
  const handleProjectNameChange = (val) => { setProjectName(val); if (outputFileName === projectName || !outputFileName) setOutputFileName(val); };
  const centerCanvas = useCallback(() => {
    if (scrollContainerRef.current && canvasWrapperRef.current) {
      const c = scrollContainerRef.current; const w = canvasWrapperRef.current;
      c.scrollLeft = (w.scrollWidth - c.clientWidth) / 2; c.scrollTop = (w.scrollHeight - c.clientHeight) / 2;
    }
  }, []);
  useEffect(() => { if (pixels && activeTab === 'editor') setTimeout(centerCanvas, 100); }, [pixels === null, activeTab, showOriginal]);
  useEffect(() => {
    const prev = (e) => { if (toolbarRef.current && toolbarRef.current.contains(e.target)) return; e.preventDefault(); };
    const container = scrollContainerRef.current;
    if (!container || !isCanvasLocked || activeTab !== 'editor') return;
    container.addEventListener('touchmove', prev, { passive: false });
    return () => container.removeEventListener('touchmove', prev);
  }, [isCanvasLocked, activeTab]);

  const syncLayersFromPixels = useCallback((curr) => {
    if (!curr) { setLayerOrder([]); return; }
    const set = new Set();
    curr.forEach(r => r.forEach(p => { if (Array.isArray(p)) { const k = JSON.stringify(p); if (k !== TRANSPARENT_KEY) set.add(k); } }));
    setLayerOrder(prev => {
      const ex = prev.filter(c => set.has(c)); const nw = Array.from(set).filter(c => !prev.includes(c));
      return [...ex, ...nw];
    });
  }, []);

  const createHistorySnapshot = useCallback((nextPixels, overrides = {}) => ({
    pixels: nextPixels,
    layerOrder: overrides.layerOrder ?? layerOrderRef.current,
    layerHeightAdjustments: overrides.layerHeightAdjustments ?? layerHeightAdjustmentsRef.current,
    layerSmoothingSettings: overrides.layerSmoothingSettings ?? layerSmoothingSettingsRef.current,
  }), []);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    if (Array.isArray(snapshot)) {
      setPixels(snapshot);
      syncLayersFromPixels(snapshot);
      setLayerSortMode('current');
      return;
    }
    setPixels(snapshot.pixels);
    setLayerOrder(snapshot.layerOrder || []);
    setLayerHeightAdjustments(snapshot.layerHeightAdjustments || {});
    setLayerSmoothingSettings(snapshot.layerSmoothingSettings || {});
    setLayerSortMode('current');
  }, [syncLayersFromPixels]);

  const pushToHistory = useCallback((p, overrides = {}) => {
    if (!p) return; const s = JSON.stringify(createHistorySnapshot(p, overrides));
    setHistory(prev => {
        const n = prev.stack.slice(0, prev.step + 1); n.push(s); if (n.length > MAX_UNDO) n.shift();
        return { stack: n, step: n.length - 1 };
    });
  }, [createHistorySnapshot]);

  const applySquareCanvasChange = useCallback((nextPixels, nextGridSize, status) => {
    setPixels(nextPixels);
    setGridSize(nextGridSize);
    syncLayersFromPixels(nextPixels);
    setLayerSortMode('current');
    setCanvasLayerJumpColor(null);
    setPendingCanvasResize(null);
    pushToHistory(nextPixels);
    if (status) setStatusMessage(status);
    const nextCursor = { x: Math.min(Math.max(0, cursorPos.x), Math.max(0, nextGridSize - 1)), y: Math.min(Math.max(0, cursorPos.y), Math.max(0, nextGridSize - 1)) };
    setCursorPos(nextCursor);
    cursorSubPixelRef.current = { ...nextCursor };
  }, [cursorPos.x, cursorPos.y, pushToHistory, syncLayersFromPixels]);

  const undo = useCallback(() => setHistory(prev => {
    if (prev.step > 0) { const p = JSON.parse(prev.stack[prev.step - 1]); restoreHistorySnapshot(p); return { ...prev, step: prev.step - 1 }; }
    return prev;
  }), [restoreHistorySnapshot]);

  const redo = useCallback(() => setHistory(prev => {
    if (prev.step < prev.stack.length - 1) { const n = JSON.parse(prev.stack[prev.step + 1]); restoreHistorySnapshot(n); return { ...prev, step: prev.step + 1 }; }
    return prev;
  }), [restoreHistorySnapshot]);

  const uniqueColorCount = pixels ? collectUniqueColorStats(pixels).size : 0;
  const modelSuggestedMixBaseColors = pixels ? suggestIdealMixBaseColors(pixels, COLOR_MIX_BASE_COUNT) : [];
  const fallbackMixBaseHexes = Array.from({ length: COLOR_MIX_BASE_COUNT }, (_, index) => modelSuggestedMixBaseColors[index] ? rgbToHex(modelSuggestedMixBaseColors[index]) : '');
  const resolvedCustomMixBaseHexes = customMixBaseHexes.map((hex, index) => hex || fallbackMixBaseHexes[index] || '');

  const applyMergedColorState = useCallback((mergedState) => {
    setPixels(mergedState.nextPixels);
    setLayerOrder(mergedState.nextLayerOrder);
    setLayerHeightAdjustments(mergedState.nextLayerHeightAdjustments);
    setLayerSmoothingSettings(mergedState.nextLayerSmoothingSettings);

    const currentColorKey = JSON.stringify(currentColor);
    const replacementKey = mergedState.replacementMap.get(currentColorKey);
    if (replacementKey && replacementKey !== currentColorKey) setCurrentColor(JSON.parse(replacementKey));

    pushToHistory(mergedState.nextPixels, {
      layerOrder: mergedState.nextLayerOrder,
      layerHeightAdjustments: mergedState.nextLayerHeightAdjustments,
      layerSmoothingSettings: mergedState.nextLayerSmoothingSettings,
    });
    setStatusMessage(`${mergedState.beforeCount} colors -> ${mergedState.afterCount} colors`);
  }, [currentColor, pushToHistory]);

  const mergeSimilarColors = useCallback(() => {
    if (!pixels) return;
    const mergedState = buildMergedColorState(pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings);
    if (!mergedState) {
      setStatusMessage(`No similar colors found. ${uniqueColorCount} colors unchanged.`);
      return;
    }
    applyMergedColorState(mergedState);
  }, [pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings, applyMergedColorState, uniqueColorCount]);

  const reduceColorsToTarget = useCallback(() => {
    if (!pixels) return;
    const safeTarget = Math.max(1, Math.floor(Number(targetColorCount) || DEFAULT_TARGET_COLOR_COUNT));
    if (safeTarget >= uniqueColorCount) {
      setStatusMessage(`Target already reached. ${uniqueColorCount} colors unchanged.`);
      return;
    }
    const reducedState = buildReducedColorState(pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings, safeTarget);
    if (!reducedState) {
      setStatusMessage(`Unable to reduce below ${uniqueColorCount} colors.`);
      return;
    }
    applyMergedColorState(reducedState);
  }, [pixels, targetColorCount, uniqueColorCount, layerOrder, layerHeightAdjustments, layerSmoothingSettings, applyMergedColorState]);

  const updateCustomMixBaseHex = useCallback((index, value) => {
    setCustomMixBaseHexes((prev) => prev.map((hex, hexIndex) => hexIndex === index ? value : hex));
  }, []);

  const suggestColorMixAdvisor = useCallback(() => {
    if (!pixels) return;
    const suggestedColors = suggestIdealMixBaseColors(pixels, COLOR_MIX_BASE_COUNT);
    const result = buildColorMixAdvisorResult(pixels, layerOrder, suggestedColors);
    setSuggestedMixBaseColors(suggestedColors);
    setCustomMixBaseHexes(Array.from({ length: COLOR_MIX_BASE_COUNT }, (_, index) => suggestedColors[index] ? rgbToHex(suggestedColors[index]) : ''));
    setColorMixAdvisorResult(result ? { ...result, modeLabel: `Suggested ${suggestedColors.length} Base Color${suggestedColors.length === 1 ? '' : 's'}` } : null);
    setStatusMessage(result ? `Suggested ${suggestedColors.length} base colors for the current model.` : 'No visible layer colors found.');
  }, [pixels, layerOrder]);

  const evaluateCustomMixBaseColors = useCallback(() => {
    if (!pixels) return;
    const parsedBaseColors = resolvedCustomMixBaseHexes.map((hex) => hexToRgb(hex));
    if (parsedBaseColors.some((rgb) => !rgb)) {
      setStatusMessage('Please enter 4 valid Hex colors before evaluating.');
      return;
    }
    const result = buildColorMixAdvisorResult(pixels, layerOrder, parsedBaseColors);
    setColorMixAdvisorResult(result ? { ...result, modeLabel: 'Custom 4-Color Evaluation' } : null);
    setStatusMessage(result ? 'Evaluated the current model against your 4 custom colors.' : 'No visible layer colors found.');
  }, [resolvedCustomMixBaseHexes, pixels, layerOrder]);

  const applyColorMixAdvisorResult = useCallback(() => {
    if (!pixels || !colorMixAdvisorResult) return;
    const appliedState = buildAppliedColorMixState(pixels, layerOrder, layerHeightAdjustments, layerSmoothingSettings, colorMixAdvisorResult);
    if (!appliedState) {
      setStatusMessage('No evaluated colors available to apply.');
      return;
    }

    setPixels(appliedState.nextPixels);
    setLayerOrder(appliedState.nextLayerOrder);
    setLayerHeightAdjustments(appliedState.nextLayerHeightAdjustments);
    setLayerSmoothingSettings(appliedState.nextLayerSmoothingSettings);

    const currentColorKey = JSON.stringify(currentColor);
    const replacementLayer = colorMixAdvisorResult.layers.find((layer) => layer.key === currentColorKey);
    if (replacementLayer) setCurrentColor(replacementLayer.mixedRgb);

    pushToHistory(appliedState.nextPixels, {
      layerOrder: appliedState.nextLayerOrder,
      layerHeightAdjustments: appliedState.nextLayerHeightAdjustments,
      layerSmoothingSettings: appliedState.nextLayerSmoothingSettings,
    });
    setStatusMessage('Applied evaluated color mixing result to the model.');
  }, [colorMixAdvisorResult, currentColor, layerHeightAdjustments, layerOrder, layerSmoothingSettings, pixels, pushToHistory]);

  const handleLayerColorChange = useCallback((sourceKey, nextHex) => {
    if (!pixels) return;
    const nextRgb = hexToRgb(nextHex);
    if (!nextRgb) {
      setStatusMessage('Invalid layer color.');
      return;
    }

    const nextState = buildLayerColorEditState(
      pixels,
      layerOrder,
      layerHeightAdjustments,
      layerSmoothingSettings,
      sourceKey,
      nextRgb
    );
    if (!nextState) return;

    setPixels(nextState.nextPixels);
    setLayerOrder(nextState.nextLayerOrder);
    setLayerHeightAdjustments(nextState.nextLayerHeightAdjustments);
    setLayerSmoothingSettings(nextState.nextLayerSmoothingSettings);
    setLayerSortMode('current');

    const currentColorKey = JSON.stringify(currentColor);
    if (currentColorKey === sourceKey) setCurrentColor(nextRgb);

    pushToHistory(nextState.nextPixels, {
      layerOrder: nextState.nextLayerOrder,
      layerHeightAdjustments: nextState.nextLayerHeightAdjustments,
      layerSmoothingSettings: nextState.nextLayerSmoothingSettings,
    });
    setStatusMessage(nextState.merged ? 'Layer color updated and merged into an existing layer.' : 'Layer color updated.');
  }, [currentColor, layerHeightAdjustments, layerOrder, layerSmoothingSettings, pixels, pushToHistory]);

  const updatePendingLayerColor = useCallback((sourceKey, nextHex) => {
    const normalizedHex = normalizeHexColor(nextHex);
    if (!normalizedHex) return;
    setPendingLayerColors((prev) => ({ ...prev, [sourceKey]: normalizedHex.toUpperCase() }));
  }, []);

  const cancelPendingLayerColor = useCallback((sourceKey) => {
    setPendingLayerColors((prev) => {
      if (!(sourceKey in prev)) return prev;
      const next = { ...prev };
      delete next[sourceKey];
      return next;
    });
  }, []);

  const applyPendingLayerColor = useCallback((sourceKey) => {
    const nextHex = pendingLayerColors[sourceKey];
    cancelPendingLayerColor(sourceKey);
    if (!nextHex) return;
    handleLayerColorChange(sourceKey, nextHex);
  }, [cancelPendingLayerColor, handleLayerColorChange, pendingLayerColors]);

  const jumpToLayerForColor = useCallback((color) => {
    if (!Array.isArray(color)) return;
    const colorKey = JSON.stringify(color);
    if (colorKey === TRANSPARENT_KEY || !layerOrderRef.current.includes(colorKey)) return;
    setJumpHighlightedLayer(colorKey);
    setActiveTab('layers');
  }, []);

  const handleCanvasLayerJump = useCallback(() => {
    if (!canvasLayerJumpColor) return;
    jumpToLayerForColor(canvasLayerJumpColor);
    setCanvasLayerJumpColor(null);
  }, [canvasLayerJumpColor, jumpToLayerForColor]);

  const handleToolAction = useCallback((x, y, isFirst) => {
    setPixels(prev => {
      if (!prev || !prev[y] || prev[y][x] === undefined) return prev;
      if (tool === 'select') { if (isFirst) setSelection({ start: { x, y }, end: { x, y } }); else setSelection(s => s ? { ...s, end: { x, y } } : { start: { x, y }, end: { x, y } }); return prev; }
      if (tool === 'paste') {
        if (!isFirst || !clipboard) return prev; const n = prev.map(r => [...r]);
        clipboard.data.forEach((row, dy) => row.forEach((color, dx) => {
          const tx = x + dx; const ty = y + dy; if (ty >= 0 && ty < prev.length && tx >= 0 && tx < prev[0].length) n[ty][tx] = color;
        }));
        return n;
      }
      if (tool === 'dropper') {
        if (isFirst) {
          const pickedColor = prev[y][x];
          setCurrentColor(pickedColor);
          setTool('pen');
          setCanvasLayerJumpColor(JSON.stringify(pickedColor) === TRANSPARENT_KEY ? null : [...pickedColor]);
        }
        return prev;
      }
      const col = isTransparentMode ? [...TRANSPARENT_COLOR] : currentColor;
      if (tool === 'pen') {
        const n = [...prev]; const r = (brushSize - 1) / 2; let ch = false;
        for (let dy = -Math.floor(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.floor(r); dx <= Math.ceil(r); dx++) {
          const nx = x + dx; const ny = y + dy;
          if (nx >= 0 && nx < prev[0].length && ny >= 0 && ny < prev.length) {
            if (brushSize === 1 || Math.sqrt(dx*dx + dy*dy) <= brushSize / 2) {
              if (JSON.stringify(n[ny][nx]) !== JSON.stringify(col)) { if (n[ny] === prev[ny]) n[ny] = [...prev[ny]]; n[ny][nx] = col; ch = true; }
            }
          }
        }
        return ch ? n : prev;
      }
      if (tool === 'bucket' && isFirst) {
        const tKey = JSON.stringify(prev[y][x]); if (tKey === JSON.stringify(col)) return prev;
        const n = prev.map(r => [...r]); const q = [[x, y]]; const v = new Set();
        while (q.length) {
          const [cx, cy] = q.shift(); const k = `${cx},${cy}`;
          if (v.has(k) || cx < 0 || cy < 0 || cx >= prev[0].length || cy >= prev.length || JSON.stringify(n[cy][cx]) !== tKey) continue;
          v.add(k); n[cy][cx] = col; q.push([cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]);
        }
        return n;
      }
      if (tool === 'islandFill' && isFirst) {
        const sKey = JSON.stringify(prev[y][x]); const fCol = isTransparentMode ? [...TRANSPARENT_COLOR] : currentColor;
        if (sKey === TRANSPARENT_KEY || sKey === JSON.stringify(fCol)) return prev;
        const n = prev.map(r => [...r]); const q = [[x, y]]; const v = new Set([`${x},${y}`]);
        while (q.length > 0) {
          const [cx, cy] = q.shift(); n[cy][cx] = fCol;
          const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of neighbors) {
            const key = `${nx},${ny}`;
            if (nx >= 0 && nx < n[0].length && ny >= 0 && ny < n.length && !v.has(key) && JSON.stringify(n[ny][nx]) !== TRANSPARENT_KEY) {
              v.add(key); q.push([nx, ny]);
            }
          }
        }
        return n;
      }
      if (tool === 'autoOutline' && isFirst) {
        const sKey = JSON.stringify(prev[y][x]); if (sKey === TRANSPARENT_KEY) return prev;
        const fCol = isTransparentMode ? [...TRANSPARENT_COLOR] : currentColor;
        const n = prev.map(r => [...r]); const island = new Set(); const outline = new Set();
        const q = [[x, y]]; const v = new Set([`${x},${y}`]);
        while (q.length > 0) {
          const [cx, cy] = q.shift(); island.add(`${cx},${cy}`);
          const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of neighbors) {
            const key = `${nx},${ny}`;
            if (nx >= 0 && nx < n[0].length && ny >= 0 && ny < n.length && !v.has(key) && JSON.stringify(n[ny][nx]) !== TRANSPARENT_KEY) {
              v.add(key); q.push([nx, ny]);
            }
          }
        }
        for (const pk of island) {
          const [cx, cy] = pk.split(',').map(Number);
          const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < n[0].length && ny >= 0 && ny < n.length && JSON.stringify(n[ny][nx]) === TRANSPARENT_KEY) outline.add(`${nx},${ny}`);
          }
        }
        outline.forEach(pk => { const [ox, oy] = pk.split(',').map(Number); n[oy][ox] = fCol; });
        return n;
      }
      return prev;
    });
  }, [tool, currentColor, isTransparentMode, brushSize, clipboard]);

  const reprocessImage = useCallback((imgSrc, size, offsetX, offsetY) => {
    if (!imgSrc) return; const img = new Image();
    img.onload = () => {
      const sc = document.createElement('canvas'); sc.width = img.width; sc.height = img.height;
      const sCtx = sc.getContext('2d'); sCtx.drawImage(img, 0, 0);
      const aspect = img.height / img.width; const h = Math.round(size * aspect);
      const n = [];
      for (let y = 0; y < h; y++) {
        const r = [];
        for (let x = 0; x < size; x++) {
          const sx = ((x + 0.5 + offsetX) / size) * img.width; const sy = ((y + 0.5 + offsetY) / h) * img.height;
          const cx = Math.max(0, Math.min(img.width - 1, Math.floor(sx))); const cy = Math.max(0, Math.min(img.height - 1, Math.floor(sy)));
          const pd = sCtx.getImageData(cx, cy, 1, 1).data;
          if (pd[3] < 128) r.push([...TRANSPARENT_COLOR]); else r.push([pd[0], pd[1], pd[2]]);
        }
        n.push(r);
      }
      setPixels(n); pushToHistory(n); syncLayersFromPixels(n);
      const ip = { x: Math.floor(size / 2), y: Math.floor(h / 2) };
      setCursorPos(ip); cursorSubPixelRef.current = { ...ip };
    };
    img.src = imgSrc;
  }, [syncLayersFromPixels, pushToHistory]);

  const handleUpload = useCallback((f) => {
    if (!f) return;
    const fn = f.name.split('.').slice(0, -1).join('.');
    setProjectName(fn); setOutputFileName(fn); setOriginalFilePath(f.name); 
    setCreatedAt(getFormattedDate("display")); setHistory({ stack: [], step: -1 });

    const isGif = f.type === 'image/gif' || /\.gif$/i.test(f.name);
    if (isGif) {
      f.arrayBuffer().then(async (buffer) => {
        try {
          const frames = await buildGifFrameSources(buffer);
          if (!frames.length) throw new Error('No GIF frames decoded');
          setGifFrames(frames);
          setSelectedGifFrameIndex(0);
          setSourceImage(frames[0]);
          reprocessImage(frames[0], gridSize, sampleOffsetX, sampleOffsetY);
        } catch {
          const fallbackReader = new FileReader();
          fallbackReader.onload = (e) => {
            setGifFrames([]);
            setSelectedGifFrameIndex(0);
            setSourceImage(e.target.result);
            reprocessImage(e.target.result, gridSize, sampleOffsetX, sampleOffsetY);
            setStatusMessage('GIF frame decode failed. Loaded the image without frame controls.');
          };
          fallbackReader.readAsDataURL(f);
        }
      });
      return;
    }

    const r = new FileReader();
    r.onload = (e) => {
      setGifFrames([]);
      setSelectedGifFrameIndex(0);
      setSourceImage(e.target.result);
      reprocessImage(e.target.result, gridSize, sampleOffsetX, sampleOffsetY);
    };
    r.readAsDataURL(f);
  }, [gridSize, sampleOffsetX, sampleOffsetY, reprocessImage]);

  const handleNewCanvas = useCallback(() => {
    const s = gridSize; const n = Array.from({ length: s }, () => Array.from({ length: s }, () => [...TRANSPARENT_COLOR]));
    const def = getFormattedDate("compact"); setProjectName(def); setOutputFileName(def);
    setSourceImage(null); setGifFrames([]); setSelectedGifFrameIndex(0); setShowOriginal(false); setOriginalFilePath(""); setCreatedAt(getFormattedDate("display")); setHistory({ stack: [], step: -1 });
    setPixels(n); pushToHistory(n); syncLayersFromPixels(n); setTool('pen'); setShowConfirmModal(false);
    const ip = { x: Math.floor(s / 2), y: Math.floor(s / 2) }; setCursorPos(ip); cursorSubPixelRef.current = { ...ip };
  }, [gridSize, pushToHistory, syncLayersFromPixels]);

  const saveProject = useCallback(() => {
    if (!pixels) return;
    const pd = { version: "1.4", projectName, outputFileName, author, createdAt, originalFilePath, gridSize, dotSize, layerThickness, baseThickness, padSensitivity, layerOrder, layerHeightAdjustments, layerSmoothingSettings, pixels, sourceImage };
    const b = new Blob([JSON.stringify(pd)], { type: 'application/json' }); const u = URL.createObjectURL(b);
    const l = document.createElement('a'); l.href = u; l.download = `${projectName || 'project'}.json`;
    l.click(); setStatusMessage("プロジェクトを保存しました！💾");
  }, [pixels, projectName, outputFileName, author, createdAt, originalFilePath, gridSize, dotSize, layerThickness, baseThickness, padSensitivity, layerOrder, layerHeightAdjustments, layerSmoothingSettings, sourceImage]);

  const loadProject = useCallback((e) => {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.pixels) {
          isLoadingRef.current = true; setProjectName(d.projectName || ""); setOutputFileName(d.outputFileName || "");
          setAuthor(d.author || ""); setCreatedAt(d.createdAt || ""); setOriginalFilePath(d.originalFilePath || "");
          setGridSize(d.gridSize); setDotSize(d.dotSize); setLayerThickness(d.layerThickness); setBaseThickness(d.baseThickness);
          setPadSensitivity(d.padSensitivity); setLayerOrder(d.layerOrder || []); setSourceImage(d.sourceImage || null); setGifFrames([]); setSelectedGifFrameIndex(0); setPixels(d.pixels);
          setLayerHeightAdjustments(d.layerHeightAdjustments || {}); setLayerSmoothingSettings(d.layerSmoothingSettings || {});
          setHistory({ stack: [JSON.stringify(createHistorySnapshot(d.pixels, { layerOrder: d.layerOrder || [], layerHeightAdjustments: d.layerHeightAdjustments || {}, layerSmoothingSettings: d.layerSmoothingSettings || {} }))], step: 0 }); setStatusMessage("プロジェクトを復元しました！📂");
          setTimeout(() => { isLoadingRef.current = false; centerCanvas(); }, 100);
        }
      } catch (err) { setStatusMessage("読み込みエラー。"); }
    };
    r.readAsText(f); e.target.value = '';
  }, [centerCanvas, createHistorySnapshot]);

  const openCanvasAdjustModal = useCallback(() => {
    setCanvasAdjustSizeInput(`${gridSize}`);
    setPendingCanvasResize(null);
    setShowCanvasAdjustModal(true);
  }, [gridSize]);

  const requestSquareCanvasResize = useCallback((force = false) => {
    if (!pixels) return;
    blurActiveElement();
    const nextSize = Math.min(MAX_RESOLUTION, Math.max(MIN_CANVAS_SIZE, Number.parseInt(canvasAdjustSizeInput, 10) || gridSize));
    if (nextSize === gridSize) {
      setShowCanvasAdjustModal(false);
      return;
    }
    const resized = resizeSquarePixels(pixels, nextSize);
    if (!force && resized.discardedFilledCount > 0) {
      setPendingCanvasResize({ nextSize, discardedFilledCount: resized.discardedFilledCount, nextPixels: resized.nextPixels });
      return;
    }
    suppressSourceReprocessRef.current = true;
    applySquareCanvasChange(resized.nextPixels, nextSize, `Canvas resized to ${nextSize} x ${nextSize}.`);
    setShowCanvasAdjustModal(false);
  }, [applySquareCanvasChange, canvasAdjustSizeInput, gridSize, pixels]);

  const trimCanvasToSquare = useCallback((padding = 0) => {
    if (!pixels) return;
    blurActiveElement();
    const trimmed = trimPixelsToSquare(pixels, padding);
    if (!trimmed) {
      setStatusMessage('No visible dots found to trim.');
      return;
    }
    suppressSourceReprocessRef.current = true;
    applySquareCanvasChange(
      trimmed.nextPixels,
      trimmed.nextSize,
      trimmed.padding > 0 ? `Canvas trimmed to a square with ${trimmed.padding} cell padding.` : 'Canvas trimmed to the smallest square fit.'
    );
    setShowCanvasAdjustModal(false);
  }, [applySquareCanvasChange, pixels]);

  const selectGifFrame = useCallback((nextIndex) => {
    if (!gifFrames.length) return;
    const clampedIndex = Math.max(0, Math.min(gifFrames.length - 1, nextIndex));
    const nextFrame = gifFrames[clampedIndex];
    if (!nextFrame) return;
    setSelectedGifFrameIndex(clampedIndex);
    setSourceImage(nextFrame);
    setHistory({ stack: [], step: -1 });
    reprocessImage(nextFrame, gridSize, sampleOffsetX, sampleOffsetY);
  }, [gifFrames, gridSize, sampleOffsetX, sampleOffsetY, reprocessImage]);

  const exportSTL = () => {
    if (!sceneRef.current) return; const ex = new STLExporter();
    const b = new Blob([ex.parse(sceneRef.current, { binary: true })], { type: 'application/octet-stream' });
    const a = document.createElement('a'); const ts = getFormattedDate("filename");
    a.href = URL.createObjectURL(b); a.download = `${ts}_stl_${outputFileName || 'dotplate'}.stl`;
    a.click(); setStatusMessage("STL出力完了！📦");
  };

  const exportImage = useCallback(async () => {
    if (!pixels || isExporting) return; setIsExporting(true); setStatusMessage("画像を構築中...");
    const ppmm = 300 / 25.4; const cds = dotSize * ppmm; const h = pixels.length; const w = pixels[0].length;
    const MAX = 4096; let fds = cds; if (w * fds > MAX || h * fds > MAX) fds = Math.min(MAX / w, MAX / h);
    const c = document.createElement('canvas'); c.width = Math.floor(w * fds); c.height = Math.floor(h * fds);
    const ctx = c.getContext('2d', { alpha: true });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const col = pixels[y][x]; if (JSON.stringify(col) === TRANSPARENT_KEY) continue;
        ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; ctx.fillRect(Math.floor(x * fds), Math.floor(y * fds), Math.ceil(fds), Math.ceil(fds));
      }
      if (y % 30 === 0) await new Promise(r => setTimeout(r, 0));
    }
    c.toBlob((b) => {
      if (b) {
        const u = URL.createObjectURL(b); const a = document.createElement('a'); const ts = getFormattedDate("filename");
        a.download = `${ts}_img_${outputFileName || 'dotplate'}.png`; a.href = u; a.click(); URL.revokeObjectURL(u); setStatusMessage("画像出力完了！📸");
      }
      setIsExporting(false);
    }, 'image/png');
  }, [pixels, dotSize, isExporting, outputFileName]);

  const getTouchDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  const getTouchMidpoint = (touches) => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });
  const resetPinchZoom = () => { pinchZoomRef.current = { active: false, startDistance: 0, startZoom: 1, anchorX: 0, anchorY: 0, midpointX: 0, midpointY: 0 }; };
  const syncPinchAnchor = (nextZoom, midpointX, midpointY, anchorX, anchorY) => {
    requestAnimationFrame(() => {
      const canvas = editorCanvasRef.current;
      const container = scrollContainerRef.current;
      if (!canvas || !container) return;
      const canvasRect = canvas.getBoundingClientRect();
      const anchorScreenX = canvasRect.left + anchorX * 10 * nextZoom;
      const anchorScreenY = canvasRect.top + anchorY * 10 * nextZoom;
      container.scrollLeft += anchorScreenX - midpointX;
      container.scrollTop += anchorScreenY - midpointY;
    });
  };

  const applyAnchoredZoom = useCallback((clientX, clientY, zoomFactor) => {
    const canvas = editorCanvasRef.current;
    if (!canvas || !Number.isFinite(zoomFactor) || zoomFactor <= 0) return;
    const currentZoom = zoomRef.current;
    const canvasRect = canvas.getBoundingClientRect();
    const anchorX = (clientX - canvasRect.left) / (10 * currentZoom);
    const anchorY = (clientY - canvasRect.top) / (10 * currentZoom);
    const nextZoom = Math.min(10, Math.max(0.05, currentZoom * zoomFactor));
    if (Math.abs(nextZoom - currentZoom) < 0.0001) return;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    syncPinchAnchor(nextZoom, clientX, clientY, anchorX, anchorY);
  }, []);

  const startDrawingNormal = (e) => {
    if (useVirtualPad || !editorCanvasRef.current) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX; const cy = e.touches ? e.touches[0].clientY : e.clientY;
    if (e.touches && e.touches.length === 2) {
      e.preventDefault();
      const startDistance = getTouchDistance(e.touches);
      const midpoint = getTouchMidpoint(e.touches);
      const canvasRect = editorCanvasRef.current.getBoundingClientRect();
      const anchorX = (midpoint.x - canvasRect.left) / (10 * zoom);
      const anchorY = (midpoint.y - canvasRect.top) / (10 * zoom);
      if (startDistance > 0) pinchZoomRef.current = { active: true, startDistance, startZoom: zoom, anchorX, anchorY, midpointX: midpoint.x, midpointY: midpoint.y };
      isDrawingRef.current = false;
      return;
    }
    if (tool === 'hand') { isDrawingRef.current = true; const c = scrollContainerRef.current; dragStartRef.current = { x: cx, y: cy, scrollLeft: c.scrollLeft, scrollTop: c.scrollTop }; return; }
    const r = editorCanvasRef.current.getBoundingClientRect(); const x = Math.floor((cx - r.left) / (10 * zoom)); const y = Math.floor((cy - r.top) / (10 * zoom));
    if (x >= 0 && y >= 0 && x < (pixelsRef.current?.[0]?.length || 0) && y < (pixelsRef.current?.length || 0)) { isDrawingRef.current = true; handleToolAction(x, y, true); }
  };

  const drawMoveNormal = (e) => {
    if (useVirtualPad || !editorCanvasRef.current) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX; const cy = e.touches ? e.touches[0].clientY : e.clientY;
    if (e.touches && e.touches.length === 2) {
      e.preventDefault();
      const distance = getTouchDistance(e.touches);
      const midpoint = getTouchMidpoint(e.touches);
      if (!pinchZoomRef.current.active && distance > 0) {
        const canvasRect = editorCanvasRef.current.getBoundingClientRect();
        const anchorX = (midpoint.x - canvasRect.left) / (10 * zoom);
        const anchorY = (midpoint.y - canvasRect.top) / (10 * zoom);
        pinchZoomRef.current = { active: true, startDistance: distance, startZoom: zoom, anchorX, anchorY, midpointX: midpoint.x, midpointY: midpoint.y };
      }
      const { active, startDistance, startZoom, anchorX, anchorY } = pinchZoomRef.current;
      if (active && startDistance > 0 && distance > 0) {
        const nextZoom = Math.min(10, Math.max(0.05, startZoom * (distance / startDistance)));
        setZoom(nextZoom);
        syncPinchAnchor(nextZoom, midpoint.x, midpoint.y, anchorX, anchorY);
      }
      return;
    }
    if (!isDrawingRef.current) return;
    if (tool === 'hand') { const c = scrollContainerRef.current; c.scrollLeft = dragStartRef.current.scrollLeft - (cx - dragStartRef.current.x); c.scrollTop = dragStartRef.current.scrollTop - (cy - dragStartRef.current.y); return; }
    const r = editorCanvasRef.current.getBoundingClientRect(); const x = Math.floor((cx - r.left) / (10 * zoom)); const y = Math.floor((cy - r.top) / (10 * zoom));
    if (x >= 0 && y >= 0 && x < (pixelsRef.current?.[0]?.length || 0) && y < (pixelsRef.current?.length || 0)) handleToolAction(x, y, false);
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || activeTab !== 'editor' || !pixels) return;

    const handleTrackpadPinchWheel = (event) => {
      if (!container.contains(event.target)) return;
      const isBrowserPinch = event.ctrlKey || event.metaKey || Math.abs(event.deltaZ) > 0;
      if (!isBrowserPinch) return;
      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.01);
      applyAnchoredZoom(event.clientX, event.clientY, zoomFactor);
    };

    const handleSafariGestureStart = (event) => {
      if (!container.contains(event.target)) return;
      safariGestureScaleRef.current = 1;
      event.preventDefault();
    };

    const handleSafariGestureChange = (event) => {
      if (!container.contains(event.target)) return;
      event.preventDefault();
      const previousScale = safariGestureScaleRef.current || 1;
      const nextScale = event.scale || 1;
      const zoomFactor = nextScale / previousScale;
      safariGestureScaleRef.current = nextScale;
      applyAnchoredZoom(event.clientX, event.clientY, zoomFactor);
    };

    const handleSafariGestureEnd = () => {
      safariGestureScaleRef.current = 1;
    };

    container.addEventListener('wheel', handleTrackpadPinchWheel, { passive: false });
    container.addEventListener('gesturestart', handleSafariGestureStart, { passive: false });
    container.addEventListener('gesturechange', handleSafariGestureChange, { passive: false });
    container.addEventListener('gestureend', handleSafariGestureEnd);

    return () => {
      container.removeEventListener('wheel', handleTrackpadPinchWheel);
      container.removeEventListener('gesturestart', handleSafariGestureStart);
      container.removeEventListener('gesturechange', handleSafariGestureChange);
      container.removeEventListener('gestureend', handleSafariGestureEnd);
    };
  }, [activeTab, applyAnchoredZoom, pixels]);

  useEffect(() => {
    if (activeTab !== 'layers' || !jumpHighlightedLayer) return;
    const row = layerRowRefs.current[jumpHighlightedLayer];
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (layerJumpHighlightTimeoutRef.current) clearTimeout(layerJumpHighlightTimeoutRef.current);
    layerJumpHighlightTimeoutRef.current = setTimeout(() => {
      setJumpHighlightedLayer(current => current === jumpHighlightedLayer ? null : current);
      layerJumpHighlightTimeoutRef.current = null;
    }, LAYER_JUMP_HIGHLIGHT_MS);
  }, [activeTab, jumpHighlightedLayer, layerOrder]);

  useEffect(() => () => {
    if (layerJumpHighlightTimeoutRef.current) clearTimeout(layerJumpHighlightTimeoutRef.current);
  }, []);

  const stopDrawingNormal = () => { if (isDrawingRef.current && pixelsRef.current && tool !== 'hand' && tool !== 'select' && tool !== 'dropper') { pushToHistory(pixelsRef.current); syncLayersFromPixels(pixelsRef.current); } isDrawingRef.current = false; resetPinchZoom(); };
  const startOriginalImageDrag = (e) => {
    const container = originalImageContainerRef.current;
    if (!container) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    originalDragRef.current = { active: true, x: cx, y: cy, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop };
  };
  const moveOriginalImageDrag = (e) => {
    if (!originalDragRef.current.active) return;
    const container = originalImageContainerRef.current;
    if (!container) return;
    if (e.touches) e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    container.scrollLeft = originalDragRef.current.scrollLeft - (cx - originalDragRef.current.x);
    container.scrollTop = originalDragRef.current.scrollTop - (cy - originalDragRef.current.y);
  };
  const stopOriginalImageDrag = () => { originalDragRef.current.active = false; };
  const handleTrackpadStart = (e) => { e.preventDefault(); const cx = e.touches ? e.touches[0].clientX : e.clientX; const cy = e.touches ? e.touches[0].clientY : e.clientY; lastTrackpadPosRef.current = { x: cx, y: cy }; isDrawingRef.current = true; };
  const handleTrackpadMove = (e) => {
    if (!isDrawingRef.current) return; e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX; const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = cx - lastTrackpadPosRef.current.x; const dy = cy - lastTrackpadPosRef.current.y; lastTrackpadPosRef.current = { x: cx, y: cy };
    const sc = (padSensitivity * 0.1) / zoom; cursorSubPixelRef.current.x += dx * sc; cursorSubPixelRef.current.y += dy * sc;
    const mx = (pixelsRef.current?.[0]?.length || 1) - 1; const my = (pixelsRef.current?.length || 1) - 1;
    cursorSubPixelRef.current.x = Math.max(0, Math.min(mx, cursorSubPixelRef.current.x)); cursorSubPixelRef.current.y = Math.max(0, Math.min(my, cursorSubPixelRef.current.y));
    const nx = Math.round(cursorSubPixelRef.current.x); const ny = Math.round(cursorSubPixelRef.current.y);
    if (nx !== cursorPos.x || ny !== cursorPos.y) { setCursorPos({ x: nx, y: ny }); if (isPlotting) handleToolAction(nx, ny, false); }
  };
  const handleTrackpadEnd = () => isDrawingRef.current = false;
  const startPlotting = (e) => { e.preventDefault(); setIsPlotting(true); handleToolAction(cursorPos.x, cursorPos.y, true); };
  const stopPlotting = (e) => { e.preventDefault(); setIsPlotting(false); if (tool !== 'select' && pixelsRef.current) { pushToHistory(pixelsRef.current); syncLayersFromPixels(pixelsRef.current); } };

  const handleCopy = useCallback((e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!selection || !pixelsRef.current) return;
    const x1 = Math.min(selection.start.x, selection.end.x); const x2 = Math.max(selection.start.x, selection.end.x);
    const y1 = Math.min(selection.start.y, selection.end.y); const y2 = Math.max(selection.start.y, selection.end.y);
    const d = []; for (let y = y1; y <= y2; y++) d.push(pixelsRef.current[y].slice(x1, x2 + 1));
    setClipboard({ data: d, width: x2 - x1 + 1, height: y2 - y1 + 1 }); setSelection(null); setStatusMessage("コピーしました！"); setTool('paste');
  }, [selection]);

  const applyLayerOrderChange = useCallback((nextLayerOrder, options = {}) => {
    if (!pixels) return false;
    if (nextLayerOrder.length !== layerOrder.length || nextLayerOrder.every((key, index) => key === layerOrder[index])) return false;
    setLayerOrder(nextLayerOrder);
    setLayerSortMode(options.sortMode || 'current');
    pushToHistory(pixels, { layerOrder: nextLayerOrder });
    if (options.statusMessage) setStatusMessage(options.statusMessage);
    return true;
  }, [pixels, layerOrder, pushToHistory]);

  const moveLayer = useCallback((idx, dir) => {
    const ni = idx + dir; if (ni < 0 || ni >= layerOrder.length) return;
    const no = [...layerOrder]; const t = no[idx]; no[idx] = no[ni]; no[ni] = t;
    applyLayerOrderChange(no);
  }, [applyLayerOrderChange, layerOrder]);

  const enter3DLayerMoveMode = useCallback(() => {
    setDraft3DLayerOrder([...layerOrder]);
    setSelected3DLayer(null);
    setIs3DLayerMoveMode(true);
  }, [layerOrder]);

  const cancel3DLayerMoveMode = useCallback(() => {
    setIs3DLayerMoveMode(false);
    setDraft3DLayerOrder([]);
    setSelected3DLayer(null);
  }, []);

  const confirm3DLayerMoveMode = useCallback(() => {
    if (!is3DLayerMoveMode) return;
    const hasChanged = draft3DLayerOrder.length === layerOrder.length && draft3DLayerOrder.some((key, index) => key !== layerOrder[index]);
    if (hasChanged) applyLayerOrderChange(draft3DLayerOrder, { statusMessage: 'Layer order updated from 3D View' });
    cancel3DLayerMoveMode();
  }, [applyLayerOrderChange, cancel3DLayerMoveMode, draft3DLayerOrder, is3DLayerMoveMode, layerOrder]);

  const moveDraft3DLayer = useCallback((dir) => {
    if (!selected3DLayer) return;
    setDraft3DLayerOrder(prev => {
      const idx = prev.indexOf(selected3DLayer); const nextIdx = idx + dir;
      if (idx < 0 || nextIdx < 0 || nextIdx >= prev.length) return prev;
      const nextOrder = [...prev]; const temp = nextOrder[idx]; nextOrder[idx] = nextOrder[nextIdx]; nextOrder[nextIdx] = temp;
      return nextOrder;
    });
  }, [selected3DLayer]);

  const handleTabChange = useCallback((nextTab) => {
    if (nextTab !== '3d' && is3DLayerMoveMode) cancel3DLayerMoveMode();
    setActiveTab(nextTab);
  }, [cancel3DLayerMoveMode, is3DLayerMoveMode]);

  const applyLayerSort = useCallback((mode) => {
    if (mode === 'current' || !pixels) return;
    const nextLayerOrder = getSortedLayerOrder(layerOrder, pixels, mode);
    applyLayerOrderChange(nextLayerOrder, {
      sortMode: mode,
      statusMessage: `Layers sorted by ${LAYER_SORT_OPTIONS.find((option) => option.value === mode)?.label || mode}`,
    });
  }, [applyLayerOrderChange, pixels, layerOrder]);

  useEffect(() => {
    if (isLoadingRef.current) return;
    if (!sourceImage) return;
    if (suppressSourceReprocessRef.current) {
      suppressSourceReprocessRef.current = false;
      return;
    }
    reprocessImage(sourceImage, gridSize, sampleOffsetX, sampleOffsetY);
  }, [gridSize, sampleOffsetX, sampleOffsetY, sourceImage, reprocessImage]);

  useEffect(() => {
    const c = editorCanvasRef.current; if (!c || !pixels) return; const ctx = c.getContext('2d');
    const h = pixels.length; const w = pixels[0].length; const ps = 10 * zoom; c.width = w * ps; c.height = h * ps;
    ctx.fillStyle = '#f8f9fa'; ctx.fillRect(0, 0, c.width, c.height);
    const cs = Math.max(2, 5 * zoom); ctx.fillStyle = '#f1f5f9';
    for (let y = 0; y < c.height; y += cs * 2) for (let x = 0; x < c.width; x += cs * 2) { ctx.fillRect(x, y, cs, cs); ctx.fillRect(x + cs, y + cs, cs, cs); }
    if (showGrid) { ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5; for (let x = 1; x < w; x++) { ctx.beginPath(); ctx.moveTo(x * ps, 0); ctx.lineTo(x * ps, h * ps); ctx.stroke(); } for (let y = 1; y < h; y++) { ctx.beginPath(); ctx.moveTo(0, y * ps); ctx.lineTo(w * ps, y * ps); ctx.stroke(); } }
    pixels.forEach((r, y) => r.forEach((col, x) => { if (!Array.isArray(col) || JSON.stringify(col) === TRANSPARENT_KEY) return; ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; ctx.fillRect(x * ps, y * ps, ps, ps); }));
    if (selection) { const x1 = Math.min(selection.start.x, selection.end.x) * ps; const x2 = (Math.max(selection.start.x, selection.end.x) + 1) * ps; const y1 = Math.min(selection.start.y, selection.end.y) * ps; const y2 = (Math.max(selection.start.y, selection.end.y) + 1) * ps; ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); ctx.fillStyle = 'rgba(79, 70, 229, 0.1)'; ctx.fillRect(x1, y1, x2 - x1, y2 - y1); ctx.setLineDash([]); }
    if (useVirtualPad) { ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2.5; ctx.strokeRect(cursorPos.x * ps, cursorPos.y * ps, ps, ps); }
  }, [pixels, zoom, activeTab, cursorPos, useVirtualPad, selection, tool, clipboard, showGrid]);

  useEffect(() => {
    if (activeTab === '3d' && pixels && threeRef.current) {
      const displayLayerOrder = is3DLayerMoveMode ? draft3DLayerOrder : layerOrder;
      const container = threeRef.current; while (container.firstChild) container.removeChild(container.firstChild);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf8fafc);
      const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
      const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement); const controls = new OrbitControls(camera, renderer.domElement);
      renderer.domElement.style.cursor = 'grab';
      scene.add(new THREE.AmbientLight(0xffffff, 0.6)); const light = new THREE.DirectionalLight(0xffffff, 0.8); light.position.set(200, 400, 200); scene.add(light);
      const group = new THREE.Group(); const h = pixels.length; const w = pixels[0].length;
      const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const selectableMeshes = [];
      if (baseThickness > 0) {
        const baseGeo = new THREE.BoxGeometry(w * dotSize, h * dotSize, baseThickness);
        const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshLambertMaterial({ color: 0xdddddd }));
        baseMesh.position.set(0, 0, baseThickness / 2); group.add(baseMesh);
      }
      let cz = baseThickness;
      displayLayerOrder.forEach((cs, li) => {
        const col = JSON.parse(cs); const sm = layerSmoothingSettings[cs] || { smoothOuter: false, smoothInner: false, tolerance: 0.1, offset: 0 };
        const adj = layerHeightAdjustments[cs] || { plus: 0, minus: 0 };
        const zPlus = typeof adj === 'number' ? adj : (adj.plus || 0);
        const zMinus = typeof adj === 'number' ? 0 : (adj.minus || 0);
        const thick = layerThickness + zPlus + zMinus; 
        
        if (thick > 0.0001) {
          const targetKeys = new Set(displayLayerOrder.slice(li)); let contours = getUnionContours(pixels, targetKeys);
          const paths = contours.map(c => {
            const area = calculateArea(c); const isHole = area < 0; 
            const enabled = isHole ? sm.smoothInner : sm.smoothOuter;
            let processed = enabled ? smoothPath(c, sm.tolerance, dotSize) : c;
            
            if (!isHole && Math.abs(sm.offset) > 0.0001) {
              processed = offsetPolygon(processed, sm.offset, dotSize);
            }
            
            const pts = processed.map(p => new THREE.Vector2((p.x - w/2) * dotSize, (h/2 - p.y) * dotSize));
            return { pts, area };
          });
          paths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
          const shapeGrp = [];
          paths.forEach(({pts, area}) => {
            if (area > 0) shapeGrp.push({ outer: [...pts].reverse(), holes: [] });
            else {
              const hpts = [...pts].reverse(); let parent = null;
              for (let i = shapeGrp.length - 1; i >= 0; i--) { if (isPointInPolygon(hpts[0], shapeGrp[i].outer)) { parent = shapeGrp[i]; break; } }
              if (parent) parent.holes.push(hpts); else shapeGrp.push({ outer: hpts, holes: [] });
            }
          });
          shapeGrp.forEach(sg => {
            const shape = new THREE.Shape(sg.outer); sg.holes.forEach(hp => shape.holes.push(new THREE.Path(hp)));
            const geom = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
            const isSelectedLayer = selected3DLayer === cs;
            const mat = new THREE.MeshLambertMaterial({
              color: new THREE.Color(`rgb(${col[0]},${col[1]},${col[2]})`),
              side: THREE.DoubleSide,
              emissive: isSelectedLayer ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
              emissiveIntensity: isSelectedLayer ? 0.22 : 0,
            });
            const mesh = new THREE.Mesh(geom, mat); mesh.position.z = cz - zMinus; mesh.userData.layerKey = cs; group.add(mesh); selectableMeshes.push(mesh);
          });
        }
        cz += (layerThickness + zPlus);
      });
      scene.add(group); sceneRef.current = group; const box = new THREE.Box3().setFromObject(group); const center = box.getCenter(new THREE.Vector3());
      if (threeCameraPositionRef.current && threeControlsTargetRef.current) {
        camera.position.copy(threeCameraPositionRef.current);
        controls.target.copy(threeControlsTargetRef.current);
      } else {
        camera.position.set(center.x, center.y - 100, center.z + 100);
        controls.target.copy(center);
      }
      controls.update();
      const persistThreeViewState = () => {
        threeCameraPositionRef.current = camera.position.clone();
        threeControlsTargetRef.current = controls.target.clone();
      };
      persistThreeViewState();
      controls.addEventListener('change', persistThreeViewState);
      const handlePointerDown = (event) => {
        threePointerStateRef.current = { active: true, moved: false, x: event.clientX, y: event.clientY };
      };
      const handlePointerMove = (event) => {
        if (!threePointerStateRef.current.active) return;
        const dx = event.clientX - threePointerStateRef.current.x;
        const dy = event.clientY - threePointerStateRef.current.y;
        if (Math.hypot(dx, dy) > 6) threePointerStateRef.current.moved = true;
      };
      const handlePointerUp = (event) => {
        const pointerState = threePointerStateRef.current;
        threePointerStateRef.current.active = false;
        if (pointerState.moved) return;
        const bounds = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObjects(selectableMeshes, false);
        const nextSelectedLayer = intersections[0]?.object?.userData?.layerKey || null;
        setSelected3DLayer(nextSelectedLayer);
      };
      const handleControlsStart = () => { renderer.domElement.style.cursor = 'grabbing'; };
      const handleControlsEnd = () => { renderer.domElement.style.cursor = 'grab'; };
      controls.addEventListener('start', handleControlsStart);
      controls.addEventListener('end', handleControlsEnd);
      if (is3DLayerMoveMode) {
        renderer.domElement.addEventListener('pointerdown', handlePointerDown);
        renderer.domElement.addEventListener('pointermove', handlePointerMove);
        renderer.domElement.addEventListener('pointerup', handlePointerUp);
      }
      let frameId = null;
      const animate = () => {
        if (!threeRef.current) return;
        frameId = requestAnimationFrame(animate);
        renderer.render(scene, camera);
      };
      animate();
      return () => {
        if (is3DLayerMoveMode) {
          renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
          renderer.domElement.removeEventListener('pointermove', handlePointerMove);
          renderer.domElement.removeEventListener('pointerup', handlePointerUp);
        }
        controls.removeEventListener('change', persistThreeViewState);
        controls.removeEventListener('start', handleControlsStart);
        controls.removeEventListener('end', handleControlsEnd);
        if (frameId) cancelAnimationFrame(frameId);
        controls.dispose();
        renderer.dispose();
        while (container.firstChild) container.removeChild(container.firstChild);
      };
    }
  }, [activeTab, pixels, dotSize, layerThickness, baseThickness, layerOrder, layerHeightAdjustments, layerSmoothingSettings, selected3DLayer, draft3DLayerOrder, is3DLayerMoveMode]);

  const selected3DLayerIndex = selected3DLayer ? (is3DLayerMoveMode ? draft3DLayerOrder.indexOf(selected3DLayer) : layerOrder.indexOf(selected3DLayer)) : -1;
  const selected3DLayerColor = selected3DLayerIndex >= 0 ? JSON.parse(selected3DLayer) : null;
  const canShowCanvasLayerJump = canvasLayerJumpColor && layerOrder.includes(JSON.stringify(canvasLayerJumpColor));

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans select-none overflow-hidden relative text-left">
      <header className="flex items-center justify-between px-6 py-2.5 bg-white/80 backdrop-blur-md border-b border-slate-100 z-30 shrink-0">
        <h1 className="text-base font-black text-indigo-600 flex items-center gap-1 italic uppercase tracking-tight"><Zap fill="currentColor" size={18} /> Dot Plate Pro</h1>
        <div className="flex gap-1.5">
          <button onClick={undo} disabled={history.step <= 0} className="p-1.5 bg-slate-100/50 text-slate-600 rounded-lg disabled:opacity-20 active:scale-90 transition hover:bg-slate-100"><Undo size={16}/></button>
          <button onClick={redo} disabled={history.step >= history.stack.length - 1} className="p-1.5 bg-slate-100/50 text-slate-600 rounded-lg disabled:opacity-20 active:scale-90 transition hover:bg-slate-100"><Redo size={16}/></button>
        </div>
      </header>
      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-xs overflow-hidden animate-in zoom-in">
            <div className="p-6 text-center">
              <div className="w-10 h-10 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center mx-auto mb-3"><AlertCircle size={24} /></div>
              <h3 className="text-lg font-bold text-slate-800 mb-1">Reset</h3><p className="text-[10px] text-slate-500">Are you sure you want to clear?</p>
            </div>
            <div className="flex border-t border-slate-50">
              <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cancel</button>
              <button onClick={handleNewCanvas} className="flex-1 py-3.5 text-[10px] font-bold text-rose-500 border-l border-slate-50 uppercase tracking-widest">Reset</button>
            </div>
          </div>
        </div>
      )}
      {showCanvasAdjustModal && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in">
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Canvas Adjust</p>
                  <h3 className="text-lg font-black text-slate-800 mt-1">Square Canvas Tools</h3>
                  <p className="text-[10px] text-slate-500 mt-1">Keep the square canvas model intact while resizing or trimming the drawing area.</p>
                </div>
                <button onClick={() => { setPendingCanvasResize(null); setShowCanvasAdjustModal(false); }} className="p-2 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-600 transition"><CloseIcon size={16} /></button>
              </div>
            </div>
            <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
              <div className="rounded-[1.25rem] border border-slate-100 bg-slate-50 p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Resize Square Canvas</p>
                    <p className="text-[9px] text-slate-500">Change the square working area while keeping visible dots at the same coordinates.</p>
                  </div>
                  <div className="rounded-xl bg-white border border-slate-100 px-3 py-2 text-right">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Current</p>
                    <p className="text-sm font-black text-slate-800">{gridSize} x {gridSize}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">New Grid Size</label>
                  <input type="number" min={MIN_CANVAS_SIZE} max={MAX_RESOLUTION} value={canvasAdjustSizeInput} onChange={(e) => { setCanvasAdjustSizeInput(e.target.value); setPendingCanvasResize(null); }} className="w-full text-base sm:text-sm p-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-indigo-400 transition" />
                </div>
                {pendingCanvasResize && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest">Warning</p>
                    <p className="text-[10px] text-amber-700 mt-1">{pendingCanvasResize.discardedFilledCount} visible dot{pendingCanvasResize.discardedFilledCount === 1 ? '' : 's'} will be removed outside the new square bounds.</p>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  {pendingCanvasResize ? (
                    <button onClick={() => requestSquareCanvasResize(true)} className="px-4 py-2 rounded-xl bg-amber-600 text-white text-[9px] font-black shadow-lg uppercase tracking-widest hover:bg-amber-700 transition">Resize Anyway</button>
                  ) : (
                    <button onClick={() => requestSquareCanvasResize(false)} disabled={!pixels} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[9px] font-black shadow-lg uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition">Apply Resize</button>
                  )}
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-slate-100 bg-slate-50 p-4 space-y-4">
                <div>
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Trim Visible Dots</p>
                  <p className="text-[9px] text-slate-500">Rebuild the current drawing into the smallest square that fits the visible dots, with optional square padding.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => trimCanvasToSquare(0)} disabled={!pixels} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-[9px] font-black shadow-lg uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition">Trim To Square Fit</button>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Padding</label>
                    <input type="number" min="0" max={MAX_RESOLUTION} value={canvasAdjustPaddingInput} onChange={(e) => setCanvasAdjustPaddingInput(e.target.value)} className="w-14 text-base sm:text-sm bg-transparent outline-none text-slate-700" />
                  </div>
                  <button onClick={() => trimCanvasToSquare(Math.max(0, Number.parseInt(canvasAdjustPaddingInput, 10) || 0))} disabled={!pixels} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[9px] font-black shadow-lg uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition">Trim With Square Padding</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {isExporting && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-white/60 backdrop-blur-xl">
          <div className="text-center">
            <div className="relative w-10 h-10 mx-auto mb-3"><div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div><div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div></div>
            <p className="text-[10px] font-black text-indigo-600 animate-pulse uppercase tracking-widest">{statusMessage}</p>
          </div>
        </div>
      )}
      <main className="flex-1 flex flex-col p-1.5 overflow-hidden relative">
        <div className="flex-1 bg-white rounded-[1.5rem] shadow-sm border border-slate-100 flex flex-col overflow-hidden relative">
          {activeTab === 'editor' && (
            <div className="h-full flex flex-col relative">
              <div className="px-4 py-3 border-b border-slate-50 shrink-0">
                <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 shrink-0"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resolution</span><span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-black min-w-[64px] text-center shadow-sm">{gridSize} x {gridSize}</span></div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <button onClick={() => setUseVirtualPad(!useVirtualPad)} className={`p-1.5 rounded-lg transition shadow-sm border ${useVirtualPad ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-100 text-slate-400'}`}><Gamepad size={14}/></button>
                    <button onClick={() => setShowConfirmModal(true)} className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 shadow-sm active:scale-90 transition"><FilePlus size={14}/></button>
                    <button onClick={openCanvasAdjustModal} disabled={!pixels} className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 shadow-sm active:scale-90 transition disabled:opacity-30 disabled:cursor-not-allowed"><Maximize2 size={14}/></button>
                    <label className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 shadow-sm cursor-pointer active:scale-90 transition"><ImagePlus size={14}/><input type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} /></label>
                    <button onClick={() => setShowOriginal(!showOriginal)} disabled={!sourceImage} className={`p-1.5 rounded-lg border transition shadow-sm ${showOriginal ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-100 text-slate-400'}`}><ImageIcon size={14}/></button>
                    <button onClick={() => setShowGrid(!showGrid)} className={`p-1.5 rounded-lg border transition shadow-sm ${showGrid ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-100 text-slate-400'}`}><Grid size={14}/></button>
                    <div className="w-px h-4 bg-slate-100 mx-1"></div>
                    <button onClick={() => setShowSampleOffsetControls(!showSampleOffsetControls)} disabled={!sourceImage} className={`p-1.5 rounded-lg border transition shadow-sm disabled:opacity-30 disabled:cursor-not-allowed ${showSampleOffsetControls && isResolutionToolbarVisible ? 'bg-indigo-100 border-indigo-200 text-indigo-600' : 'bg-white border-slate-100 text-slate-400'}`}><MoreVertical size={14}/></button>
                    <button onClick={() => setIsResolutionToolbarVisible(!isResolutionToolbarVisible)} className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 shadow-sm active:scale-90 transition">{isResolutionToolbarVisible ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>
                  </div>
                </div>
                {isResolutionToolbarVisible && (
                  <>
                    <div className="w-full px-1 flex items-center gap-2">
                      <button onClick={() => setGridSize(prev => Math.max(MIN_CANVAS_SIZE, prev - 1))} className="p-1 text-slate-400 hover:text-indigo-600 active:scale-90 transition"><Minus size={14} /></button>
                      <input type="range" min={MIN_CANVAS_SIZE} max={MAX_RESOLUTION} step="1" value={gridSize} onChange={(e) => setGridSize(parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1 appearance-none bg-slate-100 rounded-full" />
                      <button onClick={() => setGridSize(prev => Math.min(MAX_RESOLUTION, prev + 1))} className="p-1 text-slate-400 hover:text-indigo-600 active:scale-90 transition"><Plus size={14} /></button>
                    </div>
                    {gifFrames.length > 1 && (
                      <div className="w-full mt-3 px-1 py-2 rounded-2xl border border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3">
                        <button onClick={() => selectGifFrame(selectedGifFrameIndex - 1)} disabled={selectedGifFrameIndex <= 0} className="px-3 py-2 rounded-xl bg-white border border-slate-100 text-[9px] font-black text-slate-600 shadow-sm uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition">Prev</button>
                        <div className="text-center">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">GIF Frame</p>
                          <p className="text-[10px] font-black text-slate-700">{selectedGifFrameIndex + 1} / {gifFrames.length}</p>
                        </div>
                        <button onClick={() => selectGifFrame(selectedGifFrameIndex + 1)} disabled={selectedGifFrameIndex >= gifFrames.length - 1} className="px-3 py-2 rounded-xl bg-white border border-slate-100 text-[9px] font-black text-slate-600 shadow-sm uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition">Next</button>
                      </div>
                    )}
                    {sourceImage && showSampleOffsetControls && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-3 px-1">
                        <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase flex justify-between"><span>X-Axis Sampling Offset</span><span className="font-mono text-indigo-500">{sampleOffsetX.toFixed(2)}</span></label><input type="range" min="-0.5" max="0.5" step="0.001" value={sampleOffsetX} onChange={(e) => setSampleOffsetX(parseFloat(e.target.value))} className="w-full accent-indigo-600 h-1 appearance-none bg-slate-100 rounded-full" /></div>
                        <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase flex justify-between"><span>Y-Axis Sampling Offset</span><span className="font-mono text-indigo-500">{sampleOffsetY.toFixed(2)}</span></label><input type="range" min="-0.5" max="0.5" step="0.001" value={sampleOffsetY} onChange={(e) => setSampleOffsetY(parseFloat(e.target.value))} className="w-full accent-indigo-600 h-1 appearance-none bg-slate-100 rounded-full" /></div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className={`flex-1 flex ${showOriginal ? 'flex-col lg:flex-row' : 'flex-col'} overflow-hidden relative`}>
                <div ref={scrollContainerRef} className={`flex-1 relative bg-slate-50/30 custom-scrollbar ${tool === 'hand' && !useVirtualPad ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`} style={{ overflow: isCanvasLocked ? 'hidden' : 'auto', touchAction: 'none', overscrollBehavior: 'contain' }} onMouseDown={startDrawingNormal} onMouseMove={drawMoveNormal} onMouseUp={stopDrawingNormal} onMouseLeave={stopDrawingNormal} onTouchStart={startDrawingNormal} onTouchMove={drawMoveNormal} onTouchEnd={stopDrawingNormal}>
                  {!pixels ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                      <div className="p-6 bg-white rounded-[1.5rem] shadow-xl border border-slate-100 text-center">
                        <Upload size={32} className="text-indigo-200 mx-auto mb-3" /><label className="block cursor-pointer bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-black text-[9px] shadow-lg tracking-widest uppercase mb-3 hover:bg-indigo-700 transition">Select Image<input type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} /></label><button onClick={handleNewCanvas} className="w-full text-indigo-600 font-bold text-[9px] uppercase tracking-widest hover:underline">New Canvas</button>
                      </div>
                    </div>
                  ) : (
                    <div ref={canvasWrapperRef} className="p-[50%] inline-flex items-center justify-center min-w-full min-h-full"><canvas ref={editorCanvasRef} className="shadow-2xl rounded-sm bg-white" style={{ imageRendering: 'pixelated' }} /></div>
                  )}
                  {useVirtualPad && pixels && (
                    <div className="sticky inset-0 pointer-events-none z-30 h-full w-full">
                      <div className="absolute bottom-28 left-6 pointer-events-auto flex flex-col gap-3">
                        {tool === 'select' && selection && (<button onPointerDown={handleCopy} className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xl border-2 border-indigo-400 active:scale-90"><Copy size={18}/></button>)}
                        <button onPointerDown={startPlotting} onPointerUp={stopPlotting} className={`w-16 h-16 rounded-full flex items-center justify-center border-4 shadow-2xl transition-all ${isPlotting ? 'bg-indigo-600/80 border-indigo-400 text-white scale-95' : 'bg-white/40 backdrop-blur-sm border-white/50 text-indigo-600'}`}><span className="text-[10px] font-black uppercase tracking-widest">{tool === 'paste' ? 'Paste' : 'Plot'}</span></button>
                      </div>
                      <div className="absolute bottom-28 right-6 pointer-events-auto">
                        <div onPointerDown={handleTrackpadStart} onPointerMove={handleTrackpadMove} onPointerUp={handleTrackpadEnd} onPointerLeave={handleTrackpadEnd} className="w-40 h-40 bg-transparent rounded-[2rem] border-2 border-indigo-400/30 flex items-center justify-center touch-none relative shadow-inner backdrop-blur-[1px] overflow-hidden">
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-px h-full bg-indigo-400/20"></div><div className="w-full h-px bg-indigo-400/20 absolute"></div></div><Move size={24} className="text-indigo-400/20 z-10" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {pixels && !useVirtualPad && (
                  <div className="absolute top-4 right-4 z-50 flex flex-col items-end gap-2">
                    {canShowCanvasLayerJump && (
                      <button
                        onClick={handleCanvasLayerJump}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/90 backdrop-blur-md text-slate-700 border border-white/30 shadow-lg active:scale-95 transition"
                      >
                        <div className="w-4 h-4 rounded-full border border-white shadow-inner shrink-0" style={{ backgroundColor: rgbToHex(canvasLayerJumpColor) }} />
                        <span className="text-[9px] font-black uppercase tracking-widest">Go to Layer</span>
                      </button>
                    )}
                    <button onClick={() => setIsCanvasLocked(!isCanvasLocked)} className={`p-2.5 rounded-xl transition-all shadow-lg border ${isCanvasLocked ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white/50 backdrop-blur-md text-slate-700 border-white/20'}`}>{isCanvasLocked ? <Lock size={16} /> : <Unlock size={16} />}</button>
                  </div>
                )}
                {showOriginal && sourceImage && (
                  <div ref={originalImageContainerRef} className="flex-1 relative overflow-auto bg-slate-100/50 border-t border-slate-100 custom-scrollbar text-center cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }} onMouseDown={startOriginalImageDrag} onMouseMove={moveOriginalImageDrag} onMouseUp={stopOriginalImageDrag} onMouseLeave={stopOriginalImageDrag} onTouchStart={startOriginalImageDrag} onTouchMove={moveOriginalImageDrag} onTouchEnd={stopOriginalImageDrag}>
                    <div className="p-8 min-h-full min-w-full flex items-center justify-center"><img src={sourceImage} style={{ width: `${Math.max(1, 100 * pipZoom)}%`, height: 'auto', maxWidth: 'none' }} className="pointer-events-none shadow-2xl rounded-lg" alt="Reference" /></div>
                    <div className="absolute top-4 left-4 bg-slate-900/80 text-white text-[8px] px-2 py-1 font-black rounded-lg backdrop-blur-md pointer-events-none uppercase tracking-widest">Original Image</div>
                    <div className="absolute bottom-20 right-4 z-50 pointer-events-auto flex items-center gap-1 bg-white/85 backdrop-blur-md shadow-xl rounded-2xl px-1.5 py-1 border border-white">
                       <button onClick={(e) => {e.stopPropagation(); setPipZoom(z => Math.max(0.1, z - 0.1))}} className="p-2 text-slate-600 hover:text-indigo-600 active:scale-90 transition"><Minus size={14}/></button><span className="text-[9px] font-black w-8 text-center text-slate-700">{Math.round(pipZoom*100)}%</span><button onClick={(e) => {e.stopPropagation(); setPipZoom(z => Math.min(10, z + 0.1))}} className="p-2 text-slate-600 hover:text-indigo-600 active:scale-90 transition"><Plus size={14}/></button>
                    </div>
                  </div>
                )}
              </div>
              <div className="absolute bottom-4 left-4 right-4 flex flex-row items-center gap-2 z-40 overflow-x-auto no-scrollbar py-2">
                <div className="flex items-center bg-slate-900/95 backdrop-blur-md rounded-[2rem] shadow-2xl border border-white/10 overflow-hidden flex-shrink-0">
                  <div className="flex items-center">
                    {isBrushToolbarVisible && (
                      <div className="flex items-center gap-2 px-2.5 py-1.5 overflow-x-auto no-scrollbar scroll-smooth">
                        <div className="flex items-center gap-1 px-1.5 py-1 bg-white/5 rounded-full border border-white/5 shrink-0">
                          <button onClick={() => setBrushSize(s=>Math.max(1, s-1))} className="text-slate-400 p-0.5 hover:text-white active:scale-90 transition"><Minus size={12}/></button><span className="text-white text-[9px] font-black w-3 text-center">{brushSize}</span><button onClick={() => setBrushSize(s=>Math.min(20, s+1))} className="text-slate-400 p-0.5 hover:text-white active:scale-90 transition"><Plus size={12}/></button>
                        </div>
                        <div className="flex items-center gap-1 px-1.5 py-1 bg-white/5 rounded-full border border-white/5 shrink-0">
                          <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="text-slate-400 p-0.5 hover:text-white active:scale-90 transition"><Minus size={12}/></button><span className="text-white text-[9px] font-black min-w-[28px] text-center">{Math.round(zoom*100)}%</span><button onClick={() => setZoom(z => Math.min(10, z + 0.1))} className="text-slate-400 p-0.5 hover:text-white active:scale-90 transition"><Plus size={12}/></button>
                        </div>
                        <input type="color" value={`#${currentColor.map(c=>(c||0).toString(16).padStart(2,'0')).join('')}`} onChange={e => { const [r,g,b] = [1,3,5].map(i => parseInt(e.target.value.slice(i, i+2), 16)); setCurrentColor([r,g,b]); setIsTransparentMode(false); }} className="w-8 h-8 rounded-full border-2 border-white/20 p-0 shrink-0 overflow-hidden cursor-pointer active:scale-90 transition" />
                      </div>
                    )}
                    <button onClick={() => setIsBrushToolbarVisible(!isBrushToolbarVisible)} className="p-2.5 text-slate-400 hover:text-white self-stretch border-l border-white/10">{isBrushToolbarVisible ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}</button>
                  </div>
                </div>
                <div className="flex items-center bg-slate-900/95 backdrop-blur-md rounded-[2rem] shadow-2xl border border-white/10 overflow-hidden flex-shrink-0">
                  <div className="flex items-center">
                    {isToolSelectorVisible && (
                      <div ref={toolbarRef} className="flex items-center gap-2 px-2.5 py-1.5 overflow-x-auto no-scrollbar scroll-smooth">
                        <div className="flex gap-0.5 pr-2 border-r border-white/10 shrink-0">
                          <button onClick={() => setTool('hand')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='hand'?'bg-amber-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Hand size={18}/></button><button onClick={() => setTool('pen')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='pen'&&!isTransparentMode?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Edit3 size={18}/></button><button onClick={() => setTool('select')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='select'?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Square size={18}/></button><button onClick={() => setTool('paste')} disabled={!clipboard} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='paste'?'bg-emerald-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300 disabled:opacity-10'}`}><ClipboardPaste size={18}/></button><button onClick={() => setTool('bucket')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='bucket'?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><PaintBucket size={18}/></button><button onClick={() => setTool('islandFill')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='islandFill'?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Paintbrush size={18}/></button><button onClick={() => setTool('autoOutline')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='autoOutline'?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><ScanLine size={18}/></button><button onClick={() => setTool('dropper')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='dropper'?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Pipette size={18}/></button><button onClick={() => setIsTransparentMode(!isTransparentMode)} className={`p-2.5 rounded-full transition-all shrink-0 ${isTransparentMode?'bg-white text-black':'text-slate-500 hover:text-slate-300'}`}><Circle size={16} strokeDasharray="3 3"/></button>
                        </div>
                      </div>
                    )}
                    <button onClick={() => setIsToolSelectorVisible(!isToolSelectorVisible)} className="p-2.5 text-slate-400 hover:text-white self-stretch border-l border-white/10">{isToolSelectorVisible ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'layers' && (
            <div className="h-full flex flex-col px-6 py-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-base font-black tracking-tight uppercase flex items-center gap-2"><Layers className="text-indigo-600" size={18}/> Stack Order</h2>
                <select value={layerSortMode} onChange={(e) => applyLayerSort(e.target.value)} className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 outline-none focus:border-indigo-400 transition">
                  {LAYER_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="flex-1 overflow-auto space-y-2 pr-2 custom-scrollbar">
                {(() => {
                  const chs = []; let ch = 0; layerOrder.forEach((cs) => { 
                    const adj = layerHeightAdjustments[cs] || { plus: 0, minus: 0 };
                    const zPlus = typeof adj === 'number' ? adj : (adj.plus || 0);
                    ch += (layerThickness + zPlus); 
                    chs.push(ch); 
                  });
                  return layerOrder.length === 0 ? <p className="text-center text-[10px] text-slate-300 mt-10 font-black tracking-widest uppercase">No Data</p> : 
                    layerOrder.map((cs, i) => {
                      const col = JSON.parse(cs); 
                      const currentLayerHex = rgbToHex(col);
                      const pendingLayerHex = pendingLayerColors[cs] || currentLayerHex;
                      const hasPendingLayerColor = pendingLayerHex !== currentLayerHex;
                      const sm = layerSmoothingSettings[cs] || { smoothOuter: false, smoothInner: false, tolerance: 0.1, offset: 0 };
                      const adj = layerHeightAdjustments[cs] || { plus: 0, minus: 0 };
                      const zPlus = typeof adj === 'number' ? adj : (adj.plus || 0);
                      const zMinus = typeof adj === 'number' ? 0 : (adj.minus || 0);
                      
                      return (
                        <div
                          key={cs}
                          ref={(node) => {
                            if (node) layerRowRefs.current[cs] = node;
                            else delete layerRowRefs.current[cs];
                          }}
                          className={`flex flex-col gap-2 p-3 border rounded-xl transition-all ${
                            jumpHighlightedLayer === cs
                              ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200 shadow-md'
                              : 'bg-slate-50 border-slate-100 hover:bg-white hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-0.5 shrink-0"><button onClick={() => moveLayer(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 active:scale-90 transition bg-white rounded-md border border-slate-100 shadow-sm"><ChevronUp size={12} /></button><button onClick={() => moveLayer(i, 1)} disabled={i === layerOrder.length - 1} className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 active:scale-90 transition bg-white rounded-md border border-slate-100 shadow-sm"><ChevronDown size={12} /></button></div>
                            <input
                              type="color"
                              value={pendingLayerHex}
                              onChange={(e) => updatePendingLayerColor(cs, e.target.value)}
                              aria-label={`Edit layer ${i + 1} color`}
                              className="w-8 h-8 rounded-lg shadow-inner border border-white shrink-0 cursor-pointer overflow-hidden bg-transparent active:scale-95 transition"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest truncate">Layer {i+1}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-[10px] font-bold text-slate-700">{pendingLayerHex}</p>
                                {hasPendingLayerColor && (
                                  <div className="flex items-center gap-1">
                                    <button onClick={() => applyPendingLayerColor(cs)} className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[8px] font-black uppercase tracking-widest active:scale-95 transition">Apply</button>
                                    <button onClick={() => cancelPendingLayerColor(cs)} className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-500 text-[8px] font-black uppercase tracking-widest active:scale-95 transition">Cancel</button>
                                  </div>
                                )}
                              </div>
                              <p className="text-[10px] font-bold text-slate-700">Top: <span className="text-indigo-600">{(baseThickness + chs[i]).toFixed(1)}mm</span></p>
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                                <div className="flex items-center gap-1 justify-end">
                                    <span className="text-[7px] font-black text-slate-400 uppercase w-4">Z+</span>
                                    <button onClick={(e) => { e.stopPropagation(); handleLayerHeightChange(cs, 'plus', -0.1); }} className="p-1 bg-white/80 rounded-md border border-slate-200 shadow-sm active:scale-90 transition"><Minus size={10} /></button>
                                    <span className="text-[10px] font-mono font-bold text-slate-600 w-8 text-center">{(layerThickness + zPlus).toFixed(1)}</span>
                                    <button onClick={(e) => { e.stopPropagation(); handleLayerHeightChange(cs, 'plus', 0.1); }} className="p-1 bg-white/80 rounded-md border border-slate-200 shadow-sm active:scale-90 transition"><Plus size={10} /></button>
                                </div>
                                <div className="flex items-center gap-1 justify-end">
                                    <span className="text-[7px] font-black text-slate-400 uppercase w-4">Z-</span>
                                    <button onClick={(e) => { e.stopPropagation(); handleLayerHeightChange(cs, 'minus', -0.1); }} className="p-1 bg-white/80 rounded-md border border-slate-200 shadow-sm active:scale-90 transition"><Minus size={10} /></button>
                                    <span className="text-[10px] font-mono font-bold text-slate-600 w-8 text-center">{zMinus.toFixed(1)}</span>
                                    <button onClick={(e) => { e.stopPropagation(); handleLayerHeightChange(cs, 'minus', 0.1); }} className="p-1 bg-white/80 rounded-md border border-slate-200 shadow-sm active:scale-90 transition"><Plus size={10} /></button>
                                </div>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-x-3 gap-y-1.5">
                            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={sm.smoothOuter} onChange={(e) => handleSmoothingChange(cs, 'smoothOuter', e.target.checked)} className="w-3 h-3 accent-indigo-600" /><span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Outer</span></label>
                            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={sm.smoothInner} onChange={(e) => handleSmoothingChange(cs, 'smoothInner', e.target.checked)} className="w-3 h-3 accent-indigo-600" /><span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Inner</span></label>
                            <div className="flex flex-col gap-0.5">
                                <div className="flex justify-between items-center text-[7px] font-black text-slate-400 uppercase"><span>Tolerance</span><span>{sm.tolerance.toFixed(1)}</span></div>
                                <input type="range" min="0.1" max="2.0" step="0.1" value={sm.tolerance} onChange={(e) => handleSmoothingChange(cs, 'tolerance', parseFloat(e.target.value))} className="w-full h-1 appearance-none bg-slate-200 rounded-full accent-indigo-600" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <div className="flex justify-between items-center text-[7px] font-black text-slate-400 uppercase"><span>Offset</span><span>{(sm.offset || 0).toFixed(1)}</span></div>
                                <input type="range" min="-5.0" max="5.0" step="0.1" value={sm.offset || 0} onChange={(e) => handleSmoothingChange(cs, 'offset', parseFloat(e.target.value))} className="w-full h-1 appearance-none bg-slate-200 rounded-full accent-indigo-600" />
                            </div>
                          </div>
                        </div>
                      );
                    })
                })()}
              </div>
            </div>
          )}
          {activeTab === '3d' && (
            <div className="h-full flex flex-col">
              <div className="px-6 py-3 border-b border-slate-50 flex justify-between items-center gap-3 shrink-0">
                <h2 className="text-base font-black tracking-tight uppercase flex items-center gap-2 shrink-0"><BoxIcon className="text-indigo-600" size={18}/> 3D Preview</h2>
                <div className="flex items-center gap-2 shrink-0">
                  {is3DLayerMoveMode ? (
                    <>
                      <button onClick={cancel3DLayerMoveMode} className="flex items-center gap-1 bg-white text-slate-600 px-3 py-2 rounded-xl text-[9px] font-black shadow-sm border border-slate-200 hover:border-slate-300 transition active:scale-95">Cancel</button>
                      <button onClick={confirm3DLayerMoveMode} className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-2 rounded-xl text-[9px] font-black shadow-lg hover:bg-indigo-700 transition active:scale-95">Confirm</button>
                    </>
                  ) : (
                    <button onClick={enter3DLayerMoveMode} className="flex items-center gap-1 bg-white text-slate-600 px-3 py-2 rounded-xl text-[9px] font-black shadow-sm border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition active:scale-95">Move Layers</button>
                  )}
                  <button onClick={exportSTL} className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg hover:bg-emerald-600 transition active:scale-95"><Download size={14} /> Export STL</button>
                </div>
              </div>
              <div className="flex-1 relative bg-slate-50/50">
                <div ref={threeRef} className="absolute inset-0" />
                {is3DLayerMoveMode && (
                  <>
                    <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-md shadow-lg rounded-2xl px-3 py-2 border border-white">
                      <div className={`w-4 h-4 rounded-md border border-slate-200 shrink-0 ${selected3DLayerColor ? '' : 'bg-slate-100'}`} style={selected3DLayerColor ? { backgroundColor: `rgb(${selected3DLayerColor[0]},${selected3DLayerColor[1]},${selected3DLayerColor[2]})` } : undefined} />
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                        {selected3DLayerIndex >= 0 ? `Selected Layer ${selected3DLayerIndex + 1}` : 'Tap a layer'}
                      </p>
                    </div>
                    <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
                      <button onClick={() => moveDraft3DLayer(-1)} disabled={selected3DLayerIndex <= 0} className="flex items-center justify-center gap-1 bg-white/95 text-slate-600 px-4 py-3 rounded-2xl text-[9px] font-black shadow-lg border border-white disabled:opacity-30 disabled:cursor-not-allowed hover:text-indigo-600 transition active:scale-95"><ChevronUp size={16} /> Move Up</button>
                      <button onClick={() => moveDraft3DLayer(1)} disabled={selected3DLayerIndex < 0 || selected3DLayerIndex === draft3DLayerOrder.length - 1} className="flex items-center justify-center gap-1 bg-white/95 text-slate-600 px-4 py-3 rounded-2xl text-[9px] font-black shadow-lg border border-white disabled:opacity-30 disabled:cursor-not-allowed hover:text-indigo-600 transition active:scale-95"><ChevronDown size={16} /> Move Down</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="h-full px-6 py-4 overflow-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-6"><h2 className="text-base font-black tracking-tight uppercase flex items-center gap-2"><Settings className="text-indigo-600" size={18}/> Setup</h2><div className="flex gap-2"><button onClick={saveProject} className="p-2.5 bg-white border border-slate-100 text-indigo-600 rounded-xl shadow-sm hover:bg-indigo-50 transition"><FileJson size={18} /></button><label className="p-2.5 bg-white border border-slate-100 text-indigo-600 rounded-xl shadow-sm cursor-pointer hover:bg-indigo-50 transition"><FolderOpen size={18} /><input type="file" accept=".json" className="hidden" onChange={loadProject} /></label><button onClick={exportImage} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg uppercase">Export Image</button></div></div>
              <div className="space-y-6">
                <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 space-y-4 shadow-inner">
                  <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-100 pb-2">Project Metadata</p>
                  <div className="space-y-3">
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-2 px-1"><FileText size={10}/> Project Name</label><input type="text" value={projectName} onChange={e => handleProjectNameChange(e.target.value)} className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-indigo-400 transition" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-2 px-1"><Download size={10}/> Export Filename</label><input type="text" value={outputFileName} onChange={e => setOutputFileName(e.target.value)} className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-indigo-400 transition" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-2 px-1"><User size={10}/> Author</label><input type="text" value={author} onChange={e => setAuthor(e.target.value)} className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-indigo-400 transition" placeholder="Your Name" /></div>
                    <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100"><div><label className="text-[8px] font-black text-slate-400 uppercase px-1">Created At</label><div className="text-[9px] font-bold text-slate-500 truncate">{createdAt || "---"}</div></div><div><label className="text-[8px] font-black text-slate-400 uppercase px-1">Source File</label><div className="text-[9px] font-bold text-slate-500 truncate">{originalFilePath || "None"}</div></div></div>
                  </div>
                </div>
                <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 space-y-6 shadow-inner">
                  <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-100 pb-2">Physical Specifications</p>
                  <div className="space-y-4">
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-slate-500 flex justify-between px-1 uppercase">Dot XY Size <span>{dotSize.toFixed(1)}mm</span></label><input type="range" min="0.2" max="5.0" step="0.1" value={dotSize} onChange={e => setDotSize(parseFloat(e.target.value))} className="w-full accent-indigo-600 h-1 appearance-none bg-slate-200 rounded-full" /></div>
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-slate-500 flex justify-between px-1 uppercase">Layer Z Thick <span>{layerThickness.toFixed(1)}mm</span></label><input type="range" min="0.2" max="5.0" step="0.1" value={layerThickness} onChange={e => setLayerThickness(parseFloat(e.target.value))} className="w-full accent-indigo-600 h-1 appearance-none bg-slate-200 rounded-full" /></div>
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-slate-500 flex justify-between px-1 uppercase">Base Plate <span>{baseThickness.toFixed(1)}mm</span></label><input type="range" min="0.0" max="5.0" step="0.1" value={baseThickness} onChange={e => setBaseThickness(parseFloat(e.target.value))} className="w-full accent-indigo-600 h-1 appearance-none bg-slate-200 rounded-full" /></div>
                    <div className="space-y-1.5 pt-3 border-t border-slate-100"><label className="text-[9px] font-black text-indigo-500 flex justify-between px-1 uppercase">Pad Sensitivity <span>{padSensitivity}</span></label><input type="range" min="1" max="20" step="1" value={padSensitivity} onChange={e => setPadSensitivity(parseInt(e.target.value))} className="w-full accent-indigo-600 h-1 appearance-none bg-slate-200 rounded-full" /></div>
                  </div>
                </div>
                <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 space-y-4 shadow-inner">
                  <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-100 pb-2">Similar Color Merge</p>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Current Unique Colors</p>
                      <p className="text-lg font-black text-slate-800">{uniqueColorCount}</p>
                    </div>
                    <button onClick={mergeSimilarColors} disabled={!pixels || uniqueColorCount < 2} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg uppercase disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition">Merge Similar Colors</button>
                  </div>
                  <p className="text-[9px] text-slate-500 leading-relaxed">Uses a weak OKLab distance threshold to merge only visually similar non-transparent colors into a single representative layer color.</p>
                  <div className="pt-3 border-t border-slate-100 space-y-2">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Target Color Count</label>
                    <div className="flex items-center gap-2">
                      <input type="number" min="1" max={Math.max(1, uniqueColorCount)} value={targetColorCount} onChange={(e) => setTargetColorCount(e.target.value)} className="w-20 text-xs p-2 rounded-xl border border-slate-200 bg-white outline-none focus:border-indigo-400 transition" />
                      <button onClick={reduceColorsToTarget} disabled={!pixels || uniqueColorCount < 2} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg uppercase disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition">Reduce to Target</button>
                    </div>
                    <p className="text-[9px] text-slate-500 leading-relaxed">Greedily merges the closest visible color groups until the canvas reaches the target count.</p>
                  </div>
                  {statusMessage && <p className="text-[9px] font-bold text-indigo-600 bg-white border border-indigo-100 rounded-xl px-3 py-2">{statusMessage}</p>}
                </div>
                <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 space-y-4 shadow-inner">
                  <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-100 pb-2">Color Mixing Advisor</p>
                  <p className="text-[9px] text-slate-500 leading-relaxed">Approximate advisor for Bambu-style color mixing. Uses ideal Hex/RGB base colors, linear RGB mixing, and OKLab error scoring to estimate how well the current model colors can be reproduced.</p>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="bg-white rounded-[1.25rem] border border-slate-100 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Suggest 4 Base Colors</p>
                          <p className="text-[9px] text-slate-500">Generate ideal color slots from the current visible model colors.</p>
                        </div>
                        <button onClick={suggestColorMixAdvisor} disabled={!pixels || uniqueColorCount === 0} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg uppercase disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition">Suggest 4 Base Colors</button>
                      </div>
                      {suggestedMixBaseColors.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {suggestedMixBaseColors.map((rgb, index) => (
                            <div key={`suggested-mix-${index}`} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2.5 py-2">
                              <div className="w-8 h-8 rounded-lg border border-white shadow-inner shrink-0" style={{ backgroundColor: rgbToHex(rgb) }} />
                              <div className="min-w-0">
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Base {index + 1}</p>
                                <p className="text-[9px] font-bold text-slate-700 truncate">{rgbToHex(rgb)}</p>
                                <p className="text-[8px] text-slate-500 truncate">{formatRgbLabel(rgb)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="bg-white rounded-[1.25rem] border border-slate-100 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Evaluate Custom 4 Colors</p>
                          <p className="text-[9px] text-slate-500">Enter four Hex colors to see how the current layer colors could be mixed from them. Empty fields fall back to the current model suggestion.</p>
                        </div>
                        <button onClick={evaluateCustomMixBaseColors} disabled={!pixels || uniqueColorCount === 0} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg uppercase disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition">Evaluate Custom 4 Colors</button>
                      </div>
                      <div className="grid gap-2">
                        {customMixBaseHexes.map((hex, index) => {
                          const resolvedHex = resolvedCustomMixBaseHexes[index];
                          const normalizedHex = normalizeHexColor(resolvedHex);
                          const parsedRgb = hexToRgb(resolvedHex);
                          return (
                            <div key={`custom-mix-${index}`} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2.5 py-2">
                              <input type="color" value={normalizedHex || '#000000'} onChange={(e) => updateCustomMixBaseHex(index, e.target.value.toUpperCase())} className="w-9 h-9 rounded-lg border border-white p-0 shrink-0 cursor-pointer" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Base {index + 1}</p>
                                <input type="text" value={hex} onChange={(e) => updateCustomMixBaseHex(index, e.target.value)} className="w-full text-[10px] font-bold text-slate-700 bg-transparent outline-none uppercase" placeholder={fallbackMixBaseHexes[index] || '#RRGGBB'} />
                              </div>
                              <p className="text-[8px] text-slate-500 min-w-[88px] text-right">{parsedRgb ? formatRgbLabel(parsedRgb) : 'Invalid Hex'}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {colorMixAdvisorResult && (
                    <div className="space-y-3 pt-2 border-t border-slate-100">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Current Evaluation</p>
                          <p className="text-sm font-black text-slate-800">{colorMixAdvisorResult.modeLabel}</p>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <button onClick={applyColorMixAdvisorResult} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg uppercase hover:bg-indigo-700 transition">Apply Evaluated Colors</button>
                          {colorMixAdvisorResult.baseColors.map((rgb, index) => (
                            <div key={`result-base-${index}`} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-2">
                              <div className="w-6 h-6 rounded-lg border border-white shadow-inner shrink-0" style={{ backgroundColor: rgbToHex(rgb) }} />
                              <div>
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Base {index + 1}</p>
                                <p className="text-[9px] font-bold text-slate-700">{rgbToHex(rgb)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border border-slate-100 bg-white px-3 py-2"><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Visible Layers</p><p className="text-sm font-black text-slate-800">{colorMixAdvisorResult.summary.layerCount}</p></div>
                        <div className="rounded-xl border border-slate-100 bg-white px-3 py-2"><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Max Error</p><p className="text-sm font-black text-slate-800">{colorMixAdvisorResult.summary.maxError.toFixed(3)}</p></div>
                        <div className="rounded-xl border border-slate-100 bg-white px-3 py-2"><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Avg Error</p><p className="text-sm font-black text-slate-800">{colorMixAdvisorResult.summary.averageError.toFixed(3)}</p></div>
                        <div className="rounded-xl border border-slate-100 bg-white px-3 py-2"><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Within {COLOR_MIX_GOOD_MATCH_THRESHOLD.toFixed(2)}</p><p className="text-sm font-black text-slate-800">{colorMixAdvisorResult.summary.withinThresholdCount} / {colorMixAdvisorResult.summary.layerCount}</p></div>
                      </div>
                      <div className="space-y-2">
                        {colorMixAdvisorResult.layers.map((layer) => (
                          <div key={`mix-layer-${layer.key}`} className="rounded-[1.25rem] border border-slate-100 bg-white px-4 py-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="flex items-center gap-2 min-w-[132px]">
                                <div className="w-8 h-8 rounded-lg border border-white shadow-inner shrink-0" style={{ backgroundColor: rgbToHex(layer.targetRgb) }} />
                                <div>
                                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Layer {layer.layerNumber}</p>
                                  <p className="text-[9px] font-bold text-slate-700">{rgbToHex(layer.targetRgb)}</p>
                                </div>
                              </div>
                              <div className="flex-1 min-w-[160px]">
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Best Recipe</p>
                                <p className="text-[9px] font-bold text-slate-700">{layer.recipeLabel}</p>
                              </div>
                              <div className="flex items-center gap-2 min-w-[132px]">
                                <div className="w-8 h-8 rounded-lg border border-white shadow-inner shrink-0" style={{ backgroundColor: rgbToHex(layer.mixedRgb) }} />
                                <div>
                                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Predicted Color</p>
                                  <p className="text-[9px] font-bold text-slate-700">{rgbToHex(layer.mixedRgb)}</p>
                                </div>
                              </div>
                              <div className="min-w-[88px] text-right">
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Error</p>
                                <p className="text-[10px] font-black text-indigo-600">{layer.error.toFixed(3)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div><button onClick={() => setShowConfirmModal(true)} className="w-full mt-6 py-3 bg-rose-50 text-rose-500 rounded-[1.5rem] font-black text-[10px] border border-rose-100 uppercase tracking-widest transition hover:bg-rose-100 shadow-sm mb-4">Clear Canvas</button>
            </div>
          )}
        </div>
      </main>
      <nav className="flex justify-center items-center bg-white/90 backdrop-blur-lg border-t border-slate-100 px-2 py-1 shadow-[0_-4px_20px_rgba(0,0,0,0.02)] z-30 shrink-0">
        <div className="flex gap-1">
          {[ { id: 'editor', icon: Edit3, label: 'Editor' }, { id: 'layers', icon: Layers, label: 'Layers' }, { id: '3d', icon: BoxIcon, label: '3D View' }, { id: 'settings', icon: Settings, label: 'Setup' } ].map(item => (<NavItem key={item.id} id={item.id} icon={item.icon} label={item.label} isActive={activeTab === item.id} onClick={handleTabChange} />))}
        </div>
      </nav>
      <style dangerouslySetInnerHTML={{ __html: `
        .no-scrollbar::-webkit-scrollbar { display: none; } .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 3px; height: 3px; } .custom-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        input[type=range] { -webkit-appearance: none; } input[type=range]:focus { outline: none; }
        input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 3px; cursor: pointer; background: #f1f5f9; border-radius: 999px; }
        input[type=range]::-webkit-slider-thumb { height: 14px; width: 14px; border-radius: 50%; background: #4f46e5; -webkit-appearance: none; margin-top: -5.5px; border: 2.5px solid #ffffff; box-shadow: 0 3px 5px rgba(79,70,229,0.2); }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } } @keyframes zoomIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-in { animation: fadeIn 0.3s ease-out; } .zoom-in { animation: zoomIn 0.3s ease-out; }
      `}} />
    </div>
  );
};
export default App;
