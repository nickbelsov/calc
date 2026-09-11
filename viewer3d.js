import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const host=document.getElementById('threeViewport');
const btn2=document.getElementById('view2D');
const btn3=document.getElementById('view3D');

let renderer,scene,camera,controls,modelGroup,ro;

function init(){
  if(renderer||!host) return;
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  host.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0xf3f3f0);
  camera=new THREE.PerspectiveCamera(42,1,0.01,200);
  camera.position.set(7,6,8);

  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.08;
  controls.target.set(0,0,0);
  controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE=THREE.MOUSE.DOLLY;

  scene.add(new THREE.HemisphereLight(0xffffff,0x8f9599,2.1));
  const sun=new THREE.DirectionalLight(0xffffff,2.2);
  sun.position.set(5,10,7);sun.castShadow=true;scene.add(sun);

  const grid=new THREE.GridHelper(30,30,0xd9dad7,0xe7e8e5);
  grid.position.y=-.56;scene.add(grid);

  modelGroup=new THREE.Group();scene.add(modelGroup);
  ro=new ResizeObserver(resize);ro.observe(host);
  renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
  resize();rebuild();
}

function resize(){
  if(!renderer) return;
  const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
}

function clearGroup(){
  while(modelGroup.children.length){
    const o=modelGroup.children.pop();
    o.geometry?.dispose?.();
    if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose?.()); else o.material?.dispose?.();
  }
}

function box(w,h,d,color,x,y,z){
  const mesh=new THREE.Mesh(
    new THREE.BoxGeometry(w,h,d),
    new THREE.MeshStandardMaterial({color,roughness:.82,metalness:.03})
  );
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;modelGroup.add(mesh);return mesh;
}

function polygonMmPoints(inp){
  const pts=inp.polygonPoints||[];
  if(pts.length<3) return [];
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const bw=Math.max(1,maxX-minX),bh=Math.max(1,maxY-minY);
  return pts.map(p=>({
    x:(p.x-minX)/bw*inp.L,
    z:(p.y-minY)/bh*inp.W
  }));
}

function polygonCrossSegments(inp,axisValue,dir){
  const pts=polygonMmPoints(inp);
  if(pts.length<3) return [];
  const hits=[];

  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length];

    if(dir==='l'){
      if((a.x<=axisValue&&b.x>axisValue)||(b.x<=axisValue&&a.x>axisValue)){
        const t=(axisValue-a.x)/(b.x-a.x);
        hits.push(a.z+t*(b.z-a.z));
      }
    }else{
      if((a.z<=axisValue&&b.z>axisValue)||(b.z<=axisValue&&a.z>axisValue)){
        const t=(axisValue-a.z)/(b.z-a.z);
        hits.push(a.x+t*(b.x-a.x));
      }
    }
  }

  hits.sort((a,b)=>a-b);
  const segs=[];
  for(let i=0;i+1<hits.length;i+=2){
    if(hits[i+1]-hits[i]>1) segs.push({start:hits[i],length:hits[i+1]-hits[i]});
  }
  return segs;
}

