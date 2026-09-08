/* Immersive layout is independent of physical state. */
(function(){
  const $=id=>document.getElementById(id);let active=false,hideTimer;
  function set(value){
    active=value;document.body.classList.toggle('immersive',value);
    document.querySelectorAll('.topbar,#controls-panel,.readouts').forEach(e=>e.inert=value);
    $('minimal-hud').hidden=!value;$('immersive-actions').hidden=!value;
    if(!value){document.body.classList.remove('hud-hidden');$('fullscreen-button').focus();}
    window.blackHoleLab?.resize();wake();
  }
  function wake(){if(!active)return;document.body.classList.add('hud-awake');clearTimeout(hideTimer);hideTimer=setTimeout(()=>document.body.classList.remove('hud-awake'),3000);}
  async function enter(){set(true);try{await document.documentElement.requestFullscreen();}catch{/* CSS immersive mode remains available on browsers without Fullscreen API. */}}
  async function exit(){if(document.fullscreenElement)try{await document.exitFullscreen();}catch{}set(false);}
  function init(){
    $('fullscreen-button').onclick=()=>active?exit():enter();$('exit-immersive').onclick=exit;
    $('hud-pause').onclick=()=>{const s=blackHoleLab.settings;s.paused=!s.paused;};
    $('hud-look').onclick=()=>{const s=blackHoleLab.settings;s.look=s.look==='Toward hole'?'Outward sky':'Toward hole';};
    document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)set(false);});
    document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.key==='Escape'&&active)exit();if(e.key.toLowerCase()==='h'&&active)document.body.classList.toggle('hud-hidden');});
    document.addEventListener('pointermove',wake);document.addEventListener('pointerdown',wake);
    setInterval(()=>{if(!active)return;const l=blackHoleLab,r=l.motion.distance;
      $('hud-direction').textContent=l.settings.look.toUpperCase();$('hud-distance').textContent=r.toFixed(r<10?3:1)+' rₛ';
      $('hud-region').textContent=r<=1?'INSIDE HORIZON':r<1.5?'INSIDE PHOTON SPHERE':'OUTSIDE HORIZON';
      $('hud-observer').textContent=l.settings.camera.toUpperCase();$('hud-pause').textContent=l.settings.paused?'▶ Resume':'Ⅱ Pause';
    },150);
    window.blackHoleLab.immersive={enter,exit,set,get active(){return active;}};
  }
  if(window.blackHoleLab)init();else window.addEventListener('blackhole-ready',init,{once:true});
})();
