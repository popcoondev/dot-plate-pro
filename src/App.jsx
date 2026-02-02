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
  Unlock
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

// --- ヘルパー関数 ---
const getFormattedDate = (format = "compact") => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  
  if (format === "filename") return `${y}${m}${d}_${h}${min}${s}`;
  if (format === "display") return `${y}/${m}/${d} ${h}:${min}:${s}`;
  return `${y}${m}${d}${h}${min}${s}`;
};

// --- サブコンポーネント ---
const NavItem = ({ id, icon: Icon, label, isActive, onClick }) => {
  return (
    <button 
      onClick={() => onClick(id)} 
      className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 transition-all rounded-lg ${isActive ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}
    >
      <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
      <span className={`text-[8px] font-bold ${isActive ? 'opacity-100' : 'opacity-70'}`}>{label}</span>
    </button>
  );
};

const App = () => {
  // --- 状態管理 ---
  const [activeTab, setActiveTab] = useState('editor'); 
  const [gridSize, setGridSize] = useState(32);
  
  // メタデータ
  const [projectName, setProjectName] = useState("");
  const [outputFileName, setOutputFileName] = useState("");
  const [author, setAuthor] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [originalFilePath, setOriginalFilePath] = useState("");

  // 物理パラメータ
  const [dotSize, setDotSize] = useState(1.0);        
  const [layerThickness, setLayerThickness] = useState(1.0); 
  const [baseThickness, setBaseThickness] = useState(0.2); 
  const [padSensitivity, setPadSensitivity] = useState(1); 
  
  const [pixels, setPixels] = useState(null); 
  const [sourceImage, setSourceImage] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);
  
  const [tool, setTool] = useState('hand'); 
  const [currentColor, setCurrentColor] = useState([255, 0, 0]);
  const [brushSize, setBrushSize] = useState(1); 
  const [zoom, setZoom] = useState(1.0);
  const [pipZoom, setPipZoom] = useState(1.0); 
  const [isTransparentMode, setIsTransparentMode] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false); 

  const [useVirtualPad, setUseVirtualPad] = useState(false);
  const [isCanvasLocked, setIsCanvasLocked] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [isPlotting, setIsPlotting] = useState(false);

  const [selection, setSelection] = useState(null);
  const [clipboard, setClipboard] = useState(null);

  const [layerOrder, setLayerOrder] = useState([]); 

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false); 
  const [statusMessage, setStatusMessage] = useState("");

  // --- 参照 ---
  const editorCanvasRef = useRef(null);
  const scrollContainerRef = useRef(null); 
  const canvasWrapperRef = useRef(null);
  const threeRef = useRef(null); 
  const sceneRef = useRef(null);
  const isDrawingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const lastTouchDistRef = useRef(null);
  const lastTrackpadPosRef = useRef({ x: 0, y: 0 });
  const cursorSubPixelRef = useRef({ x: 0, y: 0 });
  const isLoadingRef = useRef(false);
  const pixelsRef = useRef(null);
  
  useEffect(() => { pixelsRef.current = pixels; }, [pixels]);

  // 初期化
  useEffect(() => {
    if (!projectName && !isLoadingRef.current) {
      const defaultName = getFormattedDate("compact");
      setProjectName(defaultName);
      setOutputFileName(defaultName);
    }
  }, []);

  const handleProjectNameChange = (val) => {
    setProjectName(val);
    if (outputFileName === projectName || !outputFileName) setOutputFileName(val);
  };

  const centerCanvas = useCallback(() => {
    if (scrollContainerRef.current && canvasWrapperRef.current) {
      const container = scrollContainerRef.current;
      const wrapper = canvasWrapperRef.current;
      container.scrollLeft = (wrapper.scrollWidth - container.clientWidth) / 2;
      container.scrollTop = (wrapper.scrollHeight - container.clientHeight) / 2;
    }
  }, []);

  useEffect(() => {
    if (pixels && activeTab === 'editor') {
      const timer = setTimeout(centerCanvas, 100);
      return () => clearTimeout(timer);
    }
  }, [pixels === null, activeTab, showOriginal]);

  useEffect(() => {
    const preventScroll = (e) => e.preventDefault();
    
    if (isCanvasLocked) {
      document.body.addEventListener('touchmove', preventScroll, { passive: false });
    } else {
      document.body.removeEventListener('touchmove', preventScroll);
    }
    
    return () => {
      document.body.removeEventListener('touchmove', preventScroll);
    };
  }, [isCanvasLocked]);

  const syncLayersFromPixels = useCallback((currentPixels) => {
    if (!currentPixels) { setLayerOrder([]); return; }
    const colorSet = new Set();
    currentPixels.forEach(row => {
      row.forEach(p => {
        if (Array.isArray(p)) {
          const key = JSON.stringify(p);
          if (key !== TRANSPARENT_KEY) colorSet.add(key);
        }
      });
    });
    setLayerOrder(prev => {
      const existing = prev.filter(c => colorSet.has(c));
      const newColors = Array.from(colorSet).filter(c => !prev.includes(c));
      return [...existing, ...newColors];
    });
  }, []);

  const pushToHistory = useCallback((newPixels) => {
    if (!newPixels) return;
    const serialized = JSON.stringify(newPixels);
    setHistory(prev => {
      const newHistory = prev.slice(0, historyStep + 1);
      newHistory.push(serialized);
      if (newHistory.length > MAX_UNDO) newHistory.shift();
      return newHistory;
    });
    setHistoryStep(prev => Math.min(prev + 1, MAX_UNDO - 1));
  }, [historyStep]);

  const undo = useCallback(() => {
    if (historyStep > 0) {
      const prevPixels = JSON.parse(history[historyStep - 1]);
      setPixels(prevPixels); setHistoryStep(historyStep - 1); syncLayersFromPixels(prevPixels);
    }
  }, [history, historyStep, syncLayersFromPixels]);

  const redo = useCallback(() => {
    if (historyStep < history.length - 1) {
      const nextPixels = JSON.parse(history[historyStep + 1]);
      setPixels(nextPixels); setHistoryStep(historyStep + 1); syncLayersFromPixels(nextPixels);
    }
  }, [history, historyStep, syncLayersFromPixels]);

  const handleToolAction = useCallback((x, y, isFirst) => {
    setPixels(prev => {
      if (!prev || !prev[y] || prev[y][x] === undefined) return prev;
      if (tool === 'select') {
        if (isFirst) setSelection({ start: { x, y }, end: { x, y } });
        else setSelection(s => s ? { ...s, end: { x, y } } : { start: { x, y }, end: { x, y } });
        return prev;
      }
      if (tool === 'paste') {
        if (!isFirst || !clipboard) return prev;
        const newPixels = prev.map(r => [...r]);
        clipboard.data.forEach((row, dy) => {
          row.forEach((color, dx) => {
            const tx = x + dx; const ty = y + dy;
            if (ty >= 0 && ty < prev.length && tx >= 0 && tx < prev[0].length) newPixels[ty][tx] = color;
          });
        });
        return newPixels;
      }
      if (tool === 'dropper') { if (isFirst) { setCurrentColor(prev[y][x]); setTool('pen'); } return prev; }
      const color = isTransparentMode ? [...TRANSPARENT_COLOR] : currentColor;
      if (tool === 'pen') {
        const newPixels = [...prev];
        const radius = (brushSize - 1) / 2;
        let changed = false;
        for (let dy = -Math.floor(radius); dy <= Math.ceil(radius); dy++) {
          for (let dx = -Math.floor(radius); dx <= Math.ceil(radius); dx++) {
            const nx = x + dx; const ny = y + dy;
            if (nx >= 0 && nx < prev[0].length && ny >= 0 && ny < prev.length) {
              if (brushSize === 1 || Math.sqrt(dx*dx + dy*dy) <= brushSize / 2) {
                if (JSON.stringify(newPixels[ny][nx]) !== JSON.stringify(color)) {
                  if (newPixels[ny] === prev[ny]) newPixels[ny] = [...prev[ny]];
                  newPixels[ny][nx] = color; changed = true;
                }
              }
            }
          }
        }
        return changed ? newPixels : prev;
      }
      if (tool === 'bucket' && isFirst) {
        const targetKey = JSON.stringify(prev[y][x]);
        if (targetKey === JSON.stringify(color)) return prev;
        const newPixels = prev.map(r => [...r]);
        const queue = [[x, y]]; const visited = new Set();
        while (queue.length) {
          const [cx, cy] = queue.shift(); const k = `${cx},${cy}`;
          if (visited.has(k) || cx < 0 || cy < 0 || cx >= prev[0].length || cy >= prev.length || JSON.stringify(newPixels[cy][cx]) !== targetKey) continue;
          visited.add(k); newPixels[cy][cx] = color;
          queue.push([cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]);
        }
        return newPixels;
      }
      return prev;
    });
  }, [tool, currentColor, isTransparentMode, brushSize, clipboard]);

  const handleUpload = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileName = file.name.split('.').slice(0, -1).join('.');
      setProjectName(fileName); setOutputFileName(fileName);
      setSourceImage(e.target.result); setOriginalFilePath(file.name); 
      setCreatedAt(getFormattedDate("display")); setHistory([]); setHistoryStep(-1);
      reprocessImage(e.target.result, gridSize);
    };
    reader.readAsDataURL(file);
  }, [gridSize]);

  const reprocessImage = useCallback((imgSrc, size) => {
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      const ctx = tempCanvas.getContext('2d');
      const aspect = img.height / img.width;
      const h = Math.round(size * aspect);
      tempCanvas.width = size; tempCanvas.height = h;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, size, h);
      const imageData = ctx.getImageData(0, 0, size, h);
      const newPixels = [];
      for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;
          if (imageData.data[idx+3] < 128) row.push([...TRANSPARENT_COLOR]);
          else row.push([imageData.data[idx], imageData.data[idx+1], imageData.data[idx+2]]);
        }
        newPixels.push(row);
      }
      setPixels(newPixels); pushToHistory(newPixels); syncLayersFromPixels(newPixels);
      const initialPos = { x: Math.floor(size / 2), y: Math.floor(h / 2) };
      setCursorPos(initialPos); cursorSubPixelRef.current = { ...initialPos };
    };
    img.src = imgSrc;
  }, [syncLayersFromPixels, pushToHistory]);

  const handleNewCanvas = useCallback(() => {
    const size = gridSize;
    const newPixels = Array.from({ length: size }, () => Array.from({ length: size }, () => [...TRANSPARENT_COLOR]));
    const defaultName = getFormattedDate("compact");
    setProjectName(defaultName); setOutputFileName(defaultName);
    setSourceImage(null); setShowOriginal(false); setOriginalFilePath("");
    setCreatedAt(getFormattedDate("display")); setHistory([]); setHistoryStep(-1);
    setPixels(newPixels); pushToHistory(newPixels); syncLayersFromPixels(newPixels);
    setTool('pen'); setShowConfirmModal(false);
    const initialPos = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
    setCursorPos(initialPos); cursorSubPixelRef.current = { ...initialPos };
  }, [gridSize, pushToHistory, syncLayersFromPixels]);

  const saveProject = useCallback(() => {
    if (!pixels) return;
    const projectData = {
      version: "1.2", projectName, outputFileName, author, createdAt, originalFilePath,
      gridSize, dotSize, layerThickness, baseThickness, padSensitivity,
      layerOrder, pixels, sourceImage
    };
    const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${projectName || 'project'}.json`;
    link.click(); setStatusMessage("プロジェクトを保存しました！💾");
  }, [pixels, projectName, outputFileName, author, createdAt, originalFilePath, gridSize, dotSize, layerThickness, baseThickness, padSensitivity, layerOrder, sourceImage]);

  const loadProject = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.pixels) {
          isLoadingRef.current = true;
          setProjectName(data.projectName || ""); setOutputFileName(data.outputFileName || "");
          setAuthor(data.author || ""); setCreatedAt(data.createdAt || "");
          setOriginalFilePath(data.originalFilePath || "");
          setGridSize(data.gridSize); setDotSize(data.dotSize);
          setLayerThickness(data.layerThickness); setBaseThickness(data.baseThickness);
          setPadSensitivity(data.padSensitivity); setLayerOrder(data.layerOrder || []);
          setSourceImage(data.sourceImage || null); setPixels(data.pixels);
          setHistory([JSON.stringify(data.pixels)]); setHistoryStep(0);
          setStatusMessage("プロジェクトを復元しました！📂");
          setTimeout(() => { isLoadingRef.current = false; centerCanvas(); }, 100);
        }
      } catch (err) { setStatusMessage("読み込みエラー。"); }
    };
    reader.readAsText(file); e.target.value = '';
  }, [centerCanvas]);

  const exportSTL = () => {
    if (!sceneRef.current) return;
    const exporter = new STLExporter();
    const blob = new Blob([exporter.parse(sceneRef.current, { binary: true })], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    const timeStr = getFormattedDate("filename");
    a.href = URL.createObjectURL(blob); 
    a.download = `${timeStr}_stl_${outputFileName || 'dotplate'}.stl`;
    a.click(); setStatusMessage("STL出力完了！📦");
  };

  const exportImage = useCallback(async () => {
    if (!pixels || isExporting) return;
    setIsExporting(true); setStatusMessage("画像を構築中...");
    const pixelsPerMm = 300 / 25.4;
    const currentDotSize = dotSize * pixelsPerMm;
    const h = pixels.length; const w = pixels[0].length;
    const MAX_CANVAS_DIM = 4096;
    let finalDotSize = currentDotSize;
    if (w * finalDotSize > MAX_CANVAS_DIM || h * finalDotSize > MAX_CANVAS_DIM) {
      finalDotSize = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(w * finalDotSize); canvas.height = Math.floor(h * finalDotSize);
    const ctx = canvas.getContext('2d', { alpha: true });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = pixels[y][x];
        if (JSON.stringify(color) === TRANSPARENT_KEY) continue;
        ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        ctx.fillRect(Math.floor(x * finalDotSize), Math.floor(y * finalDotSize), Math.ceil(finalDotSize), Math.ceil(finalDotSize));
      }
      if (y % 30 === 0) await new Promise(r => setTimeout(r, 0));
    }
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timeStr = getFormattedDate("filename");
        a.download = `${timeStr}_img_${outputFileName || 'dotplate'}.png`;
        a.href = url; a.click(); URL.revokeObjectURL(url);
        setStatusMessage("画像出力完了！📸");
      }
      setIsExporting(false);
    }, 'image/png');
  }, [pixels, dotSize, isExporting, outputFileName]);

  const startDrawingNormal = (e) => {
    if (useVirtualPad || !editorCanvasRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if (e.touches && e.touches.length === 2) {
      lastTouchDistRef.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      return;
    }
    if (tool === 'hand') {
      isDrawingRef.current = true;
      const container = scrollContainerRef.current;
      dragStartRef.current = { x: clientX, y: clientY, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop };
      return;
    }
    const rect = editorCanvasRef.current.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / (10 * zoom));
    const y = Math.floor((clientY - rect.top) / (10 * zoom));
    if (x >= 0 && y >= 0 && x < (pixelsRef.current?.[0]?.length || 0) && y < (pixelsRef.current?.length || 0)) {
      isDrawingRef.current = true; handleToolAction(x, y, true);
    }
  };

  const drawMoveNormal = (e) => {
    if (useVirtualPad || !editorCanvasRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if (e.touches && e.touches.length === 2 && lastTouchDistRef.current) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setZoom(prev => Math.min(10, Math.max(0.05, prev * (dist / lastTouchDistRef.current))));
      lastTouchDistRef.current = dist; return;
    }
    if (!isDrawingRef.current) return;
    if (tool === 'hand') {
      const container = scrollContainerRef.current;
      container.scrollLeft = dragStartRef.current.scrollLeft - (clientX - dragStartRef.current.x);
      container.scrollTop = dragStartRef.current.scrollTop - (clientY - dragStartRef.current.y);
      return;
    }
    const rect = editorCanvasRef.current.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / (10 * zoom));
    const y = Math.floor((clientY - rect.top) / (10 * zoom));
    if (x >= 0 && y >= 0 && x < (pixelsRef.current?.[0]?.length || 0) && y < (pixelsRef.current?.length || 0)) handleToolAction(x, y, false);
  };

  const stopDrawingNormal = () => { if (isDrawingRef.current && pixelsRef.current && tool !== 'hand' && tool !== 'select') { pushToHistory(pixelsRef.current); syncLayersFromPixels(pixelsRef.current); } isDrawingRef.current = false; lastTouchDistRef.current = null; };

  const handleTrackpadStart = (e) => { e.preventDefault(); const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; lastTrackpadPosRef.current = { x: clientX, y: clientY }; isDrawingRef.current = true; };
  const handleTrackpadMove = (e) => {
    if (!isDrawingRef.current) return; e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - lastTrackpadPosRef.current.x; const dy = clientY - lastTrackpadPosRef.current.y;
    lastTrackpadPosRef.current = { x: clientX, y: clientY };
    const scale = (padSensitivity * 0.1) / zoom;
    cursorSubPixelRef.current.x += dx * scale; cursorSubPixelRef.current.y += dy * scale;
    const maxX = (pixelsRef.current?.[0]?.length || 1) - 1; const maxY = (pixelsRef.current?.length || 1) - 1;
    cursorSubPixelRef.current.x = Math.max(0, Math.min(maxX, cursorSubPixelRef.current.x));
    cursorSubPixelRef.current.y = Math.max(0, Math.min(maxY, cursorSubPixelRef.current.y));
    const newX = Math.round(cursorSubPixelRef.current.x); const newY = Math.round(cursorSubPixelRef.current.y);
    if (newX !== cursorPos.x || newY !== cursorPos.y) { setCursorPos({ x: newX, y: newY }); if (isPlotting) handleToolAction(newX, newY, false); }
  };
  const handleTrackpadEnd = () => { isDrawingRef.current = false; };
  const startPlotting = (e) => { e.preventDefault(); setIsPlotting(true); handleToolAction(cursorPos.x, cursorPos.y, true); };
  const stopPlotting = (e) => { e.preventDefault(); setIsPlotting(false); if (tool !== 'select' && pixelsRef.current) { pushToHistory(pixelsRef.current); syncLayersFromPixels(pixelsRef.current); } };

  const handleCopy = useCallback((e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!selection || !pixelsRef.current) return;
    const x1 = Math.min(selection.start.x, selection.end.x);
    const x2 = Math.max(selection.start.x, selection.end.x);
    const y1 = Math.min(selection.start.y, selection.end.y);
    const y2 = Math.max(selection.start.y, selection.end.y);
    const data = [];
    for (let y = y1; y <= y2; y++) { data.push(pixelsRef.current[y].slice(x1, x2 + 1)); }
    setClipboard({ data, width: x2 - x1 + 1, height: y2 - y1 + 1 });
    setSelection(null); setStatusMessage("コピーしました！"); setTool('paste');
  }, [selection]);

  // --- レイヤー並び替えロジック (上下ボタン方式) ---
  const moveLayer = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= layerOrder.length) return;
    
    const newOrder = [...layerOrder];
    const temp = newOrder[index];
    newOrder[index] = newOrder[newIndex];
    newOrder[newIndex] = temp;
    
    setLayerOrder(newOrder);
  };

  useEffect(() => {
    if (isLoadingRef.current) return;
    if (sourceImage) reprocessImage(sourceImage, gridSize); 
    else if (pixels) {
      setPixels(prev => {
        const oldH = prev.length; const oldW = prev[0]?.length || 0;
        return Array.from({ length: gridSize }, (_, y) =>
          Array.from({ length: gridSize }, (_, x) => (y < oldH && x < oldW) ? prev[y][x] : [...TRANSPARENT_COLOR])
        );
      });
    }
  }, [gridSize]); 

  useEffect(() => {
    const canvas = editorCanvasRef.current; if (!canvas || !pixels) return;
    const ctx = canvas.getContext('2d');
    const h = pixels.length; const w = pixels[0].length; const pSize = 10 * zoom;
    canvas.width = w * pSize; canvas.height = h * pSize;
    ctx.fillStyle = '#f8f9fa'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const checkSize = Math.max(2, 5 * zoom); ctx.fillStyle = '#f1f5f9';
    for (let y = 0; y < canvas.height; y += checkSize * 2) { for (let x = 0; x < canvas.width; x += checkSize * 2) { ctx.fillRect(x, y, checkSize, checkSize); ctx.fillRect(x + checkSize, y + checkSize, checkSize, checkSize); } }
    pixels.forEach((row, y) => { row.forEach((color, x) => { if (!Array.isArray(color) || JSON.stringify(color) === TRANSPARENT_KEY) return; ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`; ctx.fillRect(x * pSize, y * pSize, pSize, pSize); }); });
    if (selection) { const x1 = Math.min(selection.start.x, selection.end.x) * pSize; const x2 = (Math.max(selection.start.x, selection.end.x) + 1) * pSize; const y1 = Math.min(selection.start.y, selection.end.y) * pSize; const y2 = (Math.max(selection.start.y, selection.end.y) + 1) * pSize; ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); ctx.fillStyle = 'rgba(79, 70, 229, 0.1)'; ctx.fillRect(x1, y1, x2 - x1, y2 - y1); ctx.setLineDash([]); }
    if (useVirtualPad) { ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2.5; ctx.strokeRect(cursorPos.x * pSize, cursorPos.y * pSize, pSize, pSize); }
  }, [pixels, zoom, activeTab, cursorPos, useVirtualPad, selection, tool, clipboard]);

  useEffect(() => {
    if (activeTab === '3d' && pixels && threeRef.current) {
      const container = threeRef.current;
      while (container.firstChild) container.removeChild(container.firstChild);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf8fafc);
      const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const light = new THREE.DirectionalLight(0xffffff, 0.8); light.position.set(200, 400, 200);
      scene.add(light);
      const group = new THREE.Group();
      const h = pixels.length; const w = pixels[0].length;
      const layerIndices = {}; layerOrder.forEach((c, i) => layerIndices[c] = i);
      if (baseThickness > 0) {
        const baseGeo = new THREE.BoxGeometry(w * dotSize, h * dotSize, baseThickness);
        const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshLambertMaterial({ color: 0xdddddd }));
        baseMesh.position.set(0, 0, baseThickness / 2); group.add(baseMesh);
      }
      pixels.forEach((row, y) => {
        row.forEach((color, x) => {
          if (!Array.isArray(color) || JSON.stringify(color) === TRANSPARENT_KEY) return;
          const layerIdx = layerIndices[JSON.stringify(color)] ?? 0;
          const stackHeight = (layerIdx + 1) * layerThickness;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(dotSize, dotSize, stackHeight), new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${color[0]},${color[1]},${color[2]})`) }));
          mesh.position.set((x - (w - 1) / 2) * dotSize, ((h - 1) / 2 - y) * dotSize, baseThickness + stackHeight / 2);
          group.add(mesh);
        });
      });
      scene.add(group); sceneRef.current = group;
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      camera.position.set(center.x, center.y - 100, center.z + 100);
      controls.target.copy(center); controls.update();
      const animate = () => { if (threeRef.current) { requestAnimationFrame(animate); renderer.render(scene, camera); } };
      animate();
    }
  }, [activeTab, pixels, dotSize, layerThickness, baseThickness, layerOrder]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans select-none overflow-hidden relative text-left">
      <header className="flex items-center justify-between px-6 py-2.5 bg-white/80 backdrop-blur-md border-b border-slate-100 z-30 shrink-0">
        <h1 className="text-base font-black text-indigo-600 flex items-center gap-1 italic uppercase tracking-tight"><Zap fill="currentColor" size={18} /> Dot Plate Pro</h1>
        <div className="flex gap-1.5">
          <button onClick={undo} disabled={historyStep <= 0} className="p-1.5 bg-slate-100/50 text-slate-600 rounded-lg disabled:opacity-20 active:scale-90 transition hover:bg-slate-100"><Undo size={16}/></button>
          <button onClick={redo} disabled={historyStep >= history.length - 1} className="p-1.5 bg-slate-100/50 text-slate-600 rounded-lg disabled:opacity-20 active:scale-90 transition hover:bg-slate-100"><Redo size={16}/></button>
        </div>
      </header>

      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-xs overflow-hidden animate-in zoom-in">
            <div className="p-6 text-center">
              <div className="w-10 h-10 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center mx-auto mb-3"><AlertCircle size={24} /></div>
              <h3 className="text-lg font-bold text-slate-800 mb-1">Reset</h3>
              <p className="text-[10px] text-slate-500">Are you sure you want to clear?</p>
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
            <div className="relative w-10 h-10 mx-auto mb-3">
              <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
            </div>
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
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resolution</span>
                    <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-black min-w-[30px] text-center shadow-sm">{gridSize}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setUseVirtualPad(!useVirtualPad)} className={`p-1.5 rounded-lg transition shadow-sm border ${useVirtualPad ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-100 text-slate-400'}`}><Gamepad size={14}/></button>
                    <button onClick={() => setShowConfirmModal(true)} className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 shadow-sm active:scale-90 transition"><FilePlus size={14}/></button>
                    <label className="p-1.5 rounded-lg bg-white border border-slate-100 text-slate-400 shadow-sm cursor-pointer active:scale-90 transition"><ImagePlus size={14}/><input type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} /></label>
                    <button onClick={() => setShowOriginal(!showOriginal)} disabled={!sourceImage} className={`p-1.5 rounded-lg border transition shadow-sm ${showOriginal ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-100 text-slate-400'}`}><ImageIcon size={14}/></button>
                  </div>
                </div>
                <div className="w-full px-1 flex items-center gap-2">
                  <button onClick={() => setGridSize(prev => Math.max(MIN_RESOLUTION, prev - 1))} className="p-1 text-slate-400 hover:text-indigo-600 active:scale-90 transition"><Minus size={14} /></button>
                  <input type="range" min={MIN_RESOLUTION} max={MAX_RESOLUTION} step="1" value={gridSize} onChange={(e) => setGridSize(parseInt(e.target.value))} className="flex-1 accent-indigo-600 h-1 appearance-none bg-slate-100 rounded-full" />
                  <button onClick={() => setGridSize(prev => Math.min(MAX_RESOLUTION, prev + 1))} className="p-1 text-slate-400 hover:text-indigo-600 active:scale-90 transition"><Plus size={14} /></button>
                </div>
              </div>

              <div className={`flex-1 flex ${showOriginal ? 'flex-col lg:flex-row' : 'flex-col'} overflow-hidden relative`}>
                <div 
                  ref={scrollContainerRef} 
                  className={`flex-1 relative bg-slate-50/30 custom-scrollbar ${tool === 'hand' && !useVirtualPad ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`} 
                  style={{ overflow: isCanvasLocked ? 'hidden' : 'auto' }}
                  onMouseDown={startDrawingNormal} 
                  onMouseMove={drawMoveNormal} 
                  onMouseUp={stopDrawingNormal} 
                  onMouseLeave={stopDrawingNormal} 
                  onTouchStart={startDrawingNormal} 
                  onTouchMove={drawMoveNormal} 
                  onTouchEnd={stopDrawingNormal}
                >
                  
                  {!pixels ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                      <div className="p-6 bg-white rounded-[1.5rem] shadow-xl border border-slate-100 text-center">
                        <Upload size={32} className="text-indigo-200 mx-auto mb-3" />
                        <label className="block cursor-pointer bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-black text-[9px] shadow-lg tracking-widest uppercase mb-3 hover:bg-indigo-700 transition">Select Image<input type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} /></label>
                        <button onClick={handleNewCanvas} className="w-full text-indigo-600 font-bold text-[9px] uppercase tracking-widest hover:underline">New Canvas</button>
                      </div>
                    </div>
                  ) : (
                    <div ref={canvasWrapperRef} className="p-[50%] inline-flex items-center justify-center min-w-full min-h-full">
                      <canvas ref={editorCanvasRef} className="shadow-2xl rounded-sm bg-white" style={{ imageRendering: 'pixelated' }} />
                    </div>
                  )}

                  {useVirtualPad && pixels && (
                    <div className="sticky inset-0 pointer-events-none z-30 h-full w-full">
                      <div className="absolute bottom-28 left-6 pointer-events-auto flex flex-col gap-3">
                        {tool === 'select' && selection && (
                          <button onPointerDown={handleCopy} className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xl border-2 border-indigo-400 active:scale-90"><Copy size={18}/></button>
                        )}
                        <button onPointerDown={startPlotting} onPointerUp={stopPlotting} 
                          className={`w-16 h-16 rounded-full flex items-center justify-center border-4 shadow-2xl transition-all ${isPlotting ? 'bg-indigo-600/80 border-indigo-400 text-white scale-95' : 'bg-white/40 backdrop-blur-sm border-white/50 text-indigo-600'}`}
                        ><span className="text-[10px] font-black uppercase tracking-widest">{tool === 'paste' ? 'Paste' : 'Plot'}</span></button>
                      </div>
                      <div className="absolute bottom-28 right-6 pointer-events-auto">
                        <div onPointerDown={handleTrackpadStart} onPointerMove={handleTrackpadMove} onPointerUp={handleTrackpadEnd} onPointerLeave={handleTrackpadEnd}
                          className="w-40 h-40 bg-transparent rounded-[2rem] border-2 border-indigo-400/30 flex items-center justify-center touch-none relative shadow-inner backdrop-blur-[1px] overflow-hidden"
                        >
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-px h-full bg-indigo-400/20"></div>
                            <div className="w-full h-px bg-indigo-400/20 absolute"></div>
                          </div>
                          <Move size={24} className="text-indigo-400/20 z-10" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {pixels && !useVirtualPad && (
                  <button 
                    onClick={() => setIsCanvasLocked(!isCanvasLocked)} 
                    className={`absolute top-4 right-4 z-50 p-2.5 rounded-xl transition-all shadow-lg border ${isCanvasLocked ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white/50 backdrop-blur-md text-slate-700 border-white/20'}`}
                  >
                    {isCanvasLocked ? <Lock size={16} /> : <Unlock size={16} />}
                  </button>
                )}

                {showOriginal && sourceImage && (
                  <div className="flex-1 relative overflow-auto bg-slate-100/50 border-t border-slate-100 custom-scrollbar text-center">
                    <div className="p-8 min-h-full min-w-full flex items-center justify-center">
                      <img src={sourceImage} style={{ width: `${Math.max(1, 100 * pipZoom)}%`, height: 'auto' }} className="pointer-events-none shadow-2xl rounded-lg" alt="Reference" />
                    </div>
                    <div className="absolute top-4 left-4 bg-slate-900/80 text-white text-[8px] px-2 py-1 font-black rounded-lg backdrop-blur-md pointer-events-none uppercase tracking-widest">Original Image</div>
                    <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-white/80 backdrop-blur-md shadow-xl rounded-2xl px-1.5 py-1 border border-white">
                       <button onClick={(e) => {e.stopPropagation(); setPipZoom(z => Math.max(0.1, z - 0.1))}} className="p-1 text-slate-600 hover:text-indigo-600 active:scale-90 transition"><Minus size={12}/></button>
                       <span className="text-[9px] font-black w-8 text-center text-slate-700">{Math.round(pipZoom*100)}%</span>
                       <button onClick={(e) => {e.stopPropagation(); setPipZoom(z => Math.min(10, z + 0.1))}} className="p-1 text-slate-600 hover:text-indigo-600 active:scale-90 transition"><Plus size={12}/></button>
                    </div>
                  </div>
                )}
              </div>

              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center bg-slate-900/95 backdrop-blur-md rounded-[2rem] shadow-2xl z-40 border border-white/10 w-auto max-w-[calc(100%-1.5rem)] overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 py-1.5 overflow-x-auto no-scrollbar scroll-smooth">
                  <div className="flex gap-0.5 pr-2 border-r border-white/10 shrink-0">
                    <button onClick={() => setTool('hand')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='hand'?'bg-amber-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Hand size={18}/></button>
                    <button onClick={() => setTool('pen')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='pen'&&!isTransparentMode?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Edit3 size={18}/></button>
                    <button onClick={() => setTool('select')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='select'?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Square size={18}/></button>
                    <button onClick={() => setTool('paste')} disabled={!clipboard} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='paste'?'bg-emerald-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300 disabled:opacity-10'}`}><ClipboardPaste size={18}/></button>
                    <button onClick={() => setTool('bucket')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='bucket'?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><PaintBucket size={18}/></button>
                    <button onClick={() => setTool('dropper')} className={`p-2.5 rounded-full transition-all shrink-0 ${tool==='dropper'?'bg-indigo-500 text-white shadow-lg':'text-slate-500 hover:text-slate-300'}`}><Pipette size={18}/></button>
                    <button onClick={() => setIsTransparentMode(!isTransparentMode)} className={`p-2.5 rounded-full transition-all shrink-0 ${isTransparentMode?'bg-white text-black':'text-slate-500 hover:text-slate-300'}`}><Circle size={16} strokeDasharray="3 3"/></button>
                  </div>
                  <div className="flex items-center gap-1 px-1.5 py-1 bg-white/5 rounded-full border border-white/5 shrink-0">
                    <button onClick={() => setBrushSize(s=>Math.max(1, s-1))} className="text-slate-400 p-0.5 hover:text-white active:scale-90 transition"><Minus size={12}/></button>
                    <span className="text-white text-[9px] font-black w-3 text-center">{brushSize}</span>
                    <button onClick={() => setBrushSize(s=>Math.min(20, s+1))} className="text-slate-400 p-0.5 hover:text-white active:scale-90 transition"><Plus size={12}/></button>
                  </div>
                  <div className="flex items-center gap-1 px-1.5 py-1 bg-white/5 rounded-full border border-white/5 shrink-0">
                    <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="text-slate-400 p-0.5 hover:text-white active:scale-90 transition"><Minus size={12}/></button>
                    <span className="text-white text-[9px] font-black min-w-[28px] text-center">{Math.round(zoom*100)}%</span>
                    <button onClick={() => setZoom(z => Math.min(10, z + 0.1))} className="text-slate-400 p-0.5 hover:text-white active:scale-90 transition"><Plus size={12}/></button>
                  </div>
                  <input type="color" value={`#${currentColor.map(c=>(c||0).toString(16).padStart(2,'0')).join('')}`} onChange={e => { const [r,g,b] = [1,3,5].map(i => parseInt(e.target.value.slice(i, i+2), 16)); setCurrentColor([r,g,b]); setIsTransparentMode(false); }} className="w-8 h-8 rounded-full border-2 border-white/20 p-0 shrink-0 overflow-hidden cursor-pointer active:scale-90 transition" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'layers' && (
            <div className="h-full flex flex-col px-6 py-4">
              <h2 className="text-base font-black tracking-tight uppercase mb-4 flex items-center gap-2"><Layers className="text-indigo-600" size={18}/> Stack Order</h2>
              <div className="flex-1 overflow-auto space-y-2 pr-2 custom-scrollbar">
                {layerOrder.length === 0 ? <p className="text-center text-[10px] text-slate-300 mt-10 font-black tracking-widest uppercase">No Data</p> : 
                  layerOrder.map((colorStr, i) => {
                    const color = JSON.parse(colorStr);
                    return (
                      <div key={colorStr} className={`flex items-center gap-4 p-3.5 bg-slate-50 border border-slate-100 rounded-xl transition-all ${'hover:bg-white hover:shadow-md hover:border-indigo-100'}`}>
                        {/* 修正: 上下ボタンによる順序入れ替え */}
                        <div className="flex flex-col gap-1 shrink-0">
                          <button 
                            onClick={() => moveLayer(i, -1)} 
                            disabled={i === 0}
                            className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 active:scale-90 transition bg-white rounded-md border border-slate-100 shadow-sm"
                          >
                            <ChevronUp size={16} />
                          </button>
                          <button 
                            onClick={() => moveLayer(i, 1)} 
                            disabled={i === layerOrder.length - 1}
                            className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 active:scale-90 transition bg-white rounded-md border border-slate-100 shadow-sm"
                          >
                            <ChevronDown size={16} />
                          </button>
                        </div>
                        
                        <div className="w-10 h-10 rounded-lg shadow-inner border border-white shrink-0 pointer-events-none" style={{ backgroundColor: `rgb(${color[0]},${color[1]},${color[2]})` }} />
                        <div className="flex-1 min-w-0 pointer-events-none">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate">Layer {i+1}</p>
                          <p className="text-xs font-bold text-slate-700">Height: <span className="text-indigo-600">{(baseThickness+(i+1)*layerThickness).toFixed(1)}mm</span></p>
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            </div>
          )}

          {activeTab === '3d' && (
            <div className="h-full flex flex-col">
              <div className="px-6 py-3 border-b border-slate-50 flex justify-between items-center shrink-0">
                <h2 className="text-base font-black tracking-tight uppercase flex items-center gap-2"><BoxIcon className="text-indigo-600" size={18}/> 3D Preview</h2>
                <button onClick={exportSTL} className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg hover:bg-emerald-600 transition active:scale-95"><Download size={14} /> Export STL</button>
              </div>
              <div ref={threeRef} className="flex-1 bg-slate-50/50" />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="h-full px-6 py-4 overflow-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-base font-black tracking-tight uppercase flex items-center gap-2"><Settings className="text-indigo-600" size={18}/> Setup</h2>
                <div className="flex gap-2">
                  <button onClick={saveProject} className="p-2.5 bg-white border border-slate-100 text-indigo-600 rounded-xl shadow-sm hover:bg-indigo-50 transition"><FileJson size={18} /></button>
                  <label className="p-2.5 bg-white border border-slate-100 text-indigo-600 rounded-xl shadow-sm cursor-pointer hover:bg-indigo-50 transition"><FolderOpen size={18} /><input type="file" accept=".json" className="hidden" onChange={loadProject} /></label>
                  <button onClick={exportImage} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[9px] font-black shadow-lg uppercase">Export Image</button>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 space-y-4 shadow-inner">
                  <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest border-b border-indigo-100 pb-2">Project Metadata</p>
                  <div className="space-y-3">
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-2 px-1"><FileText size={10}/> Project Name</label><input type="text" value={projectName} onChange={e => handleProjectNameChange(e.target.value)} className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-indigo-400 transition" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-2 px-1"><Download size={10}/> Export Filename</label><input type="text" value={outputFileName} onChange={e => setOutputFileName(e.target.value)} className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-indigo-400 transition" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase flex items-center gap-2 px-1"><User size={10}/> Author</label><input type="text" value={author} onChange={e => setAuthor(e.target.value)} className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-indigo-400 transition" placeholder="Your Name" /></div>
                    <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                      <div><label className="text-[8px] font-black text-slate-400 uppercase px-1">Created At</label><div className="text-[9px] font-bold text-slate-500 truncate">{createdAt || "---"}</div></div>
                      <div><label className="text-[8px] font-black text-slate-400 uppercase px-1">Source File</label><div className="text-[9px] font-bold text-slate-500 truncate">{originalFilePath || "None"}</div></div>
                    </div>
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
              </div>
              
              <button onClick={() => setShowConfirmModal(true)} className="w-full mt-6 py-3 bg-rose-50 text-rose-500 rounded-[1.5rem] font-black text-[10px] border border-rose-100 uppercase tracking-widest transition hover:bg-rose-100 shadow-sm mb-4">Clear Canvas</button>
            </div>
          )}
        </div>
      </main>

      <nav className="flex justify-center items-center bg-white/90 backdrop-blur-lg border-t border-slate-100 px-2 py-1 shadow-[0_-4px_20px_rgba(0,0,0,0.02)] z-30 shrink-0">
        <div className="flex gap-1">
          {[
            { id: 'editor', icon: Edit3, label: 'Editor' },
            { id: 'layers', icon: Layers, label: 'Layers' },
            { id: '3d', icon: BoxIcon, label: '3D View' },
            { id: 'settings', icon: Settings, label: 'Setup' }
          ].map(item => (
            <NavItem key={item.id} id={item.id} icon={item.icon} label={item.label} isActive={activeTab === item.id} onClick={setActiveTab} />
          ))}
        </div>
      </nav>

      <style dangerouslySetInnerHTML={{ __html: `
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 3px; height: 3px; }
        .custom-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        input[type=range] { -webkit-appearance: none; }
        input[type=range]:focus { outline: none; }
        input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 3px; cursor: pointer; background: #f1f5f9; border-radius: 999px; }
        input[type=range]::-webkit-slider-thumb { height: 14px; width: 14px; border-radius: 50%; background: #4f46e5; -webkit-appearance: none; margin-top: -5.5px; border: 2.5px solid #ffffff; box-shadow: 0 3px 5px rgba(79,70,229,0.2); }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes zoomIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-in { animation: fadeIn 0.3s ease-out; }
        .zoom-in { animation: zoomIn 0.3s ease-out; }
      `}} />
    </div>
  );
};

export default App;