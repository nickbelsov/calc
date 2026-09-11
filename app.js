const $ = id => document.getElementById(id);

const baseNames = {
  ground: "Грунт / земля",
  concrete: "Бетон",
  roof: "Кровля / гидроизоляция"
};

const layoutNames = {
  optimal: "Оптимальный раскрой",
  aligned: "Стыки в одну линию",
  half: "Шахматка 1/2",
  seamless: "Без стыков"
};

const layoutHints = {
  optimal: "Минимизация отходов с повторным использованием остатков.",
  aligned: "Все торцевые стыки располагаются на одинаковых осях.",
  half: "Чётные ряды: 1/2 + 1/2 пролёта. Нечётные: 1/4 + 1/2 + 1/4.",
  seamless: "Каждый ряд выполняется одной доской. Возможен только при длине ряда до 6000 мм."
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

function chooseStockForRemaining(remaining) {
  const sorted = [...CONFIG.boardLengths].sort((a,b)=>a-b);
  return sorted.find(x=>x>=remaining) || sorted[sorted.length-1];
}

function addPurchase(purchases, stock) {
  purchases[stock] = (purchases[stock] || 0) + 1;
}

function makeRowFromLengths(lengths, reusedFlags = []) {
  const pieces = lengths.map((length,i)=>({
    length,
    sourceLength:length,
    reused:!!reusedFlags[i]
  }));
  let x=0;
  const seams=[];
  for(let i=0;i<pieces.length-1;i++){
    x+=pieces[i].length;
    seams.push(x);
  }
  return {pieces,seams};
}

function chooseAlignedPattern(runLength) {
  const lengths=[...CONFIG.boardLengths].sort((a,b)=>a-b);
  let best=null;
  const maxPieces=Math.ceil(runLength/3000)+2;

  function walk(combo,sum,depth){
    if(sum>=runLength){
      const waste=sum-runLength;
      const cand={combo:[...combo],sum,waste,pieces:combo.length};
      if(!best || cand.waste<best.waste || (cand.waste===best.waste && cand.pieces<best.pieces)) best=cand;
      return;
    }
    if(depth>=maxPieces) return;
    for(const len of lengths){
      combo.push(len);
      walk(combo,sum+len,depth+1);
      combo.pop();
    }
  }

  walk([],0,0);

  const actual=[...best.combo];
  if(best.waste>0) actual[actual.length-1]-=best.waste;
  return {...best,actual};
}

function buildRowsAligned(runLength,rowCount){
  const pattern=chooseAlignedPattern(runLength);
  const purchases={3000:0,4000:0,6000:0};

  pattern.combo.forEach(stock=>{
    purchases[stock]=(purchases[stock]||0)+rowCount;
  });

  const rows=[];
  for(let r=0;r<rowCount;r++) rows.push(makeRowFromLengths(pattern.actual));

  return {
    rows,purchases,reusedPieces:0,
    finalWaste:pattern.waste*rowCount,
    offcuts:[],
    warning:""
  };
}

function buildRowsSeamless(runLength,rowCount){
  const purchases={3000:0,4000:0,6000:0};

  if(runLength>6000){
    const fallback=buildRowsOptimal(runLength,rowCount);
    fallback.warning="Режим «Без стыков» невозможен: длина ряда больше 6000 мм. Временно показан оптимальный раскрой.";
    return fallback;
  }

  const stock=chooseStockForRemaining(runLength);
  purchases[stock]=rowCount;
  const waste=(stock-runLength)*rowCount;
  const rows=Array.from({length:rowCount},()=>makeRowFromLengths([runLength]));

  return {rows,purchases,reusedPieces:0,finalWaste:waste,offcuts:[],warning:""};
}

function packPiecesIntoStock(pieceLengths){
  const purchases={3000:0,4000:0,6000:0};
  const bins=[];
  let reusedPieces=0;

  const pieces=[...pieceLengths].sort((a,b)=>b-a);

  for(const piece of pieces){
    let bestBin=-1;
    let bestRemaining=Infinity;

    for(let i=0;i<bins.length;i++){
      if(bins[i].remaining>=piece){
        const after=bins[i].remaining-piece;
        if(after<bestRemaining){
          bestRemaining=after;
          bestBin=i;
        }
      }
    }

    if(bestBin>=0){
      bins[bestBin].remaining-=piece;
      reusedPieces++;
      continue;
    }

    const stock=chooseStockForRemaining(piece);
    addPurchase(purchases,stock);
    bins.push({stock,remaining:stock-piece});
  }

  const offcuts=bins.map(b=>b.remaining).filter(x=>x>0.5).sort((a,b)=>b-a);

  return {
    purchases,
    reusedPieces,
    finalWaste:offcuts.reduce((a,b)=>a+b,0),
    offcuts
  };
}

function buildRowsHalf(runLength,rowCount){
  const rows=[];
  const allPieceLengths=[];

  const half=runLength/2;
  const quarter=runLength/4;

  for(let r=0;r<rowCount;r++){
    const lengths = r%2===0
      ? [half, half]
      : [quarter, half, quarter];

    rows.push(makeRowFromLengths(lengths));
    allPieceLengths.push(...lengths);
  }

  // Закупку под геометрическую шахматку считаем отдельно:
  // детали упаковываются в доступные доски 3/4/6 м с повторным использованием остатков.
  const packed=packPiecesIntoStock(allPieceLengths);

  return {
    rows,
    purchases:packed.purchases,
    reusedPieces:packed.reusedPieces,
    finalWaste:packed.finalWaste,
    offcuts:packed.offcuts,
    warning:"Шахматка: ряд A = 1/2 + 1/2; ряд B = 1/4 + 1/2 + 1/4."
  };
}

function takeBestOffcut(offcuts,remaining){
  let bestIndex=-1;
  let bestScore=Infinity;
  for(let i=0;i<offcuts.length;i++){
    const len=offcuts[i];
    if(len<=0) continue;
    const used=Math.min(len,remaining);
    const remainder=remaining-used;
    const score=remainder===0?0:remainder+(len>remaining?len-remaining:0);
    if(score<bestScore){bestScore=score;bestIndex=i;}
  }
  return bestIndex;
}

function buildRowsOptimal(runLength,rowCount){
  const offcuts=[];
  const purchases={3000:0,4000:0,6000:0};
  const rows=[];
  let reusedPieces=0;

  for(let r=0;r<rowCount;r++){
    let remaining=runLength;
    const pieces=[];

    while(remaining>0.5){
      let usedFromOffcut=false;
      const idx=takeBestOffcut(offcuts,remaining);

      if(idx>=0){
        const available=offcuts[idx];
        if(available>=remaining || remaining>3000){
          const used=Math.min(available,remaining);
          pieces.push({length:used,sourceLength:available,reused:true});
          reusedPieces++;
          if(available>used+0.5) offcuts[idx]=available-used;
          else offcuts.splice(idx,1);
          remaining-=used;
          usedFromOffcut=true;
        }
      }

      if(usedFromOffcut) continue;

      const stock=chooseStockForRemaining(remaining);
      addPurchase(purchases,stock);
      const used=Math.min(stock,remaining);
      pieces.push({length:used,sourceLength:stock,reused:false});
      remaining-=used;

      const leftover=stock-used;
      if(leftover>0.5) offcuts.push(leftover);
    }

    if(r%2===1) pieces.reverse();

    let x=0;
    const seams=[];
    for(let i=0;i<pieces.length-1;i++){
      x+=pieces[i].length;
      seams.push(x);
    }
    rows.push({pieces,seams});
  }

  offcuts.sort((a,b)=>b-a);

  return {
    rows,purchases,reusedPieces,
    finalWaste:offcuts.reduce((a,b)=>a+b,0),
    offcuts,warning:""
  };
}

function buildBoardRows(runLength,rowCount,mode){
  if(mode==="aligned") return buildRowsAligned(runLength,rowCount);
  if(mode==="half") return buildRowsHalf(runLength,rowCount);
  if(mode==="seamless") return buildRowsSeamless(runLength,rowCount);
  return buildRowsOptimal(runLength,rowCount);
}

function uniquePositions(values,tolerance=2){
  const sorted=[...values].sort((a,b)=>a-b);
  const out=[];
  for(const v of sorted){
    if(!out.length || Math.abs(out[out.length-1]-v)>tolerance) out.push(v);
  }
  return out;
}

function regularJoistPositions(run,maxStep){
  const edge=Math.min(CONFIG.joist.maxEdgeCantilever,run/2);
  const start=edge;
  const end=run-edge;
  if(end<=start) return [run/2];

  const span=end-start;
  const intervals=Math.max(1,Math.ceil(span/maxStep));
  const step=span/intervals;
  const positions=[];

  for(let i=0;i<=intervals;i++) positions.push(start+step*i);
  return positions;
}

function buildJoists(run,allSeams,maxStep){
  const seamOffset=CONFIG.joist.seamOverhang;
  const doubled=[];

  for(const seam of allSeams){
    if(seam-seamOffset>0) doubled.push(seam-seamOffset);
    if(seam+seamOffset<run) doubled.push(seam+seamOffset);
  }

  const seamJoists=uniquePositions(doubled);
  const regular=regularJoistPositions(run,maxStep)
    .filter(p=>!seamJoists.some(s=>Math.abs(s-p)<80));

  return {
    regular:uniquePositions(regular),
    seam:seamJoists,
    all:uniquePositions([...regular,...seamJoists])
  };
}

function houseAffectsAxis(direction,houseSide,axis){
  if(axis==="across"){
    return direction==="l"?["top","bottom"].includes(houseSide):["left","right"].includes(houseSide);
  }
  return direction==="l"?["left","right"].includes(houseSide):["top","bottom"].includes(houseSide);
}

function houseAtAxisStart(direction,houseSide,axis){
  if(axis==="across") return direction==="l"?houseSide==="top":houseSide==="left";
  return direction==="l"?houseSide==="left":houseSide==="top";
}

function addLine(parent,cls,direction,pos,axisLength,isRunAxis){
  const w=parent.clientWidth;
  const h=parent.clientHeight;
  const px=isRunAxis
    ? pos/axisLength*(direction==="l"?w:h)
    : pos/axisLength*(direction==="l"?h:w);

  const line=document.createElement("div");
  line.className=cls;

  if(isRunAxis){
    if(direction==="l") Object.assign(line.style,{left:px+"px",top:"0",width:cls.includes("beltLine")?"4px":"2px",height:"100%"});
    else Object.assign(line.style,{top:px+"px",left:"0",height:cls.includes("beltLine")?"4px":"2px",width:"100%"});
  }else{
    if(direction==="l") Object.assign(line.style,{top:px+"px",left:"0",height:cls.includes("beltLine")?"4px":"2px",width:"100%"});
    else Object.assign(line.style,{left:px+"px",top:"0",width:cls.includes("beltLine")?"4px":"2px",height:"100%"});
  }

  parent.appendChild(line);
}

function renderBoardRows(terrace,model){
  const {direction,run,boardRows}=model;
  const w=terrace.clientWidth;
  const h=terrace.clientHeight;
  const rowCount=boardRows.rows.length;

  boardRows.rows.forEach((row,rowIndex)=>{
    const rowStart=rowIndex/rowCount;
    const rowEnd=(rowIndex+1)/rowCount;
    let cursor=0;

    row.pieces.forEach((piece,pieceIndex)=>{
      const el=document.createElement("div");
      el.className="boardPiece"+(piece.reused?" alt":"");

      const a=cursor/run;
      const b=(cursor+piece.length)/run;

      if(direction==="l"){
        Object.assign(el.style,{
          left:(a*w)+"px",width:Math.max(1,(b-a)*w)+"px",
          top:(rowStart*h)+"px",height:Math.max(1,(rowEnd-rowStart)*h)+"px"
        });
      }else{
        Object.assign(el.style,{
          top:(a*h)+"px",height:Math.max(1,(b-a)*h)+"px",
          left:(rowStart*w)+"px",width:Math.max(1,(rowEnd-rowStart)*w)+"px"
        });
      }

      terrace.appendChild(el);
      cursor+=piece.length;

    });
  });
}

function renderPlan(model){
  const terrace=$("terrace");
  terrace.innerHTML="";

  const {run,across,direction,joists,beltLayout,pileLayout,base}=model;

  if($("showBelts").checked){
    for(const pos of beltLayout.positions) addLine(terrace,"beltLine",direction,pos,across,false);
  }

  if($("showJoists").checked){
    for(const pos of joists.regular) addLine(terrace,"joistLine",direction,pos,run,true);
    for(const pos of joists.seam) addLine(terrace,"joistLine double",direction,pos,run,true);
  }

  if($("showBoards").checked) renderBoardRows(terrace,model);

  if($("showPiles").checked && base==="ground"){
    const w=terrace.clientWidth;
    const h=terrace.clientHeight;

    for(const beltPos of beltLayout.positions){
      for(const pilePos of pileLayout.positions){
        const dot=document.createElement("div");
        dot.className="pileDot";

        if(direction==="l"){
          dot.style.left=(pilePos/run*w)+"px";
          dot.style.top=(beltPos/across*h)+"px";
        }else{
          dot.style.left=(beltPos/across*w)+"px";
          dot.style.top=(pilePos/run*h)+"px";
        }

        terrace.appendChild(dot);
      }
    }
  }
}

function renderRowPlans(boardRows){
  const box=$("rowPlans");
  box.innerHTML="";

  const maxShown=Math.min(boardRows.rows.length,12);

  for(let i=0;i<maxShown;i++){
    const row=boardRows.rows[i];
    const div=document.createElement("div");
    div.className="rowPlan";

    const pieces=row.pieces.map(p=>
      (p.reused?"остаток ":"")+fmt(p.length)+" мм"
    ).join(" + ");

    div.innerHTML="<span>Ряд "+(i+1)+"</span><b>"+pieces+"</b>";
    box.appendChild(div);
  }

  if(boardRows.rows.length>maxShown){
    const div=document.createElement("div");
    div.className="rowPlan";
    div.innerHTML="<span>…</span><b>ещё "+(boardRows.rows.length-maxShown)+" рядов</b>";
    box.appendChild(div);
  }
}

function updateViewSize(L,W){
  const t=$("terrace");
  const scale=Math.min(650/L,430/W);
  t.style.width=Math.max(300,L*scale)+"px";
  t.style.height=Math.max(220,W*scale)+"px";
}

function calculate(){
  const L=+$("L").value||6200;
  const W=+$("W").value||3800;
  const direction=$("dir").value;
  const layoutMode=$("layoutMode").value;
  const base=$("base").value;
  const boardModule=+$("boardModule").value||CONFIG.defaultBoardModule;
  const boardHeight=+$("boardHeight").value||23;
  const hasHouse=$("hasHouse").checked;
  const houseSide=$("houseSide").value;

  const run=direction==="l"?L:W;
  const across=direction==="l"?W:L;

  const joistStep=joistStepByBoardHeight(boardHeight);
  const rowCount=Math.ceil(across/boardModule);
  const boardRows=buildBoardRows(run,rowCount,layoutMode);

  const allSeams=uniquePositions(boardRows.rows.flatMap(r=>r.seams));
  const joists=buildJoists(run,allSeams,joistStep);

  const joistLengthM=across/1000;
  const regularJoistMeters=joists.regular.length*joistLengthM;
  const seamJoistMeters=joists.seam.length*joistLengthM;
  const totalJoistMeters=regularJoistMeters+seamJoistMeters;
  const joistBuy=stockPurchase(totalJoistMeters);

  const totalBoards=Object.values(boardRows.purchases).reduce((a,b)=>a+b,0);
  const totalSeams=boardRows.rows.reduce((sum,row)=>sum+row.seams.length,0);

  const beltAffected=hasHouse && houseAffectsAxis(direction,houseSide,"across");
  const beltLayout=beltAffected
    ? equalLayoutWithHouseOffset(across,CONFIG.belt.maxSpacing,CONFIG.ground.houseOffset,houseAtAxisStart(direction,houseSide,"across"))
    : equalLayout(across,CONFIG.belt.maxSpacing);

  const beltLengthM=run/1000;
  const beltMeters=beltLayout.count*beltLengthM;
  const beltBuy=stockPurchase(beltMeters);

  const pileAffected=hasHouse && houseAffectsAxis(direction,houseSide,"run");
  const pileLayout=pileAffected
    ? equalLayoutWithHouseOffset(run,CONFIG.ground.pileSpacingMax,CONFIG.ground.houseOffset,houseAtAxisStart(direction,houseSide,"run"))
    : equalLayout(run,CONFIG.ground.pileSpacingMax);

  const totalPiles=beltLayout.count*pileLayout.count;

  $("area").textContent=fmt(L*W/1e6,2)+" м²";
  $("baseOut").textContent=baseNames[base];
  $("layoutModeOut").textContent=layoutNames[layoutMode];

  const warning=$("layoutWarning");
  warning.textContent=boardRows.warning||"";
  warning.classList.toggle("hidden",!boardRows.warning);

  $("rows").textContent=rowCount+" шт.";
  $("buy3000").textContent=(boardRows.purchases[3000]||0)+" шт.";
  $("buy4000").textContent=(boardRows.purchases[4000]||0)+" шт.";
  $("buy6000").textContent=(boardRows.purchases[6000]||0)+" шт.";
  $("boardCount").textContent=totalBoards+" шт.";
  $("reusedOffcuts").textContent=boardRows.reusedPieces+" шт.";
  $("boardWaste").textContent=fmt(boardRows.finalWaste/1000,2)+" м";
  $("seams").textContent=totalSeams+" шт.";
  renderRowPlans(boardRows);

  $("joistStepOut").textContent=joistStep+" мм";
  $("regularJoists").textContent=joists.regular.length+" шт. / "+fmt(regularJoistMeters,1)+" м.п.";
  $("doubleJoists").textContent=joists.seam.length+" шт. / "+fmt(seamJoistMeters,1)+" м.п.";
  $("joists").textContent=fmt(totalJoistMeters,1)+" м.п.";
  $("joistPurchase").textContent=joistBuy.sticks+" хлыстов / "+fmt(joistBuy.meters)+" м";

  $("beltRows").textContent=beltLayout.count+" шт.";
  $("beltStepOut").textContent=beltLayout.houseOffsetApplied
    ? "400 мм от дома, далее ≈ "+fmt(beltLayout.step)+" мм"
    : fmt(beltLayout.step)+" мм";
  $("belt").textContent=fmt(beltMeters,1)+" м.п.";
  $("beltPurchase").textContent=beltBuy.sticks+" хлыстов / "+fmt(beltBuy.meters)+" м";

  if(base==="ground"){
    $("pilesPerBelt").textContent=pileLayout.count+" шт.";
    $("pileStepOut").textContent=pileLayout.houseOffsetApplied
      ? "400 мм от дома, далее ≈ "+fmt(pileLayout.step)+" мм"
      : fmt(pileLayout.step)+" мм";
    $("supports").textContent=totalPiles+" свай × 2500 мм";
    $("pileInfo").textContent=
      "Рядов пояса: "+beltLayout.count+
      ". На каждом поясе: "+pileLayout.count+
      " свай. Максимальный шаг — 1500 мм."+
      (hasHouse?" Со стороны дома применяется отступ 400 мм.":"");
  }else if(base==="roof"){
    $("pilesPerBelt").textContent="—";
    $("pileStepOut").textContent="—";
    $("supports").textContent="Регулируемые пластиковые опоры";
    $("pileInfo").textContent="Для кровли сваи не применяются.";
  }else{
    $("pilesPerBelt").textContent="—";
    $("pileStepOut").textContent="—";
    $("supports").textContent="По выбранной технологии бетона";
    $("pileInfo").textContent="Алгоритм бетонного основания будет рассчитан отдельно.";
  }

  $("tech").textContent=base==="ground"
    ? "ДПК → лаги 40×40×2 → пояс 80×80×2 → сваи 2500 мм. Металл закупается хлыстами по 6 м."
    : base==="roof"
      ? "Кровля / гидроизоляция: только регулируемые пластиковые опоры → металлический каркас → ДПК."
      : "Бетон: резиновые подкладки, арматурные штыри или регулируемые пластиковые опоры.";

  updateViewSize(L,W);

  lastModel={run,across,direction,boardRows,joists,beltLayout,pileLayout,base};
  setTimeout(()=>renderPlan(lastModel),0);
}

function updateControls(){
  const base=$("base").value;
  const layoutMode=$("layoutMode").value;

  $("ground").classList.toggle("hidden",base!=="ground");
  $("concrete").classList.toggle("hidden",base!=="concrete");
  $("houseControls").classList.toggle("hidden",!$("hasHouse").checked);
  $("layoutHint").textContent=layoutHints[layoutMode]||"";
}

["L","W","dir","layoutMode","base","boardModule","boardHeight","hasHouse","houseSide"].forEach(id=>{
  const el=$(id);
  if(el){
    el.addEventListener("input",()=>{updateControls();calculate();});
    el.addEventListener("change",()=>{updateControls();calculate();});
  }
});

["showBoards","showJoists","showBelts","showPiles"].forEach(id=>{
  $(id).addEventListener("change",()=>{if(lastModel)renderPlan(lastModel);});
});

$("calc").addEventListener("click",calculate);

updateControls();
calculate();