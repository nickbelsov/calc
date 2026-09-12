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
let projectZones = [];
let polygonPoints = [
  {x:0,y:0},{x:6200,y:0},{x:6200,y:3800},{x:0,y:3800}
];
let polygonClosed = true;
let drawingPolygon = false;
let draggingVertex = -1;
let polygonViewBoxLock = null;
const FREE_DRAW_VIEWBOX = {x:0,y:0,w:50000,h:35000}; // 50 × 35 м, координаты в мм.

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
  const b=polygonBounds(polygonPoints);
  const areaMm2=polygonClosed?polygonArea(polygonPoints):0;
  const bw=Math.max(1,b.maxX-b.minX);
  const bh=Math.max(1,b.maxY-b.minY);

  return {
    areaM2:areaMm2/1e6,
    bboxL:bw,
    bboxW:bh,
    bounds:b
  };
}

function eventToSvg(svg,e){
  const pt=svg.createSVGPoint();
  pt.x=e.clientX; pt.y=e.clientY;
  const ctm=svg.getScreenCTM();
  return ctm ? pt.matrixTransform(ctm.inverse()) : {x:0,y:0};
}

function startDrawingPolygon(){
  projectZones=[];
  polygonPoints=[];
  polygonClosed=false;
  drawingPolygon=true;
  draggingVertex=-1;
  polygonViewBoxLock=null;

  const terrace=$("terrace");
  const layer=$("constructionLayer");
  terrace.style.width="650px";
  terrace.style.height="430px";
  layer.innerHTML="";
  layer.style.clipPath="none";
  layer.style.webkitClipPath="none";

  renderPolygonEditor();
  resetCanvasView();
}

function closePolygon(){
  if(polygonPoints.length<3) return;
  polygonClosed=true;
  drawingPolygon=false;
  polygonViewBoxLock=null;
  calculate();
  setTimeout(fitCanvasView,40);
}

function resetPolygon(){
  projectZones=[];
  polygonPoints=[
    {x:0,y:0},{x:6200,y:0},{x:6200,y:3800},{x:0,y:3800}
  ];
  polygonClosed=true;
  drawingPolygon=false;
  draggingVertex=-1;
  polygonViewBoxLock=null;
  calculate();
  setTimeout(fitCanvasView,40);
}

