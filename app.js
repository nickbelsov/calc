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

function stockPurchase(meters) {
  const stockM = CONFIG.metal.stockLength / 1000;
  const sticks = Math.ceil(meters / stockM);
  return { sticks, meters: sticks * stockM };
}

function joistStepByBoardHeight(height) {
  return height <= CONFIG.joist.stepByBoardHeight.thinMaxHeight
    ? CONFIG.joist.stepByBoardHeight.thinStep
    : CONFIG.joist.stepByBoardHeight.thickStep;
}

function equalLayout(length, maxSpacing) {
  const intervals = Math.max(1, Math.ceil(length / maxSpacing));
  const step = length / intervals;
  const positions = [];

  for (let i = 0; i <= intervals; i++) {
    positions.push(i * step);
  }

  return {
    intervals,
    count: intervals + 1,
    step,
    positions
  };
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
        (candidate.waste === best.waste && candidate.pieces < best.pieces)
      ) best = candidate;
      return;
    }

    if (depth >= maxPieces) return;

    for (const len of lengths) {
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

  return mirrored
    ? seams.map(x => runLength - x).sort((a, b) => a - b)
    : seams;
}

function uniquePositions(values, tolerance = 2) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];

  for (const v of sorted) {
    if (!out.length || Math.abs(out[out.length - 1] - v) > tolerance) out.push(v);
  }

  return out;
}

function regularJoistPositions(run, maxStep) {
  const edge = Math.min(CONFIG.joist.maxEdgeCantilever, run / 2);
  const start = edge;
  const end = run - edge;

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
  const doubled = [];

  for (const seam of allSeams) {
    if (seam - seamOffset > 0) doubled.push(seam - seamOffset);
    if (seam + seamOffset < run) doubled.push(seam + seamOffset);
  }

  const seamJoists = uniquePositions(doubled);
  const regular = regularJoistPositions(run, maxStep)
    .filter(p => !seamJoists.some(s => Math.abs(s - p) < 80));

  return {
    regular: uniquePositions(regular),
    seam: seamJoists,
    all: uniquePositions([...regular, ...seamJoists])
  };
}

function renderPlan(model) {
  const terrace = $("terrace");
  terrace.innerHTML = "";

  const { run, direction, rowCount, rowSeams, joists } = model;
  const w = terrace.clientWidth;
  const h = terrace.clientHeight;
  const runPx = direction === "l" ? w : h;
  const acrossPx = direction === "l" ? h : w;

  for (let i = 1; i < rowCount; i++) {
    const p = (i / rowCount) * acrossPx;
    const line = document.createElement("div");
    line.className = "boardLine";

    if (direction === "l") {
      Object.assign(line.style, { left: "0", top: p + "px", width: "100%", height: "1px" });
    } else {
      Object.assign(line.style, { top: "0", left: p + "px", height: "100%", width: "1px" });
    }

    terrace.appendChild(line);
  }

  const seamSet = uniquePositions(rowSeams.flat());

  for (const seam of seamSet) {
    const p = seam / run * runPx;
    const line = document.createElement("div");
    line.className = "seamLine";

    if (direction === "l") {
      Object.assign(line.style, { top: "0", left: p + "px", height: "100%", width: "2px" });
    } else {
      Object.assign(line.style, { left: "0", top: p + "px", width: "100%", height: "2px" });
    }

    terrace.appendChild(line);
  }

  for (const pos of joists.seam) {
    const p = pos / run * runPx;
    const line = document.createElement("div");
    line.className = "joistLine";

    if (direction === "l") {
      Object.assign(line.style, { top: "0", left: p + "px", height: "100%", width: "3px" });
    } else {
      Object.assign(line.style, { left: "0", top: p + "px", width: "100%", height: "3px" });
    }

    terrace.appendChild(line);
  }
}

function updateViewSize(L, W) {
  const t = $("terrace");
  const scale = Math.min(650 / L, 430 / W);
  t.style.width = Math.max(300, L * scale) + "px";
  t.style.height = Math.max(220, W * scale) + "px";
}

