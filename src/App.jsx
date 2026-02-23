import React, { useState, useRef, useEffect, useCallback } from 'react';
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
const MIN_RESOLUTION = 8;
const MAX_RESOLUTION = 500;
const apiKey = ""; 

const TRANSPARENT_COLOR = [255, 0, 255];
const TRANSPARENT_KEY = JSON.stringify(TRANSPARENT_COLOR);

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
  const [showConfirmModal, setShowConfirmModal] = useState(false); const [isExporting, setIsExporting] = useState(false); 
  const [statusMessage, setStatusMessage] = useState(""); const [showSampleOffsetControls, setShowSampleOffsetControls] = useState(false);
  const [sampleOffsetX, setSampleOffsetX] = useState(0); const [sampleOffsetY, setSampleOffsetY] = useState(0);
  const [isResolutionToolbarVisible, setIsResolutionToolbarVisible] = useState(true);
  const [isBrushToolbarVisible, setIsBrushToolbarVisible] = useState(true); const [isToolSelectorVisible, setIsToolSelectorVisible] = useState(true);
  
  const handleLayerHeightChange = (colorStr, delta) => setLayerHeightAdjustments(prev => ({ ...prev, [colorStr]: ((prev[colorStr] || 0) + delta) }));
  const handleSmoothingChange = (colorStr, key, value) => setLayerSmoothingSettings(prev => ({ ...prev, [colorStr]: { ...(prev[colorStr] || { smoothOuter: false, smoothInner: false, tolerance: 0.1 }), [key]: value } }));

  const editorCanvasRef = useRef(null); const scrollContainerRef = useRef(null); const canvasWrapperRef = useRef(null);
  const threeRef = useRef(null); const sceneRef = useRef(null); const isDrawingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 }); const lastTouchDistRef = useRef(null);
  const lastTrackpadPosRef = useRef({ x: 0, y: 0 }); const cursorSubPixelRef = useRef({ x: 0, y: 0 });
  const isLoadingRef = useRef(false); const pixelsRef = useRef(null); const toolbarRef = useRef(null);
  
  useEffect(() => { pixelsRef.current = pixels; }, [pixels]);
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
    if (isCanvasLocked) document.body.addEventListener('touchmove', prev, { passive: false });
    else document.body.removeEventListener('touchmove', prev);
    return () => document.body.removeEventListener('touchmove', prev);
  }, [isCanvasLocked]);

  const syncLayersFromPixels = useCallback((curr) => {
    if (!curr) { setLayerOrder([]); return; }
    const set = new Set();
    curr.forEach(r => r.forEach(p => { if (Array.isArray(p)) { const k = JSON.stringify(p); if (k !== TRANSPARENT_KEY) set.add(k); } }));
    setLayerOrder(prev => {
      const ex = prev.filter(c => set.has(c)); const nw = Array.from(set).filter(c => !prev.includes(c));
      return [...ex, ...nw];
    });
  }, []);

  const pushToHistory = useCallback((p) => {
    if (!p) return; const s = JSON.stringify(p);
    setHistory(prev => {
        const n = prev.stack.slice(0, prev.step + 1); n.push(s); if (n.length > MAX_UNDO) n.shift();
        return { stack: n, step: n.length - 1 };
    });
  }, []);

  const undo = useCallback(() => setHistory(prev => {
    if (prev.step > 0) { const p = JSON.parse(prev.stack[prev.step - 1]); setPixels(p); syncLayersFromPixels(p); return { ...prev, step: prev.step - 1 }; }
    return prev;
  }), [syncLayersFromPixels]);

  const redo = useCallback(() => setHistory(prev => {
    if (prev.step < prev.stack.length - 1) { const n = JSON.parse(prev.stack[prev.step + 1]); setPixels(n); syncLayersFromPixels(n); return { ...prev, step: prev.step + 1 }; }
    return prev;
  }), [syncLayersFromPixels]);

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
      if (tool === 'dropper') { if (isFirst) { setCurrentColor(prev[y][x]); setTool('pen'); } return prev; }
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
    if (!f) return; const r = new FileReader();
    r.onload = (e) => {
      const fn = f.name.split('.').slice(0, -1).join('.');
      setProjectName(fn); setOutputFileName(fn); setSourceImage(e.target.result); setOriginalFilePath(f.name); 
      setCreatedAt(getFormattedDate("display")); setHistory({ stack: [], step: -1 });
      reprocessImage(e.target.result, gridSize, sampleOffsetX, sampleOffsetY);
    };
    r.readAsDataURL(f);
  }, [gridSize, sampleOffsetX, sampleOffsetY, reprocessImage]);

  const handleNewCanvas = useCallback(() => {
    const s = gridSize; const n = Array.from({ length: s }, () => Array.from({ length: s }, () => [...TRANSPARENT_COLOR]));
    const def = getFormattedDate("compact"); setProjectName(def); setOutputFileName(def);
    setSourceImage(null); setShowOriginal(false); setOriginalFilePath(""); setCreatedAt(getFormattedDate("display")); setHistory({ stack: [], step: -1 });
    setPixels(n); pushToHistory(n); syncLayersFromPixels(n); setTool('pen'); setShowConfirmModal(false);
    const ip = { x: Math.floor(s / 2), y: Math.floor(s / 2) }; setCursorPos(ip); cursorSubPixelRef.current = { ...ip };
  }, [gridSize, pushToHistory, syncLayersFromPixels]);

  const saveProject = useCallback(() => {
    if (!pixels) return;
    const pd = { version: "1.4", projectName, outputFileName, author, createdAt, originalFilePath, gridSize, dotSize, layerThickness, baseThickness, padSensitivity, layerOrder, pixels, sourceImage };
    const b = new Blob([JSON.stringify(pd)], { type: 'application/json' }); const u = URL.createObjectURL(b);
    const l = document.createElement('a'); l.href = u; l.download = `${projectName || 'project'}.json`;
    l.click(); setStatusMessage("プロジェクトを保存しました！💾");
  }, [pixels, projectName, outputFileName, author, createdAt, originalFilePath, gridSize, dotSize, layerThickness, baseThickness, padSensitivity, layerOrder, sourceImage]);

  const loadProject = useCallback((e) => {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.pixels) {
          isLoadingRef.current = true; setProjectName(d.projectName || ""); setOutputFileName(d.outputFileName || "");
          setAuthor(d.author || ""); setCreatedAt(d.createdAt || ""); setOriginalFilePath(d.originalFilePath || "");
          setGridSize(d.gridSize); setDotSize(d.dotSize); setLayerThickness(d.layerThickness); setBaseThickness(d.baseThickness);
          setPadSensitivity(d.padSensitivity); setLayerOrder(d.layerOrder || []); setSourceImage(d.sourceImage || null); setPixels(d.pixels);
          setHistory({ stack: [JSON.stringify(d.pixels)], step: 0 }); setStatusMessage("プロジェクトを復元しました！📂");
          setTimeout(() => { isLoadingRef.current = false; centerCanvas(); }, 100);
        }
      } catch (err) { setStatusMessage("読み込みエラー。"); }
    };
    r.readAsText(f); e.target.value = '';
  }, [centerCanvas]);

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

  const startDrawingNormal = (e) => {
    if (useVirtualPad || !editorCanvasRef.current) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX; const cy = e.touches ? e.touches[0].clientY : e.clientY;
    if (e.touches && e.touches.length === 2) { lastTouchDistRef.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); return; }
    if (tool === 'hand') { isDrawingRef.current = true; const c = scrollContainerRef.current; dragStartRef.current = { x: cx, y: cy, scrollLeft: c.scrollLeft, scrollTop: c.scrollTop }; return; }
    const r = editorCanvasRef.current.getBoundingClientRect(); const x = Math.floor((cx - r.left) / (10 * zoom)); const y = Math.floor((cy - r.top) / (10 * zoom));
    if (x >= 0 && y >= 0 && x < (pixelsRef.current?.[0]?.length || 0) && y < (pixelsRef.current?.length || 0)) { isDrawingRef.current = true; handleToolAction(x, y, true); }
  };

  const drawMoveNormal = (e) => {
    if (useVirtualPad || !editorCanvasRef.current) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX; const cy = e.touches ? e.touches[0].clientY : e.clientY;
    if (e.touches && e.touches.length === 2 && lastTouchDistRef.current) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setZoom(prev => Math.min(10, Math.max(0.05, prev * (d / lastTouchDistRef.current)))); lastTouchDistRef.current = d; return;
    }
    if (!isDrawingRef.current) return;
    if (tool === 'hand') { const c = scrollContainerRef.current; c.scrollLeft = dragStartRef.current.scrollLeft - (cx - dragStartRef.current.x); c.scrollTop = dragStartRef.current.scrollTop - (cy - dragStartRef.current.y); return; }
    const r = editorCanvasRef.current.getBoundingClientRect(); const x = Math.floor((cx - r.left) / (10 * zoom)); const y = Math.floor((cy - r.top) / (10 * zoom));
    if (x >= 0 && y >= 0 && x < (pixelsRef.current?.[0]?.length || 0) && y < (pixelsRef.current?.length || 0)) handleToolAction(x, y, false);
  };

  const stopDrawingNormal = () => { if (isDrawingRef.current && pixelsRef.current && tool !== 'hand' && tool !== 'select') { pushToHistory(pixelsRef.current); syncLayersFromPixels(pixelsRef.current); } isDrawingRef.current = false; lastTouchDistRef.current = null; };
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

  const moveLayer = (idx, dir) => {
    const ni = idx + dir; if (ni < 0 || ni >= layerOrder.length) return;
    const no = [...layerOrder]; const t = no[idx]; no[idx] = no[ni]; no[ni] = t; setLayerOrder(no);
  };

  useEffect(() => {
    if (isLoadingRef.current) return;
    if (sourceImage) reprocessImage(sourceImage, gridSize, sampleOffsetX, sampleOffsetY);
    else if (pixels) {
      const oh = pixels.length; const ow = pixels[0]?.length || 0; const ngs = parseInt(gridSize, 10);
      if (oh === ngs && ow === ngs) return;
      const n = Array.from({ length: ngs }, (_, y) => Array.from({ length: ngs }, (_, x) => (y < oh && x < ow) ? pixels[y][x] : [...TRANSPARENT_COLOR]));
      setPixels(n);
    }
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
      const container = threeRef.current; while (container.firstChild) container.removeChild(container.firstChild);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf8fafc);
      const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
      const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement); const controls = new OrbitControls(camera, renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6)); const light = new THREE.DirectionalLight(0xffffff, 0.8); light.position.set(200, 400, 200); scene.add(light);
      const group = new THREE.Group(); const h = pixels.length; const w = pixels[0].length;
      if (baseThickness > 0) {
        const baseGeo = new THREE.BoxGeometry(w * dotSize, h * dotSize, baseThickness);
        const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshLambertMaterial({ color: 0xdddddd }));
        baseMesh.position.set(0, 0, baseThickness / 2); group.add(baseMesh);
      }
      let cz = baseThickness;
      layerOrder.forEach((cs, li) => {
        const col = JSON.parse(cs); const sm = layerSmoothingSettings[cs] || { smoothOuter: false, smoothInner: false, tolerance: 0.1 };
        const thick = layerThickness + (layerHeightAdjustments[cs] || 0); if (thick <= 0) return;
        const targetKeys = new Set(layerOrder.slice(li)); let contours = getUnionContours(pixels, targetKeys);
        const paths = contours.map(c => {
          const area = calculateArea(c); const isHole = area < 0; // グリッド空間
          const enabled = isHole ? sm.smoothInner : sm.smoothOuter;
          const processed = enabled ? smoothPath(c, sm.tolerance, dotSize) : c;
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
          const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${col[0]},${col[1]},${col[2]})`), side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(geom, mat); mesh.position.z = cz; group.add(mesh);
        });
        cz += thick;
      });
      scene.add(group); sceneRef.current = group; const box = new THREE.Box3().setFromObject(group); const center = box.getCenter(new THREE.Vector3());
      camera.position.set(center.x, center.y - 100, center.z + 100); controls.target.copy(center); controls.update();
      const animate = () => { if (threeRef.current) { requestAnimationFrame(animate); renderer.render(scene, camera); } }; animate();
    }
  }, [activeTab, pixels, dotSize, layerThickness, baseThickness, layerOrder, layerHeightAdjustments, layerSmoothingSettings]);

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
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resolution</span><span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-black min-w-[30px] text-center shadow-sm">{gridSize}</span></div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setUseVirtualPad(!useVirtualPad)} className={`p-1.5 rounded-lg transition shadow-sm border ${useVirtualPad ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-100 text-slate-400'}`}><Gamepad size={14}/></button>
                    <button onClick={() => setShowConfirmModal(true)} className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 shadow-sm active:scale-90 transition"><FilePlus size={14}/></button>
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
                      <button onClick={() => setGridSize(prev => Math.max(MIN_RESOLUTION, prev - 1))} className="p-1 text-slate-400 hover:text-indigo-600 active:scale-90 transition"><Minus size={14} /></button>
                      <input type="range" min={MIN_RESOLUTION} max={MAX_RESOLUTION} step="1" value={gridSize} onChange={(e) => setGridSize(parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1 appearance-none bg-slate-100 rounded-full" />
                      <button onClick={() => setGridSize(prev => Math.min(MAX_RESOLUTION, prev + 1))} className="p-1 text-slate-400 hover:text-indigo-600 active:scale-90 transition"><Plus size={14} /></button>
                    </div>
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
                <div ref={scrollContainerRef} className={`flex-1 relative bg-slate-50/30 custom-scrollbar ${tool === 'hand' && !useVirtualPad ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`} style={{ overflow: isCanvasLocked ? 'hidden' : 'auto' }} onMouseDown={startDrawingNormal} onMouseMove={drawMoveNormal} onMouseUp={stopDrawingNormal} onMouseLeave={stopDrawingNormal} onTouchStart={startDrawingNormal} onTouchMove={drawMoveNormal} onTouchEnd={stopDrawingNormal}>
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
                {pixels && !useVirtualPad && (<button onClick={() => setIsCanvasLocked(!isCanvasLocked)} className={`absolute top-4 right-4 z-50 p-2.5 rounded-xl transition-all shadow-lg border ${isCanvasLocked ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white/50 backdrop-blur-md text-slate-700 border-white/20'}`}>{isCanvasLocked ? <Lock size={16} /> : <Unlock size={16} />}</button>)}
                {showOriginal && sourceImage && (
                  <div className="flex-1 relative overflow-auto bg-slate-100/50 border-t border-slate-100 custom-scrollbar text-center">
                    <div className="p-8 min-h-full min-w-full flex items-center justify-center"><img src={sourceImage} style={{ width: `${Math.max(1, 100 * pipZoom)}%`, height: 'auto' }} className="pointer-events-none shadow-2xl rounded-lg" alt="Reference" /></div>
                    <div className="absolute top-4 left-4 bg-slate-900/80 text-white text-[8px] px-2 py-1 font-black rounded-lg backdrop-blur-md pointer-events-none uppercase tracking-widest">Original Image</div>
                    <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-white/80 backdrop-blur-md shadow-xl rounded-2xl px-1.5 py-1 border border-white">
                       <button onClick={(e) => {e.stopPropagation(); setPipZoom(z => Math.max(0.1, z - 0.1))}} className="p-1 text-slate-600 hover:text-indigo-600 active:scale-90 transition"><Minus size={12}/></button><span className="text-[9px] font-black w-8 text-center text-slate-700">{Math.round(pipZoom*100)}%</span><button onClick={(e) => {e.stopPropagation(); setPipZoom(z => Math.min(10, z + 0.1))}} className="p-1 text-slate-600 hover:text-indigo-600 active:scale-90 transition"><Plus size={12}/></button>
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
              <h2 className="text-base font-black tracking-tight uppercase mb-4 flex items-center gap-2"><Layers className="text-indigo-600" size={18}/> Stack Order</h2>
              <div className="flex-1 overflow-auto space-y-2 pr-2 custom-scrollbar">
                {(() => {
                  const chs = []; let ch = 0; layerOrder.forEach((cs) => { ch += (layerThickness + (layerHeightAdjustments[cs] || 0)); chs.push(ch); });
                  return layerOrder.length === 0 ? <p className="text-center text-[10px] text-slate-300 mt-10 font-black tracking-widest uppercase">No Data</p> : 
                    layerOrder.map((cs, i) => {
                      const col = JSON.parse(cs); const sm = layerSmoothingSettings[cs] || { smoothOuter: false, smoothInner: false, tolerance: 0.1 };
                      return (
                        <div key={cs} className="flex flex-col gap-3 p-3.5 bg-slate-50 border border-slate-100 rounded-xl hover:bg-white hover:shadow-md transition-all">
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-1 shrink-0"><button onClick={() => moveLayer(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 active:scale-90 transition bg-white rounded-md border border-slate-100 shadow-sm"><ChevronUp size={16} /></button><button onClick={() => moveLayer(i, 1)} disabled={i === layerOrder.length - 1} className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 active:scale-90 transition bg-white rounded-md border border-slate-100 shadow-sm"><ChevronDown size={16} /></button></div>
                            <div className="w-10 h-10 rounded-lg shadow-inner border border-white shrink-0" style={{ backgroundColor: `rgb(${col[0]},${col[1]},${col[2]})` }} />
                            <div className="flex-1 min-w-0"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate">Layer {i+1}</p><p className="text-xs font-bold text-slate-700">Height: <span className="text-indigo-600">{(baseThickness + chs[i]).toFixed(1)}mm</span></p></div>
                            <div className="flex items-center gap-2"><button onClick={(e) => { e.stopPropagation(); handleLayerHeightChange(cs, -0.1); }} className="p-1.5 bg-white/80 rounded-lg border border-slate-200 shadow-sm active:scale-90 transition"><Minus size={12} /></button><span className="text-xs font-bold text-slate-600 w-12 text-center">{(layerThickness + (layerHeightAdjustments[cs] || 0)).toFixed(1)} mm</span><button onClick={(e) => { e.stopPropagation(); handleLayerHeightChange(cs, 0.1); }} className="p-1.5 bg-white/80 rounded-lg border border-slate-200 shadow-sm active:scale-90 transition"><Plus size={12} /></button></div>
                          </div>
                          <div className="pt-3 border-t border-slate-100 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={sm.smoothOuter} onChange={(e) => handleSmoothingChange(cs, 'smoothOuter', e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600" /><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Smooth Outer</span></label>
                              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={sm.smoothInner} onChange={(e) => handleSmoothingChange(cs, 'smoothInner', e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600" /><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Smooth Inner</span></label>
                            </div>
                            <div className="space-y-1"><div className="flex justify-between items-center"><span className="text-[9px] font-black text-slate-400 uppercase">Tolerance</span><span className="text-[9px] font-mono text-indigo-600 font-bold">{sm.tolerance.toFixed(2)} mm</span></div><input type="range" min="0.05" max="1.0" step="0.05" value={sm.tolerance} onChange={(e) => handleSmoothingChange(cs, 'tolerance', parseFloat(e.target.value))} className="w-full h-1 appearance-none bg-slate-200 rounded-full accent-indigo-600" /></div>
                          </div>
                        </div>
                      );
                    })
                })()}
              </div>
            </div>
          )}
          {activeTab === '3d' && (
            <div className="h-full flex flex-col"><div className="px-6 py-3 border-b border-slate-50 flex justify-between items-center shrink-0"><h2 className="text-base font-black tracking-tight uppercase flex items-center gap-2"><BoxIcon className="text-indigo-600" size={18}/> 3D Preview</h2><button onClick={exportSTL} className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg hover:bg-emerald-600 transition active:scale-95"><Download size={14} /> Export STL</button></div><div ref={threeRef} className="flex-1 bg-slate-50/50" /></div>
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
              </div><button onClick={() => setShowConfirmModal(true)} className="w-full mt-6 py-3 bg-rose-50 text-rose-500 rounded-[1.5rem] font-black text-[10px] border border-rose-100 uppercase tracking-widest transition hover:bg-rose-100 shadow-sm mb-4">Clear Canvas</button>
            </div>
          )}
        </div>
      </main>
      <nav className="flex justify-center items-center bg-white/90 backdrop-blur-lg border-t border-slate-100 px-2 py-1 shadow-[0_-4px_20px_rgba(0,0,0,0.02)] z-30 shrink-0">
        <div className="flex gap-1">
          {[ { id: 'editor', icon: Edit3, label: 'Editor' }, { id: 'layers', icon: Layers, label: 'Layers' }, { id: '3d', icon: BoxIcon, label: '3D View' }, { id: 'settings', icon: Settings, label: 'Setup' } ].map(item => (<NavItem key={item.id} id={item.id} icon={item.icon} label={item.label} isActive={activeTab === item.id} onClick={setActiveTab} />))}
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