/* Educational inspection and reproducible scenes. No changes to the ray equations. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  function attach(){
    const lab=window.blackHoleLab,P=lab.physics,s=lab.settings;
    let inspecting=false,selection=null,previousPause=false,pointerStart=null;
    const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
    const norm=a=>{const n=Math.hypot(...a);return a.map(x=>x/n);};
    function message(text){$('tools-message').textContent=text;}
    function download(name,data,type='application/json'){
      const link=document.createElement('a');let url;
      if(typeof data==='string'&&data.startsWith('data:'))url=data;
      else url=URL.createObjectURL(new Blob([data],{type}));
      link.href=url;link.download=name;link.click();
      if(url.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function sceneState(){
      const r=lab.cameraVectors.radial;
      return {version:1,settings:{...s,paused:true},view:{yaw:Math.atan2(r.x,r.z),elevation:Math.asin(r.y),distance:lab.motion.distance}};
    }
    function restore(state){
      if(state.version!==1||!state.settings||!state.view)throw Error('This is not a supported scene.');
      // Accept only known controls and their actual permitted values. Never execute URL data.
      lab.reset();
      for(const controller of lab.gui.controllersRecursive()){
        const key=controller.property,value=state.settings[key];
        if(value===undefined)continue;
        const current=s[key];
        if(typeof current==='number'){
          if(!Number.isFinite(value))continue;
          const min=controller._min??-Infinity,max=controller._max??Infinity;
          s[key]=Math.max(min,Math.min(max,value));
        }else if(typeof current==='boolean'){if(typeof value==='boolean')s[key]=value;}
        else if(controller._values){if(controller._values.includes(value))s[key]=value;}
        else if(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))s[key]=value;
      }
      const yaw=state.view.yaw,elevation=state.view.elevation;
      if(Number.isFinite(yaw))lab.motion.yaw=yaw;
      if(Number.isFinite(elevation))lab.motion.elevation=Math.max(-1.45,Math.min(1.45,elevation));
      lab.motion.distance=Math.max(s.camera==='Plunge'?.2:1.51,Math.min(1000,s.distance));
      const look=s.look,viewFov=s.fov;
      lab.setCamera(s.camera);s.look=look;s.fov=viewFov;s.paused=true;
      lab.updateMode();lab.resize();lab.gui.controllersRecursive().forEach(c=>c.updateDisplay());
      message('Scene loaded. Moving cameras restart their trajectory, paused.');
    }
    function inspect(uv){
      const sample=lab.readPixel(uv),r=lab.motion.distance,V=lab.cameraVectors;
      const aspect=lab.uniforms.resolution.value.x/lab.uniforms.resolution.value.y;
      const x=(sample.uv[0]*2-1)*aspect*lab.uniforms.tanHalfFov.value,y=(sample.uv[1]*2-1)*lab.uniforms.tanHalfFov.value;
      const q=norm(V.forward.toArray().map((v,i)=>v+x*V.right.toArray()[i]+y*V.up.toArray()[i]));
      const launched=s.camera==='Plunge'?{direction:q,frequency:1}:P.boostSky(q,V.velocity.toArray());
      const er=V.radial.toArray(),nr=dot(launched.direction,er);
      const tangent=launched.direction.map((v,i)=>v-nr*er[i]),nt=Math.hypot(...tangent),et=norm(tangent);
      let crossing=(Math.atan2(-er[1],et[1])+Math.PI)%Math.PI;if(crossing<1e-5)crossing+=Math.PI;
      const ef=s.camera==='Plunge'?P.efLaunch(r,nr,nt):null;
      const w=ef?ef.w:-nr*Math.sqrt(P.lapse(r))/(r*nt);
      let reference=null;
      if(nt>1e-7&&(!ef||ef.energy>0))reference=P.referenceRay({r,w,crossing,disk:s.disk,interior:r<=1});
      const p=sample.physical,h=sample.intersection,meta=sample.metadata,isDisk=h[3]>=2;
      const D=s.doppler?p[2]:1;
      const grav=s.redshift?(isDisk?Math.sqrt((1-1/p[0])/(ef?1:P.lapse(r))):ef?1:1/Math.sqrt(P.lapse(r))):1;
      const g=grav*(isDisk?D:1)*p[3];
      const status=isDisk?'Disk emission':h[3]>=0?'Background sky':h[3]===-1?'Captured / no external source':'Unresolved';
      let comparison='Not available for this radial or non-external ray.';
      if(reference){
        const gpuStatus=isDisk?'disk':h[3]>=0?'sky':h[3]===-1?'captured':'unresolved';
        comparison=`CPU: ${reference.status}. `;
        if(reference.status!==gpuStatus)comparison+='GPU/CPU classification differs near a boundary; increase quality.';
        else if(isDisk)comparison+=`Hit-radius relative difference: ${(Math.abs(p[0]-reference.r)/reference.r).toExponential(2)}.`;
        else if(gpuStatus==='sky'){
          const expected=er.map((v,i)=>v*Math.cos(reference.phi)+et[i]*Math.sin(reference.phi));
          comparison+=`Escape-direction difference: ${(Math.acos(Math.max(-1,Math.min(1,dot(norm(h.slice(0,3)),expected))))*180/Math.PI).toExponential(2)}°.`;
        }else comparison+='Capture classification agrees.';
      }
      selection={...sample,status,observerRadius:r,properSeconds:lab.properTime,
        model:s.diskModel,temperatureObserved:isDisk?p[1]*g:null,frequencyRatio:g,gravitationalFactor:grav,
        reference,scene:sceneState()};
      const rows=[['Result',status],['Emission / closest radius',p[0].toFixed(5)+' rₛ'],
        ['Emitted temperature',isDisk?Math.round(p[1]).toLocaleString()+' K':'—'],
        ['Observed temperature',isDisk?Math.round(p[1]*g).toLocaleString()+' K':'—'],
        ['Emitter Doppler D',isDisk?p[2].toFixed(6)+(s.doppler?'':' (disabled)'):'—'],
        ['Gravity factor',grav.toFixed(6)],['Observer factor',p[3].toFixed(6)],['Total frequency g',g.toFixed(6)],
        ['Impact parameter b',meta[0].toFixed(6)+' rₛ'],['Angular travel',meta[1].toFixed(4)+' rad'],
        ['Complete windings',(meta[1]/(2*Math.PI)).toFixed(3)],['GPU accepted/work steps',String(Math.round(meta[3]))],
        ['GPU max invariant drift',meta[2]<0?'LUT path — not recorded':meta[2].toExponential(2)],
        ['CPU max invariant drift',reference?reference.drift.toExponential(2):'—']];
      $('inspector-values').replaceChildren();
      for(const [name,value] of rows){const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;box.append(dt,dd);$('inspector-values').append(box);}
      $('accuracy-result').textContent=comparison;
      $('ray-note').textContent=(ef?'Regular EF launch. The observer factor includes its complete infinity-to-observer shift; a local static split is undefined inside the horizon. ':'')+'One actual subpixel ray; double-precision reference at Δφ ≤ 0.0025. The diagram shows Schwarzschild spatial coordinates in the ray’s orbital plane, not proper distances.';
      drawPath(reference,r);
      previousPause=s.paused;s.paused=true;$('inspector-dialog').showModal();
      return selection;
    }
    function drawPath(reference,r){
      const svg=$('ray-diagram'),radius=Math.max(12,Math.min(r*1.12,35)),k=95/radius;
      const circle=(value,cls)=>`<circle cx="210" cy="110" r="${value*k}" class="${cls}"/>`;
      let content=circle(3,'path-isco')+circle(1.5,'path-photon')+circle(1,'path-horizon');
      if(reference){
        const points=reference.points.filter(p=>p.every(Number.isFinite));
        const path=points.map(([x,y],i)=>(i?'L':'M')+(210+x*k).toFixed(2)+','+(110-y*k).toFixed(2)).join(' ');
        content+=`<path d="${path}" class="selected-ray"/>`;
      }
      content+=`<text x="12" y="20">ORBITAL PLANE · rₛ UNITS</text><text x="12" y="207">Horizon 1 · Photon sphere 1.5 · ISCO 3</text>`;
      svg.innerHTML=content;
    }
    $('inspect-button').onclick=()=>{inspecting=!inspecting;$('inspect-button').setAttribute('aria-pressed',inspecting);message(inspecting?'Click the viewport to inspect a photon. Drag still orbits the camera.':'Ray inspection off.');};
    $('render-host').addEventListener('pointerdown',e=>pointerStart=[e.clientX,e.clientY]);
    $('render-host').addEventListener('pointerup',e=>{
      if(!inspecting||!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>4)return;
      const rect=$('render-host').getBoundingClientRect();inspect([(e.clientX-rect.left)/rect.width,1-(e.clientY-rect.top)/rect.height]);
    });
    $('close-inspector').onclick=()=>$('inspector-dialog').close();
    $('inspector-dialog').addEventListener('close',()=>s.paused=previousPause);
    $('export-ray').onclick=()=>{if(selection)download('black-hole-ray.json',JSON.stringify(selection,null,2));};
    $('export-button').onclick=()=>{download('event-horizon.png',lab.exportPNG());message('Viewport PNG exported at the current render resolution.');};
    $('save-button').onclick=()=>{try{localStorage.setItem('event-horizon-scene-v1',JSON.stringify(sceneState()));message('Scene saved in this browser.');}catch{message('Browser storage is unavailable. Use Copy scene URL instead.');}};
    $('load-button').onclick=()=>{try{const state=localStorage.getItem('event-horizon-scene-v1');if(!state){message('No saved scene in this browser yet.');return;}restore(JSON.parse(state));}catch(error){message(error.message);}};
    $('share-button').onclick=async()=>{
      const url=new URL(location.href);url.hash='scene='+encodeURIComponent(JSON.stringify(sceneState()));
      try{await navigator.clipboard.writeText(url.href);message('Scene URL copied. Open it on the same hosted page; moving trajectories restart paused.');}
      catch{$('scene-url').hidden=false;$('scene-url').value=url.href;$('scene-url').select();message('Copy the selected scene URL.');}
    };
    const comparison=$('comparison-label');
    setInterval(()=>{comparison.hidden=!s.comparison;comparison.textContent=`${s.color} ← | → ${s.comparisonMode}`;comparison.style.left=(s.comparisonSplit*100)+'%';},250);
    lab.inspect=inspect;lab.sceneState=sceneState;lab.restoreScene=restore;
    if(location.hash.startsWith('#scene=')){
      try{restore(JSON.parse(decodeURIComponent(location.hash.slice(7))));}catch(error){message('Could not load scene: '+error.message);}
    }
  }
  if(window.blackHoleLab)attach();else window.addEventListener('blackhole-ready',attach,{once:true});
})();
