import * as LJS from "./vendor/littlejs.esm.js";

const COLS = 18;
const ROWS = 12;
const TILE_SIZE = 1;
const TILE_IDS = ["grass", "path", "water", "stone", "flower", "tree", "bridge", "start", "portal", "erase"];
const TILE_LABELS = {
  grass: "Grass",
  path: "Path",
  water: "Water",
  stone: "Stone",
  flower: "Bloom",
  tree: "Tree",
  bridge: "Bridge",
  start: "Start",
  portal: "Portal",
  erase: "Erase",
};
const COLORS = {};
const color = (hex, alpha = 1) => {
  const value = hex.replace("#", "");
  return LJS.rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
    alpha,
  );
};

const boardIndex = (col, row) => row * COLS + col;
let board = createStarterLevel();
let selectedTile = "grass";
let hoverCell = null;
let painting = false;
let strokeValue = "grass";
let strokeStart = null;
let undoStack = [];
let redoStack = [];
let toastTimer;

const paletteGrid = document.querySelector("#palette-grid");
const playfield = document.querySelector("#playfield");
const engineRoot = document.querySelector("#engine-root");
const undoButton = document.querySelector("#undo-button");
const redoButton = document.querySelector("#redo-button");
const fileInput = document.querySelector("#file-input");
const levelNameInput = document.querySelector("#level-name");
let engineCanvas = null;

function createStarterLevel() {
  const cells = Array(COLS * ROWS).fill("grass");
  const set = (col, row, tile) => {
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) cells[boardIndex(col, row)] = tile;
  };

  // A winding stream, with a little stone along its banks.
  for (let col = 0; col < COLS; col++) {
    const streamRow = 6 + Math.round(Math.sin(col * 0.48) * 1.15);
    set(col, streamRow, "water");
    set(col, streamRow + 1, "water");
    if (col % 3 === 1) {
      set(col, streamRow - 1, "stone");
      set(col, streamRow + 2, "stone");
    }
  }

  // The footpath crosses the stream on a small plank bridge.
  for (let col = 0; col < COLS; col++) {
    const pathRow = Math.round(9 - col * 0.34 + Math.sin(col * 0.43) * 0.45);
    const current = cells[boardIndex(col, pathRow)];
    set(col, pathRow, current === "water" ? "bridge" : "path");
    if (col > 0 && col % 5 === 0) {
      const next = cells[boardIndex(col, pathRow + 1)];
      if (next === "water") set(col, pathRow + 1, "bridge");
    }
  }

  const trees = [[1, 1], [3, 2], [6, 1], [14, 1], [16, 2], [2, 10], [5, 10], [13, 10], [16, 9], [4, 5], [11, 2], [10, 10]];
  for (const [col, row] of trees) if (cells[boardIndex(col, row)] === "grass") set(col, row, "tree");

  const blooms = [[2, 3], [4, 3], [7, 2], [12, 2], [14, 3], [3, 8], [6, 9], [11, 9], [14, 8], [16, 7], [1, 5]];
  for (const [col, row] of blooms) if (cells[boardIndex(col, row)] === "grass") set(col, row, "flower");

  set(1, 9, "start");
  set(16, 3, "portal");
  return cells;
}

function renderPalette() {
  paletteGrid.innerHTML = TILE_IDS.map((id) => `
    <button class="tile-button${id === selectedTile ? " is-selected" : ""}" data-kind="${id}" type="button" aria-pressed="${id === selectedTile}" aria-label="${TILE_LABELS[id]} tile">
      <span class="tile-swatch" data-kind="${id}" aria-hidden="true"></span>
      <span class="tile-name">${TILE_LABELS[id]}</span>
    </button>
  `).join("");
}

