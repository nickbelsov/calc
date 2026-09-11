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
let polygonPoints = [
  {x:100,y:100},{x:900,y:100},{x:900,y:600},{x:100,y:600}
];
let polygonClosed = true;
let drawingPolygon = false;
let draggingVertex = -1;

function polygonArea(points){
  if(points.length<3) return 0;
  let sum=0;
  for(let i=0;i<points.length;i++){
    const a=points[i], b=points[(i+1)%points.length];
    sum += a.x*b.y - b.x*a.y;
  }
  return Math.abs(sum)/2;
}

function polygonBounds(points){
  if(!points.length) return {minX:0,maxX:1000,minY:0,maxY:700};
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  return {
    minX:Math.min(...xs), maxX:Math.max(...xs),
    minY:Math.min(...ys), maxY:Math.max(...ys)
  };
}

function svgToMm(point,bounds,L,W){
  const bw=Math.max(1,bounds.maxX-bounds.minX);
  const bh=Math.max(1,bounds.maxY-bounds.minY);
  return {
    x:(point.x-bounds.minX)/bw*L,
    y:(point.y-bounds.minY)/bh*W
  };
}

function getPolygonMetrics(){
  const L=+$("L").value||6200;
  const W=+$("W").value||3800;
  const b=polygonBounds(polygonPoints);
  const pxArea=polygonClosed?polygonArea(polygonPoints):0;
  const bw=Math.max(1,b.maxX-b.minX);
  const bh=Math.max(1,b.maxY-b.minY);
  return {
    areaM2:(pxArea/(bw*bh))*(L*W)/1e6,
    bboxL:L,bboxW:W,bounds:b
  };
}

function eventToSvg(svg,e){
  const pt=svg.createSVGPoint();
  pt.x=e.clientX; pt.y=e.clientY;
  const ctm=svg.getScreenCTM();
  return ctm ? pt.matrixTransform(ctm.inverse()) : {x:0,y:0};
}

function startDrawingPolygon(){
  polygonPoints=[];
  polygonClosed=false;
  drawingPolygon=true;
  draggingVertex=-1;
  renderPolygonEditor();
  calculate();
}

function closePolygon(){
  if(polygonPoints.length<3) return;
  polygonClosed=true;
  drawingPolygon=false;
  renderPolygonEditor();
  calculate();
}

function resetPolygon(){
  polygonPoints=[
    {x:100,y:100},{x:900,y:100},{x:900,y:600},{x:100,y:600}
  ];
  polygonClosed=true;
  drawingPolygon=false;
  renderPolygonEditor();
  calculate();
}

function polygonClipPath(){
  if(!polygonClosed || polygonPoints.length<3) return "none";
  return "polygon(" + polygonPoints.map(p=>
    (p.x/10).toFixed(3)+"% "+(p.y/7).toFixed(3)+"%"
  ).join(",") + ")";
}

function applyPolygonToTerrace(){
  const terrace=$("terrace");
  const layer=$("constructionLayer");
  const free=$("shapeMode").value==="free";

  terrace.classList.toggle("freeShape",free);

  if(free && polygonClosed && polygonPoints.length>=3){
    const clip=polygonClipPath();
    layer.style.clipPath=clip;
    layer.style.webkitClipPath=clip;
  }else{
    layer.style.clipPath="none";
    layer.style.webkitClipPath="none";
  }
}

