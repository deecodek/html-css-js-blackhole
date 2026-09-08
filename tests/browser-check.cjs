// Optional development check; uses an existing Playwright installation, not a site dependency.
// PLAYWRIGHT_PATH may point to a preinstalled Playwright package. No npm/build step is needed.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href,{waitUntil:'load',timeout:60000});
  await page.waitForFunction(()=>window.blackHoleLab||!document.getElementById('error').hidden,{timeout:60000});
  const initError=await page.locator('#error').textContent();if(initError){console.error('BROWSER ERRORS',errors);await browser.close();throw Error(initError);}
  await page.waitForTimeout(4000);
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
  console.log('ERRORS',JSON.stringify(errors));
  await browser.close();if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