function technologyText(base) {
  if (base === "ground") {
    return "ДПК → лаги 40×40×2 → пояс 80×80×2 → сваи 2500 мм. Пояса и сваи распределяются равномерно с шагом не более 1500 мм. Металл закупается хлыстами по 6 м.";
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
  const boardHeight = +$("boardHeight").value || 23;

  const run = direction === "l" ? L : W;
  const across = direction === "l" ? W : L;

  const joistStep = joistStepByBoardHeight(boardHeight);
  const rowCount = Math.ceil(across / boardModule);
  const plan = chooseBoardCombination(run);

  const rowSeams = [];
  for (let r = 0; r < rowCount; r++) {
    rowSeams.push(seamPositions(plan.actual, run, r % 2 === 1));
  }

  const allSeams = uniquePositions(rowSeams.flat());
  const joists = buildJoists(run, allSeams, joistStep);

  const joistLengthM = across / 1000;
  const regularJoistMeters = joists.regular.length * joistLengthM;
  const seamJoistMeters = joists.seam.length * joistLengthM;
  const totalJoistMeters = regularJoistMeters + seamJoistMeters;
  const joistBuy = stockPurchase(totalJoistMeters);

  const boardsToBuy = rowCount * plan.combo.length;
  const rawWaste = rowCount * plan.waste;
  const totalSeams = rowSeams.reduce((sum, row) => sum + row.length, 0);

  // Пояс 80×80 идёт перпендикулярно лагам.
  // Поэтому ряды пояса распределяются по длине лаги (across).
  const beltLayout = equalLayout(across, CONFIG.belt.maxSpacing);
  const beltLengthM = run / 1000;
  const beltMeters = beltLayout.count * beltLengthM;
  const beltBuy = stockPurchase(beltMeters);

  // Сваи стоят непосредственно под каждым поясом и
  // равномерно распределяются по всей длине пояса.
  const pileLayout = equalLayout(run, CONFIG.ground.pileSpacingMax);
  const totalPiles = beltLayout.count * pileLayout.count;

  $("area").textContent = fmt(L * W / 1e6, 2) + " м²";
  $("baseOut").textContent = baseNames[base];
  $("rows").textContent = fmt(rowCount) + " шт.";
  $("boardCount").textContent = fmt(boardsToBuy) + " шт.";
  $("boardPlan").textContent = plan.combo.map(x => x / 1000 + " м").join(" + ");
  $("boardWaste").textContent = fmt(rawWaste / 1000, 2) + " м";
  $("seams").textContent = fmt(totalSeams) + " шт.";

  $("joistStepOut").textContent = joistStep + " мм";
  $("regularJoists").textContent =
    fmt(joists.regular.length) + " шт. / " + fmt(regularJoistMeters, 1) + " м.п.";
  $("doubleJoists").textContent =
    fmt(joists.seam.length) + " шт. / " + fmt(seamJoistMeters, 1) + " м.п.";
  $("joists").textContent = fmt(totalJoistMeters, 1) + " м.п.";
  $("joistPurchase").textContent =
    joistBuy.sticks + " хлыстов / " + fmt(joistBuy.meters, 0) + " м";

  $("beltRows").textContent = beltLayout.count + " шт.";
  $("beltStepOut").textContent = fmt(beltLayout.step) + " мм";
  $("belt").textContent = fmt(beltMeters, 1) + " м.п.";
  $("beltPurchase").textContent =
    beltBuy.sticks + " хлыстов / " + fmt(beltBuy.meters, 0) + " м";

  if (base === "ground") {
    $("pilesPerBelt").textContent = pileLayout.count + " шт.";
    $("pileStepOut").textContent = fmt(pileLayout.step) + " мм";
    $("supports").textContent = totalPiles + " свай × 2500 мм";

    $("pileInfo").textContent =
      "Рядов пояса: " + beltLayout.count +
      ", шаг ≈ " + fmt(beltLayout.step) +
      " мм. На каждом поясе: " + pileLayout.count +
      " свай, шаг ≈ " + fmt(pileLayout.step) +
      " мм. Все интервалы равномерные и не превышают 1500 мм.";
  } else if (base === "roof") {
    $("pilesPerBelt").textContent = "—";
    $("pileStepOut").textContent = "—";
    $("supports").textContent = "Регулируемые пластиковые опоры";
    $("pileInfo").textContent = "Для кровли сваи не применяются.";
  } else {
    $("pilesPerBelt").textContent = "—";
    $("pileStepOut").textContent = "—";
    $("supports").textContent = "По выбранной технологии бетона";
    $("pileInfo").textContent = "Алгоритм бетонного основания будет рассчитан отдельно.";
  }

  $("tech").textContent = technologyText(base);

  updateViewSize(L, W);

  setTimeout(() => renderPlan({
    run,
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

["L", "W", "dir", "base", "boardModule", "boardHeight"].forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener("input", () => {
      updateBaseControls();
      calculate();
    });
  }
});

$("calc").addEventListener("click", calculate);

updateBaseControls();
calculate();