function renderPolygonEditor(){
  const svg=$("polygonEditor");
  if(!svg || $("shapeMode").value!=="free") return;
  applyPolygonToTerrace();
  svg.innerHTML="";
  svg.classList.toggle("drawing",drawingPolygon);

  const ns="http://www.w3.org/2000/svg";

  if(polygonPoints.length>=2){
    const shape=document.createElementNS(ns,polygonClosed?"polygon":"polyline");
    shape.setAttribute("points",polygonPoints.map(p=>p.x+","+p.y).join(" "));
    shape.setAttribute("class",polygonClosed?"polygonFill":"openPolyline");
    svg.appendChild(shape);
  }

  const metrics=getPolygonMetrics();
  const b=metrics.bounds;
  const edgeCount=polygonClosed?polygonPoints.length:Math.max(0,polygonPoints.length-1);

  for(let i=0;i<edgeCount;i++){
    const p=polygonPoints[i];
    const next=polygonPoints[(i+1)%polygonPoints.length];
    const mx=(p.x+next.x)/2, my=(p.y+next.y)/2;

    if(polygonClosed){
      const add=document.createElementNS(ns,"circle");
      add.setAttribute("cx",mx); add.setAttribute("cy",my); add.setAttribute("r","13");
      add.setAttribute("class","addHandle");
      add.addEventListener("click",e=>{
        e.stopPropagation();
        polygonPoints.splice(i+1,0,{x:mx,y:my});
        renderPolygonEditor();
        calculate();
      });
      svg.appendChild(add);
    }

    if(polygonClosed){
      const m1=svgToMm(p,b,metrics.bboxL,metrics.bboxW);
      const m2=svgToMm(next,b,metrics.bboxL,metrics.bboxW);
      const length=Math.hypot(m2.x-m1.x,m2.y-m1.y);
      const label=document.createElementNS(ns,"text");
      label.setAttribute("x",mx); label.setAttribute("y",my-20);
      label.setAttribute("text-anchor","middle");
      label.setAttribute("class","edgeLabel");
      label.textContent=fmt(length)+" мм";
      label.addEventListener("click",e=>{
        e.stopPropagation();
        const raw=window.prompt("Длина ребра, мм",String(Math.round(length)));
        if(raw===null) return;
        const desired=Number(String(raw).replace(",","."));
        if(!Number.isFinite(desired)||desired<=0) return;
        const scale=desired/Math.max(1,length);
        const dx=next.x-p.x,dy=next.y-p.y;
        polygonPoints[(i+1)%polygonPoints.length]={
          x:Math.max(20,Math.min(980,p.x+dx*scale)),
          y:Math.max(20,Math.min(680,p.y+dy*scale))
        };
        renderPolygonEditor();
        calculate();
      });
      svg.appendChild(label);
    }
  }

  polygonPoints.forEach((p,i)=>{
    const c=document.createElementNS(ns,"circle");
    c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r",i===0&&drawingPolygon&&polygonPoints.length>=3?"20":"16");
    c.setAttribute("class","vertexHandle"+(i===0&&drawingPolygon&&polygonPoints.length>=3?" closeTarget":""));

    if(i===0&&drawingPolygon&&polygonPoints.length>=3){
      c.addEventListener("click",e=>{e.stopPropagation();closePolygon();});
    } else if(polygonClosed){
      c.addEventListener("pointerdown",e=>{
        e.preventDefault(); e.stopPropagation();
        draggingVertex=i;
        svg.setPointerCapture(e.pointerId);
      });
    }
    svg.appendChild(c);
  });
}

function installPolygonPointerHandlers(){
  const svg=$("polygonEditor");
  if(!svg||svg.dataset.handlersInstalled) return;
  svg.dataset.handlersInstalled="1";

  svg.addEventListener("click",e=>{
    if(!drawingPolygon || e.target.classList.contains("vertexHandle")) return;
    const loc=eventToSvg(svg,e);
    polygonPoints.push({
      x:Math.max(20,Math.min(980,loc.x)),
      y:Math.max(20,Math.min(680,loc.y))
    });
    renderPolygonEditor();
  });

  svg.addEventListener("pointermove",e=>{
    if(draggingVertex<0) return;
    const loc=eventToSvg(svg,e);
    polygonPoints[draggingVertex]={
      x:Math.max(20,Math.min(980,loc.x)),
      y:Math.max(20,Math.min(680,loc.y))
    };
    renderPolygonEditor();
    calculate();
  });

  const stop=e=>{
    draggingVertex=-1;
    try{if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);}catch(_){}
  };
  svg.addEventListener("pointerup",stop);
  svg.addEventListener("pointercancel",stop);
}

function getAllowedBoardLengths(){
  const values=[];
  if($("allow3000")?.checked) values.push(3000);
  if($("allow4000")?.checked) values.push(4000);
  if($("allow6000")?.checked) values.push(6000);
  return values;
}

