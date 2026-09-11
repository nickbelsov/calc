const $ = id => document.getElementById(id);

const baseNames = {
  ground: "Грунт / земля",
  concrete: "Бетон",
  roof: "Кровля / гидроизоляция"
};

let lastModel = null;

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
  for (let i = 0; i <= intervals; i++) positions.push(i * step);
  return { intervals, count: intervals + 1, step, positions, houseOffsetApplied: false };
}

function equalLayoutWithHouseOffset(length, maxSpacing, houseOffset, houseAtStart) {
  if (length <= houseOffset) return equalLayout(length, maxSpacing);
  const remaining = length - houseOffset;
  const intervals = Math.max(1, Math.ceil(remaining / maxSpacing));
  const step = remaining / intervals;
  const positions = [];

  if (houseAtStart) {
    positions.push(houseOffset);
    for (let i = 1; i <= intervals; i++) positions.push(houseOffset + i * step);
  } else {
    for (let i = 0; i <= intervals; i++) positions.push(i * step);
    positions[positions.length - 1] = length - houseOffset;
  }

  return { intervals, count: positions.length, step, positions, houseOffsetApplied: true, houseOffset };
}

function chooseBoardCombination(runLength) {
  const lengths = CONFIG.boardLengths;
  const maxPieces = Math.ceil(runLength / Math.min(...lengths)) + 2;
  let best = null;

  function walk(combo, sum, depth) {
    if (sum >= runLength) {
      const waste = sum - runLength;
      const candidate = { combo: [...combo], sum, waste, pieces: combo.length };
      if (!best || candidate.waste < best.waste || (candidate.waste === best.waste && candidate.pieces < best.pieces)) best = candidate;
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
  return mirrored ? seams.map(x => runLength - x).sort((a, b) => a - b) : seams;
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
  const regular = regularJoistPositions(run, maxStep).filter(p => !seamJoists.some(s => Math.abs(s - p) < 80));
  return { regular: uniquePositions(regular), seam: seamJoists, all: uniquePositions([...regular, ...seamJoists]) };
}

function houseAffectsAxis(direction, houseSide, axis) {
  if (axis === "across") {
    return direction === "l" ? ["top","bottom"].includes(houseSide) : ["left","right"].includes(houseSide);
  }
  return direction === "l" ? ["left","right"].includes(houseSide) : ["top","bottom"].includes(houseSide);
}

function houseAtAxisStart(direction, houseSide, axis) {
  if (axis === "across") return direction === "l" ? houseSide === "top" : houseSide === "left";
  return direction === "l" ? houseSide === "left" : houseSide === "top";
}

function addLine(parent, cls, direction, pos, axisLength, isRunAxis) {
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  const px = isRunAxis
    ? pos / axisLength * (direction === "l" ? w : h)
    : pos / axisLength * (direction === "l" ? h : w);

  const line = document.createElement("div");
  line.className = cls;

  if (isRunAxis) {
    if (direction === "l") Object.assign(line.style,{left:px+"px",top:"0",width:cls.includes("beltLine")?"4px":"2px",height:"100%"});
    else Object.assign(line.style,{top:px+"px",left:"0",height:cls.includes("beltLine")?"4px":"2px",width:"100%"});
  } else {
    if (direction === "l") Object.assign(line.style,{top:px+"px",left:"0",height:cls.includes("beltLine")?"4px":"2px",width:"100%"});
    else Object.assign(line.style,{left:px+"px",top:"0",width:cls.includes("beltLine")?"4px":"2px",height:"100%"});
  }
  parent.appendChild(line);
}

function renderPlan(model) {
  const terrace = $("terrace");
  terrace.innerHTML = "";

  const { run, across, direction, rowCount, rowSeams, joists, beltLayout, pileLayout, base } = model;
  const showBoards = $("showBoards").checked;
  const showJoists = $("showJoists").checked;
  const showBelts = $("showBelts").checked;
  const showPiles = $("showPiles").checked;

  if (showBelts) {
    for (const pos of beltLayout.positions) addLine(terrace,"beltLine",direction,pos,across,false);
  }

  if (showJoists) {
    for (const pos of joists.regular) addLine(terrace,"joistLine",direction,pos,run,true);
    for (const pos of joists.seam) addLine(terrace,"joistLine double",direction,pos,run,true);
  }

  if (showBoards) {
    const acrossPx = direction === "l" ? terrace.clientHeight : terrace.clientWidth;
    for (let i = 1; i < rowCount; i++) {
      const p = (i / rowCount) * acrossPx;
      const line = document.createElement("div");
      line.className = "boardLine";
      if (direction === "l") Object.assign(line.style,{left:"0",top:p+"px",width:"100%",height:"1px"});
      else Object.assign(line.style,{top:"0",left:p+"px",height:"100%",width:"1px"});
      terrace.appendChild(line);
    }

    const seamSet = uniquePositions(rowSeams.flat());
    for (const seam of seamSet) {
      const w = terrace.clientWidth, h = terrace.clientHeight;
      const p = seam / run * (direction === "l" ? w : h);
      const line = document.createElement("div");
      line.className = "seamLine";
      if (direction === "l") Object.assign(line.style,{top:"0",left:p+"px",height:"100%",width:"2px"});
      else Object.assign(line.style,{left:"0",top:p+"px",width:"100%",height:"2px"});
      terrace.appendChild(line);
    }
  }

  if (showPiles && base === "ground") {
    const w = terrace.clientWidth, h = terrace.clientHeight;
    for (const beltPos of beltLayout.positions) {
      for (const pilePos of pileLayout.positions) {
        const dot = document.createElement("div");
        dot.className = "pileDot";

        if (direction === "l") {
          dot.style.left = (pilePos / run * w) + "px";
          dot.style.top = (beltPos / across * h) + "px";
        } else {
          dot.style.left = (beltPos / across * w) + "px";
          dot.style.top = (pilePos / run * h) + "px";
        }

        terrace.appendChild(dot);
      }
    }
  }

  if (base === "ground" && showBelts && beltLayout.count > 1) {
    const label = document.createElement("div");
    label.className = "dimLabel";
    label.style.left = "8px";
    label.style.top = "8px";
    label.textContent = "пояс ≈ " + fmt(beltLayout.step) + " мм";
    terrace.appendChild(label);
  }

  if (base === "ground" && showPiles && pileLayout.count > 1) {
    const label = document.createElement("div");
    label.className = "dimLabel";
    label.style.right = "8px";
    label.style.bottom = "8px";
    label.textContent = "сваи ≈ " + fmt(pileLayout.step) + " мм";
    terrace.appendChild(label);
  }
}

function updateViewSize(L, W) {
  const t = $("terrace");
  const scale = Math.min(650 / L, 430 / W);
  t.style.width = Math.max(300, L * scale) + "px";
  t.style.height = Math.max(220, W * scale) + "px";
}

function calculate() {
  const L = +$("L").value || 6200;
  const W = +$("W").value || 3800;
  const direction = $("dir").value;
  const base = $("base").value;
  const boardModule = +$("boardModule").value || CONFIG.defaultBoardModule;
  const boardHeight = +$("boardHeight").value || 23;
  const hasHouse = $("hasHouse").checked;
  const houseSide = $("houseSide").value;

  const run = direction === "l" ? L : W;
  const across = direction === "l" ? W : L;

  const joistStep = joistStepByBoardHeight(boardHeight);
  const rowCount = Math.ceil(across / boardModule);
  const plan = chooseBoardCombination(run);

  const rowSeams = [];
  for (let r = 0; r < rowCount; r++) rowSeams.push(seamPositions(plan.actual, run, r % 2 === 1));

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

  const beltAffected = hasHouse && houseAffectsAxis(direction, houseSide, "across");
  const beltLayout = beltAffected
    ? equalLayoutWithHouseOffset(across, CONFIG.belt.maxSpacing, CONFIG.ground.houseOffset, houseAtAxisStart(direction, houseSide, "across"))
    : equalLayout(across, CONFIG.belt.maxSpacing);

  const beltLengthM = run / 1000;
  const beltMeters = beltLayout.count * beltLengthM;
  const beltBuy = stockPurchase(beltMeters);

  const pileAffected = hasHouse && houseAffectsAxis(direction, houseSide, "run");
  const pileLayout = pileAffected
    ? equalLayoutWithHouseOffset(run, CONFIG.ground.pileSpacingMax, CONFIG.ground.houseOffset, houseAtAxisStart(direction, houseSide, "run"))
    : equalLayout(run, CONFIG.ground.pileSpacingMax);

  const totalPiles = beltLayout.count * pileLayout.count;

  $("area").textContent = fmt(L * W / 1e6, 2) + " м²";
  $("baseOut").textContent = baseNames[base];
  $("rows").textContent = rowCount + " шт.";
  $("boardCount").textContent = boardsToBuy + " шт.";
  $("boardPlan").textContent = plan.combo.map(x => x / 1000 + " м").join(" + ");
  $("boardWaste").textContent = fmt(rawWaste / 1000, 2) + " м";
  $("seams").textContent = totalSeams + " шт.";

  $("joistStepOut").textContent = joistStep + " мм";
  $("regularJoists").textContent = joists.regular.length + " шт. / " + fmt(regularJoistMeters,1) + " м.п.";
  $("doubleJoists").textContent = joists.seam.length + " шт. / " + fmt(seamJoistMeters,1) + " м.п.";
  $("joists").textContent = fmt(totalJoistMeters,1) + " м.п.";
  $("joistPurchase").textContent = joistBuy.sticks + " хлыстов / " + fmt(joistBuy.meters) + " м";

  $("beltRows").textContent = beltLayout.count + " шт.";
  $("beltStepOut").textContent = beltLayout.houseOffsetApplied
    ? "400 мм от дома, далее ≈ " + fmt(beltLayout.step) + " мм"
    : fmt(beltLayout.step) + " мм";
  $("belt").textContent = fmt(beltMeters,1) + " м.п.";
  $("beltPurchase").textContent = beltBuy.sticks + " хлыстов / " + fmt(beltBuy.meters) + " м";

  if (base === "ground") {
    $("pilesPerBelt").textContent = pileLayout.count + " шт.";
    $("pileStepOut").textContent = pileLayout.houseOffsetApplied
      ? "400 мм от дома, далее ≈ " + fmt(pileLayout.step) + " мм"
      : fmt(pileLayout.step) + " мм";
    $("supports").textContent = totalPiles + " свай × 2500 мм";
    $("pileInfo").textContent =
      "Рядов пояса: " + beltLayout.count +
      ". На каждом поясе: " + pileLayout.count +
      " свай. Максимальный шаг — 1500 мм." +
      (hasHouse ? " Со стороны дома применяется отступ 400 мм." : "");
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

  $("tech").textContent = base === "ground"
    ? "ДПК → лаги 40×40×2 → пояс 80×80×2 → сваи 2500 мм. Металл закупается хлыстами по 6 м."
    : base === "roof"
      ? "Кровля / гидроизоляция: только регулируемые пластиковые опоры → металлический каркас → ДПК."
      : "Бетон: резиновые подкладки, арматурные штыри или регулируемые пластиковые опоры.";

  updateViewSize(L, W);

  lastModel = { run, across, direction, rowCount, rowSeams, joists, beltLayout, pileLayout, base };
  setTimeout(() => renderPlan(lastModel), 0);
}

function updateControls() {
  const base = $("base").value;
  $("ground").classList.toggle("hidden", base !== "ground");
  $("concrete").classList.toggle("hidden", base !== "concrete");
  $("houseControls").classList.toggle("hidden", !$("hasHouse").checked);
}

["L","W","dir","base","boardModule","boardHeight","hasHouse","houseSide"].forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener("input", () => { updateControls(); calculate(); });
    el.addEventListener("change", () => { updateControls(); calculate(); });
  }
});

["showBoards","showJoists","showBelts","showPiles"].forEach(id => {
  $(id).addEventListener("change", () => { if (lastModel) renderPlan(lastModel); });
});

$("calc").addEventListener("click", calculate);

updateControls();
calculate();