function rebuild(){
  if(!renderer) return;
  const model=window.getNimtech3DModel?.();
  const inp=window.getNimtechProjectInputs?.();
  if(!model||!inp) return;

  clearGroup();
  const sx=inp.L/1000,sz=inp.W/1000;
  const boardH=Math.max(.018,inp.boardHeight/1000),joistH=.04,beltH=.08;
  const boardY=.18+joistH+beltH+boardH/2,joistY=.18+beltH+joistH/2,beltY=.18+beltH/2;
  const boardMat=0xb38359,joistMat=0x44494d,beltMat=0x8b684b,pileMat=0x6c7175;
  const dir=model.direction;

  if(inp.shapeMode==='free' && inp.polygonClosed){
    const pts=polygonMmPoints(inp);
    if(pts.length>=3){
      const shape=new THREE.Shape();
      shape.moveTo(-sx/2+pts[0].x/1000,-sz/2+pts[0].z/1000);
      for(let i=1;i<pts.length;i++) shape.lineTo(-sx/2+pts[i].x/1000,-sz/2+pts[i].z/1000);
      shape.closePath();
      const geo=new THREE.ShapeGeometry(shape);
      const mat=new THREE.MeshStandardMaterial({color:0xd8c4af,roughness:.95,metalness:0,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geo,mat);
      mesh.rotation.x=-Math.PI/2;
      mesh.position.y=boardY-boardH/2-.004;
      mesh.receiveShadow=true;
      modelGroup.add(mesh);
    }
  }

  if(model.boardRows?.rows){
    const rowCount=model.boardRows.rows.length||1;
    model.boardRows.rows.forEach((row,ri)=>{
      const segments=model.boardRows.polygon?(row.segments||[]):[{start:0,length:model.run,pieces:row.pieces||[]}];
      const acrossPos=model.boardRows.polygon?(row.axis||0):((ri+.5)/rowCount*model.across);
      segments.forEach(seg=>{
        let cursor=seg.start;
        (seg.pieces||[]).forEach(piece=>{
          const len=piece.length/1000,module=inp.boardModule/1000*.92;
          if(dir==='l') box(len,boardH,module,boardMat,-sx/2+cursor/1000+len/2,boardY,-sz/2+acrossPos/1000);
          else box(module,boardH,len,boardMat,-sx/2+acrossPos/1000,boardY,-sz/2+cursor/1000+len/2);
          cursor+=piece.length;
        });
      });
    });
  }

  const allJoists=[...(model.joists?.regular||[]),...(model.joists?.seam||[])];
  allJoists.forEach(pos=>{
    if(inp.shapeMode==='free' && inp.polygonClosed){
      const segs=polygonCrossSegments(inp,pos,dir);
      segs.forEach(seg=>{
        const len=seg.length/1000;
        if(dir==='l'){
          box(.04,joistH,len,joistMat,-sx/2+pos/1000,joistY,-sz/2+seg.start/1000+len/2);
        }else{
          box(len,joistH,.04,joistMat,-sx/2+seg.start/1000+len/2,joistY,-sz/2+pos/1000);
        }
      });
    }else{
      const jlen=model.across/1000;
      if(dir==='l') box(.04,joistH,jlen,joistMat,-sx/2+pos/1000,joistY,0);
      else box(jlen,joistH,.04,joistMat,0,joistY,-sz/2+pos/1000);
    }
  });

  if(model.polygonStructure){
    model.polygonStructure.belts.forEach(b=>b.segments.forEach(seg=>{
      const len=seg.length/1000;
      if(dir==='l') box(len,beltH,.08,beltMat,-sx/2+seg.start/1000+len/2,beltY,-sz/2+b.axis/1000);
      else box(.08,beltH,len,beltMat,-sx/2+b.axis/1000,beltY,-sz/2+seg.start/1000+len/2);
      (seg.piles||[]).forEach(p=>{
        const ph=.55;
        if(dir==='l') box(.09,ph,.09,pileMat,-sx/2+p/1000,-ph/2,-sz/2+b.axis/1000);
        else box(.09,ph,.09,pileMat,-sx/2+b.axis/1000,-ph/2,-sz/2+p/1000);
      });
    }));
  }else{
    (model.beltLayout?.positions||[]).forEach(bp=>{
      if(dir==='l') box(sx,beltH,.08,beltMat,0,beltY,-sz/2+bp/1000);
      else box(.08,beltH,sz,beltMat,-sx/2+bp/1000,beltY,0);
      (model.pileLayout?.positions||[]).forEach(pp=>{
        const ph=.55;
        if(dir==='l') box(.09,ph,.09,pileMat,-sx/2+pp/1000,-ph/2,-sz/2+bp/1000);
        else box(.09,ph,.09,pileMat,-sx/2+bp/1000,-ph/2,-sz/2+pp/1000);
      });
    });
  }

  const maxDim=Math.max(sx,sz);
  controls.target.set(0,.05,0);
  camera.position.set(maxDim*.95,maxDim*.78,maxDim*1.08);
  controls.update();
}

btn3?.addEventListener('click',()=>{
  document.body.classList.add('view3d');
  btn3.classList.add('active');btn2.classList.remove('active');
  init();resize();rebuild();
});
btn2?.addEventListener('click',()=>{
  document.body.classList.remove('view3d');
  btn2.classList.add('active');btn3.classList.remove('active');
});
window.addEventListener('nimtech-model-change',()=>{if(renderer) rebuild();});
