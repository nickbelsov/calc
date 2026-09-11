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

  const jlen=model.across/1000;
  [...(model.joists?.regular||[]),...(model.joists?.seam||[])].forEach(pos=>{
    if(dir==='l') box(.04,joistH,jlen,joistMat,-sx/2+pos/1000,joistY,0);
    else box(jlen,joistH,.04,joistMat,0,joistY,-sz/2+pos/1000);
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