function emptyBoardResult(message){
  return {
    rows:[],
    purchases:{3000:0,4000:0,6000:0},
    reusedPieces:0,
    finalWaste:0,
    offcuts:[],
    warning:message || "Не выбрана ни одна доступная длина доски."
  };
}

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

function chooseStockForRemaining(remaining, allowedLengths) {
  const sorted = [...allowedLengths].sort((a,b)=>a-b);
  if(!sorted.length) return null;
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

function chooseAlignedPattern(runLength, allowedLengths) {
  const lengths=[...allowedLengths].sort((a,b)=>a-b);
  let best=null;
  if(!lengths.length) return null;
  const maxPieces=Math.ceil(runLength/Math.min(...lengths))+2;

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

function buildRowsAligned(runLength,rowCount,allowedLengths){
  const pattern=chooseAlignedPattern(runLength,allowedLengths);
  if(!pattern) return emptyBoardResult();
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

function buildRowsSeamless(runLength,rowCount,allowedLengths){
  const purchases={3000:0,4000:0,6000:0};

  if(runLength>6000){
    const fallback=buildRowsOptimal(runLength,rowCount,allowedLengths);
    fallback.warning="Режим «Без стыков» невозможен: длина ряда больше 6000 мм. Временно показан оптимальный раскрой.";
    return fallback;
  }

  const stock=chooseStockForRemaining(runLength,allowedLengths);
  if(!stock || stock<runLength) {
    const fallback=buildRowsOptimal(runLength,rowCount,allowedLengths);
    fallback.warning="Режим «Без стыков» невозможен с выбранными длинами доски.";
    return fallback;
  }
  purchases[stock]=rowCount;
  const waste=(stock-runLength)*rowCount;
  const rows=Array.from({length:rowCount},()=>makeRowFromLengths([runLength]));

  return {rows,purchases,reusedPieces:0,finalWaste:waste,offcuts:[],warning:""};
}

function packPiecesIntoStock(pieceLengths,allowedLengths){
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

    const stock=chooseStockForRemaining(piece,allowedLengths);
    if(!stock) return emptyBoardResult();
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

function buildRowsHalf(runLength,rowCount,allowedLengths){
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
  const packed=packPiecesIntoStock(allPieceLengths,allowedLengths);

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

function buildRowsOptimal(runLength,rowCount,allowedLengths){
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

      const stock=chooseStockForRemaining(remaining,allowedLengths);
      if(!stock) return emptyBoardResult();
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

function buildBoardRows(runLength,rowCount,mode,allowedLengths){
  if(!allowedLengths.length) return emptyBoardResult();
  if(mode==="aligned") return buildRowsAligned(runLength,rowCount,allowedLengths);
  if(mode==="half") return buildRowsHalf(runLength,rowCount,allowedLengths);
  if(mode==="seamless") return buildRowsSeamless(runLength,rowCount,allowedLengths);
  return buildRowsOptimal(runLength,rowCount,allowedLengths);
}

function polygonScanlineSegments(axisValue,direction,L,W){
  if(!polygonClosed||polygonPoints.length<3) return [];
  const b=polygonBounds(polygonPoints);
  const bw=Math.max(1,b.maxX-b.minX), bh=Math.max(1,b.maxY-b.minY);
  const scan = direction==="l"
    ? b.minY + (axisValue/W)*bh
    : b.minX + (axisValue/L)*bw;

  const hits=[];
  for(let i=0;i<polygonPoints.length;i++){
    const a=polygonPoints[i], c=polygonPoints[(i+1)%polygonPoints.length];
    if(direction==="l"){
      if((a.y<=scan&&c.y>scan)||(c.y<=scan&&a.y>scan)){
        const t=(scan-a.y)/(c.y-a.y);
        hits.push(a.x+t*(c.x-a.x));
      }
    }else{
      if((a.x<=scan&&c.x>scan)||(c.x<=scan&&a.x>scan)){
        const t=(scan-a.x)/(c.x-a.x);
        hits.push(a.y+t*(c.y-a.y));
      }
    }
  }
  hits.sort((a,b)=>a-b);

  const segments=[];
  for(let i=0;i+1<hits.length;i+=2){
    const startPx=hits[i],endPx=hits[i+1];
    if(endPx-startPx<0.5) continue;
    if(direction==="l"){
      segments.push({
        start:(startPx-b.minX)/bw*L,
        length:(endPx-startPx)/bw*L
      });
    }else{
      segments.push({
        start:(startPx-b.minY)/bh*W,
        length:(endPx-startPx)/bh*W
      });
    }
  }
  return segments;
}

function mergePurchases(target,source){
  [3000,4000,6000].forEach(k=>target[k]=(target[k]||0)+(source[k]||0));
}

function buildPolygonBoardRows(L,W,direction,boardModule,mode,allowedLengths){
  const across=direction==="l"?W:L;
  const rowCount=Math.ceil(across/boardModule);
  const rows=[];
  const purchases={3000:0,4000:0,6000:0};
  let reusedPieces=0,finalWaste=0;
  const offcuts=[];
  let warning="";

  for(let r=0;r<rowCount;r++){
    const axis=Math.min(across-0.001,(r+0.5)*boardModule);
    const spans=polygonScanlineSegments(axis,direction,L,W);
    const row={axis,segments:[],seams:[]};

    for(const span of spans){
      const built=buildBoardRows(span.length,1,mode,allowedLengths);
      if(built.warning&&!warning) warning=built.warning;
      if(!built.rows.length) continue;
      const local=built.rows[0];
      row.segments.push({start:span.start,length:span.length,pieces:local.pieces,seams:local.seams});
      local.seams.forEach(s=>row.seams.push(span.start+s));
      mergePurchases(purchases,built.purchases);
      reusedPieces+=built.reusedPieces||0;
      finalWaste+=built.finalWaste||0;
      if(built.offcuts) offcuts.push(...built.offcuts);
    }
    rows.push(row);
  }

  return {rows,purchases,reusedPieces,finalWaste,offcuts,warning,polygon:true};
}

function getLongestPolygonSegment(boardRows){
  if(!boardRows?.polygon) return null;
  let best=null;

  for(const row of boardRows.rows){
    for(const seg of row.segments||[]){
      if(!best || seg.length>best.length){
        best={
          start:seg.start,
          length:seg.length
        };
      }
    }
  }

  return best;
}

function getPolygonSeamPatterns(boardRows, mode){
  const master=getLongestPolygonSegment(boardRows);
  if(!master) return {even:[],odd:[],all:[]};

  const start=master.start;
  const len=master.length;

  if(mode==="half"){
    // Равномерная шахматка:
    // чётные ряды: 1/2 + 1/2
    // нечётные: 1/4 + 1/2 + 1/4
    const even=[start+len/2];
    const odd=[start+len/4,start+3*len/4];

    return {
      even,
      odd,
      all:uniquePositions([...even,...odd])
    };
  }

  // Для остальных режимов пока сохраняем единую систему осей
  // по самому длинному ряду.
  let bestRowSegment=null;
  for(const row of boardRows.rows){
    for(const seg of row.segments||[]){
      if(!bestRowSegment || seg.length>bestRowSegment.length) bestRowSegment=seg;
    }
  }

  const common=bestRowSegment
    ? (bestRowSegment.seams||[]).map(x=>bestRowSegment.start+x)
    : [];

  return {even:common,odd:common,all:uniquePositions(common)};
}

function applyPolygonSeamPatterns(boardRows, patterns){
  if(!boardRows?.polygon) return boardRows;

  boardRows.rows.forEach((row,rowIndex)=>{
    const axes=(rowIndex%2===0 ? patterns.even : patterns.odd) || [];
    const nextSegments=[];

    for(const seg of row.segments||[]){
      const inside=axes
        .filter(x=>x>seg.start+1 && x<seg.start+seg.length-1)
        .sort((a,b)=>a-b);

      const cuts=[seg.start,...inside,seg.start+seg.length];
      const pieces=[];
      const seams=[];

      for(let i=0;i<cuts.length-1;i++){
        const len=cuts[i+1]-cuts[i];
        pieces.push({length:len,sourceLength:len,reused:false});
        if(i<cuts.length-2) seams.push(cuts[i+1]-seg.start);
      }

      nextSegments.push({
        start:seg.start,
        length:seg.length,
        pieces,
        seams
      });
    }

    row.segments=nextSegments;
    row.seams=[];
    for(const seg of nextSegments){
      for(const seam of seg.seams) row.seams.push(seg.start+seam);
    }
  });

  return boardRows;
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

function buildPolygonBeltsAndPiles(L,W,direction,beltPositions,hasHouse,houseSide){
  const run=direction==="l"?L:W;
  const belts=[];
  let beltMeters=0;
  let totalPiles=0;
  let maxPilesPerBelt=0;
  const pileSteps=[];

  const pileAffected=hasHouse && houseAffectsAxis(direction,houseSide,"run");
  const houseAtStart=houseAtAxisStart(direction,houseSide,"run");

  for(const beltPos of beltPositions){
    const spans=polygonScanlineSegments(beltPos,direction,L,W);
    const segments=[];

    for(const span of spans){
      const layout=pileAffected
        ? equalLayoutWithHouseOffset(
            span.length,
            CONFIG.ground.pileSpacingMax,
            CONFIG.ground.houseOffset,
            houseAtStart
          )
        : equalLayout(span.length,CONFIG.ground.pileSpacingMax);

      const piles=layout.positions.map(p=>span.start+p);

      segments.push({
        start:span.start,
        length:span.length,
        piles,
        pileStep:layout.step,
        houseOffsetApplied:layout.houseOffsetApplied
      });

      beltMeters+=span.length/1000;
      totalPiles+=piles.length;
      maxPilesPerBelt=Math.max(maxPilesPerBelt,piles.length);
      if(layout.step) pileSteps.push(layout.step);
    }

    belts.push({axis:beltPos,segments});
  }

  return {
    belts,
    beltMeters,
    totalPiles,
    maxPilesPerBelt,
    minPileStep:pileSteps.length?Math.min(...pileSteps):0,
    maxPileStep:pileSteps.length?Math.max(...pileSteps):0
  };
}

function addBeltSegment(parent,direction,axis,across,start,length,run){
  const w=parent.clientWidth;
  const h=parent.clientHeight;
  const line=document.createElement("div");
  line.className="beltLine";

  if(direction==="l"){
    Object.assign(line.style,{
      left:(start/run*w)+"px",
      width:Math.max(1,length/run*w)+"px",
      top:(axis/across*h)+"px",
      height:"4px"
    });
  }else{
    Object.assign(line.style,{
      top:(start/run*h)+"px",
      height:Math.max(1,length/run*h)+"px",
      left:(axis/across*w)+"px",
      width:"4px"
    });
  }

  parent.appendChild(line);
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

function renderBoardRows(parent,model){
  const {direction,run,across,boardRows}=model;
  const w=parent.clientWidth,h=parent.clientHeight;

  if(boardRows.polygon){
    boardRows.rows.forEach(row=>{
      const rowStart=Math.max(0,(row.axis-CONFIG.defaultBoardModule/2)/across);
      const rowHeight=Math.min(1,CONFIG.defaultBoardModule/across);

      row.segments.forEach(seg=>{
        let cursor=seg.start;
        seg.pieces.forEach(piece=>{
          const el=document.createElement("div");
          el.className="boardPiece"+(piece.reused?" alt":"");
          const a=cursor/run,b=(cursor+piece.length)/run;

          if(direction==="l"){
            Object.assign(el.style,{
              left:(a*w)+"px",width:Math.max(1,(b-a)*w)+"px",
              top:(rowStart*h)+"px",height:Math.max(2,rowHeight*h)+"px"
            });
          }else{
            Object.assign(el.style,{
              top:(a*h)+"px",height:Math.max(1,(b-a)*h)+"px",
              left:(rowStart*w)+"px",width:Math.max(2,rowHeight*w)+"px"
            });
          }
          parent.appendChild(el);
          cursor+=piece.length;
        });
      });
    });
    return;
  }

  const rowCount=boardRows.rows.length;
  boardRows.rows.forEach((row,rowIndex)=>{
    const rowStart=rowIndex/rowCount,rowEnd=(rowIndex+1)/rowCount;
    let cursor=0;
    row.pieces.forEach(piece=>{
      const el=document.createElement("div");
      el.className="boardPiece"+(piece.reused?" alt":"");
      const a=cursor/run,b=(cursor+piece.length)/run;
      if(direction==="l"){
        Object.assign(el.style,{left:(a*w)+"px",width:Math.max(1,(b-a)*w)+"px",top:(rowStart*h)+"px",height:Math.max(1,(rowEnd-rowStart)*h)+"px"});
      }else{
        Object.assign(el.style,{top:(a*h)+"px",height:Math.max(1,(b-a)*h)+"px",left:(rowStart*w)+"px",width:Math.max(1,(rowEnd-rowStart)*w)+"px"});
      }
      parent.appendChild(el);
      cursor+=piece.length;
    });
  });
}

function renderPlan(model){
  const terrace=$("terrace");
  const layer=$("constructionLayer");
  layer.innerHTML="";
  applyPolygonToTerrace();

  const {run,across,direction,joists,beltLayout,pileLayout,base,polygonStructure}=model;

  if(model.shapeMode==="free" && (!polygonClosed || polygonPoints.length<3)){
    layer.innerHTML="";
    return;
  }

  if($("showBelts").checked){
    if(model.shapeMode==="free" && polygonStructure){
      for(const belt of polygonStructure.belts){
        for(const seg of belt.segments){
          addBeltSegment(layer,direction,belt.axis,across,seg.start,seg.length,run);
        }
      }
    }else{
      for(const pos of beltLayout.positions) addLine(layer,"beltLine",direction,pos,across,false);
    }
  }

  if($("showJoists").checked){
    for(const pos of joists.regular) addLine(layer,"joistLine",direction,pos,run,true);
    for(const pos of joists.seam) addLine(layer,"joistLine",direction,pos,run,true);
  }

  if($("showBoards").checked) renderBoardRows(layer,model);

  if($("showPiles").checked && base==="ground"){
    const w=layer.clientWidth;
    const h=layer.clientHeight;

    if(model.shapeMode==="free" && polygonStructure){
      for(const belt of polygonStructure.belts){
        for(const seg of belt.segments){
          for(const pilePos of seg.piles){
            const dot=document.createElement("div");
            dot.className="pileDot";

            if(direction==="l"){
              dot.style.left=(pilePos/run*w)+"px";
              dot.style.top=(belt.axis/across*h)+"px";
            }else{
              dot.style.left=(belt.axis/across*w)+"px";
              dot.style.top=(pilePos/run*h)+"px";
            }

            layer.appendChild(dot);
          }
        }
      }
    }else{
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

          layer.appendChild(dot);
        }
      }
    }
  }
}

function renderRowPlans(boardRows){
  const box=$("rowPlans");
  box.innerHTML="";
  const nonEmpty=boardRows.rows.filter(r=>boardRows.polygon ? r.segments.length : true);
  const maxShown=Math.min(nonEmpty.length,12);

  for(let i=0;i<maxShown;i++){
    const row=nonEmpty[i];
    const div=document.createElement("div");
    div.className="rowPlan";
    let pieces;

    if(boardRows.polygon){
      pieces=row.segments.map(seg=>
        seg.pieces.map(p=>fmt(p.length)+" мм").join(" + ")
      ).join("  |  ");
    }else{
      pieces=row.pieces.map(p=>(p.reused?"остаток ":"")+fmt(p.length)+" мм").join(" + ");
    }

    div.innerHTML="<span>Ряд "+(i+1)+"</span><b>"+pieces+"</b>";
    box.appendChild(div);
  }

  if(nonEmpty.length>maxShown){
    const div=document.createElement("div");
    div.className="rowPlan";
    div.innerHTML="<span>…</span><b>ещё "+(nonEmpty.length-maxShown)+" рядов</b>";
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
  const shapeMode=$("shapeMode").value;
  const direction=$("dir").value;
  const layoutMode=$("layoutMode").value;
  const base=$("base").value;
  const boardModule=+$("boardModule").value||CONFIG.defaultBoardModule;
  const boardHeight=+$("boardHeight").value||23;
  const hasHouse=$("hasHouse").checked;
  const houseSide=$("houseSide").value;
  const allowedLengths=getAllowedBoardLengths();

  const run=direction==="l"?L:W;
  const across=direction==="l"?W:L;

  const joistStep=joistStepByBoardHeight(boardHeight);
  const rowCount=Math.ceil(across/boardModule);
  let boardRows = shapeMode==="free" && polygonClosed
    ? buildPolygonBoardRows(L,W,direction,boardModule,layoutMode,allowedLengths)
    : buildBoardRows(run,rowCount,layoutMode,allowedLengths);

  let seamPatterns={even:[],odd:[],all:[]};
  let allSeams=[];

  if(shapeMode==="free" && boardRows.polygon){
    seamPatterns=getPolygonSeamPatterns(boardRows,layoutMode);
    boardRows=applyPolygonSeamPatterns(boardRows,seamPatterns);
    allSeams=seamPatterns.all;
  }else{
    allSeams=uniquePositions((boardRows.rows||[]).flatMap(r=>r.seams));
  }

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

  let polygonStructure=null;
  let beltMeters=0;
  let pileLayout=null;
  let totalPiles=0;

  if(shapeMode==="free" && polygonClosed){
    polygonStructure=buildPolygonBeltsAndPiles(
      L,W,direction,beltLayout.positions,hasHouse,houseSide
    );
    beltMeters=polygonStructure.beltMeters;
    totalPiles=polygonStructure.totalPiles;
  }else{
    const beltLengthM=run/1000;
    beltMeters=beltLayout.count*beltLengthM;

    const pileAffected=hasHouse && houseAffectsAxis(direction,houseSide,"run");
    pileLayout=pileAffected
      ? equalLayoutWithHouseOffset(run,CONFIG.ground.pileSpacingMax,CONFIG.ground.houseOffset,houseAtAxisStart(direction,houseSide,"run"))
      : equalLayout(run,CONFIG.ground.pileSpacingMax);

    totalPiles=beltLayout.count*pileLayout.count;
  }

  const beltBuy=stockPurchase(beltMeters);

  const shapeMetrics = shapeMode==="free" ? getPolygonMetrics() : {areaM2:L*W/1e6,bboxL:L,bboxW:W};
  $("area").textContent=fmt(shapeMetrics.areaM2,2)+" м²";
  $("bboxOut").textContent=fmt(shapeMetrics.bboxL)+" × "+fmt(shapeMetrics.bboxW)+" мм";
  $("baseOut").textContent=baseNames[base];
  $("layoutModeOut").textContent=layoutNames[layoutMode];
  $("allowedLengthsOut").textContent=allowedLengths.length
    ? allowedLengths.map(x=>x/1000+" м").join(" / ")
    : "не выбраны";

  const warning=$("layoutWarning");
  const freeWarning = shapeMode==="free" && !polygonClosed
    ? "Замкните контур кликом по первой точке — после этого начнётся расчёт раскладки внутри формы."
    : shapeMode==="free"
      ? (layoutMode==="half"
          ? "Шахматка привязана к самому длинному непрерывному ряду: чётные ряды имеют один шов по центру, нечётные — швы на 1/4 и 3/4. Эти три оси профиля 40×40×2 проходят через всю площадку. Пояс 80×80 и сваи уже обрезаются по реальному контуру."
          : "Для произвольной формы оси стыков берутся по самому длинному непрерывному ряду и протягиваются через всю площадку. Пояс 80×80 и сваи уже обрезаются по реальному контуру.")
      : "";
  warning.textContent=[boardRows.warning,freeWarning].filter(Boolean).join(" ");
  warning.classList.toggle("hidden",!warning.textContent);

  $("rows").textContent=boardRows.rows.length ? rowCount+" шт." : "—";
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
    if(shapeMode==="free" && polygonStructure){
      $("pilesPerBelt").textContent="по фактическим участкам";
      $("pileStepOut").textContent=polygonStructure.maxPileStep
        ? "до "+fmt(polygonStructure.maxPileStep)+" мм"
        : "—";
      $("supports").textContent=totalPiles+" свай × 2500 мм";
      $("pileInfo").textContent=
        "Пояс 80×80×2 обрезан по реальному контуру. Сваи расставлены отдельно на каждом фактическом участке пояса с равномерным шагом не более 1500 мм."+
        (hasHouse?" Со стороны дома применяется отступ 400 мм.":"");
    }else{
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
    }
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
    ? "ДПК → профиль 40×40×2 → пояс 80×80×2 → сваи 2500 мм. Металл закупается хлыстами по 6 м."
    : base==="roof"
      ? "Кровля / гидроизоляция: только регулируемые пластиковые опоры → металлический каркас → ДПК."
      : "Бетон: резиновые подкладки, арматурные штыри или регулируемые пластиковые опоры.";

  updateViewSize(L,W);

  lastModel={run,across,direction,boardRows,joists,beltLayout,pileLayout,base,shapeMode,seamPatterns,polygonStructure};
  setTimeout(()=>{
    renderPlan(lastModel);
    if(shapeMode==="free") renderPolygonEditor();
  },0);
}

function updateControls(){
  const base=$("base").value;
  const layoutMode=$("layoutMode").value;

  $("ground").classList.toggle("hidden",base!=="ground");
  $("concrete").classList.toggle("hidden",base!=="concrete");
  $("houseControls").classList.toggle("hidden",!$("hasHouse").checked);
  const free=$("shapeMode").value==="free";
  $("rectControls").classList.toggle("hidden",false);
  $("freeControls").classList.toggle("hidden",!free);
  $("polygonEditor").classList.toggle("hidden",!free);
  applyPolygonToTerrace();
  if(free) setTimeout(renderPolygonEditor,0);
  const allowed=getAllowedBoardLengths();
  $("layoutHint").textContent=allowed.length
    ? (layoutHints[layoutMode]||"")
    : "Выберите хотя бы одну длину доски для расчёта.";
}

["L","W","shapeMode","dir","layoutMode","base","boardModule","boardHeight","hasHouse","houseSide","allow3000","allow4000","allow6000"].forEach(id=>{
  const el=$(id);
  if(el){
    el.addEventListener("input",()=>{updateControls();calculate();});
    el.addEventListener("change",()=>{updateControls();calculate();});
  }
});

["showBoards","showJoists","showBelts","showPiles"].forEach(id=>{
  $(id).addEventListener("change",()=>{if(lastModel)renderPlan(lastModel);});
});

$("drawPolygon")?.addEventListener("click",startDrawingPolygon);
$("resetPolygon")?.addEventListener("click",resetPolygon);
$("calc").addEventListener("click",calculate);

installPolygonPointerHandlers();
updateControls();
calculate();
function updatePanelToggleTitles(){
  const leftCollapsed=document.body.classList.contains("leftCollapsed");
  const rightCollapsed=document.body.classList.contains("rightCollapsed");
  const left=$("toggleLeft"),right=$("toggleRight");
  if(left){
    left.title=leftCollapsed?"Развернуть параметры":"Свернуть параметры";
    left.setAttribute("aria-label",left.title);
  }
  if(right){
    right.title=rightCollapsed?"Развернуть расчёт":"Свернуть расчёт";
    right.setAttribute("aria-label",right.title);
  }
}

$("toggleLeft")?.addEventListener("click",()=>{
  document.body.classList.toggle("leftCollapsed");
  localStorage.setItem("nimtechLeftCollapsed",document.body.classList.contains("leftCollapsed")?"1":"0");
  updatePanelToggleTitles();
  setTimeout(()=>{ if(lastModel) renderPlan(lastModel); },240);
});

$("toggleRight")?.addEventListener("click",()=>{
  document.body.classList.toggle("rightCollapsed");
  localStorage.setItem("nimtechRightCollapsed",document.body.classList.contains("rightCollapsed")?"1":"0");
  updatePanelToggleTitles();
  setTimeout(()=>{ if(lastModel) renderPlan(lastModel); },240);
});

if(localStorage.getItem("nimtechLeftCollapsed")==="1") document.body.classList.add("leftCollapsed");
if(localStorage.getItem("nimtechRightCollapsed")==="1") document.body.classList.add("rightCollapsed");
updatePanelToggleTitles();
