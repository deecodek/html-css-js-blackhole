// Optional development check; uses an existing Playwright installation, not a site dependency.
// PLAYWRIGHT_PATH may point to a preinstalled Playwright package. No npm/build step is needed.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/INVALID_OPERATION|deprecated|no valid shader|missing fragment/.test(m.text()))errors.push(m.text());});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href,{waitUntil:'load',timeout:60000});
  await page.waitForFunction(()=>window.blackHoleLab||!document.getElementById('error').hidden,{timeout:60000});
  const initError=await page.locator('#error').textContent();if(initError){console.error('BROWSER ERRORS',errors);await browser.close();throw Error(initError);}
  await page.waitForFunction(()=>window.blackHoleLab?.frameNumber>2,{timeout:60000});
  fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
  await page.screenshot({path:path.resolve(__dirname,'../artifacts/desktop.png')});
  const result=await page.evaluate(()=>{
    const lab=blackHoleLab,data=lab.probe();let disk=0,sky=0,captured=0,unresolved=0,higher=0,minD=Infinity,maxD=0;
    for(let i=0;i<data.length;i+=4){const tag=data[i+2];if(tag>=2){disk++;minD=Math.min(minD,data[i]);maxD=Math.max(maxD,data[i]);if(tag>=3)higher++;}else if(tag>=0)sky++;else if(tag===-1)captured++;else unresolved++;}
    const gl=lab.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {disk,sky,captured,unresolved,higher,minD,maxD,fps:lab.fps,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',buffer:[lab.target.width,lab.target.height]};
  });
  console.log('INITIAL',JSON.stringify(result));
  if(!result.disk||!result.sky||!result.captured)errors.push('Initial image must contain disk, sky and captured rays.');
  if(result.minD>=1||result.maxD<=1)errors.push('Expected both receding and approaching disk Doppler shifts.');
  const frames=async(n=2)=>{
    const before=await page.evaluate(()=>blackHoleLab.frameNumber);
    await page.waitForFunction(({before,n})=>blackHoleLab.frameNumber>=before+n,{before,n},{timeout:60000});
  };
  const baseline=await page.evaluate(()=>Array.from(blackHoleLab.probe()));
  for(const mode of ['Natural','Gravity','Artistic','Doppler','Temperature']){
    await page.evaluate(mode=>blackHoleLab.setMode(mode),mode);await frames();
    const same=await page.evaluate(base=>{const data=blackHoleLab.probe();return Array.from(data).every((x,i)=>x===base[i]);},baseline);
    if(!same)errors.push('Geometry changed with palette '+mode);
  }
  console.log('MODES: all five rendered with identical physical buffers');
  await page.evaluate(()=>{const l=blackHoleLab;l.settings.doppler=false;l.settings.redshift=false;l.settings.higherImages=false;l.settings.skyLensing=false;l.settings.comparison=true;});await frames();
  const toggles=await page.evaluate(()=>{const u=blackHoleLab.uniforms;return !u.dopplerEnabled.value&&!u.redshiftEnabled.value&&!u.higherImages.value&&!u.skyLensing.value&&u.comparisonEnabled.value;});
  if(!toggles)errors.push('Effect toggles did not update uniforms');
  await page.evaluate(()=>{blackHoleLab.reset();blackHoleLab.settings.diskModel='Novikov–Thorne';});await frames();
  const inspection=await page.evaluate(()=>{
    const l=blackHoleLab,data=l.probe();let index=-1;
    for(let i=0;i<data.length;i+=4)if(data[i+2]===2&&data[i+1]>4&&data[i+1]<7){index=i/4;break;}
    const uv=[(index%64+.5)/64,(Math.floor(index/64)+.5)/48];
    const p=l.inspect(uv);return {status:p.status,r:p.physical[0],cpuR:p.reference?.r,cpu:p.reference?.status,drift:p.metadata[2],T:p.physical[1],expectedT:l.physics.ntFlux(p.physical[0])/l.physics.NT_PEAK_FLUX};
  });
  console.log('INSPECTOR',JSON.stringify(inspection));
  if(inspection.cpu!=='disk'||Math.abs(inspection.r-inspection.cpuR)/inspection.cpuR>1e-3)errors.push('GPU disk intersection disagrees with CPU reference');
  if(Math.abs((inspection.T/45000)**4-inspection.expectedT)>1e-4)errors.push('GPU Page-Thorne temperature disagrees with CPU');
  await page.screenshot({path:path.resolve(__dirname,'../artifacts/inspector.png')});
  await page.locator('#close-inspector').click();
  await page.locator('#save-button').click();
  await page.evaluate(()=>blackHoleLab.setMode('Doppler'));await page.locator('#load-button').click();await frames();
  if(await page.evaluate(()=>blackHoleLab.settings.color)!=='Temperature')errors.push('Saved scene failed to restore');
  for(const camera of ['Orbiting','Flyby','Plunge']){
    await page.evaluate(camera=>{const l=blackHoleLab;l.setCamera(camera);l.settings.paused=true;},camera);await frames();
    const cameraResult=await page.evaluate(()=>{
      const l=blackHoleLab,data=l.probe();let nan=0,sky=0,disk=0,unresolved=0;
      for(let i=0;i<data.length;i+=4){if(!Number.isFinite(data[i])||!Number.isFinite(data[i+1]))nan++;if(data[i+2]>=2)disk++;else if(data[i+2]>=0)sky++;else if(data[i+2]<-1)unresolved++;}
      return {camera:l.settings.camera,r:l.motion.distance,velocity:l.uniforms.cameraVelocity.value.length(),ef:l.uniforms.infalling.value,nan,sky,disk,unresolved,glError:l.renderer.getContext().getError()};
    });
    console.log('CAMERA',JSON.stringify(cameraResult));
    if(cameraResult.nan||cameraResult.glError)errors.push(camera+' generated invalid GPU values/errors');
    if(camera!=='Plunge'&&cameraResult.velocity<=0)errors.push(camera+' lacks moving-observer velocity');
  }
  for(const r of [1.01,1,.99,.7,.2]){
    await page.evaluate(r=>{blackHoleLab.setDistance(r);blackHoleLab.settings.paused=true;},r);await frames();
    const data=await page.evaluate(()=>{const l=blackHoleLab,a=l.probe();return {r:l.motion.distance,finite:Array.from(a).every(Number.isFinite),sky:Array.from(a).filter((x,i)=>i%4===2&&x>=0&&x<2).length,error:l.renderer.getContext().getError()};});
    console.log('HORIZON',JSON.stringify(data));
    if(!data.finite||data.error||!data.sky)errors.push('Horizon regularity/visibility failure at r='+r);
  }
  await page.screenshot({path:path.resolve(__dirname,'../artifacts/inside-horizon.png')});
  await page.evaluate(()=>{blackHoleLab.reset();blackHoleLab.settings.quality='Fine';blackHoleLab.resize();});await frames();
  if(await page.evaluate(()=>blackHoleLab.uniforms.samplesPerPixel.value)!==4)errors.push('Fine quality lacks four independent subpixels');
  await page.screenshot({path:path.resolve(__dirname,'../artifacts/fine.png')});
  await page.evaluate(()=>blackHoleLab.reset());await page.setViewportSize({width:390,height:844});await frames();
  await page.screenshot({path:path.resolve(__dirname,'../artifacts/mobile.png'),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(overflow)errors.push('Mobile viewport has horizontal overflow');
  await page.locator('#physics-button').click();if(!await page.locator('#physics-dialog').isVisible())errors.push('Physics dialog failed');await page.keyboard.press('Escape');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-button').click();const download=await downloadPromise;
  if(download.suggestedFilename()!=='event-horizon.png')errors.push('PNG download missing');
  console.log('UI: inspector, restore, comparison, mobile, physics dialog and PNG export exercised');
  console.log('ERRORS',JSON.stringify(errors));
  await browser.close();if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