function chooseTile(id) {
  selectedTile = id;
  for (const button of paletteGrid.querySelectorAll(".tile-button")) {
    const active = button.dataset.kind === selectedTile;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const swatch = document.querySelector("#selected-swatch");
  swatch.dataset.kind = selectedTile;
  document.querySelector("#selected-label").textContent = `${TILE_LABELS[selectedTile]} selected`;
}

function makePalette() {
  const hex = {
    background: "#f1f2e9",
    boardShadow: "#9ea896",
    boardFrame: "#d6dbcf",
    grass: "#78b67a",
    grassLight: "#a6d28b",
    grassMid: "#67aa70",
    grassDark: "#4b925d",
    path: "#d7b781",
    pathLight: "#eed39d",
    pathDark: "#b99362",
    water: "#67b6c7",
    waterLight: "#ace1d4",
    waterDark: "#459caf",
    stone: "#a3ada2",
    stoneLight: "#c9d0bf",
    stoneDark: "#788a82",
    flower: "#72b47a",
    stem: "#3e8452",
    petal: "#f2a7a0",
    petalGold: "#f2cb73",
    trunk: "#82634d",
    treeDark: "#34764d",
    treeMid: "#438d58",
    treeLight: "#64a968",
    bridge: "#bb8050",
    bridgeLight: "#d79b61",
    bridgeDark: "#936244",
    start: "#f0cf75",
    startLight: "#fff1bb",
    portal: "#765fba",
    portalLight: "#c0a8ef",
    portalCore: "#74a9dd",
    empty: "#edeadd",
    grid: "#f8f7ee",
    hover: "#fff8c9",
    hoverEdge: "#fff2a1",
  };
  for (const [key, value] of Object.entries(hex)) COLORS[key] = color(value);
  COLORS.shadow = color("#324338", 0.17);
  COLORS.hoverFill = color("#fff5ba", 0.22);
  COLORS.waterShine = color("#c9eee0", 0.88);
}

function updateCamera() {
  const rect = playfield.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = Math.max(11, Math.min((rect.width - 64) / COLS, (rect.height - 64) / ROWS, 42));
  LJS.setCameraScale(scale);
  const stageCenterX = rect.left + rect.width / 2;
  const stageCenterY = rect.top + rect.height / 2;
  LJS.setCameraPos(LJS.vec2(
    (window.innerWidth / 2 - stageCenterX) / scale,
    (stageCenterY - window.innerHeight / 2) / scale,
  ));
}

function gameRender() {
  const camera = LJS.cameraPos;
  const size = LJS.vec2(LJS.mainCanvasSize.x / LJS.cameraScale + 2, LJS.mainCanvasSize.y / LJS.cameraScale + 2);
  LJS.drawRect(camera, size, COLORS.background);

  // A quiet shadow and paper-colored rim lift the editable map off the canvas.
  LJS.drawRect(LJS.vec2(0.05, -0.13), LJS.vec2(COLS + 0.48, ROWS + 0.48), COLORS.shadow);
  LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(COLS + 0.24, ROWS + 0.24), COLORS.boardFrame);
  LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(COLS + 0.07, ROWS + 0.07), COLORS.grid);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const center = cellCenter(col, row);
      drawTile(board[boardIndex(col, row)], center, col, row);
    }
  }

  // Fine grout lines keep the tile grid readable without overpowering the art.
  const left = -COLS / 2;
  const top = ROWS / 2;
  for (let col = 0; col <= COLS; col++) {
    const x = left + col;
    LJS.drawLine(LJS.vec2(x, -ROWS / 2), LJS.vec2(x, ROWS / 2), 0.018, COLORS.grid);
  }
  for (let row = 0; row <= ROWS; row++) {
    const y = top - row;
    LJS.drawLine(LJS.vec2(-COLS / 2, y), LJS.vec2(COLS / 2, y), 0.018, COLORS.grid);
  }

  if (hoverCell) {
    const center = cellCenter(hoverCell.col, hoverCell.row);
    LJS.drawRect(center, LJS.vec2(0.97, 0.97), COLORS.hoverFill);
    const half = 0.48;
    const leftEdge = center.x - half;
    const rightEdge = center.x + half;
    const topEdge = center.y + half;
    const bottomEdge = center.y - half;
    const corners = [
      [LJS.vec2(leftEdge, bottomEdge), LJS.vec2(rightEdge, bottomEdge)],
      [LJS.vec2(leftEdge, topEdge), LJS.vec2(rightEdge, topEdge)],
      [LJS.vec2(leftEdge, bottomEdge), LJS.vec2(leftEdge, topEdge)],
      [LJS.vec2(rightEdge, bottomEdge), LJS.vec2(rightEdge, topEdge)],
    ];
    for (const [a, b] of corners) LJS.drawLine(a, b, 0.045, COLORS.hoverEdge);
  }
}

function cellCenter(col, row) {
  return LJS.vec2(col - COLS / 2 + TILE_SIZE / 2, ROWS / 2 - row - TILE_SIZE / 2);
}

