const $ = id => document.getElementById(id);

const baseNames = {
  ground: "Грунт / земля",
  concrete: "Бетон",
  roof: "Кровля / гидроизоляция"
};

function fmt(n, digits = 0) {
  return Number(n).toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function chooseBoardCombination(runLength) {
  const lengths = CONFIG.boardLengths;
  const maxPieces = Math.ceil(runLength / Math.min(...lengths)) + 2;
  let best = null;

  function walk(combo, sum, depth) {
    if (sum >= runLength) {
      const waste = sum - runLength;
      const candidate = { combo: [...combo], sum, waste, pieces: combo.length };

      if (
        !best ||
        candidate.waste < best.waste ||
        (candidate.waste === best.waste && candidate.pieces < best.pieces) ||
        (candidate.waste === best.waste && candidate.pieces === best.pieces && candidate.sum < best.sum)
      ) {
        best = candidate;
      }
      return;
    }

    if (depth >= maxPieces) return;

    for (const len of lengths) {
      if (best && sum > runLength + best.waste) continue;
      combo.push(len);
      walk(combo, sum + len, depth + 1);
      combo.pop();
    }
  }

  walk([], 0, 0);

  const actual = [...best.combo];
  if (best.waste > 0) actual[actual.length - 1] -= best.waste;

  return { ...best, actual };
}

function seamPositions(actualPieces, runLength, mirrored = false) {
  const seams = [];
  let x = 0;
  for (let i = 0; i < actualPieces.length - 1; i++) {
    x += actualPieces[i];
    seams.push(x);
  }
  return mirrored ? seams.map(x => runLength - x).sort((a,b) => a-b) : seams;
}

function uniquePositions(values, tolerance = 2) {
  const sorted = [...values].sort((a,b)=>a-b);
  const out = [];
  for (const v of sorted) {
    if (!out.length || Math.abs(out[out.length - 1] - v) > tolerance) out.push(v);
  }
  return out;
}

function regularJoistPositions(run, maxStep) {
  const start = CONFIG.overhang.max;
  const end = run - CONFIG.overhang.max;
  if (end <= start) return [run / 2];

  const span = end - start;
  const intervals = Math.max(1, Math.ceil(span / maxStep));
  const step = span / intervals;

  const positions = [];
  for (let i = 0; i <= intervals; i++) positions.push(start + step * i);
  return positions;
}

function buildJoists(run, allSeams, maxStep) {
  const seamOffset = CONFIG.joist.seamOverhang;
  const doublePositions = [];

  for (const seam of allSeams) {
    if (seam - seamOffset > 0) doublePositions.push(seam - seamOffset);
    if (seam + seamOffset < run) doublePositions.push(seam + seamOffset);
  }

  const seamJoists = uniquePositions(doublePositions);
  const regular = regularJoistPositions(run, maxStep)
    .filter(p => !seamJoists.some(s => Math.abs(s - p) < 80));

  return {
    regular: uniquePositions(regular),
    seam: seamJoists,
    all: uniquePositions([...regular, ...seamJoists])
  };
}

function buildBelts(across, beltStep) {
  const edge = Math.min(CONFIG.overhang.max, across / 2);
  const span = Math.max(0, across - 2 * edge);
  const intervals = Math.max(1, Math.ceil(span / beltStep));
  const step = intervals ? span / intervals : 0;
  const positions = [];
  for (let i = 0; i <= intervals; i++) positions.push(edge + i * step);
  return positions;
}

function pileLayout(run, preferred) {
  const minS = CONFIG.ground.pileSpacingMin;
  const maxS = CONFIG.ground.pileSpacingMax;
  const minEdge = CONFIG.ground.minEdge;

  let count = Math.max(2, Math.ceil(run / preferred));

  while (count < 100) {
    const module = run / count;
    const edge = module / 2;
    if (module >= minS && module <= maxS && edge >= minEdge) {
      const positions = [];
      for (let i = 0; i < count; i++) positions.push(edge + i * module);
      return { count, module, edge, positions };
    }
    if (module > maxS) count++;
    else if (module < minS && count > 2) count--;
    else count++;
  }

  return { count: 0, module: 0, edge: 0, positions: [] };
}

function renderPlan(model) {
  const terrace = $("terrace");
  terrace.innerHTML = "";

  const { run, across, direction, rowCount, rowSeams, joists } = model;
  const w = terrace.clientWidth;
  const h = terrace.clientHeight;

  const runPx = direction === "l" ? w : h;
  const acrossPx = direction === "l" ? h : w;

  for (let i = 1; i < rowCount; i++) {
    const p = (i / rowCount) * acrossPx;
    const line = document.createElement("div");
    line.className = "boardLine";
    if (direction === "l") {
      Object.assign(line.style, {left:"0", top:p+"px", width:"100%", height:"1px"});
    } else {
      Object.assign(line.style, {top:"0", left:p+"px", height:"100%", width:"1px"});
    }
    terrace.appendChild(line);
  }

  const seamSet = uniquePositions(rowSeams.flat());
  for (const seam of seamSet) {
    const p = seam / run * runPx;
    const line = document.createElement("div");
    line.className = "seamLine";
    if (direction === "l") {
      Object.assign(line.style, {top:"0", left:p+"px", height:"100%", width:"2px"});
    } else {
      Object.assign(line.style, {left:"0", top:p+"px", width:"100%", height:"2px"});
    }
    terrace.appendChild(line);
  }

  for (const pos of joists.seam) {
    const p = pos / run * runPx;
    const line = document.createElement("div");
    line.className = "joistLine";
    if (direction === "l") {
      Object.assign(line.style, {top:"0", left:p+"px", height:"100%", width:"3px"});
    } else {
      Object.assign(line.style, {left:"0", top:p+"px", width:"100%", height:"3px"});
    }
    terrace.appendChild(line);
  }
}

function updateViewSize(L, W, direction) {
  const t = $("terrace");
  const scale = Math.min(650 / L, 430 / W);
  t.style.width = Math.max(300, L * scale) + "px";
  t.style.height = Math.max(220, W * scale) + "px";
}

function technologyText(base) {
  if (base === "ground") {
    return "Логика: раскладка ДПК → лаги 40×40×2 → опорный пояс 80×80×2 → винтовые сваи 2500 мм.";
  }
  if (base === "roof") {
    return "Кровля / гидроизоляция: только регулируемые пластиковые опоры → металлический каркас → ДПК.";
  }
  return "Бетон: резиновые подкладки, арматурные штыри или регулируемые пластиковые опоры.";
}

function calculate() {
  const L = +$("L").value || 6200;
  const W = +$("W").value || 3800;
  const direction = $("dir").value;
  const base = $("base").value;
  const boardModule = +$("boardModule").value || CONFIG.defaultBoardModule;
  const joistStep = +$("step").value || CONFIG.joist.defaultStep;
  const beltStep = +$("beltStep").value || CONFIG.belt.defaultStep;
  const pileTarget = +$("pileTarget").value || CONFIG.ground.preferredPileSpacing;

  const run = direction === "l" ? L : W;
  const across = direction === "l" ? W : L;

  const rowCount = Math.ceil(across / boardModule);
  const plan = chooseBoardCombination(run);

  const rowSeams = [];
  for (let r = 0; r < rowCount; r++) {
    rowSeams.push(seamPositions(plan.actual, run, r % 2 === 1));
  }

  const allSeams = uniquePositions(rowSeams.flat());
  const joists = buildJoists(run, allSeams, joistStep);
  const belts = buildBelts(across, beltStep);

  const joistLengthM = across / 1000;
  const regularJoistMeters = joists.regular.length * joistLengthM;
  const seamJoistMeters = joists.seam.length * joistLengthM;
  const totalJoistMeters = regularJoistMeters + seamJoistMeters;

  const beltLengthM = run / 1000;
  const beltMeters = belts.length * beltLengthM;

  const boardsToBuy = rowCount * plan.combo.length;
  const rawWaste = rowCount * plan.waste;
  const totalSeams = rowSeams.reduce((s, a) => s + a.length, 0);

  $("area").textContent = fmt(L * W / 1e6, 2) + " м²";
  $("baseOut").textContent = baseNames[base];
  $("rows").textContent = fmt(rowCount) + " шт.";
  $("boardCount").textContent = fmt(boardsToBuy) + " шт.";
  $("boardPlan").textContent = plan.combo.map(x => x/1000 + " м").join(" + ");
  $("boardWaste").textContent = fmt(rawWaste / 1000, 2) + " м";
  $("seams").textContent = fmt(totalSeams) + " шт.";

  $("regularJoists").textContent =
    fmt(joists.regular.length) + " шт. / " + fmt(regularJoistMeters, 1) + " м.п.";

  $("doubleJoists").textContent =
    fmt(joists.seam.length) + " шт. / " + fmt(seamJoistMeters, 1) + " м.п.";

  $("joists").textContent =
    fmt(joists.all.length) + " шт. / " + fmt(totalJoistMeters, 1) + " м.п.";

  $("belt").textContent =
    fmt(belts.length) + " шт. / " + fmt(beltMeters, 1) + " м.п.";

  if (base === "ground") {
    const pile = pileLayout(run, pileTarget);
    const totalPiles = pile.count * belts.length;

    $("supports").textContent = fmt(totalPiles) + " свай × 2500 мм";
    $("pileInfo").textContent =
      "На каждом поясе: " + pile.count +
      " свай. Равномерный модуль ≈ " + fmt(pile.module) +
      " мм, отступ крайних свай ≈ " + fmt(pile.edge) + " мм.";
  } else if (base === "roof") {
    $("supports").textContent = "Регулируемые пластиковые опоры";
    $("pileInfo").textContent = "Для кровли сваи не применяются.";
  } else {
    $("supports").textContent = "По выбранной технологии бетона";
    $("pileInfo").textContent = "Расчёт бетонных опор будет добавлен отдельным алгоритмом.";
  }

  $("tech").textContent = technologyText(base);

  updateViewSize(L, W, direction);

  setTimeout(() => renderPlan({
    run,
    across,
    direction,
    rowCount,
    rowSeams,
    joists
  }), 0);
}

function updateBaseControls() {
  const base = $("base").value;
  $("ground").classList.toggle("hidden", base !== "ground");
  $("concrete").classList.toggle("hidden", base !== "concrete");
}

["L","W","dir","base","boardModule","step","beltStep","pileTarget"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("input", () => {
    updateBaseControls();
    calculate();
  });
});

$("calc").addEventListener("click", calculate);

updateBaseControls();
calculate();