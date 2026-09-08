/* Rendering harness: Three.js. Nonphysical motion/UI: GSAP. Controls: lil-gui.
   Physics stays in physics.js and the geometry shader. No build step required. */
(async function () {
  'use strict';
  const $=id=>document.getElementById(id);
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const defaults={mass:4.3,distance:24,fov:50,camera:'Static',color:'Temperature',
    convention:'Public / thermal',exposure:1.1,peakTemperature:45000,disk:true,
    doppler:true,redshift:true,higherImages:true,skyLensing:true,gravityOverlay:false,
    gravityDriver:'Redshift',gravityOpacity:.3,palette:'Solar amber',cold:'#360e06',
    middle:'#fb751a',hot:'#fff2be',dopplerExaggeration:1,annotations:'Auto',
    photonMarker:false,quality:'Balanced',diagnostics:false,clockRate:100,paused:false,
    diskModel:'Shakura–Sunyaev',periapsis:4.5,betaInfinity:.25,look:'Toward hole',
    comparison:false,comparisonMode:'Natural',comparisonSplit:.5,
    experimentSpeed:1,experimentAzimuth:0,experimentElevation:.12,experimentRadius:8};
  const settings={...defaults};
  const motion={yaw:.25,elevation:.23,distance:defaults.distance};
  const palettes={
    'Deep ocean':['#011728','#0798ab','#c8fff2'],
    'Nebula':['#160c3c','#aa35d2','#ffd6ef'],
    'Solar amber':['#360e06','#fb751a','#fff2be'],
    'Cyberpunk':['#102660','#ee167c','#81ffed'],
    'Monochrome gold':['#161006','#927c3c','#fff3b0']};
  let renderer,target,scene,quad,ortho,geometryMaterial,presentationMaterial,probeMaterial,probeTarget,pickMaterial,pickTarget;
  let uniforms,gui,controllers={},cameraKm,orbit=null,properTime=0,lastTime=0,frames=0,fpsTime=0;
  let lastBand='',lastLookupRadius=0,lookupTimer,weakTexture,tour=null,drag=null,resizeObserver;
  let width=1,height=1,scale=1,qualityScale=1,frameNumber=0,pausedContext=false;
  let lastProbe=0,lastLabels='',lastResize=0,lowFpsCount=0,fps=0,lastGeometryKey='';
  const vector=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
  const cameraVectors={};
  let flyby=null,plunge=null,traceMilliseconds=0,experiment=null;
  function fail(message){pausedContext=true;$('error').hidden=false;$('error').textContent=message;$('loading').style.display='none';$('render-label').textContent='RENDERER UNAVAILABLE';}
  if(!window.gsap||!window.lil){
    fail('A CDN dependency could not load. Check your internet connection and allow cdn.jsdelivr.net, then reload. This page needs Three.js, GSAP and lil-gui.');return;
  }
  // Supported CDN ES module, imported from this classic script so file:// also works.
  // No bundler, import map, npm install, or deprecated global Three.js build.
  let THREE;
  try{THREE=await import('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.min.js');}
  catch(error){console.error(error);fail('Three.js could not load from its CDN. Check your internet connection and allow cdn.jsdelivr.net, then reload.');return;}
  const P=BHPhysics;
  const tween=(object,values)=>gsap.to(object,{duration:reducedMotion?0:.7,ease:'power2.out',overwrite:'auto',...values});
  const massKm=()=>P.schwarzschildKm(settings.mass*1e6);
  const minimumRadius=()=>settings.camera==='Orbiting'?3.05:settings.camera==='Plunge'?.2:1.51;
  function floatTexture(data,w,h){
    const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType);
    t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;
  }
  function makeSky(){
    // Synthetic extended-source environment. Positions, source sizes and colors
    // are scene choices; all distortion of this fixed map comes from traced rays.
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#020307';ctx.fillRect(0,0,2048,1024);
    let seed=38179;
    const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<120;i++){
      const x=random()*2048,y=510+160*Math.sin(x/2048*Math.PI*2)+80*(random()-.5);
      const radius=50+random()*130,g=ctx.createRadialGradient(x,y,0,x,y,radius);
      g.addColorStop(0,'rgba(25,33,51,0.028)');g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
    // Finite angular source disks help filtering; these are not catalog point stars.
    for(let i=0;i<5200;i++){
      const x=random()*2048,y=Math.acos(2*random()-1)/Math.PI*1024;
      const radius=.25+Math.pow(random(),6)*1.7,alpha=.12+random()*.65;
      const warm=random()>.77;
      ctx.fillStyle=warm?`rgba(232,201,163,${alpha})`:`rgba(190,209,237,${alpha})`;
      ctx.beginPath();ctx.arc(x,y,radius,0,2*Math.PI);ctx.fill();
    }
    // A few resolvable bright stars make multiple lensed images identifiable.
    for(const [x,y] of [[1100,480],[520,720],[1600,220],[1820,680],[70,410]]){
      const gradient=ctx.createRadialGradient(x,y,0,x,y,4);
      gradient.addColorStop(0,'#fff9e8');gradient.addColorStop(.22,'#bccff0');gradient.addColorStop(1,'rgba(30,50,90,0)');
      ctx.fillStyle=gradient;ctx.fillRect(x-4,y-4,8,8);
    }
    const tex=new THREE.CanvasTexture(canvas);tex.wrapS=THREE.RepeatWrapping;
    tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
  }
  function initialize(){
    const canvas=document.createElement('canvas');
    const context=canvas.getContext('webgl2',{antialias:false,alpha:false,powerPreference:'high-performance'});
    if(!context)throw Error('WebGL2 is unavailable. Enable hardware acceleration in a modern browser and reload.');
    if(!context.getExtension('EXT_color_buffer_float'))throw Error('This GPU does not support floating-point WebGL2 render targets, which the shared physics buffers require.');
    if(!context.getExtension('OES_texture_float_linear'))throw Error('This GPU lacks floating-point texture filtering needed for the numerical lookup tables.');
    renderer=new THREE.WebGLRenderer({canvas,context,antialias:false});
    renderer.autoClear=false;renderer.setClearColor(0x000000);
    renderer.debug.onShaderError=(gl,program,vertexShader,fragmentShader)=>{
      const diagnostic=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertexShader),gl.getShaderInfoLog(fragmentShader)].filter(Boolean).join('\n');
      // Abort the current draw as well as subsequent frames; never spam useProgram errors.
      throw Error('Shader compilation failed: '+diagnostic);
    };
    $('render-host').appendChild(renderer.domElement);
    const shared={resolution:{value:new THREE.Vector2(1,1)},cameraPosition:{value:vector()},
      cameraRight:{value:vector()},cameraUp:{value:vector()},cameraForward:{value:vector()},
      cameraVelocity:{value:vector()},tanHalfFov:{value:1},infalling:{value:false}};
    uniforms={...shared,diskEnabled:{value:true},useLookup:{value:false},
      weakLookup:{value:floatTexture(new Float32Array(8),1,2)},lookupRange:{value:vector()},
      maxSteps:{value:512},tolerance:{value:1e-6},peakTemperature:{value:settings.peakTemperature},
      physicalBuffer:{value:null},intersectionBuffer:{value:null},spectrum:{value:floatTexture(P.spectrumTable(),1024,1)},
      sky:{value:makeSky()},colorMode:{value:1},thermalConvention:{value:0},gravityDriver:{value:0},
      dopplerEnabled:{value:true},redshiftEnabled:{value:true},skyLensing:{value:true},higherImages:{value:true},
      gravityOverlay:{value:false},diagnostics:{value:false},exposure:{value:settings.exposure},
      gravityOpacity:{value:.3},dopplerExaggeration:{value:1},paletteA:{value:new THREE.Color()},
      paletteB:{value:new THREE.Color()},paletteC:{value:new THREE.Color()},
      diskModel:{value:0},ntPeakFlux:{value:P.NT_PEAK_FLUX},metadataBuffer:{value:null},
      comparisonEnabled:{value:false},comparisonMode:{value:0},comparisonSplit:{value:.5},samplesPerPixel:{value:1},
      objectCount:{value:0},coordinateTime:{value:0},historyCounts:{value:Array(8).fill(0)},
      objectBoundsMin:{value:Array.from({length:8},()=>vector())},objectBoundsMax:{value:Array.from({length:8},()=>vector())},
      objectPositions:{value:floatTexture(new Float32Array(8*2048*4),2048,8)},
      objectVelocities:{value:floatTexture(new Float32Array(8*2048*4),2048,8)},objectShapes:{value:floatTexture(new Float32Array(8*2048*4),2048,8)}};
    target=new THREE.WebGLMultipleRenderTargets(1,1,3);
    target.depthBuffer=false;target.stencilBuffer=false;
    target.texture.forEach(t=>{t.type=THREE.FloatType;t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;});
    experiment=new BHExperimentEngine();experiment.reset({mass:settings.mass*1e6});
    geometryMaterial=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:BHShaders.vertex,fragmentShader:BHShaders.geometry,uniforms:{...uniforms,resolution:{value:new THREE.Vector2(1,1)}},depthTest:false,depthWrite:false});
    presentationMaterial=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:BHShaders.vertex,fragmentShader:BHShaders.presentation,uniforms,depthTest:false,depthWrite:false});
    probeTarget=new THREE.WebGLRenderTarget(64,48,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
    probeMaterial=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:BHShaders.vertex,
      fragmentShader:`precision highp float;uniform sampler2D physicalBuffer,intersectionBuffer;out vec4 outputData;void main(){vec2 uv=gl_FragCoord.xy/vec2(64.,48.);vec4 p=texture(physicalBuffer,uv),h=texture(intersectionBuffer,uv);outputData=vec4(p.z,p.x,h.w,1.);}`,
      uniforms,depthTest:false,depthWrite:false});
    pickTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false});
    pickMaterial=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:BHShaders.vertex,
      fragmentShader:`precision highp float;uniform sampler2D source;uniform vec2 point;out vec4 outputData;void main(){outputData=texture(source,point);}`,
      uniforms:{source:{value:null},point:{value:new THREE.Vector2()}},depthTest:false,depthWrite:false});
    scene=new THREE.Scene();ortho=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),geometryMaterial);quad.frustumCulled=false;scene.add(quad);
    cameraKm=massKm()*motion.distance;
    buildControls();bindEvents();setPalette(settings.palette);updateMode();resize();updateExperimentList();
    resizeObserver=new ResizeObserver(()=>resize());resizeObserver.observe($('viewport'));
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();pausedContext=true;fail('The GPU context was lost. Reload the page to recreate the numerical buffers.');});
    gsap.from('.viewport-heading,.panel-heading,.readouts',{opacity:0,y:reducedMotion?0:8,duration:reducedMotion?0:1,stagger:.1});
    if(!reducedMotion)gsap.to('.loading-orbit',{rotation:360,duration:2,repeat:-1,ease:'none'});
    requestAnimationFrame(frame);
    // Small public inspection surface for reproducible numerical/browser checks.
    window.blackHoleLab={settings,motion,renderer,uniforms,THREE,get target(){return target;},
      setMode:mode=>{settings.color=mode;updateMode();gui.controllersRecursive().forEach(c=>c.updateDisplay());},
      setCamera:mode=>{settings.camera=mode;changeCamera();},
      setDistance:r=>{stopTour();setDistance(r,false);},
      reset,probe:readProbe,physics:P,gui,resize,updateMode,readPixel,setDynamics,
      get cameraVectors(){return cameraVectors;},get fps(){return fps;},get properTime(){return properTime;},
      get traceMilliseconds(){return traceMilliseconds;},get flyby(){return flyby;},get plunge(){return plunge;},
      get frameNumber(){return frameNumber;},get defaults(){return {...defaults};},
      exportPNG:()=>{quad.material=presentationMaterial;renderer.setRenderTarget(null);renderer.render(scene,ortho);return renderer.domElement.toDataURL('image/png');},
      experiment,spawnObject:(type,config)=>{if(!experiment)return null;const id=experiment.spawn({type,...config});updateExperimentList();return id;},removeObject:(id)=>{if(!experiment)return;const o=experiment.objects.find(o=>o.id===id);if(o)o.visible=false;updateExperimentList();},resetExperiment:()=>{if(!experiment)return;experiment.reset({mass:settings.mass*1e6});uniforms.objectCount.value=0;updateExperimentList();}};
    window.dispatchEvent(new Event('blackhole-ready'));
  }
  function setDynamics(snapshot){
    const objects=snapshot.objects.filter(o=>o.visible&&o.type!=='Light').slice(0,8);
    uniforms.objectCount.value=objects.length;uniforms.coordinateTime.value=snapshot.time;
    uniforms.historyCounts.value.fill(0);
    const positions=uniforms.objectPositions.value.image.data,velocities=uniforms.objectVelocities.value.image.data,shapes=uniforms.objectShapes.value.image.data;
    for(let id=0;id<objects.length;id++){
      const object=objects[id],history=object.history.slice(-2048);uniforms.historyCounts.value[id]=history.length;
      const min=uniforms.objectBoundsMin.value[id].set(Infinity,Infinity,Infinity),max=uniforms.objectBoundsMax.value[id].set(-Infinity,-Infinity,-Infinity);
      history.forEach((h,i)=>{
        const offset=(id*2048+i)*4,radius=object.config.radius/snapshot.rs;
        positions.set([h.t,...h.x],offset);velocities.set(h.u,offset);
        const axes=h.axes.map(a=>a*radius),period=object.config.pulsePeriod||snapshot.units;
        const temperature=object.type==='Probe'&&((h.tau*snapshot.units)%period)>period*.2?0:h.temperature;
        shapes.set([...axes,h.ended?0:temperature],offset);
        const extent=Math.max(...axes)*4;min.min(vector(...h.x).addScalar(-extent));max.max(vector(...h.x).addScalar(extent));
      });
    }
    uniforms.objectPositions.value.needsUpdate=uniforms.objectVelocities.value.needsUpdate=uniforms.objectShapes.value.needsUpdate=true;
    lastGeometryKey='';
  }
  function buildControls(){
    gui=new lil.GUI({container:$('gui-host'),title:'Simulation'});
    const space=gui.addFolder('Black hole & observer');
    controllers.mass=space.add(settings,'mass',.00001,6500,.00001).name('Mass · million M☉').onChange(()=>{
      stopTour();gsap.killTweensOf(motion,'distance');
      // Hold physical kilometres fixed: changing mass must change apparent geometry.
      const next=Math.max(minimumRadius(),Math.min(1000,cameraKm/massKm()));
      motion.distance=settings.distance=next;cameraKm=next*massKm();invalidateLookup();updateReadouts();
      if(experiment)experiment.reset({mass:settings.mass*1e6});
    });
    controllers.camera=space.add(settings,'camera',['Static','Orbiting','Flyby','Plunge']).name('Observer').onChange(changeCamera);
    controllers.distance=space.add(settings,'distance',1.51,1000,.01).name('Distance · rₛ').listen().onChange(value=>{stopTour();setDistance(value);});
    space.add(settings,'fov',8,150,.1).name('Field of view · °');
    controllers.clock=space.add(settings,'clockRate',1,1000,1).name('Clock rate · ×');
    controllers.paused=space.add(settings,'paused').name('Pause motion');
    controllers.look=space.add(settings,'look',['Toward hole','Outward sky']).name('Look direction');
    controllers.periapsis=space.add(settings,'periapsis',2.05,15,.05).name('Flyby periapsis · rₛ').onFinishChange(()=>changeCamera());
    controllers.betaInfinity=space.add(settings,'betaInfinity',.05,.8,.01).name('Flyby speed · c').onFinishChange(()=>changeCamera());
    const view=gui.addFolder('Light & color');
    view.add(settings,'color',['Natural','Temperature','Gravity','Artistic','Doppler']).name('Rendering mode').onChange(updateMode);
    view.add(settings,'exposure',-6,6,.05).name('Exposure · EV');
    controllers.temperature=view.add(settings,'peakTemperature',5000,500000,1000).name('Peak temp. · K').onChange(updateMode);
    view.add(settings,'diskModel',['Shakura–Sunyaev','Novikov–Thorne']).name('Disk model');
    controllers.convention=view.add(settings,'convention',['Public / thermal','Scientific / X-ray']).name('Convention').onChange(updateMode);
    controllers.palette=view.add(settings,'palette',Object.keys(palettes).concat('Custom')).name('Palette').onChange(setPalette);
    ['cold','middle','hot'].forEach((key,i)=>controllers[key]=view.addColor(settings,key).name(['Cool color','Mid color','Hot color'][i]).onChange(()=>{settings.palette='Custom';updateMode();}));
    controllers.exaggeration=view.add(settings,'dopplerExaggeration',.1,4,.1).name('Doppler contrast').onChange(updateMode);
    controllers.gravityDriver=view.add(settings,'gravityDriver',['Redshift','Potential','Curvature']).name('Gravity scalar').onChange(updateMode);
    controllers.gravityOpacity=view.add(settings,'gravityOpacity',0,1,.01).name('Overlay opacity');
    const effects=gui.addFolder('Isolate the effects');
    effects.add(settings,'disk').name('Accretion disk');
    effects.add(settings,'doppler').name('Disk Doppler');
    effects.add(settings,'redshift').name('Gravitational shift');
    effects.add(settings,'higherImages').name('Higher-order light');
    effects.add(settings,'skyLensing').name('Sky lensing');
    effects.add(settings,'gravityOverlay').name('Gravity overlay').onChange(updateMode);
    effects.close();
    const guide=gui.addFolder('Guides & precision');
    guide.add(settings,'annotations',['Auto','On','Off']).name('Annotations').onChange(()=>{lastBand='';lastProbe=0;});
    guide.add(settings,'photonMarker').name('Critical-curve guide');
    guide.add(settings,'quality',['Fast','Balanced','Fine']).name('Render quality').onChange(()=>{qualityScale=1;resize();});
    guide.add(settings,'diagnostics').name('Unresolved rays');
    guide.close();
    const compare=gui.addFolder('Compare & inspect');
    compare.add(settings,'comparison').name('Split comparison');
    compare.add(settings,'comparisonMode',['Natural','Temperature','Gravity','Artistic','Doppler']).name('Right-hand mode');
    compare.add(settings,'comparisonSplit',.1,.9,.01).name('Split position');
    compare.close();
    const experimentFolder=gui.addFolder('Experiment');
    experimentFolder.add(settings,'experimentSpeed',0,10,.1).name('Speed ×');
    experimentFolder.add(settings,'experimentRadius',.5,80,.5).name('Spawn radius · rₛ');
    experimentFolder.add(settings,'experimentAzimuth',-180,180,1).name('Azimuth · °');
    experimentFolder.add(settings,'experimentElevation',-90,90,1).name('Elevation · °');
    const spawnActions={probe:()=>spawnObject('Probe'),rock:()=>spawnObject('Rock'),spacecraft:()=>spawnObject('Spacecraft'),star:()=>spawnObject('Star'),cloud:()=>spawnObject('Cloud'),light:()=>spawnObject('Light')};
    experimentFolder.add(spawnActions,'probe').name('＋ Probe');
    experimentFolder.add(spawnActions,'rock').name('＋ Rock');
    experimentFolder.add(spawnActions,'spacecraft').name('＋ Spacecraft');
    experimentFolder.add(spawnActions,'star').name('＋ Star');
    experimentFolder.add(spawnActions,'cloud').name('＋ Cloud');
    experimentFolder.add(spawnActions,'light').name('＋ Light beam');
    const experimentReset={reset:()=>resetExperiment()};
    experimentFolder.add(experimentReset,'reset').name('↺ Reset experiment');
    experimentFolder.close();
    for(const [name,colors] of Object.entries(palettes)){
      const button=document.createElement('button');button.title=name;button.setAttribute('aria-label',name+' palette');
      button.style.background=`linear-gradient(120deg,${colors.join(',')})`;
      button.onclick=()=>{settings.palette=name;setPalette(name);};$('palette-gallery').appendChild(button);
    }
    updateCameraControls();
  }
  function setPalette(name){
    if(palettes[name])[settings.cold,settings.middle,settings.hot]=palettes[name];
    updateMode();gui.controllersRecursive().forEach(c=>c.updateDisplay());
  }
  function spawnObject(type){
    if(!experiment)return;
    const az=settings.experimentAzimuth*Math.PI/180,elev=settings.experimentElevation*Math.PI/180;
    const dir=type==='Light'?az*180/Math.PI:0;
    experiment.spawn({type,r:settings.experimentRadius,azimuth:az,elevation:elev,speed:settings.experimentSpeed,direction:dir});
    updateExperimentList();
  }
  function resetExperiment(){
    if(!experiment)return;
    experiment.reset({mass:settings.mass*1e6});uniforms.objectCount.value=0;updateExperimentList();
  }
  function updateExperimentList(){
    const host=$('experiment-list');if(!host)return;
    host.innerHTML='';
    if(!experiment||!experiment.objects.length){host.innerHTML='<span class="experiment-empty">No objects spawned</span>';return;}
    for(const o of experiment.objects){
      const row=document.createElement('div');row.className='experiment-row';
      row.innerHTML=`<span class="experiment-type">${o.type} #${o.id}</span>
        <button class="experiment-toggle" data-id="${o.id}" title="${o.visible?'Hide':'Show'}">${o.visible?'◉':'○'}</button>
        <button class="experiment-remove" data-id="${o.id}" title="Remove">×</button>`;
      host.appendChild(row);
    }
    host.querySelectorAll('.experiment-toggle').forEach(btn=>btn.onclick=()=>{
      const o=experiment.objects.find(o=>o.id===+btn.dataset.id);if(o)o.visible=!o.visible;updateExperimentList();
    });
    host.querySelectorAll('.experiment-remove').forEach(btn=>btn.onclick=()=>{
      const o=experiment.objects.find(o=>o.id===+btn.dataset.id);if(o)o.visible=false;updateExperimentList();
    });
  }
  function updateMode(){
    if(!gui)return;
    const mode=settings.color,art=mode==='Artistic',gravity=mode==='Gravity'||settings.gravityOverlay;
    controllers.convention.show(mode==='Temperature');controllers.palette.show(art);
    ['cold','middle','hot'].forEach(k=>controllers[k].show(art));
    controllers.exaggeration.show(mode==='Doppler');controllers.gravityDriver.show(gravity);controllers.gravityOpacity.show(gravity);
    $('palette-gallery').hidden=!art;
    const peak=settings.peakTemperature.toLocaleString('en-US');
    const notes={Natural:'Approximate visible-light appearance · Planck → CIE → sRGB. The emission peak can lie in UV/X-rays.',
      Temperature:'False color · observed temperature includes disk, observer and gravitational frequency shifts.',
      Gravity:'Scalar wash · disk emission radius or sky-ray closest approach. The shadow remains absorbing.',
      Artistic:'Custom false color · identical geodesics, temperature, frequency shifts and bolometric intensity.',
      Doppler:'D alone sets color; D⁴ sets bolometric brightness. Contrast exaggeration changes only the color key.'};
    $('mode-note').textContent=notes[mode];
    const thermal=settings.convention==='Public / thermal'?'#020000,#8e0801,#ff751a,#ffd754,#fff9e6':'#ef1507,#fff2ce,#1278ff';
    let gradient=mode==='Artistic'?`${settings.cold},${settings.middle},${settings.hot}`:thermal;
    if(mode==='Natural')gradient='#b42d04,#ffe1bb,#ffffff,#bdd5ff';
    if(mode==='Gravity')gradient='#064e88,#bd7661,#ff3714';
    if(mode==='Doppler')gradient='#ff2113,#ffffff,#216bff';
    $('colorbar').style.background=`linear-gradient(90deg,${gradient})`;
    $('legend-title').textContent=mode==='Doppler'?'EMITTER DOPPLER FACTOR':mode==='Gravity'?settings.gravityDriver.toUpperCase()+' / NORMALIZED':mode==='Natural'?'VISIBLE BLACKBODY COLOR':'OBSERVED TEMPERATURE';
    $('legend-low').textContent=mode==='Doppler'?(Math.max(0,1-1/settings.dopplerExaggeration)).toFixed(2):mode==='Gravity'?'Weak':mode==='Natural'?'3,000 K':'0 K';
    $('legend-middle').textContent=mode==='Doppler'?'D = 1':mode==='Gravity'?'':mode==='Natural'?'10,000 K':Math.round(settings.peakTemperature/2).toLocaleString()+' K';
    $('legend-high').textContent=mode==='Doppler'?(1+1/settings.dopplerExaggeration).toFixed(2):mode==='Gravity'?'Strong':mode==='Natural'?'30,000 K':peak+' K';
  }
  function updateCameraControls(){
    const moving=settings.camera!=='Static';
    controllers.clock.show(moving);controllers.paused.show(moving);
    controllers.distance.min(minimumRadius());
    controllers.periapsis.show(settings.camera==='Flyby');controllers.betaInfinity.show(settings.camera==='Flyby');
    controllers.look.show(moving);
    const notes={Static:'Static observer · hovering requires acceleration. Drag changes viewpoint, without adding observer velocity.',
      Orbiting:'Circular geodesic · local tetrad + aberration. Navigation resets the orbit; stable radius stays above ISCO.',
      Flyby:'Unbound timelike geodesic · radius and velocity follow the effective potential. Changing periapsis restarts the trajectory.',
      Plunge:'Radial E = 1 infall · regular Eddington–Finkelstein observer frame. Crosses the horizon; pauses at 0.2 rₛ, before the singularity.'};
    $('camera-note').textContent=notes[settings.camera];
  }
  function basePosition(){return vector(Math.cos(motion.elevation)*Math.sin(motion.yaw),Math.sin(motion.elevation),Math.cos(motion.elevation)*Math.cos(motion.yaw));}
  function startOrbit(){
    const radial=basePosition(),tangent=vector(radial.z,0,-radial.x).normalize();
    orbit={a:radial,b:tangent,phase:0};
  }
  function changeCamera(){
    stopTour();gsap.killTweensOf(motion);settings.paused=false;properTime=0;flyby=null;plunge=null;
    motion.distance=Math.max(minimumRadius(),motion.distance);
    if(settings.camera==='Orbiting'){
      if(motion.distance<3.05)setDistance(3.05,false);
      startOrbit();
    }else if(orbit){
      const p=cameraVectors.radial||basePosition();motion.yaw=Math.atan2(p.x,p.z);motion.elevation=Math.asin(p.y);orbit=null;
    }
    if(settings.camera==='Flyby'){
      startOrbit();flyby=P.flybyInitial(settings.periapsis,settings.betaInfinity,Math.max(24,motion.distance));motion.distance=flyby.y[0];
    }
    if(settings.camera==='Plunge'){
      // Start near enough that horizon crossing is practical at the explicit clock rate.
      motion.distance=Math.min(8,Math.max(.2,motion.distance));
      plunge={start:motion.distance,elapsed:0,v:0};orbit=null;settings.look='Outward sky';settings.fov=110;
    }
    invalidateLookup();
    updateCameraControls();
    // GSAP eases a cosmetic panel transition; velocity is always the exact active tetrad.
    gsap.fromTo('.camera-note',{opacity:.3},{opacity:1,duration:reducedMotion?0:.5});
  }
  function setDistance(value,animate=true){
    const destination=Math.max(minimumRadius(),Math.min(1000,value));
    invalidateLookup();
    if(settings.camera==='Flyby'||settings.camera==='Plunge'){
      // Repositioning starts new initial data; never silently splice a geodesic.
      motion.distance=destination;changeCamera();return;
    }
    if(animate)tween(motion,{distance:destination,duration:reducedMotion?0:.35,onUpdate:()=>{settings.distance=motion.distance;cameraKm=motion.distance*massKm();}});
    else{gsap.killTweensOf(motion,'distance');motion.distance=settings.distance=destination;cameraKm=destination*massKm();}
  }
  function invalidateLookup(){uniforms.useLookup.value=false;clearTimeout(lookupTimer);lastLookupRadius=0;}
  function scheduleLookup(r){
    if(settings.camera==='Plunge'||r<=60||Math.abs(r-lastLookupRadius)<1e-5)return;
    clearTimeout(lookupTimer);lastLookupRadius=r;
    lookupTimer=setTimeout(()=>{
      if(Math.abs(motion.distance-r)>1e-5)return;
      const result=P.weakTable(r);if(!result)return;
      if(weakTexture)weakTexture.dispose();
      weakTexture=floatTexture(result.data,result.size,2);
      uniforms.weakLookup.value=weakTexture;uniforms.lookupRange.value.set(result.bMin,result.bMax,r);
      uniforms.useLookup.value=true;
    },200);
  }
  function resize(){
    if(!renderer)return;
    const rect=$('viewport').getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    // Explicit pixel budgets are performance choices. HTML overlays remain native resolution.
    const budgets={Fast:280000,Balanced:620000,Fine:1300000};
    const supersample=settings.quality==='Fine'?2:1;
    scale=Math.min(devicePixelRatio,1.5,Math.sqrt(budgets[settings.quality]/(width*height))/supersample)*qualityScale;
    scale=Math.max(.3,scale);
    renderer.setPixelRatio(scale);renderer.setSize(width,height);
    const w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
    target.setSize(w*supersample,h*supersample);uniforms.resolution.value.set(w,h);
    geometryMaterial.uniforms.resolution.value.set(target.width,target.height);
    uniforms.samplesPerPixel.value=supersample*supersample;
    uniforms.physicalBuffer.value=target.texture[0];uniforms.intersectionBuffer.value=target.texture[1];
    uniforms.metadataBuffer.value=target.texture[2];
    $('annotations').setAttribute('viewBox',`0 0 ${width} ${height}`);lastResize=performance.now();lastProbe=0;lastGeometryKey='';
  }
  function updateCamera(dt){
    let radial=basePosition(),velocity=vector();
    let r=motion.distance;
    if(settings.camera==='Orbiting'){
      if(!orbit)startOrbit();
      // Physical proper seconds per simulated second; explicit user clock acceleration.
      const dTau=settings.paused?0:dt*settings.clockRate;
      properTime+=dTau;
      // Geometric time unit rs/c seconds. dphi/dtau=Omega/sqrt(1-3/(2r)).
      const rsSeconds=massKm()*1000/P.C;
      const omega=Math.sqrt(1/(2*r*r*r));
      orbit.phase+=dTau/rsSeconds*omega/Math.sqrt(1-1.5/r);
      radial=orbit.a.clone().multiplyScalar(Math.cos(orbit.phase)).addScaledVector(orbit.b,Math.sin(orbit.phase));
      velocity=orbit.a.clone().multiplyScalar(-Math.sin(orbit.phase)).addScaledVector(orbit.b,Math.cos(orbit.phase)).multiplyScalar(P.orbitalBeta(r));
    }
    if(settings.camera==='Flyby'&&flyby){
      const dTau=settings.paused?0:dt*settings.clockRate;properTime+=dTau;
      let interval=dTau/(massKm()*1000/P.C);
      while(interval>0){const h=Math.min(.025,interval);flyby.y=P.timelikeStep(flyby.y,flyby.L,h);interval-=h;}
      r=motion.distance=flyby.y[0];
      radial=orbit.a.clone().multiplyScalar(Math.cos(flyby.y[2])).addScaledVector(orbit.b,Math.sin(flyby.y[2]));
      const tangent=orbit.a.clone().multiplyScalar(-Math.sin(flyby.y[2])).addScaledVector(orbit.b,Math.cos(flyby.y[2]));
      // Local static components: beta_r=(dr/dtau)/E, beta_phi=L sqrt(f)/(rE).
      velocity=radial.clone().multiplyScalar(flyby.y[1]/flyby.E).addScaledVector(tangent,flyby.L*Math.sqrt(P.lapse(r))/(r*flyby.E));
      if(r>flyby.startRadius*1.1&&flyby.y[1]>0)settings.paused=true;
    }
    if(settings.camera==='Plunge'&&plunge){
      const remaining=(Math.pow(plunge.start,1.5)-Math.pow(.2,1.5))/1.5-plunge.elapsed;
      const interval=settings.paused?0:Math.max(0,Math.min(remaining,dt*settings.clockRate/(massKm()*1000/P.C)));
      const previous=r;plunge.elapsed+=interval;properTime+=interval*(massKm()*1000/P.C);
      r=motion.distance=Math.max(.2,P.infallRadius(plunge.start,plunge.elapsed));
      // dv/dtau=1/(1+1/sqrt(r)) is regular through the future horizon.
      plunge.v+=interval*.5*(1/(1+1/Math.sqrt(previous))+1/(1+1/Math.sqrt(r)));
      if(r<=.200001)settings.paused=true;
    }
    const forward=radial.clone().multiplyScalar(settings.look==='Outward sky'?1:-1);
    // Stable screen roll through the tilted orbit's poles: orbit normal is camera up reference.
    const upReference=orbit?orbit.a.clone().cross(orbit.b).normalize():vector(0,1,0);
    const right=forward.clone().cross(upReference).normalize(),up=right.clone().cross(forward).normalize();
    cameraVectors.radial=radial;cameraVectors.right=right;cameraVectors.up=up;cameraVectors.forward=forward;cameraVectors.velocity=velocity;
    uniforms.cameraPosition.value.copy(radial).multiplyScalar(r);
    uniforms.cameraRight.value.copy(right);uniforms.cameraUp.value.copy(up);uniforms.cameraForward.value.copy(forward);
    uniforms.cameraVelocity.value.copy(velocity);uniforms.tanHalfFov.value=Math.tan(settings.fov*Math.PI/360);
    uniforms.infalling.value=settings.camera==='Plunge';
    settings.distance=r;cameraKm=r*massKm();
    scheduleLookup(r);
  }
  function updateUniforms(){
    uniforms.diskEnabled.value=settings.disk;
    uniforms.diskModel.value=settings.diskModel==='Novikov–Thorne'?1:0;
    uniforms.comparisonEnabled.value=settings.comparison;uniforms.comparisonSplit.value=settings.comparisonSplit;
    uniforms.comparisonMode.value=['Natural','Temperature','Gravity','Artistic','Doppler'].indexOf(settings.comparisonMode);
    uniforms.colorMode.value=['Natural','Temperature','Gravity','Artistic','Doppler'].indexOf(settings.color);
    uniforms.thermalConvention.value=settings.convention==='Public / thermal'?0:1;
    uniforms.gravityDriver.value=['Redshift','Potential','Curvature'].indexOf(settings.gravityDriver);
    for(const [uniform,key] of Object.entries({dopplerEnabled:'doppler',redshiftEnabled:'redshift',skyLensing:'skyLensing',higherImages:'higherImages',gravityOverlay:'gravityOverlay',diagnostics:'diagnostics',exposure:'exposure',gravityOpacity:'gravityOpacity',dopplerExaggeration:'dopplerExaggeration',peakTemperature:'peakTemperature'}))uniforms[uniform].value=settings[key];
    uniforms.paletteA.value.set(settings.cold);uniforms.paletteB.value.set(settings.middle);uniforms.paletteC.value.set(settings.hot);
    // Distance-aware integration budget; strong-field rays also adapt by local u.
    const r=motion.distance,detail=Math.max(0,Math.min(1,Math.log(100/Math.max(r,1.51))/Math.log(100/1.51)));
    uniforms.maxSteps.value=Math.round(320+detail*1728);
    uniforms.tolerance.value=settings.quality==='Fine'?2e-7:settings.quality==='Fast'?3e-6:8e-7;
  }
  function updateReadouts(){
    const rs=massKm(),r=motion.distance;
    $('mass-value').innerHTML=settings.mass.toFixed(2)+' <small>million M☉</small>';
    for(const [id,factor] of [['horizon-value',1],['photon-value',1.5],['isco-value',3]])$(id).innerHTML=(rs*factor/1e6).toFixed(2)+' <small>million km</small>';
    $('camera-radius').innerHTML=r.toFixed(r>100?1:2)+' <small>rₛ</small>';
    $('camera-speed').textContent=settings.camera==='Plunge'?(r>1?'STATIC-FRAME SPEED '+(1/Math.sqrt(r)).toFixed(3)+' c':'INSIDE THE EVENT HORIZON'):'LOCAL SPEED '+cameraVectors.velocity.length().toFixed(3)+' c';
    // Log radius minimap: named radii have exactly mapped positions, not equal spacing.
    const radius=x=>x<1?13*x:13+42*Math.log(x)/Math.log(1000);
    const rings=$('radar').querySelectorAll('circle');rings[1].setAttribute('r',radius(1.5));rings[2].setAttribute('r',radius(3));
    const pos=cameraVectors.radial||basePosition(),angle=Math.atan2(pos.x,pos.z),rr=radius(r);
    const x=65+rr*Math.sin(angle),y=65-rr*Math.cos(angle);
    $('radar-camera').setAttribute('cx',x);$('radar-camera').setAttribute('cy',y);
    $('radar-line').setAttribute('x2',x);$('radar-line').setAttribute('y2',y);
    $('radar').setAttribute('aria-label',`Logarithmic radial map. Observer ${r.toFixed(2)} Schwarzschild radii. Horizon 1, photon sphere 1.5, ISCO 3.`);
    $('precision-note').textContent=`RK4 ≤ ${uniforms.maxSteps.value} · ${target.width} × ${target.height}${settings.quality==='Fine'?' · 4 rays/pixel':''}${uniforms.useLookup.value?' · sky LUT':''}`;
  }
  function updateBand(){
    const r=motion.distance,band=r<=1?'Interior':r>100?'Far':r>10?'Medium':r>3?'Close':'Extreme';
    if(band===lastBand)return;lastBand=band;
    const text={Far:'The shadow subtends a small angle. A narrow field of view helps resolve background lensing.',Medium:'Light from the far side of the disk bends over and under the shadow.',Close:'Doppler beaming and finite-distance frequency shifts are prominent. Look for higher-order disk images.',Extreme:'Near the unstable photon orbit, rays can wind around the hole. Finite pixel and precision limits matter here.',Interior:'You are inside the future horizon. External light can still reach you; no future-directed signal can escape back out.'};
    $('band-title').textContent=band.toUpperCase()+' FIELD';$('band-description').textContent=text[band];
    document.querySelectorAll('.band-progress i').forEach((e,i)=>e.classList.toggle('active',i===['Far','Medium','Close','Extreme'].indexOf(band)));
    gsap.fromTo('.regime-card',{opacity:.35},{opacity:1,duration:reducedMotion?0:.7});
    const on=settings.annotations==='On'||(settings.annotations==='Auto'&&band!=='Far');
    tween($('disk-labels'),{opacity:on?1:0,duration:.6});
  }
  function projectDirection(q){
    const v=cameraVectors,depth=q.dot(v.forward);
    if(depth<=.001)return null;
    const unit=height/(2*uniforms.tanHalfFov.value*depth);
    return [width/2+q.dot(v.right)*unit,height/2-q.dot(v.up)*unit];
  }
  function criticalGuide(){
    if(!settings.photonMarker||settings.camera==='Plunge'||settings.look==='Outward sky'){$('critical-marker').innerHTML='';return;}
    const r=motion.distance,alpha=Math.asin(Math.min(1,P.BC*Math.sqrt(1-1/r)/r));
    const v=cameraVectors,points=[];
    // Critical cone in the static tetrad, transformed into the moving camera.
    for(let i=0;i<=96;i++){
      const a=i/96*2*Math.PI;
      let q=v.radial.clone().multiplyScalar(-Math.cos(alpha)).addScaledVector(v.right,Math.sin(alpha)*Math.cos(a)).addScaledVector(v.up,Math.sin(alpha)*Math.sin(a));
      q=vector(...P.boostSky(q.toArray(),v.velocity.toArray().map(x=>-x)).direction);
      points.push(projectDirection(q));
    }
    const valid=points.filter(Boolean);if(valid.length!==points.length){$('critical-marker').innerHTML='';return;}
    const path=valid.map((p,i)=>(i?'L':'M')+p.map(x=>x.toFixed(1)).join(',')).join('');
    const top=valid.reduce((a,b)=>a[1]<b[1]?a:b);
    const labelY=Math.max(155,top[1]-17);
    $('critical-marker').innerHTML=`<path d="${path}" style="stroke-dasharray:3 7"/><text x="${Math.max(12,Math.min(width-230,top[0]+10))}" y="${labelY}">PHOTON SPHERE → CRITICAL CURVE</text>`;
  }
  function readProbe(){
    const data=new Float32Array(64*48*4);
    renderer.setRenderTarget(probeTarget);quad.material=probeMaterial;renderer.render(scene,ortho);
    renderer.readRenderTargetPixels(probeTarget,0,0,64,48,data);
    renderer.setRenderTarget(null);quad.material=presentationMaterial;
    return data;
  }
  function readPixel(uv){
    const point=[(Math.floor(uv[0]*target.width)+.5)/target.width,(Math.floor(uv[1]*target.height)+.5)/target.height];
    pickMaterial.uniforms.point.value.set(...point);quad.material=pickMaterial;renderer.setRenderTarget(pickTarget);
    const records=target.texture.map(texture=>{const values=new Float32Array(4);pickMaterial.uniforms.source.value=texture;renderer.render(scene,ortho);renderer.readRenderTargetPixels(pickTarget,0,0,1,1,values);return Array.from(values);});
    renderer.setRenderTarget(null);quad.material=presentationMaterial;return {physical:records[0],intersection:records[1],metadata:records[2],uv:point};
  }
  function updateAnnotations(time){
    criticalGuide();
    if(time-lastProbe<1100)return;lastProbe=time;
    const visible=settings.annotations==='On'||(settings.annotations==='Auto'&&lastBand!=='Far');
    if(!visible||!settings.disk){$('disk-labels').innerHTML='';return;}
    // Read a tiny downsample of actual ray intersections, not a projected unlensed mesh.
    const data=readProbe();let bestD=null,inner=null,ring=null;
    for(let i=0;i<64*48;i++){
      const D=data[i*4],r=data[i*4+1],tag=data[i*4+2];
      const x=(i%64+.5)/64*width,y=(1-(Math.floor(i/64)+.5)/48)*height;
      if(tag<2||x<35||x>width-35||y<155||y>height-190)continue;
      if(!bestD||D>bestD.D)bestD={D,x,y};
      if(!inner||r<inner.r)inner={r,x,y};
      if(tag>=3&&(!ring||y<ring.y))ring={x,y};
    }
    const label=(p,text,side,dy)=>{
      if(!p)return '';
      const endX=Math.max(20,Math.min(width-190,p.x+side*85)),endY=Math.max(166,Math.min(height-185,p.y+dy));
      return `<circle cx="${p.x}" cy="${p.y}" r="2"/><path d="M${p.x},${p.y} L${endX},${endY} h65"/><text x="${endX}" y="${endY-7}">${text}</text>`;
    };
    const labels=label(ring,'HIGHER-ORDER DISK IMAGE',1,-45)+
      (settings.doppler?label(bestD,'DOPPLER-BEAMED SIDE',-1,43):'')+
      (inner&&(!ring||Math.hypot(inner.x-ring.x,inner.y-ring.y)>70)?label(inner,'INNER DISK / ISCO 3 rₛ',1,45):'');
    if(labels!==lastLabels){$('disk-labels').innerHTML=labels;lastLabels=labels;}
  }
  function stopTour(){
    if(tour){tour.kill();tour=null;$('tour-button').textContent='▷ Guided journey';}
  }
  function guidedTour(){
    if(tour){stopTour();return;}
    settings.camera='Static';changeCamera();settings.fov=38;
    const stops=[{r:180,fov:9},{r:28,fov:38},{r:7,fov:90},{r:1.7,fov:110}];
    tour=gsap.timeline({onComplete:()=>{tour=null;$('tour-button').textContent='▷ Guided journey';}});
    $('tour-button').textContent='Ⅱ Stop journey';
    for(const stop of stops){
      // Navigation dolly in log(r-r_min): fine control close to the photon sphere.
      const proxy={logR:Math.log(motion.distance-1.5)};
      tour.to(proxy,{logR:Math.log(stop.r-1.5),duration:reducedMotion?.1:7,ease:'power2.inOut',
        onStart:()=>{proxy.logR=Math.log(motion.distance-1.5);invalidateLookup();},
        onUpdate:()=>{motion.distance=1.5+Math.exp(proxy.logR);settings.distance=motion.distance;cameraKm=motion.distance*massKm();}},'>');
      tour.to(settings,{fov:stop.fov,duration:reducedMotion?.1:7,ease:'power2.inOut'},'<');
      tour.to({}, {duration:5});
    }
  }
  function reset(){
    stopTour();gsap.killTweensOf(motion);Object.assign(settings,defaults);orbit=null;flyby=null;plunge=null;properTime=0;qualityScale=1;
    Object.assign(motion,{yaw:.25,elevation:.23,distance:defaults.distance});cameraKm=massKm()*motion.distance;
    if(experiment){experiment.reset({mass:settings.mass*1e6});uniforms.objectCount.value=0;}
    invalidateLookup();lastBand='';updateCameraControls();setPalette(settings.palette);resize();
    gui.controllersRecursive().forEach(c=>c.updateDisplay());
  }
  function bindEvents(){
    const host=$('render-host');
    host.addEventListener('pointerdown',e=>{if(e.button!==0)return;stopTour();host.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY};});
    host.addEventListener('pointermove',e=>{
      if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};
      if(orbit){const p=cameraVectors.radial;motion.yaw=Math.atan2(p.x,p.z);motion.elevation=Math.asin(p.y);}
      motion.yaw-=dx*.005;motion.elevation=Math.max(-1.45,Math.min(1.45,motion.elevation+dy*.005));
      if(settings.camera==='Orbiting')startOrbit();
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(type,()=>drag=null);
    host.addEventListener('wheel',e=>{
      e.preventDefault();stopTour();
      // Logarithmic zoom of distance above minimum: progressively finer near the hole.
    const minimum=minimumRadius(),base=gsap.isTweening(motion)?settings.distance:motion.distance;
      const normalized=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?height:1);
      setDistance(minimum+(base-minimum+.01)*Math.exp(Math.max(-.5,Math.min(.5,normalized*.0015)))-.01);
    },{passive:false});
    host.addEventListener('keydown',e=>{
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','_'].includes(e.key))e.preventDefault();else return;
      stopTour();
      if(['+','='].includes(e.key))setDistance(motion.distance*.9);
      else if(['-','_'].includes(e.key))setDistance(motion.distance*1.1);
      else{motion.yaw+=(e.key==='ArrowLeft'?.08:e.key==='ArrowRight'?-.08:0);motion.elevation=Math.max(-1.45,Math.min(1.45,motion.elevation+(e.key==='ArrowUp'?.05:e.key==='ArrowDown'?-.05:0)));if(orbit)startOrbit();}
    });
    $('tour-button').onclick=guidedTour;$('reset-button').onclick=reset;
    $('fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{ $('camera-note').textContent='Fullscreen is unavailable in this browser context.';}};
    $('physics-button').onclick=()=>{$('physics-dialog').showModal();gsap.fromTo($('physics-dialog'),{opacity:0,y:reducedMotion?0:12},{opacity:1,y:0,duration:reducedMotion?0:.25});};
    $('close-physics').onclick=()=>$('physics-dialog').close();
    $('physics-dialog').addEventListener('click',e=>{if(e.target===$('physics-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
    document.addEventListener('visibilitychange',()=>{lastTime=0;fpsTime=performance.now();frames=0;});
  }
  function frame(time){
    if(pausedContext)return;
    if(document.hidden){requestAnimationFrame(frame);return;}
    const dt=lastTime?Math.min(.1,(time-lastTime)/1000):0;lastTime=time;
    updateCamera(dt);updateUniforms();
    if(experiment){
      const engineDt=settings.paused?0:dt*settings.clockRate;
      const snapshot=experiment.advance(engineDt/100);
      setDynamics(snapshot);
    }
    // The model is stationary. Reuse exact intersection buffers until a geometric
    // input changes; palette/exposure/toggle edits need only the cheap display pass.
    const geometryKey=[...uniforms.cameraPosition.value.toArray(),...uniforms.cameraRight.value.toArray(),
      ...uniforms.cameraUp.value.toArray(),...uniforms.cameraForward.value.toArray(),...uniforms.cameraVelocity.value.toArray(),settings.fov,
      settings.disk,settings.diskModel,settings.camera,settings.peakTemperature,uniforms.maxSteps.value,uniforms.tolerance.value,
      uniforms.useLookup.value,uniforms.lookupRange.value.z,uniforms.coordinateTime.value,uniforms.objectCount.value,
      experiment?experiment.time:0,experiment?experiment.objects.filter(o=>o.visible).length:0].join(',');
    const traced=geometryKey!==lastGeometryKey;
    try{
      if(traced){quad.material=geometryMaterial;renderer.setRenderTarget(target);renderer.render(scene,ortho);lastGeometryKey=geometryKey;}
      quad.material=presentationMaterial;renderer.setRenderTarget(null);renderer.render(scene,ortho);
      updateBand();updateAnnotations(time);
    }catch(error){console.error(error);fail(error.message);return;}
    if(frameNumber++===1){
      gsap.to($('loading'),{opacity:0,duration:reducedMotion?0:.6,onComplete:()=>{$('loading').style.display='none';gsap.killTweensOf('.loading-orbit');}});
    }
    $('render-label').textContent=traced?'TRACING NULL GEODESICS':'CACHED NULL GEODESICS';
    frames++;
    if(time-fpsTime>=1000){
      fps=frames*1000/(time-fpsTime);frames=0;fpsTime=time;
      $('fps').textContent=Math.round(fps)+' FPS';updateReadouts();
      if(traced&&fps<26&&time-lastResize>2500)lowFpsCount++;else lowFpsCount=0;
      if(lowFpsCount>=3&&qualityScale>.5){qualityScale*=.85;lowFpsCount=0;resize();}
    }
    requestAnimationFrame(frame);
  }
  try{initialize();}catch(error){console.error(error);fail(error.message);}
})();