function drawTile(kind, center, col, row) {
  if (!kind) kind = "empty";
  const pattern = (dx, dy, w, h, fill) => LJS.drawRect(LJS.vec2(center.x + dx, center.y + dy), LJS.vec2(w, h), fill);
  const seed = (col * 13 + row * 29) % 7;
  const base = kind === "empty" ? COLORS.empty : COLORS[kind] || COLORS.grass;
  LJS.drawRect(center, LJS.vec2(0.985, 0.985), base);

  switch (kind) {
    case "grass":
      pattern(-0.28 + seed * 0.035, 0.23, 0.08, 0.07, COLORS.grassLight);
      pattern(0.22, -0.22 + seed * 0.025, 0.11, 0.065, COLORS.grassDark);
      pattern(-0.1, -0.34, 0.055, 0.055, COLORS.grassMid);
      break;
    case "path":
      pattern(-0.26, 0.22, 0.095, 0.07, COLORS.pathLight);
      pattern(0.22, -0.2, 0.1, 0.075, COLORS.pathDark);
      pattern(-0.02, -0.32 + seed * 0.015, 0.06, 0.055, COLORS.pathLight);
      break;
    case "water":
      pattern(-0.12, 0.22, 0.31, 0.045, COLORS.waterShine);
      pattern(0.17, -0.08, 0.26, 0.045, COLORS.waterShine);
      pattern(-0.2, -0.3, 0.18, 0.04, COLORS.waterDark);
      break;
    case "stone":
      pattern(-0.2, 0.2, 0.32, 0.3, COLORS.stoneLight);
      pattern(0.2, -0.18, 0.36, 0.32, COLORS.stoneDark);
      pattern(0, -0.35, 0.18, 0.055, COLORS.stoneLight);
      break;
    case "flower":
      pattern(-0.02, -0.13, 0.045, 0.29, COLORS.stem);
      pattern(-0.14, -0.23, 0.15, 0.055, COLORS.stem);
      pattern(-0.08, 0.12, 0.16, 0.16, COLORS.petal);
      pattern(0.08, 0.12, 0.16, 0.16, COLORS.petal);
      pattern(0, 0.26, 0.16, 0.16, COLORS.petal);
      pattern(0, 0.12, 0.11, 0.11, COLORS.petalGold);
      break;
    case "tree":
      pattern(0, -0.27, 0.17, 0.43, COLORS.trunk);
      pattern(0, 0.16, 0.68, 0.3, COLORS.treeDark);
      pattern(-0.04, 0.03, 0.58, 0.32, COLORS.treeMid);
      pattern(-0.06, 0.25, 0.38, 0.22, COLORS.treeLight);
      pattern(-0.24, 0.22, 0.12, 0.12, COLORS.treeLight);
      break;
    case "bridge":
      pattern(0, 0.23, 0.58, 0.045, COLORS.waterShine);
      pattern(0, -0.17, 0.66, 0.045, COLORS.waterShine);
      pattern(0, 0, 0.82, 0.6, COLORS.bridgeDark);
      pattern(0, 0, 0.74, 0.51, COLORS.bridge);
      pattern(0, 0.17, 0.74, 0.045, COLORS.bridgeLight);
      pattern(0, 0, 0.74, 0.045, COLORS.bridgeLight);
      pattern(0, -0.17, 0.74, 0.045, COLORS.bridgeLight);
      break;
    case "start":
      pattern(0, -0.15, 0.045, 0.56, COLORS.trunk);
      pattern(0.15, 0.2, 0.25, 0.17, COLORS.start);
      pattern(0.12, 0.24, 0.16, 0.095, COLORS.startLight);
      pattern(-0.04, -0.38, 0.3, 0.1, COLORS.start);
      break;
    case "portal":
      pattern(0, 0, 0.58, 0.76, COLORS.portal);
      pattern(0, -0.02, 0.42, 0.6, COLORS.portalLight);
      pattern(0, -0.08, 0.19, 0.4, COLORS.portalCore);
      pattern(-0.16, -0.35, 0.11, 0.08, COLORS.portalLight);
      pattern(0.18, 0.32, 0.1, 0.08, COLORS.portalLight);
      break;
    case "empty":
      pattern(-0.27, 0.27, 0.08, 0.08, COLORS.boardFrame);
      pattern(0.24, -0.25, 0.06, 0.06, COLORS.boardFrame);
      break;
  }
}