function polygonClipPath(){
  if(!polygonClosed || polygonPoints.length<3) return "none";
  const b=polygonBounds(polygonPoints);
  const bw=Math.max(1,b.maxX-b.minX);
  const bh=Math.max(1,b.maxY-b.minY);
  return "polygon(" + polygonPoints.map(p=>
    (((p.x-b.minX)/bw)*100).toFixed(3)+"% "+
    (((p.y-b.minY)/bh)*100).toFixed(3)+"%"
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

function updatePolygonEditorViewBox(svg){
  if(polygonViewBoxLock){
    svg.setAttribute("viewBox",polygonViewBoxLock);
    return;
  }

  if(drawingPolygon || polygonPoints.length<2){
    const v=FREE_DRAW_VIEWBOX;
    svg.setAttribute("viewBox",v.x+" "+v.y+" "+v.w+" "+v.h);
    return;
  }

  const b=polygonBounds(polygonPoints);
  const bw=Math.max(1,b.maxX-b.minX);
  const bh=Math.max(1,b.maxY-b.minY);
  svg.setAttribute("viewBox",b.minX+" "+b.minY+" "+bw+" "+bh);
}

function renderPolygonEditor(){
  const svg=$("polygonEditor");
  if(!svg || $("shapeMode").value!=="free") return;
  updatePolygonEditorViewBox(svg);
  if(draggingVertex<0) applyPolygonToTerrace();
  svg.innerHTML="";
  svg.classList.toggle("drawing",drawingPolygon);

  const ns="http://www.w3.org/2000/svg";

  // Периметральный 80×80 рисуем в той же SVG-системе координат,
  // что и редактируемый контур. Так наклонные стороны не перекрываются
  // чёрной линией контура и остаются визуально видимыми.
  const perimeterBelts=lastModel?.shapeMode==="free"
    ? (lastModel?.polygonStructure?.angledSupportSegments||[])
    : [];

  if($("showBelts")?.checked && perimeterBelts.length){
    for(const seg of perimeterBelts){
      const line=document.createElementNS(ns,"line");
      line.setAttribute("x1",String(seg.absX1));
      line.setAttribute("y1",String(seg.absY1));
      line.setAttribute("x2",String(seg.absX2));
      line.setAttribute("y2",String(seg.absY2));
      line.setAttribute("class","perimeterSupportSvg");
      svg.appendChild(line);
    }
  }

  if(polygonPoints.length>=2){
    const shape=document.createElementNS(ns,polygonClosed?"polygon":"polyline");
    shape.setAttribute("points",polygonPoints.map(p=>p.x+","+p.y).join(" "));
    shape.setAttribute("class",polygonClosed?"polygonFill":"openPolyline");
    svg.appendChild(shape);
  }

  const metrics=getPolygonMetrics();
  const b=metrics.bounds;
  const visualSpan=Math.max(1,b.maxX-b.minX,b.maxY-b.minY);
  const handleR=Math.max(80,visualSpan*0.018);
  const addR=Math.max(65,visualSpan*0.013);
  const labelOffset=Math.max(140,visualSpan*0.035);
  const labelSize=Math.min(220,Math.max(140,visualSpan*0.018));
  const edgeCount=polygonClosed?polygonPoints.length:Math.max(0,polygonPoints.length-1);

  for(let i=0;i<edgeCount;i++){
    const p=polygonPoints[i];
    const next=polygonPoints[(i+1)%polygonPoints.length];
    const mx=(p.x+next.x)/2, my=(p.y+next.y)/2;

    if(polygonClosed){
      const add=document.createElementNS(ns,"circle");
      add.setAttribute("cx",mx); add.setAttribute("cy",my); add.setAttribute("r",String(addR));
      add.setAttribute("class","addHandle");
      add.addEventListener("click",e=>{
        e.stopPropagation();
        projectZones=[];
        polygonPoints.splice(i+1,0,{x:mx,y:my});
        calculate();
      });
      svg.appendChild(add);
    }

    if(polygonClosed){
      const length=Math.hypot(next.x-p.x,next.y-p.y);
      const labelY=my-labelOffset;
      const labelText=fmt(length)+" мм";
      const bg=document.createElementNS(ns,"rect");
      const approxW=Math.max(labelSize*2.3,labelText.length*labelSize*.58);
      const approxH=labelSize*1.45;
      bg.setAttribute("x",String(mx-approxW/2));
      bg.setAttribute("y",String(labelY-approxH*.78));
      bg.setAttribute("width",String(approxW));
      bg.setAttribute("height",String(approxH));
      bg.setAttribute("rx",String(labelSize*.22));
      bg.setAttribute("class","edgeLabelBg");
      svg.appendChild(bg);

      const label=document.createElementNS(ns,"text");
      label.setAttribute("x",mx); label.setAttribute("y",labelY);
      label.setAttribute("text-anchor","middle");
      label.setAttribute("font-size",String(labelSize));
      label.setAttribute("class","edgeLabel");
      label.textContent=labelText;
      label.addEventListener("click",e=>{
        e.stopPropagation();
        const raw=window.prompt("Длина ребра, мм",String(Math.round(length)));
        if(raw===null) return;
        const desired=Number(String(raw).replace(",","."));
        if(!Number.isFinite(desired)||desired<=0) return;
        const scale=desired/Math.max(1,length);
        const dx=next.x-p.x,dy=next.y-p.y;
        projectZones=[];
        polygonPoints[(i+1)%polygonPoints.length]={
          x:p.x+dx*scale,
          y:p.y+dy*scale
        };
        renderPolygonEditor();
        calculate();
      });
      svg.appendChild(label);
    }
  }

  polygonPoints.forEach((p,i)=>{
    const c=document.createElementNS(ns,"circle");
    c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("r",String(i===0&&drawingPolygon&&polygonPoints.length>=3?handleR*1.25:handleR));
    c.setAttribute("class","vertexHandle"+(i===0&&drawingPolygon&&polygonPoints.length>=3?" closeTarget":""));

    if(i===0&&drawingPolygon&&polygonPoints.length>=3){
      c.addEventListener("click",e=>{e.stopPropagation();closePolygon();});
    } else if(polygonClosed){
      c.addEventListener("pointerdown",e=>{
        e.preventDefault(); e.stopPropagation();
        draggingVertex=i;
        polygonViewBoxLock=svg.getAttribute("viewBox");
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
    projectZones=[];
    polygonPoints.push({
      x:loc.x,
      y:loc.y
    });
    renderPolygonEditor();
  });

  svg.addEventListener("pointermove",e=>{
    if(draggingVertex<0) return;
    const loc=eventToSvg(svg,e);
    projectZones=[];
    polygonPoints[draggingVertex]={
      x:loc.x,
      y:loc.y
    };
    renderPolygonEditor();
  });

  const stop=e=>{
    if(draggingVertex<0) return;
    draggingVertex=-1;
    polygonViewBoxLock=null;
    try{if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);}catch(_){}
    calculate();
  };
  svg.addEventListener("pointerup",stop);
  svg.addEventListener("pointercancel",stop);
}

function getSelectedWarehouseProduct(){
  return window.NIMTECH_INVENTORY?.getProduct?.($("warehouseProduct")?.value) || null;
}

function getAllowedBoardLengths(){
  const values=[];
  const useWarehouse=$("useWarehouse")?.checked;
  const product=getSelectedWarehouseProduct();

  const permitted=len=>{
    if(!useWarehouse || !product) return true;
    return (product.variants?.[len]?.stock||0)>0;
  };

  if($("allow3000")?.checked && permitted(3000)) values.push(3000);
  if($("allow4000")?.checked && permitted(4000)) values.push(4000);
  if($("allow6000")?.checked && permitted(6000)) values.push(6000);
  return values;
}

function renderWarehouseUI(){
  const api=window.NIMTECH_INVENTORY;
  const select=$("warehouseProduct");
  const status=$("warehouseStatus");
  const lengths=$("warehouseLengths");
  if(!api||!select||!status||!lengths) return;

  if(!select.dataset.ready){
    select.innerHTML="";
    api.products.forEach(p=>{
      const o=document.createElement("option");
      o.value=p.id;
      o.textContent=p.name;
      select.appendChild(o);
    });
    select.dataset.ready="1";
  }

  const p=getSelectedWarehouseProduct();
  if(!p) return;

  status.textContent=api.mode==="mock"
    ? "Тестовые остатки · позже заменим на API МоегоСклада"
    : "Остатки синхронизированы с МоимСкладом";

  lengths.innerHTML=[3000,4000,6000].map(len=>{
    const v=p.variants?.[len]||{stock:0};
    const cls=v.stock>0?"ok":"zero";
    return '<span class="'+cls+'"><b>'+(len/1000)+' м</b><small>'+v.stock+' шт.</small></span>';
  }).join("");

  [["allow3000",3000],["allow4000",4000],["allow6000",6000]].forEach(([id,len])=>{
    const el=$(id);
    if(!el) return;
    const unavailable=$("useWarehouse")?.checked && ((p.variants?.[len]?.stock||0)<=0);
    el.disabled=unavailable;
    if(unavailable) el.checked=false;
  });
}

function renderStockCheck(boardRows){
  const box=$("stockCheck");
  if(!box) return;
  if(!$("useWarehouse")?.checked){
    box.className="stockCheck";
    box.textContent="Складской режим выключен.";
    return;
  }

  const p=getSelectedWarehouseProduct();
  if(!p){
    box.className="stockCheck bad";
    box.textContent="Не выбрана складская позиция.";
    return;
  }

  const shortages=[];
  const lines=[3000,4000,6000].map(len=>{
    const need=boardRows.purchases?.[len]||0;
    const have=p.variants?.[len]?.stock||0;
    if(need>have) shortages.push((len/1000)+" м: нужно "+need+", есть "+have);
    return (len/1000)+" м — "+need+" / "+have+" шт.";
  });

  box.className="stockCheck "+(shortages.length?"bad":"good");
  box.innerHTML="<strong>"+(shortages.length?"Недостаточно товара":"Товара достаточно")+"</strong><span>"+lines.join(" · ")+"</span>"+
    (shortages.length?"<small>"+shortages.join("; ")+"</small>":"");
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

function engineeringAreaLoadNmm2(){
  const e=CONFIG.engineering;
  const totalKgM2=
    e.designLiveLoadKgM2 +
    e.deckingDeadLoadKgM2*e.deckingDeadLoadFactor;
  // 1 kPa = 0.001 N/mm²
  return totalKgM2*e.gravity/1e6;
}

function sectionSpanLimit(section,tributaryWidthMm){
  const e=CONFIG.engineering;
  const qArea=engineeringAreaLoadNmm2();
  const qLine=qArea*Math.max(1,tributaryWidthMm);
  const E=e.elasticModulusMPa;
  const Ry=e.steelRyMPa;
  const I=section.I_mm4;
  const W=section.W_mm3;
  const ratio=e.deflectionRatio;

  const uniformStrength=Math.sqrt((8*Ry*W)/qLine);
  const uniformDeflection=Math.cbrt((384*E*I)/(5*qLine*ratio));

  const P=e.terracePointLoadKN*1000*e.terracePointLoadFactor;
  const pointStrength=(4*Ry*W)/P;
  const pointDeflection=Math.sqrt((48*E*I)/(P*ratio));

  const governing=Math.min(
    uniformStrength,
    uniformDeflection,
    pointStrength,
    pointDeflection
  );

  return {
    qLine,
    uniformStrength,
    uniformDeflection,
    pointStrength,
    pointDeflection,
    governing
  };
}

function terraceStructuralLimits(joistStepMm){
  const e=CONFIG.engineering;
  const joist=sectionSpanLimit(
    e.sections.joist40x40x2,
    joistStepMm
  );

  const joistSupportMax=Math.min(
    CONFIG.belt.maxSpacing,
    Math.floor(joist.governing/10)*10
  );

  // Для 80×80 берём максимально неблагоприятную полосу нагрузки,
  // равную расстоянию между соседними поясами.
  const belt=sectionSpanLimit(
    e.sections.belt80x80x2,
    Math.max(1,joistSupportMax)
  );

  const pileSpacingMax=Math.min(
    CONFIG.ground.pileSpacingMax,
    Math.floor(belt.governing/10)*10
  );

  return {
    qAreaNmm2:engineeringAreaLoadNmm2(),
    qAreaKPa:engineeringAreaLoadNmm2()*1000,
    joist,
    belt,
    joistSupportMax,
    pileSpacingMax
  };
}

function supportLineLayout(length,maxSpacing,maxCantilever=200){
  if(length<=0) return {positions:[],count:0,intervals:0,step:0,edgeStart:0,edgeEnd:0};

  if(length<=maxCantilever*2){
    return {
      positions:[length/2],
      count:1,
      intervals:0,
      step:0,
      edgeStart:length/2,
      edgeEnd:length/2
    };
  }

  const start=maxCantilever;
  const end=length-maxCantilever;
  const span=end-start;
  const intervals=Math.max(1,Math.ceil(span/maxSpacing));
  const step=span/intervals;
  const positions=[];

  for(let i=0;i<=intervals;i++) positions.push(start+i*step);

  return {
    positions,
    count:positions.length,
    intervals,
    step,
    edgeStart:start,
    edgeEnd:length-end
  };
}

function endpointPileLayout(length,maxSpacing){
  // Сваи обязаны стоять на обоих концах физического участка 80×80,
  // промежуточные распределяются равномерно.
  return equalLayout(length,maxSpacing);
}

function sharedZoneBoundaryBelts(zones){
  const out=[];
  const tol=1;

  for(let i=0;i<zones.length;i++){
    for(let j=i+1;j<zones.length;j++){
      const a=zones[i],b=zones[j];

      // Горизонтальная общая граница.
      if(Math.abs((a.y+a.h)-b.y)<=tol || Math.abs((b.y+b.h)-a.y)<=tol){
        const y=Math.abs((a.y+a.h)-b.y)<=tol ? b.y : a.y;
        const start=Math.max(a.x,b.x);
        const end=Math.min(a.x+a.w,b.x+b.w);
        if(end-start>tol){
          out.push({
            orientation:"h",
            axis:y,
            start,
            end,
            zoneId:a.id+"+"+b.id,
            pileLength:Math.max(a.pileLength||0,b.pileLength||0)||CONFIG.ground.pileLength,
            reason:"shared-zone-boundary"
          });
        }
      }

      // Вертикальная общая граница.
      if(Math.abs((a.x+a.w)-b.x)<=tol || Math.abs((b.x+b.w)-a.x)<=tol){
        const x=Math.abs((a.x+a.w)-b.x)<=tol ? b.x : a.x;
        const start=Math.max(a.y,b.y);
        const end=Math.min(a.y+a.h,b.y+b.h);
        if(end-start>tol){
          out.push({
            orientation:"v",
            axis:x,
            start,
            end,
            zoneId:a.id+"+"+b.id,
            pileLength:Math.max(a.pileLength||0,b.pileLength||0)||CONFIG.ground.pileLength,
            reason:"shared-zone-boundary"
          });
        }
      }
    }
  }
  return out;
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
    cutLength:length,
    sourceLength:length,
    stockLength:null,
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
  for(let r=0;r<rowCount;r++){
    const row=makeRowFromLengths(pattern.actual);
    row.pieces.forEach((piece,index)=>{
      piece.stockLength=pattern.combo[index]||piece.length;
      piece.sourceLength=piece.stockLength;
    });
    rows.push(row);
  }

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
  const rows=Array.from({length:rowCount},()=>{
    const row=makeRowFromLengths([runLength]);
    row.pieces[0].stockLength=stock;
    row.pieces[0].sourceLength=stock;
    return row;
  });

  return {rows,purchases,reusedPieces:0,finalWaste:waste,offcuts:[],warning:""};
}

function packPiecesIntoStock(pieceLengths,allowedLengths){
  const purchases={3000:0,4000:0,6000:0};
  const bins=[];
  let reusedPieces=0;

  const stocks=[...allowedLengths].sort((a,b)=>a-b);
  if(!stocks.length) return emptyBoardResult();

  const maxStock=Math.max(...stocks);
  const oversized=pieceLengths.find(piece=>piece>maxStock+0.001);
  if(oversized){
    return emptyBoardResult(
      "Раскладка невозможна: требуется цельная деталь "+fmt(oversized)+" мм, а максимальная выбранная длина доски — "+fmt(maxStock)+" мм."
    );
  }

  const pieces=pieceLengths
    .map((length,index)=>({length,index}))
    .sort((a,b)=>b.length-a.length);

  const allocations=Array(pieceLengths.length).fill(null);

  for(const piece of pieces){
    let bestBin=-1;
    let bestRemaining=Infinity;

    for(let j=0;j<bins.length;j++){
      if(bins[j].remaining+0.001>=piece.length){
        const after=bins[j].remaining-piece.length;
        if(after<bestRemaining){
          bestRemaining=after;
          bestBin=j;
        }
      }
    }

    if(bestBin>=0){
      const bin=bins[bestBin];
      bin.remaining-=piece.length;
      bin.cuts.push(piece.length);
      allocations[piece.index]={
        cutLength:piece.length,
        stockLength:bin.stock,
        reused:true
      };
      reusedPieces++;
      continue;
    }

    const stock=stocks.find(x=>x+0.001>=piece.length);
    if(!stock){
      return emptyBoardResult(
        "Раскладка невозможна: деталь "+fmt(piece.length)+" мм не помещается ни в одну из выбранных длин."
      );
    }

    addPurchase(purchases,stock);
    const bin={stock,remaining:stock-piece.length,cuts:[piece.length]};
    bins.push(bin);
    allocations[piece.index]={
      cutLength:piece.length,
      stockLength:stock,
      reused:false
    };
  }

  const offcuts=bins.map(b=>Math.max(0,b.remaining)).filter(x=>x>0.5).sort((a,b)=>b-a);

  return {
    purchases,
    reusedPieces,
    finalWaste:offcuts.reduce((x,y)=>x+y,0),
    offcuts,
    allocations,
    bins,
    warning:""
  };
}

function buildRowsHalf(runLength,rowCount,allowedLengths){
  const rows=[];
  const allPieceLengths=[];
  const pieceRefs=[];

  const half=runLength/2;
  const quarter=runLength/4;

  for(let r=0;r<rowCount;r++){
    const lengths = r%2===0
      ? [half,half]
      : [quarter,half,quarter];

    const row=makeRowFromLengths(lengths);
    rows.push(row);

    row.pieces.forEach(piece=>{
      allPieceLengths.push(piece.length);
      pieceRefs.push(piece);
    });
  }

  const packed=packPiecesIntoStock(allPieceLengths,allowedLengths);
  if(packed.warning){
    return {
      rows:[],
      purchases:packed.purchases||{3000:0,4000:0,6000:0},
      reusedPieces:0,
      finalWaste:0,
      offcuts:[],
      warning:packed.warning
    };
  }

  (packed.allocations||[]).forEach((allocation,index)=>{
    const piece=pieceRefs[index];
    if(!piece||!allocation) return;
    piece.cutLength=allocation.cutLength;
    piece.stockLength=allocation.stockLength;
    piece.sourceLength=allocation.stockLength;
    piece.reused=allocation.reused;
  });

  return {
    rows,
    purchases:packed.purchases,
    reusedPieces:packed.reusedPieces,
    finalWaste:packed.finalWaste,
    offcuts:packed.offcuts,
    bins:packed.bins,
    warning:"Равномерная шахматка: ряд A = 1/2 + 1/2; ряд B = 1/4 + 1/2 + 1/4. Повторяются только эти две схемы."
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
  const scan = direction==="l"
    ? b.minY + axisValue
    : b.minX + axisValue;

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
    const start=hits[i],end=hits[i+1];
    if(end-start<0.5) continue;
    if(direction==="l"){
      segments.push({start:start-b.minX,length:end-start});
    }else{
      segments.push({start:start-b.minY,length:end-start});
    }
  }
  return segments;
}

function polygonCrosslineSegments(runPosition,direction,L,W){
  if(!polygonClosed||polygonPoints.length<3) return [];
  const b=polygonBounds(polygonPoints);

  // Линия профиля 40×40 перпендикулярна доске:
  // при direction=l фиксируем X и получаем участки по Y;
  // при direction=w фиксируем Y и получаем участки по X.
  const fixed=direction==="l"
    ? b.minX+runPosition
    : b.minY+runPosition;

  const hits=[];
  for(let i=0;i<polygonPoints.length;i++){
    const p=polygonPoints[i],q=polygonPoints[(i+1)%polygonPoints.length];

    if(direction==="l"){
      if((p.x<=fixed&&q.x>fixed)||(q.x<=fixed&&p.x>fixed)){
        const t=(fixed-p.x)/(q.x-p.x);
        hits.push(p.y+t*(q.y-p.y));
      }
    }else{
      if((p.y<=fixed&&q.y>fixed)||(q.y<=fixed&&p.y>fixed)){
        const t=(fixed-p.y)/(q.y-p.y);
        hits.push(p.x+t*(q.x-p.x));
      }
    }
  }

  hits.sort((x,y)=>x-y);
  const segments=[];
  for(let i=0;i+1<hits.length;i+=2){
    const start=hits[i],end=hits[i+1];
    if(end-start<0.5) continue;
    segments.push({
      start:direction==="l"?start-b.minY:start-b.minX,
      length:end-start
    });
  }
  return segments;
}

function polygonJoistMeters(positions,direction,L,W){
  let total=0;
  for(const p of positions){
    const spans=polygonCrosslineSegments(p,direction,L,W);
    total+=spans.reduce((sum,s)=>sum+s.length,0)/1000;
  }
  return total;
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

function applyPolygonSeamPatterns(boardRows,patterns,allowedLengths){
  if(!boardRows?.polygon) return boardRows;

  const pieceRefs=[];
  const pieceLengths=[];

  boardRows.rows.forEach((row,rowIndex)=>{
    const axes=(rowIndex%2===0 ? patterns.even : patterns.odd) || [];
    const nextSegments=[];

    for(const seg of row.segments||[]){
      const inside=axes
        .filter(x=>x>seg.start+1 && x<seg.start+seg.length-1)
        .sort((x,y)=>x-y);

      const cuts=[seg.start,...inside,seg.start+seg.length];
      const pieces=[];
      const seams=[];

      for(let j=0;j<cuts.length-1;j++){
        const len=cuts[j+1]-cuts[j];
        const piece={
          length:len,
          cutLength:len,
          sourceLength:len,
          stockLength:null,
          reused:false
        };
        pieces.push(piece);
        pieceRefs.push(piece);
        pieceLengths.push(len);
        if(j<cuts.length-2) seams.push(cuts[j+1]-seg.start);
      }

      nextSegments.push({start:seg.start,length:seg.length,pieces,seams});
    }

    row.segments=nextSegments;
    row.seams=[];
    for(const seg of nextSegments){
      for(const seam of seg.seams) row.seams.push(seg.start+seam);
    }
  });

  const packed=packPiecesIntoStock(pieceLengths,allowedLengths);
  if(packed.warning){
    boardRows.warning=[boardRows.warning,packed.warning].filter(Boolean).join(" ");
    boardRows.purchases={3000:0,4000:0,6000:0};
    boardRows.finalWaste=0;
    boardRows.reusedPieces=0;
    return boardRows;
  }

  (packed.allocations||[]).forEach((allocation,index)=>{
    const piece=pieceRefs[index];
    if(!piece||!allocation) return;
    piece.stockLength=allocation.stockLength;
    piece.sourceLength=allocation.stockLength;
    piece.reused=allocation.reused;
  });

  boardRows.purchases=packed.purchases;
  boardRows.reusedPieces=packed.reusedPieces;
  boardRows.finalWaste=packed.finalWaste;
  boardRows.offcuts=packed.offcuts;
  boardRows.bins=packed.bins;

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
  const seamJoists=[];

  for(const seam of allSeams){
    if(seam-seamOffset>0) seamJoists.push(seam-seamOffset);
    if(seam+seamOffset<run) seamJoists.push(seam+seamOffset);
  }

  const seam=uniquePositions(seamJoists);
  const edge=Math.min(CONFIG.joist.maxEdgeCantilever,run/2);

  // Обязательные опоры: две трубы у каждого стыка.
  // Между ними и краями достраиваем обычные трубы так,
  // чтобы ни один фактический шаг не превышал maxStep.
  const anchors=uniquePositions([edge,...seam,run-edge].filter(x=>x>=0&&x<=run));
  const regular=[];

  for(let i=0;i<anchors.length-1;i++){
    const a=anchors[i],b=anchors[i+1];
    const span=b-a;
    const intervals=Math.max(1,Math.ceil(span/maxStep));
    const step=span/intervals;

    for(let j=1;j<intervals;j++){
      regular.push(a+step*j);
    }
  }

  // Крайние опоры тоже являются обычным профилем, если не совпали
  // со стыковыми трубами.
  [edge,run-edge].forEach(p=>{
    if(!seam.some(s=>Math.abs(s-p)<2)) regular.push(p);
  });

  const regularUnique=uniquePositions(regular);
  const all=uniquePositions([...regularUnique,...seam]);

  let actualMaxStep=0;
  for(let i=0;i<all.length-1;i++){
    actualMaxStep=Math.max(actualMaxStep,all[i+1]-all[i]);
  }

  return {
    regular:regularUnique,
    seam,
    all,
    actualMaxStep,
    edgeOverhangStart:all.length?all[0]:run/2,
    edgeOverhangEnd:all.length?run-all[all.length-1]:run/2
  };
}

function enforcePileEdgeCantilever(spanLength,layout,maxCantilever=200,options={}){
  if(!layout || !layout.positions?.length) return layout;

  const exemptStart=!!options.exemptStart;
  const exemptEnd=!!options.exemptEnd;
  let positions=[...layout.positions].sort((x,y)=>x-y);

  if(!exemptStart && positions[0]>maxCantilever){
    positions.unshift(maxCantilever);
  }
  if(!exemptEnd && spanLength-positions[positions.length-1]>maxCantilever){
    positions.push(spanLength-maxCantilever);
  }

  positions=uniquePositions(positions,1);

  let maxStep=0;
  for(let j=0;j<positions.length-1;j++){
    maxStep=Math.max(maxStep,positions[j+1]-positions[j]);
  }

  return {
    ...layout,
    positions,
    count:positions.length,
    step:maxStep||layout.step,
    edgeCantileverStart:positions[0],
    edgeCantileverEnd:spanLength-positions[positions.length-1],
    cantileverExemptStart:exemptStart,
    cantileverExemptEnd:exemptEnd
  };
}

function polygonEdgeLength(a,b){
  return Math.hypot(b.x-a.x,b.y-a.y);
}

function polygonFreePerimeterSegments(hasHouse=false,houseSide="top"){
  if(!polygonClosed||polygonPoints.length<3) return [];
  const b=polygonBounds(polygonPoints);
  const tol=Math.max(2,Math.max(b.maxX-b.minX,b.maxY-b.minY)*0.002);
  const segments=[];

  const isHouseEdge=(p,q)=>{
    if(!hasHouse) return false;

    if(houseSide==="top"){
      return Math.abs(p.y-b.minY)<=tol && Math.abs(q.y-b.minY)<=tol;
    }
    if(houseSide==="bottom"){
      return Math.abs(p.y-b.maxY)<=tol && Math.abs(q.y-b.maxY)<=tol;
    }
    if(houseSide==="left"){
      return Math.abs(p.x-b.minX)<=tol && Math.abs(q.x-b.minX)<=tol;
    }
    if(houseSide==="right"){
      return Math.abs(p.x-b.maxX)<=tol && Math.abs(q.x-b.maxX)<=tol;
    }
    return false;
  };

  for(let i=0;i<polygonPoints.length;i++){
    const p=polygonPoints[i],q=polygonPoints[(i+1)%polygonPoints.length];
    const len=polygonEdgeLength(p,q);
    if(len<1) continue;
    if(isHouseEdge(p,q)) continue;

    segments.push({
      x1:p.x-b.minX,
      y1:p.y-b.minY,
      x2:q.x-b.minX,
      y2:q.y-b.minY,
      absX1:p.x,
      absY1:p.y,
      absX2:q.x,
      absY2:q.y,
      length:len,
      reason:"perimeter",
      pileLength:CONFIG.ground.pileLength
    });
  }

  return segments;
}

function polygonCentroidApprox(){
  if(!polygonPoints.length) return {x:0,y:0};
  const b=polygonBounds(polygonPoints);
  return {
    x:(b.minX+b.maxX)/2,
    y:(b.minY+b.maxY)/2
  };
}

function angledInsetSupportSegments(direction,hasHouse=false,houseSide="top",maxLagOverhang=200){
  const perimeter=polygonFreePerimeterSegments(hasHouse,houseSide);
  const center=polygonCentroidApprox();
  const b=polygonBounds(polygonPoints);
  const out=[];
  const axisTol=2;

  for(const edge of perimeter){
    const dx=edge.absX2-edge.absX1;
    const dy=edge.absY2-edge.absY1;
    const len=Math.hypot(dx,dy);
    if(len<1) continue;

    // Только реально наклонные стороны. Горизонтальные/вертикальные
    // уже обслуживаются обычной системой параллельных поясов.
    if(Math.abs(dx)<=axisTol || Math.abs(dy)<=axisTol) continue;

    const tx=dx/len, ty=dy/len;
    let nx=-ty, ny=tx;

    const mx=(edge.absX1+edge.absX2)/2;
    const my=(edge.absY1+edge.absY2)/2;

    // Нормаль должна смотреть внутрь площадки.
    if((center.x-mx)*nx+(center.y-my)*ny<0){
      nx=-nx; ny=-ny;
    }

    // Выбираем перпендикулярное смещение так, чтобы расстояние
    // ВДОЛЬ ЛАГИ от её конца до пересечения с поясом было <= 200 мм.
    // direction=l => лаги вертикальные, direction=w => горизонтальные.
    const normalAlongJoist = direction==="l" ? Math.abs(ny) : Math.abs(nx);
    if(normalAlongJoist<0.05) continue;

    const normalOffset=Math.min(
      maxLagOverhang,
      Math.max(40,maxLagOverhang*normalAlongJoist)
    );

    const ax1=edge.absX1+nx*normalOffset;
    const ay1=edge.absY1+ny*normalOffset;
    const ax2=edge.absX2+nx*normalOffset;
    const ay2=edge.absY2+ny*normalOffset;

    out.push({
      x1:ax1-b.minX,
      y1:ay1-b.minY,
      x2:ax2-b.minX,
      y2:ay2-b.minY,
      absX1:ax1,
      absY1:ay1,
      absX2:ax2,
      absY2:ay2,
      length:len,
      reason:"angled-inset-support",
      sourceEdge:edge,
      normalOffset,
      lagOverhang:normalOffset/normalAlongJoist,
      pileLength:CONFIG.ground.pileLength
    });
  }

  return out;
}

function perimeterPilePoints(segments,maxSpacing,pileLength=CONFIG.ground.pileLength){
  const points=[];

  for(const seg of segments){
    const layout=endpointPileLayout(seg.length,maxSpacing);
    const dx=seg.x2-seg.x1;
    const dy=seg.y2-seg.y1;
    const len=Math.max(1,seg.length);

    for(const d of layout.positions){
      const t=d/len;
      points.push({
        x:seg.x1+dx*t,
        y:seg.y1+dy*t,
        pileLength:seg.pileLength||pileLength,
        zones:["perimeter"]
      });
    }
  }

  return mergeSupportPoints(points,2);
}

function nearestDistancePointToSegment(px,py,x1,y1,x2,y2){
  const vx=x2-x1,vy=y2-y1;
  const wx=px-x1,wy=py-y1;
  const vv=vx*vx+vy*vy;
  if(vv<=1e-9) return Math.hypot(px-x1,py-y1);
  let t=(wx*vx+wy*vy)/vv;
  t=Math.max(0,Math.min(1,t));
  const cx=x1+t*vx,cy=y1+t*vy;
  return Math.hypot(px-cx,py-cy);
}

function maxJoistEndToSupportDistance(joistPositions,direction,L,W,perimeterSegments,internalBelts){
  let maxDistance=0;

  for(const pos of joistPositions){
    const spans=polygonCrosslineSegments(pos,direction,L,W);
    for(const span of spans){
      const endpoints=direction==="l"
        ? [
            {x:pos,y:span.start},
            {x:pos,y:span.start+span.length}
          ]
        : [
            {x:span.start,y:pos},
            {x:span.start+span.length,y:pos}
          ];

      for(const ep of endpoints){
        let best=Infinity;

        for(const seg of perimeterSegments||[]){
          best=Math.min(best,nearestDistancePointToSegment(
            ep.x,ep.y,seg.x1,seg.y1,seg.x2,seg.y2
          ));
        }

        // Internal belts are axis-aligned support lines.
        for(const belt of internalBelts||[]){
          if(direction==="l"){
            if(ep.x>=belt.start-1 && ep.x<=belt.start+belt.length+1){
              best=Math.min(best,Math.abs(ep.y-belt.axis));
            }
          }else{
            if(ep.y>=belt.start-1 && ep.y<=belt.start+belt.length+1){
              best=Math.min(best,Math.abs(ep.x-belt.axis));
            }
          }
        }

        if(Number.isFinite(best)) maxDistance=Math.max(maxDistance,best);
      }
    }
  }

  return maxDistance;
}

function addArbitrarySegment(parent,seg,L,W,cls){
  const w=parent.clientWidth,h=parent.clientHeight;
  const x1=seg.x1/L*w,y1=seg.y1/W*h;
  const x2=seg.x2/L*w,y2=seg.y2/W*h;
  const dx=x2-x1,dy=y2-y1;
  const len=Math.hypot(dx,dy);
  const angle=Math.atan2(dy,dx)*180/Math.PI;

  const el=document.createElement("div");
  el.className=cls+" arbitrarySegment";
  Object.assign(el.style,{
    left:x1+"px",
    top:y1+"px",
    width:Math.max(1,len)+"px",
    height:cls.includes("beltLine")?"4px":"2px",
    transformOrigin:"0 50%",
    transform:"rotate("+angle+"deg)"
  });
  parent.appendChild(el);
}

function buildPolygonBeltsAndPiles(L,W,direction,beltPositions,hasHouse,houseSide,structuralLimits=null){
  const limits=structuralLimits||terraceStructuralLimits(CONFIG.joist.stepByBoardHeight.thinStep);
  const belts=[];
  let beltMeters=0;
  const pileSteps=[];

  // 1) Внутренние прямые несущие линии 80×80×2.
  for(const beltPos of beltPositions){
    const across=direction==="l"?W:L;
    const scanPos=Math.min(across-0.001,Math.max(0.001,beltPos));
    const spans=polygonScanlineSegments(scanPos,direction,L,W);
    const segments=[];

    for(const span of spans){
      const layout=endpointPileLayout(span.length,limits.pileSpacingMax);
      const piles=layout.positions.map(p=>span.start+p);

      segments.push({
        start:span.start,
        length:span.length,
        piles,
        pileStep:layout.step,
        houseOffsetApplied:false
      });

      beltMeters+=span.length/1000;
      if(layout.step) pileSteps.push(layout.step);
    }

    belts.push({axis:beltPos,segments});
  }

  // 2) Для каждой свободной наклонной стороны строим ОТДЕЛЬНЫЙ
  // внутренний пояс 80×80×2, параллельный стороне.
  // Его положение определяется правилом: свес конца лаги <= 200 мм.
  const angledSupportSegments=angledInsetSupportSegments(
    direction,
    hasHouse,
    houseSide,
    CONFIG.joist.maxEdgeCantilever
  );

  beltMeters+=angledSupportSegments.reduce((sum,s)=>sum+s.length/1000,0);

  const angledPilePoints=perimeterPilePoints(
    angledSupportSegments,
    limits.pileSpacingMax,
    CONFIG.ground.pileLength
  );

  // 3) Сваи внутренних прямых поясов.
  const internalPilePoints=[];
  for(const belt of belts){
    for(const seg of belt.segments){
      for(const p of seg.piles){
        if(direction==="l"){
          internalPilePoints.push({
            x:p,
            y:belt.axis,
            pileLength:CONFIG.ground.pileLength,
            zones:["internal"]
          });
        }else{
          internalPilePoints.push({
            x:belt.axis,
            y:p,
            pileLength:CONFIG.ground.pileLength,
            zones:["internal"]
          });
        }
      }
    }
  }

  const pilePoints=mergeSupportPoints(
    [...angledPilePoints,...internalPilePoints],
    2
  );

  return {
    belts,
    angledSupportSegments,
    // Контур оставляем только как геометрию площадки, не как несущий пояс.
    perimeterSegments:[],
    pilePoints,
    beltMeters,
    totalPiles:pilePoints.length,
    maxPilesPerBelt:Math.max(
      0,
      ...belts.flatMap(b=>b.segments.map(s=>s.piles.length)),
      ...angledSupportSegments.map(s=>endpointPileLayout(s.length,limits.pileSpacingMax).count)
    ),
    minPileStep:pileSteps.length?Math.min(...pileSteps):0,
    maxPileStep:Math.max(
      pileSteps.length?Math.max(...pileSteps):0,
      ...angledSupportSegments.map(s=>endpointPileLayout(s.length,limits.pileSpacingMax).step||0)
    ),
    maxAngledLagOverhang:angledSupportSegments.length
      ? Math.max(...angledSupportSegments.map(s=>s.lagOverhang||0))
      : 0
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

function renderEngineeringDimensions(layer,model){
  if(model.shapeMode!=="rect") return;
  const L=+$("L").value||6200;
  const W=+$("W").value||3800;

  const dx=document.createElement("div");
  dx.className="engineeringDimension x";
  dx.innerHTML="<span>"+fmt(L)+" мм</span>";
  layer.appendChild(dx);

  const dy=document.createElement("div");
  dy.className="engineeringDimension y";
  dy.innerHTML="<span>"+fmt(W)+" мм</span>";
  layer.appendChild(dy);

  const mark=document.createElement("div");
  mark.className="planCornerMark";
  mark.textContent="ПЛАН · мм";
  layer.appendChild(mark);
}

function zoneAxisOrigin(zone,direction,axis){
  if(axis==="run") return direction==="l" ? zone.x : zone.y;
  return direction==="l" ? zone.y : zone.x;
}

function zoneAxisLength(zone,direction,axis){
  if(axis==="run") return direction==="l" ? zone.w : zone.h;
  return direction==="l" ? zone.h : zone.w;
}

function mergeCollinearSegments(segments,tolerance=1){
  const groups=new Map();

  for(const seg of segments){
    const key=seg.orientation+":"+Math.round(seg.axis/tolerance);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push({...seg});
  }

  const merged=[];
  for(const items of groups.values()){
    items.sort((x,y)=>x.start-y.start);
    let cur=null;

    for(const seg of items){
      if(!cur){
        cur={...seg};
        continue;
      }
      if(seg.start<=cur.end+tolerance){
        cur.end=Math.max(cur.end,seg.end);
        if(seg.pileLength||cur.pileLength){
          cur.pileLength=Math.max(cur.pileLength||0,seg.pileLength||0);
        }
      }else{
        merged.push(cur);
        cur={...seg};
      }
    }
    if(cur) merged.push(cur);
  }
  return merged;
}

function mergeSupportPoints(points,tolerance=2){
  const out=[];
  for(const p of points){
    const existing=out.find(q=>Math.hypot(q.x-p.x,q.y-p.y)<=tolerance);
    if(existing){
      existing.pileLength=Math.max(existing.pileLength||0,p.pileLength||0);
      existing.zones=[...new Set([...(existing.zones||[]),...(p.zones||[])])];
    }else{
      out.push({...p,zones:[...(p.zones||[])]});
    }
  }
  return out;
}

function supportFrameTieBelts(zone,direction,beltLayout,hasHouse,houseSide){
  if(!beltLayout?.positions?.length) return [];

  const first=beltLayout.positions[0];
  const last=beltLayout.positions[beltLayout.positions.length-1];
  const out=[];

  const runStartSide=direction==="l" ? "left" : "top";
  const runEndSide=direction==="l" ? "right" : "bottom";
  const omitStart=hasHouse && houseSide===runStartSide;
  const omitEnd=hasHouse && houseSide===runEndSide;

  if(direction==="l"){
    // Основные 80×80 горизонтальны; торцевые связи вертикальны.
    if(!omitStart){
      out.push({
        orientation:"v",
        axis:zone.x,
        start:zone.y+first,
        end:zone.y+last,
        zoneId:zone.id,
        pileLength:zone.pileLength||CONFIG.ground.pileLength,
        reason:"support-frame-tie"
      });
    }
    if(!omitEnd){
      out.push({
        orientation:"v",
        axis:zone.x+zone.w,
        start:zone.y+first,
        end:zone.y+last,
        zoneId:zone.id,
        pileLength:zone.pileLength||CONFIG.ground.pileLength,
        reason:"support-frame-tie"
      });
    }
  }else{
    // Основные 80×80 вертикальны; торцевые связи горизонтальны.
    if(!omitStart){
      out.push({
        orientation:"h",
        axis:zone.y,
        start:zone.x+first,
        end:zone.x+last,
        zoneId:zone.id,
        pileLength:zone.pileLength||CONFIG.ground.pileLength,
        reason:"support-frame-tie"
      });
    }
    if(!omitEnd){
      out.push({
        orientation:"h",
        axis:zone.y+zone.h,
        start:zone.x+first,
        end:zone.x+last,
        zoneId:zone.id,
        pileLength:zone.pileLength||CONFIG.ground.pileLength,
        reason:"support-frame-tie"
      });
    }
  }

  return out;
}

function buildZonedStructure(zones,direction,seamPatterns,joistStep,base,hasHouse=false,houseSide="top",structuralLimits=null){
  if(!zones?.length) return null;
  const limits=structuralLimits||terraceStructuralLimits(joistStep);

  const zoneModels=[];
  const joistSegments=[];
  const beltSegments=[];
  const pilePoints=[];

  for(const zone of zones){
    const runOrigin=zoneAxisOrigin(zone,direction,"run");
    const acrossOrigin=zoneAxisOrigin(zone,direction,"across");
    const run=zoneAxisLength(zone,direction,"run");
    const across=zoneAxisLength(zone,direction,"across");

    const globalSeams=(seamPatterns?.all||[]);
    const localSeams=globalSeams
      .filter(x=>x>runOrigin+1&&x<runOrigin+run-1)
      .map(x=>x-runOrigin);

    const joists=buildJoists(run,localSeams,joistStep);
    const beltLayout=supportLineLayout(
      across,
      limits.joistSupportMax,
      CONFIG.joist.maxEdgeCantilever
    );
    const pileLayout=endpointPileLayout(run,limits.pileSpacingMax);

    const makeJoistSegment=(pos,type)=>{
      if(direction==="l"){
        return {orientation:"v",axis:zone.x+pos,start:zone.y,end:zone.y+zone.h,type,zoneId:zone.id};
      }
      return {orientation:"h",axis:zone.y+pos,start:zone.x,end:zone.x+zone.w,type,zoneId:zone.id};
    };

    joists.regular.forEach(pos=>joistSegments.push(makeJoistSegment(pos,"regular")));
    joists.seam.forEach(pos=>joistSegments.push(makeJoistSegment(pos,"seam")));

    for(const pos of beltLayout.positions){
      if(direction==="l"){
        beltSegments.push({orientation:"h",axis:zone.y+pos,start:zone.x,end:zone.x+zone.w,zoneId:zone.id,pileLength:zone.pileLength||CONFIG.ground.pileLength,reason:"joist-support"});
      }else{
        beltSegments.push({orientation:"v",axis:zone.x+pos,start:zone.y,end:zone.y+zone.h,zoneId:zone.id,pileLength:zone.pileLength||CONFIG.ground.pileLength,reason:"joist-support"});
      }
    }

    beltSegments.push(...supportFrameTieBelts(zone,direction,beltLayout,hasHouse,houseSide));

    zoneModels.push({
      ...zone,
      runOrigin,acrossOrigin,run,across,
      joists,beltLayout,pileLayout,
      regularJoistMeters:joists.regular.length*across/1000,
      seamJoistMeters:joists.seam.length*across/1000
    });
  }

  beltSegments.push(...sharedZoneBoundaryBelts(zones));

  const mergedBelts=mergeCollinearSegments(beltSegments);
  const pileSteps=[];

  if(base==="ground"){
    for(const seg of mergedBelts){
      const length=seg.end-seg.start;
      const layout=endpointPileLayout(length,limits.pileSpacingMax);
      pileSteps.push(layout.step||0);

      for(const p of layout.positions){
        pilePoints.push(seg.orientation==="h"
          ? {
              x:seg.start+p,
              y:seg.axis,
              pileLength:seg.pileLength||CONFIG.ground.pileLength,
              zones:seg.zoneId?[seg.zoneId]:[]
            }
          : {
              x:seg.axis,
              y:seg.start+p,
              pileLength:seg.pileLength||CONFIG.ground.pileLength,
              zones:seg.zoneId?[seg.zoneId]:[]
            }
        );
      }
    }
  }

  const mergedPiles=mergeSupportPoints(pilePoints);

  return {
    zones:zoneModels,
    joistSegments,
    beltSegments:mergedBelts,
    pilePoints:mergedPiles,
    regularJoistMeters:zoneModels.reduce((sum,z)=>sum+z.regularJoistMeters,0),
    seamJoistMeters:zoneModels.reduce((sum,z)=>sum+z.seamJoistMeters,0),
    totalJoistMeters:zoneModels.reduce((sum,z)=>sum+z.regularJoistMeters+z.seamJoistMeters,0),
    beltMeters:mergedBelts.reduce((sum,s)=>sum+(s.end-s.start)/1000,0),
    totalPiles:mergedPiles.length,
    pileCountsByLength:mergedPiles.reduce((acc,p)=>{
      const len=p.pileLength||CONFIG.ground.pileLength;
      acc[len]=(acc[len]||0)+1;
      return acc;
    },{}),
    maxPileStep:Math.max(0,...pileSteps),
    maxBeltStep:Math.max(0,...zoneModels.map(z=>z.beltLayout.step||0))
  };
}

function addAbsoluteSegment(parent,seg,L,W,cls){
  const w=parent.clientWidth,h=parent.clientHeight;
  const el=document.createElement("div");
  el.className=cls;

  if(seg.orientation==="h"){
    Object.assign(el.style,{
      left:(seg.start/L*w)+"px",
      width:Math.max(1,(seg.end-seg.start)/L*w)+"px",
      top:(seg.axis/W*h)+"px",
      height:cls.includes("beltLine")?"4px":"2px"
    });
  }else{
    Object.assign(el.style,{
      top:(seg.start/W*h)+"px",
      height:Math.max(1,(seg.end-seg.start)/W*h)+"px",
      left:(seg.axis/L*w)+"px",
      width:cls.includes("beltLine")?"4px":"2px"
    });
  }
  parent.appendChild(el);
}

function renderZoneOutlines(parent,zoned,L,W){
  if(!zoned?.zones?.length) return;
  const w=parent.clientWidth,h=parent.clientHeight;

  zoned.zones.forEach(zone=>{
    const box=document.createElement("div");
    box.className="zoneOutline zone-"+(zone.type||"area");
    Object.assign(box.style,{
      left:(zone.x/L*w)+"px",
      top:(zone.y/W*h)+"px",
      width:(zone.w/L*w)+"px",
      height:(zone.h/W*h)+"px"
    });

    const label=document.createElement("span");
    label.textContent=zone.name||zone.id;
    box.appendChild(label);
    parent.appendChild(box);
  });
}

function renderPlan(model){
  const terrace=$("terrace");
  const layer=$("constructionLayer");
  layer.innerHTML="";
  applyPolygonToTerrace();

  const {run,across,direction,joists,beltLayout,pileLayout,base,polygonStructure,zonedStructure}=model;
  const modelL=direction==="l"?run:across;
  const modelW=direction==="l"?across:run;

  if(model.shapeMode==="free" && (!polygonClosed || polygonPoints.length<3)){
    layer.innerHTML="";
    return;
  }

  if($("showBelts").checked){
    if(zonedStructure){
      for(const seg of zonedStructure.beltSegments){
        addAbsoluteSegment(layer,seg,modelL,modelW,"beltLine");
      }
    }else if(model.shapeMode==="free" && polygonStructure){
      for(const belt of polygonStructure.belts){
        for(const seg of belt.segments){
          addBeltSegment(layer,direction,belt.axis,across,seg.start,seg.length,run);
        }
      }
      for(const seg of polygonStructure.angledSupportSegments||[]){
        addArbitrarySegment(layer,seg,modelL,modelW,"beltLine angledSupportBelt");
      }
    }else{
      for(const pos of beltLayout.positions) addLine(layer,"beltLine",direction,pos,across,false);
    }
  }

  if($("showJoists").checked){
    if(zonedStructure){
      for(const seg of zonedStructure.joistSegments){
        addAbsoluteSegment(layer,seg,modelL,modelW,"joistLine"+(seg.type==="seam"?" double":""));
      }
    }else{
      for(const pos of joists.regular) addLine(layer,"joistLine",direction,pos,run,true);
      for(const pos of joists.seam) addLine(layer,"joistLine",direction,pos,run,true);
    }
  }

  if($("showBoards").checked) renderBoardRows(layer,model);

  if($("showPiles").checked && base==="ground"){
    const w=layer.clientWidth;
    const h=layer.clientHeight;

    if(zonedStructure){
      for(const p of zonedStructure.pilePoints){
        const dot=document.createElement("div");
        dot.className="pileDot";
        dot.style.left=(p.x/modelL*w)+"px";
        dot.style.top=(p.y/modelW*h)+"px";
        dot.title="Свая "+fmt(p.pileLength)+" мм";
        layer.appendChild(dot);
      }
    }else if(model.shapeMode==="free" && polygonStructure){
      for(const p of polygonStructure.pilePoints||[]){
        const dot=document.createElement("div");
        dot.className="pileDot";
        dot.style.left=(p.x/modelL*w)+"px";
        dot.style.top=(p.y/modelW*h)+"px";
        layer.appendChild(dot);
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

  if(zonedStructure) renderZoneOutlines(layer,zonedStructure,modelL,modelW);
  renderEngineeringDimensions(layer,model);
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
        seg.pieces.map(p=>{
          const cut=fmt(p.cutLength||p.length)+" мм";
          return p.stockLength && Math.abs(p.stockLength-(p.cutLength||p.length))>1
            ? cut+" ← "+fmt(p.stockLength)
            : cut;
        }).join(" + ")
      ).join("  |  ");
    }else{
      pieces=row.pieces.map(p=>{
        const cut=fmt(p.cutLength||p.length)+" мм";
        const stock=p.stockLength && Math.abs(p.stockLength-(p.cutLength||p.length))>1
          ? " ← "+fmt(p.stockLength)
          : "";
        return (p.reused?"остаток ":"")+cut+stock;
      }).join(" + ");
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
  if(!t) return;

  const safeL=Math.max(1,L);
  const safeW=Math.max(1,W);
  const scale=Math.min(650/safeL,430/safeW);

  // Не искажаем пропорции даже у очень длинных / узких контуров.
  t.style.width=Math.max(24,safeL*scale)+"px";
  t.style.height=Math.max(24,safeW*scale)+"px";
}

function buildAlgorithmDiagnostics(model){
  const lines=[];
  const {run,across,joists,beltLayout,pileLayout,base,boardRows,seamPatterns,shapeMode}=model;

  if(model.zonedStructure){
    lines.push({
      title:"Зоны проекта",
      text:model.zonedStructure.zones.map(z=>
        z.name+" "+fmt(z.w)+"×"+fmt(z.h)+" мм"+(z.pileLength?" · сваи "+fmt(z.pileLength)+" мм":"")
      ).join(" | ")+" Общие опоры и участки пояса объединяются."
    });
  }

  if(model.structuralLimits){
    const sl=model.structuralLimits;
    lines.push({
      title:"Расчётная нагрузка",
      text:"Равномерная нагрузка "+fmt(sl.qAreaKPa,2)+" кПа (500 кг/м² эксплуатационная + до 25 кг/м² ДПК с коэффициентом 1,10). "+
        "Сталь: Ry 230 МПа, E 200 ГПа. Критерий прогиба L/"+CONFIG.engineering.deflectionRatio+"."
    });
    lines.push({
      title:"Допустимый пролёт 40×40×2",
      text:"По расчёту: "+fmt(sl.joist.governing)+" мм; в модели принимаем не более "+
        fmt(sl.joistSupportMax)+" мм между поясами 80×80×2."
    });
    lines.push({
      title:"Допустимый пролёт 80×80×2",
      text:"По расчёту: "+fmt(sl.belt.governing)+" мм; шаг свай ограничиваем "+
        fmt(sl.pileSpacingMax)+" мм."
    });
  }

  lines.push({
    title:"ДПК",
    text:"Закупочные длины: "+getAllowedBoardLengths().map(x=>x/1000+" м").join(" / ")+
      ". Фактические детали считаются отдельно от закупочных досок."
  });

  if($("layoutMode").value==="half"){
    const aSeams=shapeMode==="free" ? seamPatterns.even : [run/2];
    const bSeams=shapeMode==="free" ? seamPatterns.odd : [run/4,3*run/4];
    lines.push({
      title:"Шахматка",
      text:"Повторяются 2 ряда. Оси A: "+(aSeams.length?aSeams.map(fmt).join(", ")+" мм":"нет")+
        ". Оси B: "+(bSeams.length?bSeams.map(fmt).join(", ")+" мм":"нет")+"."
    });
  }

  lines.push({
    title:"40×40×2",
    text:"Шаг по осям не более "+joistStepByBoardHeight(+$("boardHeight").value||23)+
      " мм. Обычных линий: "+(model.zonedStructure
        ? model.zonedStructure.zones.reduce((sum,z)=>sum+z.joists.regular.length,0)
        : joists.regular.length)+
      ", линий под стыками: "+(model.zonedStructure
        ? model.zonedStructure.zones.reduce((sum,z)=>sum+z.joists.seam.length,0)
        : joists.seam.length)+
      ". Фактический максимальный шаг: "+fmt(joists.actualMaxStep)+" мм."+
      (shapeMode==="free"?" Метраж считается по фактическим участкам внутри контура.":"")
  });

  lines.push({
    title:"Края 40×40×2",
    text:"Свес слева/справа: "+fmt(joists.edgeOverhangStart)+" / "+fmt(joists.edgeOverhangEnd)+
      " мм, предел "+CONFIG.joist.maxEdgeCantilever+" мм."
  });

  if(model.polygonStructure?.angledSupportSegments?.length){
    lines.push({
      title:"Пояса вдоль косых сторон",
      text:model.polygonStructure.angledSupportSegments.map((s,i)=>
        "№"+(i+1)+": "+fmt(s.length)+" мм, свес лаг "+fmt(s.lagOverhang)+" мм"
      ).join(" | ")
    });
  }

  if(model.supportDistanceCheck!=null){
    lines.push({
      title:"Контроль свеса лаг",
      text:"Максимальное расстояние от конца лаги 40×40×2 до ближайшего пояса 80×80×2: "+
        fmt(model.supportDistanceCheck)+" мм / допустимо "+CONFIG.joist.maxEdgeCantilever+" мм."
    });
  }

  lines.push({
    title:"80×80×2",
    text:model.zonedStructure
      ? model.zonedStructure.zones.map(z=>
          z.name+": "+z.beltLayout.count+" ряда, шаг "+fmt(z.beltLayout.step)+" мм, свес лаг "+
          fmt(z.beltLayout.edgeStart)+" / "+fmt(z.beltLayout.edgeEnd)+" мм"
        ).join(" | ")+". Расчётный предел шага "+fmt(model.structuralLimits?.joistSupportMax||CONFIG.belt.maxSpacing)+" мм; свес лаг ≤ "+CONFIG.joist.maxEdgeCantilever+" мм. Свободные торцы несущих линий связаны поперечным 80×80×2; со стороны примыкания к дому замыкающий профиль не добавляется."
      : "Рядов: "+beltLayout.count+
        ", фактический шаг ≈ "+fmt(beltLayout.step)+" мм, предел "+CONFIG.belt.maxSpacing+" мм."
  });

  if(base==="ground" && pileLayout){
    const houseException="";
    lines.push({
      title:"Сваи",
      text:"На один пояс: "+pileLayout.count+
        ", равномерный шаг "+fmt(pileLayout.step)+" мм, предел "+CONFIG.ground.pileSpacingMax+" мм."+
        houseException
    });
  }else if(base==="ground" && model.polygonStructure){
    lines.push({
      title:"Сваи",
      text:"Расставлены по каждому фактическому участку пояса; максимальный найденный шаг "+
        fmt(model.polygonStructure.maxPileStep)+" мм."
    });
  }

  const joistBuy=stockPurchase(model.totalJoistMeters||0);
  const beltBuy=stockPurchase(model.beltMeters||0);
  lines.push({
    title:"Металл",
    text:"40×40×2: "+fmt(model.totalJoistMeters||0,1)+" м.п. → "+
      joistBuy.sticks+" × 6 м. 80×80×2: "+fmt(model.beltMeters||0,1)+" м.п. → "+
      beltBuy.sticks+" × 6 м. Резка и сварка разрешены."
  });

  const purchases=boardRows?.purchases||{};
  lines.push({
    title:"Закупка ДПК",
    text:"3 м: "+(purchases[3000]||0)+" шт.; 4 м: "+(purchases[4000]||0)+
      " шт.; 6 м: "+(purchases[6000]||0)+" шт. Обрезки можно использовать как самостоятельные детали, но нельзя соединять обратно в одну доску."
  });

  return lines;
}

function renderAlgorithmDiagnostics(model){
  const box=$("algorithmDiagnostics");
  if(!box||!model) return;
  const lines=buildAlgorithmDiagnostics(model);
  box.innerHTML=lines.map(line=>
    '<div class="diagRow"><strong>'+line.title+'</strong><span>'+line.text+'</span></div>'
  ).join("");
}

function calculate(){
  const shapeMode=$("shapeMode").value;
  const freeMetrics=shapeMode==="free" ? getPolygonMetrics() : null;
  const L=shapeMode==="free" ? freeMetrics.bboxL : (+$("L").value||6200);
  const W=shapeMode==="free" ? freeMetrics.bboxW : (+$("W").value||3800);
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
  const structuralLimits=terraceStructuralLimits(joistStep);
  const rowCount=Math.ceil(across/boardModule);
  let boardRows = shapeMode==="free" && polygonClosed
    ? buildPolygonBoardRows(L,W,direction,boardModule,layoutMode,allowedLengths)
    : buildBoardRows(run,rowCount,layoutMode,allowedLengths);

  let seamPatterns={even:[],odd:[],all:[]};
  let allSeams=[];

  if(shapeMode==="free" && boardRows.polygon){
    seamPatterns=getPolygonSeamPatterns(boardRows,layoutMode);
    boardRows=applyPolygonSeamPatterns(boardRows,seamPatterns,allowedLengths);
    allSeams=seamPatterns.all;
  }else{
    allSeams=uniquePositions((boardRows.rows||[]).flatMap(r=>r.seams));
  }

  const joists=buildJoists(run,allSeams,joistStep);
  const zonedStructure=projectZones.length
    ? buildZonedStructure(projectZones,direction,seamPatterns,joistStep,base,hasHouse,houseSide,structuralLimits)
    : null;

  const joistLengthM=across/1000;
  const regularJoistMeters=shapeMode==="free"&&polygonClosed
    ? polygonJoistMeters(joists.regular,direction,L,W)
    : joists.regular.length*joistLengthM;
  const seamJoistMeters=shapeMode==="free"&&polygonClosed
    ? polygonJoistMeters(joists.seam,direction,L,W)
    : joists.seam.length*joistLengthM;
  let effectiveRegularJoistMeters=regularJoistMeters;
  let effectiveSeamJoistMeters=seamJoistMeters;
  let totalJoistMeters=regularJoistMeters+seamJoistMeters;

  if(zonedStructure){
    effectiveRegularJoistMeters=zonedStructure.regularJoistMeters;
    effectiveSeamJoistMeters=zonedStructure.seamJoistMeters;
    totalJoistMeters=zonedStructure.totalJoistMeters;
  }

  const joistBuy=stockPurchase(totalJoistMeters);

  const totalBoards=Object.values(boardRows.purchases).reduce((a,b)=>a+b,0);
  const totalSeams=boardRows.rows.reduce((sum,row)=>sum+row.seams.length,0);

  const beltAffected=hasHouse && houseAffectsAxis(direction,houseSide,"across");
  const beltLayout=supportLineLayout(
    across,
    structuralLimits.joistSupportMax,
    CONFIG.joist.maxEdgeCantilever
  );

  let polygonStructure=null;
  let beltMeters=0;
  let pileLayout=null;
  let totalPiles=0;

  if(shapeMode==="free" && polygonClosed){
    polygonStructure=buildPolygonBeltsAndPiles(
      L,W,direction,beltLayout.positions,hasHouse,houseSide,structuralLimits
    );
    beltMeters=polygonStructure.beltMeters;
    totalPiles=polygonStructure.totalPiles;
  }else{
    const beltLengthM=run/1000;
    beltMeters=beltLayout.count*beltLengthM;

    const pileAffected=hasHouse && houseAffectsAxis(direction,houseSide,"run");
    pileLayout=endpointPileLayout(run,structuralLimits.pileSpacingMax);

    totalPiles=beltLayout.count*pileLayout.count;
  }

  if(zonedStructure){
    beltMeters=zonedStructure.beltMeters;
    totalPiles=zonedStructure.totalPiles;
  }

  const supportDistanceCheck=
    shapeMode==="free" && polygonStructure && !zonedStructure
      ? maxJoistEndToSupportDistance(
          joists.all,
          direction,
          L,
          W,
          polygonStructure.angledSupportSegments||[],
          polygonStructure.belts.flatMap(b=>
            b.segments.map(s=>({
              axis:b.axis,
              start:s.start,
              length:s.length
            }))
          )
        )
      : null;

  const beltBuy=stockPurchase(beltMeters);

  const shapeMetrics = shapeMode==="free" ? freeMetrics : {areaM2:L*W/1e6,bboxL:L,bboxW:W};
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
          ? "Шахматка привязана к самому длинному непрерывному ряду. 80×80×2 строится по фактическим концам лаг 40×40×2: свес ≤200 мм, внутренний шаг ≤1500 мм. Сваи ставятся на концах каждого участка 80×80 и далее равномерно ≤1500 мм."
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
  renderStockCheck(boardRows);

  $("joistStepOut").textContent="до "+fmt(joists.actualMaxStep||joistStep)+" мм";
  $("checkJoistStep").textContent=fmt(joists.actualMaxStep||joistStep)+" / "+joistStep+" мм";
  $("checkEdgeOverhang").textContent=fmt(joists.edgeOverhangStart)+" / "+fmt(joists.edgeOverhangEnd)+" мм";
  $("checkBeltStep").textContent=zonedStructure
    ? fmt(zonedStructure.maxBeltStep)+" / "+fmt(structuralLimits.joistSupportMax)+" мм"
    : fmt(beltLayout.step)+" / "+fmt(structuralLimits.joistSupportMax)+" мм";
  const regularCount=zonedStructure
    ? zonedStructure.zones.reduce((sum,z)=>sum+z.joists.regular.length,0)
    : joists.regular.length;
  const seamCount=zonedStructure
    ? zonedStructure.zones.reduce((sum,z)=>sum+z.joists.seam.length,0)
    : joists.seam.length;

  $("regularJoists").textContent=regularCount+" шт. / "+fmt(effectiveRegularJoistMeters,1)+" м.п.";
  $("doubleJoists").textContent=seamCount+" шт. / "+fmt(effectiveSeamJoistMeters,1)+" м.п.";
  $("joists").textContent=fmt(totalJoistMeters,1)+" м.п.";
  $("joistPurchase").textContent=joistBuy.sticks+" хлыстов / "+fmt(joistBuy.meters)+" м";

  $("beltRows").textContent=zonedStructure
    ? zonedStructure.zones.map(z=>z.name+": "+z.beltLayout.count).join(" / ")
    : beltLayout.count+" шт.";
  $("beltStepOut").textContent=zonedStructure
    ? "до "+fmt(zonedStructure.maxBeltStep)+" мм; крайние ≤200 мм"
    : "до "+fmt(beltLayout.step)+" мм; свес "+fmt(beltLayout.edgeStart)+" / "+fmt(beltLayout.edgeEnd)+" мм";
  $("belt").textContent=fmt(beltMeters,1)+" м.п.";
  $("beltPurchase").textContent=beltBuy.sticks+" хлыстов / "+fmt(beltBuy.meters)+" м";

  if(base==="ground"){
    if(zonedStructure){
      const parts=Object.entries(zonedStructure.pileCountsByLength)
        .sort((x,y)=>Number(y[0])-Number(x[0]))
        .map(([len,count])=>count+" свай × "+fmt(Number(len))+" мм");
      $("pilesPerBelt").textContent="по зонам";
      $("pileStepOut").textContent="до "+fmt(zonedStructure.maxPileStep)+" мм";
      $("checkPileStep").textContent=fmt(zonedStructure.maxPileStep)+" / "+fmt(structuralLimits.pileSpacingMax)+" мм";
      $("supports").textContent=parts.join(" + ");
      $("pileInfo").textContent=
        "80×80×2 строится как несущая система под 40×40×2: крайняя линия не дальше 200 мм от конца лаги, внутренний шаг ≤1500 мм. Сваи стоят на концах каждого физического участка 80×80×2 и равномерно между ними с шагом ≤1500 мм. На общей границе террасы и крыльца добавлен отдельный несущий профиль.";
    }else if(shapeMode==="free" && polygonStructure){
      $("pilesPerBelt").textContent="по фактическим участкам";
      $("pileStepOut").textContent=polygonStructure.maxPileStep
        ? "до "+fmt(polygonStructure.maxPileStep)+" мм"
        : "—";
      $("checkPileStep").textContent=polygonStructure.maxPileStep
        ? fmt(polygonStructure.maxPileStep)+" / 1500 мм"
        : "—";
      $("supports").textContent=totalPiles+" свай × 2500 мм";
      $("pileInfo").textContent=
        "Для каждой свободной наклонной стороны строится отдельный внутренний пояс 80×80×2, параллельный стороне. Его положение рассчитывается так, чтобы свес конца лаги 40×40×2 до точки опоры был не более 200 мм. Сваи стоят на концах пояса и далее равномерно с шагом не более 1500 мм."+
        (hasHouse?" Со стороны дома применяется отступ 400 мм.":"")+
        (pileLayout?.edgeCantileverStart!=null
          ? " Крайний свес 40×40 относительно опоры: "+fmt(pileLayout.edgeCantileverStart)+" / "+fmt(pileLayout.edgeCantileverEnd)+" мм, максимум 200 мм."
          : "");
    }else{
      $("pilesPerBelt").textContent=pileLayout.count+" шт.";
      $("pileStepOut").textContent=fmt(pileLayout.step)+" мм";
      $("checkPileStep").textContent=fmt(pileLayout.step)+" / "+fmt(structuralLimits.pileSpacingMax)+" мм";
      $("supports").textContent=totalPiles+" свай × 2500 мм";
      $("pileInfo").textContent=
        "Рядов пояса: "+beltLayout.count+
        ". На каждом поясе: "+pileLayout.count+
        " свай. Максимальный шаг — 1500 мм."+
        (hasHouse?" Со стороны дома применяется отдельный отступ 400 мм; правило 200 мм к этой стороне не применяется.":"");
    }
  }else if(base==="roof"){
    $("pilesPerBelt").textContent="—";
    $("pileStepOut").textContent="—";
    $("checkPileStep").textContent="—";
    $("supports").textContent="Регулируемые пластиковые опоры";
    $("pileInfo").textContent="Для кровли сваи не применяются.";
  }else{
    $("pilesPerBelt").textContent="—";
    $("pileStepOut").textContent="—";
    $("supports").textContent="По выбранной технологии бетона";
    $("pileInfo").textContent="Алгоритм бетонного основания будет рассчитан отдельно.";
  }

  $("tech").textContent=base==="ground"
    ? (zonedStructure
        ? "ДПК → профиль 40×40×2 → пояс 80×80×2 → зональные сваи: 2500 мм основная площадка / 2000 мм крыльцо. Металл закупается хлыстами по 6 м."
        : "ДПК → профиль 40×40×2 → пояс 80×80×2 → сваи 2500 мм. Металл закупается хлыстами по 6 м.")
    : base==="roof"
      ? "Кровля / гидроизоляция: только регулируемые пластиковые опоры → металлический каркас → ДПК."
      : "Бетон: резиновые подкладки, арматурные штыри или регулируемые пластиковые опоры.";

  updateViewSize(L,W);

  lastModel={
    run,across,direction,boardRows,joists,beltLayout,pileLayout,base,shapeMode,seamPatterns,polygonStructure,
    totalJoistMeters,
    regularJoistMeters:effectiveRegularJoistMeters,
    seamJoistMeters:effectiveSeamJoistMeters,
    beltMeters,totalPiles,zonedStructure,supportDistanceCheck,structuralLimits,
    algorithmVersion:"3.0"
  };
  renderAlgorithmDiagnostics(lastModel);
  setTimeout(()=>{
    renderPlan(lastModel);
    if(shapeMode==="free") renderPolygonEditor();
    updateWorldGrid();
    notify3D();
  },0);
}

function updateControls(){
  const base=$("base").value;
  const layoutMode=$("layoutMode").value;

  $("ground").classList.toggle("hidden",base!=="ground");
  $("concrete").classList.toggle("hidden",base!=="concrete");
  $("houseControls").classList.toggle("hidden",!$("hasHouse").checked);
  const free=$("shapeMode").value==="free";
  $("rectControls").classList.toggle("hidden",free);
  $("freeControls").classList.toggle("hidden",!free);
  $("polygonEditor").classList.toggle("hidden",!free);
  applyPolygonToTerrace();
  if(free) setTimeout(renderPolygonEditor,0);
  renderWarehouseUI();
  const allowed=getAllowedBoardLengths();
  $("layoutHint").textContent=allowed.length
    ? (layoutHints[layoutMode]||"")
    : "Выберите хотя бы одну длину доски для расчёта.";
}

["L","W","shapeMode","dir","layoutMode","base","boardModule","boardHeight","hasHouse","houseSide","allow3000","allow4000","allow6000","useWarehouse","warehouseProduct"].forEach(id=>{
  const el=$(id);
  if(el){
    el.addEventListener("input",()=>{updateControls();calculate();});
    el.addEventListener("change",()=>{updateControls();calculate();});
  }
});

["showBoards","showJoists","showBelts","showPiles"].forEach(id=>{
  $(id).addEventListener("change",()=>{if(lastModel)renderPlan(lastModel);});
});

function loadControlScheme(){
  // Контрольный чертёж из загруженной схемы.
  // Основная площадка 4500×3500 мм + центральное крыльцо 600×1200 мм.
  projectZones=[
    {id:"main",name:"Основная терраса",type:"terrace",x:0,y:0,w:4500,h:3500,pileLength:2500},
    {id:"porch",name:"Крыльцо",type:"porch",x:1950,y:3500,w:600,h:1200,pileLength:2000}
  ];

  polygonPoints=[
    {x:0,y:0},
    {x:4500,y:0},
    {x:4500,y:3500},
    {x:2550,y:3500},
    {x:2550,y:4700},
    {x:1950,y:4700},
    {x:1950,y:3500},
    {x:0,y:3500}
  ];
  polygonClosed=true;
  drawingPolygon=false;
  draggingVertex=-1;
  polygonViewBoxLock=null;

  $("shapeMode").value="free";
  $("dir").value="w";
  $("hasHouse").checked=true;
  $("houseSide").value="top";
  updateControls();
  calculate();
  setTimeout(fitCanvasView,60);
}

$("drawPolygon")?.addEventListener("click",startDrawingPolygon);
$("loadControlScheme")?.addEventListener("click",loadControlScheme);
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

let viewScale=1;
let viewX=0;
let viewY=0;
let isPanning=false;
let panStart={x:0,y:0,vx:0,vy:0};
let spaceDown=false;

function updateWorldGrid(){
  const vp=$("canvasViewport");
  const terrace=$("terrace");
  if(!vp||!terrace||!lastModel) return;

  const direction=lastModel.direction;
  const projectL=direction==="l" ? lastModel.run : lastModel.across;
  const projectW=direction==="l" ? lastModel.across : lastModel.run;

  if(!projectL||!projectW) return;

  // Мелкая сетка 500 мм, крупная — 1000 мм.
  const pxPerMmX=terrace.offsetWidth/projectL;
  const pxPerMmY=terrace.offsetHeight/projectW;

  let minorX=500*pxPerMmX*viewScale;
  let minorY=500*pxPerMmY*viewScale;
  let majorX=1000*pxPerMmX*viewScale;
  let majorY=1000*pxPerMmY*viewScale;

  // Не даём сетке превратиться в серую заливку при сильном уменьшении.
  while(minorX<8 || minorY<8){
    minorX*=2; minorY*=2; majorX*=2; majorY*=2;
  }

  const rect=vp.getBoundingClientRect();
  const cx=rect.width/2+viewX;
  const cy=rect.height/2+viewY;

  vp.style.setProperty("--grid-minor-x",minorX+"px");
  vp.style.setProperty("--grid-minor-y",minorY+"px");
  vp.style.setProperty("--grid-major-x",majorX+"px");
  vp.style.setProperty("--grid-major-y",majorY+"px");
  vp.style.setProperty("--grid-origin-x",cx+"px");
  vp.style.setProperty("--grid-origin-y",cy+"px");
}

function applyCanvasTransform(){
  const scene=$("canvasScene");
  if(!scene) return;
  scene.style.transform="translate("+viewX+"px,"+viewY+"px) scale("+viewScale+")";
  const zr=$("zoomReset");
  if(zr) zr.textContent=Math.round(viewScale*100)+"%";
  updateWorldGrid();
}

function resetCanvasView(){
  viewScale=1;
  viewX=0;
  viewY=0;
  applyCanvasTransform();
}

function fitCanvasView(){
  const vp=$("canvasViewport");
  const terrace=$("terrace");
  if(!vp||!terrace) return;
  const pad=50;
  const sx=(vp.clientWidth-pad*2)/Math.max(1,terrace.offsetWidth);
  const sy=(vp.clientHeight-pad*2)/Math.max(1,terrace.offsetHeight);
  viewScale=Math.max(.25,Math.min(2.5,Math.min(sx,sy)));
  viewX=0;
  viewY=0;
  applyCanvasTransform();
}

function setCanvasZoom(nextScale,anchorClientX=null,anchorClientY=null){
  const vp=$("canvasViewport");
  if(!vp) return;
  const old=viewScale;
  nextScale=Math.max(.25,Math.min(4,nextScale));
  if(nextScale===old) return;

  const rect=vp.getBoundingClientRect();
  const ax=(anchorClientX??(rect.left+rect.width/2))-rect.left-rect.width/2;
  const ay=(anchorClientY??(rect.top+rect.height/2))-rect.top-rect.height/2;

  const sceneX=(ax-viewX)/old;
  const sceneY=(ay-viewY)/old;

  viewScale=nextScale;
  viewX=ax-sceneX*viewScale;
  viewY=ay-sceneY*viewScale;
  applyCanvasTransform();
}

$("zoomIn")?.addEventListener("click",()=>setCanvasZoom(viewScale*1.15));
$("zoomOut")?.addEventListener("click",()=>setCanvasZoom(viewScale/1.15));
$("zoomReset")?.addEventListener("click",resetCanvasView);
$("zoomFit")?.addEventListener("click",fitCanvasView);

$("canvasViewport")?.addEventListener("wheel",e=>{
  e.preventDefault();
  const factor=e.deltaY<0?1.1:1/1.1;
  setCanvasZoom(viewScale*factor,e.clientX,e.clientY);
},{passive:false});

$("canvasViewport")?.addEventListener("pointerdown",e=>{
  const panAllowed=e.button===1 || e.button===2 || spaceDown;
  if(!panAllowed) return;
  e.preventDefault();
  isPanning=true;
  panStart={x:e.clientX,y:e.clientY,vx:viewX,vy:viewY};
  $("canvasViewport").classList.add("panning");
  $("canvasViewport").setPointerCapture(e.pointerId);
});

$("canvasViewport")?.addEventListener("pointermove",e=>{
  if(!isPanning) return;
  viewX=panStart.vx+(e.clientX-panStart.x);
  viewY=panStart.vy+(e.clientY-panStart.y);
  applyCanvasTransform();
});

function endPan(e){
  if(!isPanning) return;
  isPanning=false;
  $("canvasViewport")?.classList.remove("panning");
  try{if($("canvasViewport")?.hasPointerCapture(e.pointerId)) $("canvasViewport").releasePointerCapture(e.pointerId);}catch(_){}
}
$("canvasViewport")?.addEventListener("pointerup",endPan);
$("canvasViewport")?.addEventListener("pointercancel",endPan);

window.addEventListener("keydown",e=>{
  if(e.code==="Space" && !["INPUT","SELECT","TEXTAREA"].includes(document.activeElement?.tagName)){
    spaceDown=true;
    document.body.classList.add("spacePan");
    e.preventDefault();
  }
});
window.addEventListener("keyup",e=>{
  if(e.code==="Space"){
    spaceDown=false;
    document.body.classList.remove("spacePan");
  }
});

window.addEventListener("resize",()=>setTimeout(fitCanvasView,80));
setTimeout(fitCanvasView,150);


function notify3D(){
  window.dispatchEvent(new CustomEvent("nimtech-model-change"));
}


window.getNimtech3DModel=()=>lastModel;
window.getNimtechProjectInputs=()=>{
  const free=$("shapeMode").value==="free";
  const m=free?getPolygonMetrics():null;
  return {
  L:free?m.bboxL:(+$("L").value||6200),
  W:free?m.bboxW:(+$("W").value||3800),
  boardModule:+$("boardModule").value||150,
  boardHeight:+$("boardHeight").value||23,
  direction:$("dir").value,
  shapeMode:$("shapeMode").value,
  base:$("base").value,
  polygonPoints:polygonPoints.map(p=>({...p})),
  polygonClosed,
  projectZones:projectZones.map(z=>({...z}))
  };
};
$("canvasViewport")?.addEventListener("contextmenu",e=>e.preventDefault());
