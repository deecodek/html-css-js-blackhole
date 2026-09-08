importScripts('relativity.js','experiment-engine.js');
const engine=new BHExperimentEngine();
self.onmessage=({data})=>{
  try{
    if(data.action==='reset')engine.reset(data.config);
    if(data.action==='spawn')engine.spawn(data.config);
    if(data.action==='advance')engine.advance(data.interval);
    if(data.action==='restore'){engine.reset(data.config);for(const object of data.objects)engine.spawn(object);engine.advance(data.time||0);}
    if(data.action==='remove')engine.objects=engine.objects.filter(o=>o.id!==data.id);
    if(data.action==='toggle'){const o=engine.objects.find(o=>o.id===data.id);if(o)o[data.key]=!!data.value;}
    postMessage({snapshot:engine.snapshot()});
  }catch(error){postMessage({error:error.message});}
};