function cellFromPointer(event) {
  const rect = engineCanvas.getBoundingClientRect();
  const scale = LJS.cameraScale;
  const worldX = (event.clientX - rect.left - rect.width / 2) / scale + LJS.cameraPos.x;
  const worldY = (rect.height / 2 - (event.clientY - rect.top)) / scale + LJS.cameraPos.y;
  const col = Math.floor(worldX + COLS / 2);
  const row = Math.floor(ROWS / 2 - worldY);
  return col >= 0 && col < COLS && row >= 0 && row < ROWS ? { col, row } : null;
}

function paintCell(cell) {
  if (!cell) return;
  const value = strokeValue === "erase" ? null : strokeValue;
  const index = boardIndex(cell.col, cell.row);
  if (board[index] === value) return;
  board[index] = value;
  updatePlacedCount();
}

function finishStroke() {
  if (!painting) return;
  painting = false;
  if (strokeStart && !sameBoard(strokeStart, board)) commitHistory(strokeStart);
  strokeStart = null;
}

function sameBoard(a, b) {
  return a.length === b.length && a.every((tile, index) => tile === b[index]);
}

function commitHistory(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(board.slice());
  board = undoStack.pop();
  updatePlacedCount();
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(board.slice());
  board = redoStack.pop();
  updatePlacedCount();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  undoButton.disabled = !undoStack.length;
  redoButton.disabled = !redoStack.length;
}

function updatePlacedCount() {
  const count = board.filter(Boolean).length;
  document.querySelector("#placed-count").textContent = `${count} placed`;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2100);
}

function exportLevel() {
  const level = {
    format: "little-level",
    version: 1,
    name: levelNameInput.value.trim() || "Untitled level",
    width: COLS,
    height: ROWS,
    tiles: board,
  };
  const filename = (level.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "little-level") + ".json";
  const blob = new Blob([JSON.stringify(level, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Level exported");
}

async function importLevel(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== "little-level" || data.width !== COLS || data.height !== ROWS || !Array.isArray(data.tiles) || data.tiles.length !== COLS * ROWS) {
      throw new Error("That file does not match this level grid.");
    }
    const valid = new Set(TILE_IDS.filter((id) => id !== "erase"));
    const imported = data.tiles.map((id) => valid.has(id) ? id : null);
    if (!sameBoard(board, imported)) commitHistory(board.slice());
    board = imported;
    if (typeof data.name === "string" && data.name.trim()) levelNameInput.value = data.name.trim().slice(0, 48);
    updatePlacedCount();
    showToast("Level opened");
  } catch (error) {
    console.warn("Unable to open level file", error);
    showToast("Could not open that level file");
  } finally {
    fileInput.value = "";
  }
}

function bindCanvasInput(surface) {
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    painting = true;
    strokeStart = board.slice();
    strokeValue = event.button === 2 || event.shiftKey ? "erase" : selectedTile;
    hoverCell = cellFromPointer(event);
    paintCell(hoverCell);
    surface.setPointerCapture(event.pointerId);
  });
  surface.addEventListener("pointermove", (event) => {
    hoverCell = cellFromPointer(event);
    if (painting) paintCell(hoverCell);
  });
  surface.addEventListener("pointerup", finishStroke);
  surface.addEventListener("pointercancel", finishStroke);
  surface.addEventListener("lostpointercapture", finishStroke);
  surface.addEventListener("pointerleave", () => {
    if (!painting) hoverCell = null;
  });
  surface.addEventListener("contextmenu", (event) => event.preventDefault());
}

function gameUpdatePost() {
  updateCamera();
}

function gameUpdate() {}

function bindUI() {
  paletteGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".tile-button");
    if (button) chooseTile(button.dataset.kind);
  });
  undoButton.addEventListener("click", undo);
  redoButton.addEventListener("click", redo);
  document.querySelector("#export-button").addEventListener("click", exportLevel);
  document.querySelector("#open-button").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => importLevel(fileInput.files?.[0]));

  window.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
  });
}

async function start() {
  makePalette();
  renderPalette();
  chooseTile("grass");
  updatePlacedCount();
  document.querySelector("#dimension-label").textContent = `${COLS} × ${ROWS}`;
  bindUI();

  LJS.setCanvasPixelRatio(1);
  LJS.setShowSplashScreen(false);
  await LJS.engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, () => {}, [], engineRoot);
  engineCanvas = engineRoot.querySelector("canvas");
  if (engineCanvas) bindCanvasInput(playfield);
}

function gameInit() {
  updateCamera();
}

start();
