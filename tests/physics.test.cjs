'use strict';
const assert=require('node:assert/strict');
const P=require('../physics.js');
function near(a,b,tolerance,message){assert.ok(Math.abs(a-b)<tolerance,`${message}: ${a} vs ${b}`);}
near(P.schwarzschildKm(1),2.95334,.00002,'Solar Schwarzschild radius in km');
near(P.orbitalBeta(3),.5,1e-14,'ISCO local speed is c/2');
near(P.derivative([2/3,0])[1],0,1e-15,'Circular photon solution at r=1.5rs');
near(P.invariant([2/3,0]),1/(P.BC*P.BC),1e-15,'Critical impact parameter');
assert.equal(P.trace(P.BC*.999).captured,true,'Subcritical ray is captured');
assert.equal(P.trace(P.BC*1.001).captured,false,'Supercritical ray escapes');
assert.ok(P.trace(P.BC*1.00001).angle>P.trace(P.BC*1.01).angle,'Near-critical winding grows');
assert.equal(P.trace(.5,1.2,false).captured,false,'Outward photon inside photon sphere can escape');
const weak=P.trace(100,1e7,true,.001);
near(weak.angle-Math.PI+Math.asin(100/1e7),.02,.0004,'Weak deflection approaches 4M/b=2/b');
const coarse=P.trace(4,1000,true,.08),fine=P.trace(4,1000,true,.04),reference=P.trace(4,1000,true,.002);
assert.ok(Math.abs(coarse.angle-reference.angle)>8*Math.abs(fine.angle-reference.angle),'RK4 convergence under step halving');
assert.ok(reference.drift<1e-9,'Conserved quantity remains stable');
near(P.temperature(3),0,1e-10,'Zero torque inner boundary');
near(P.temperature(49/12),45000,1e-7,'Correct SS peak');
assert.ok(P.temperature(20)<P.temperature(8),'Disk cools outward');
const boost=P.boostSky([1,0,0],[.5,0,0]);
near(boost.frequency,Math.sqrt(3),1e-14,'Forward observer blueshift');
const q=[.6,.8,0],v=[.4,0,0],a=P.boostSky(q,v),back=P.boostSky(a.direction,v.map(x=>-x));
q.forEach((x,i)=>near(back.direction[i],x,1e-14,'Aberration roundtrip'));
near(a.direction.reduce((s,x)=>s+x*x,0),1,1e-14,'Aberrated ray remains null/unit');
assert.ok(P.spectrumXYZ(12000)[1]>P.spectrumXYZ(6000)[1],'Planck visible radiance increases with T');
assert.equal(P.ntFlux(3),0,'Page-Thorne zero-torque flux');
assert.ok(P.ntPeakRadius>4&&P.ntPeakRadius<6,'Relativistic disk peak location');
near(P.ntFlux(1e7)*1e21,3*.5/(8*Math.PI),.0001,'NT flux approaches Newtonian 3M/(8pi r³)');
for(const r of [.2,.9,1,1.00001,2,100])for(const nr of [-.8,0,.8]){
  const nt=Math.sqrt(1-nr*nr),launch=P.efLaunch(r,nr,nt),f=P.lapse(r);
  near(-f*launch.kv**2+2*launch.kv*launch.radial+nt*nt,0,1e-13,'EF launch remains null through the horizon');
  near(-f*launch.kv+launch.radial,launch.energy,1e-14,'EF conserved Killing energy');
  near(P.invariant([1/r,launch.w]),launch.energy**2/launch.L**2,1e-11,'EF initial data matches orbital invariant');
  if(r>1){
    const boost=P.boostSky([nr,nt,0],[-1/Math.sqrt(r),0,0]);
    near(r*boost.direction[1]/Math.sqrt(f),launch.b,1e-8,'EF and static tetrads agree outside horizon');
    near(boost.frequency/Math.sqrt(f),launch.frequency,1e-8,'EF and static observer frequency agrees');
  }
}
near(P.infallRadius(8,(8**1.5-1)/1.5),1,1e-13,'Finite proper time to horizon');
assert.ok(P.infallRadius(8,15)<1,'Infall continues inside horizon');
const inside=P.efLaunch(.9,0,1);
assert.equal(P.referenceRay({r:.9,w:inside.w,disk:false,interior:true}).status,'sky','External photons reach an observer inside the future horizon');
const flyby=P.flybyInitial(2.1,.25,24);let state=flyby.y,minR=24,maxError=0;
for(let i=0;i<14000;i++){
  state=P.timelikeStep(state,flyby.L,.02);minR=Math.min(minR,state[0]);
  maxError=Math.max(maxError,Math.abs(P.timelikeEnergySquared(state[0],state[1],flyby.L)-flyby.E**2));
  if(state[0]>24&&state[1]>0)break;
}
near(minR,2.1,.00002,'Unbound flyby reaches the requested periapsis');
assert.ok(state[1]>0&&state[0]>24,'Flyby recedes after periapsis');
assert.ok(maxError<1e-8,'Flyby conserves timelike energy');

// Relativity module tests
const R=require('../relativity.js');
const x0=[10,0,0],v0=[0,0,0];
const init0=R.initial(x0,v0,true,0);
assert.equal(init0.length,9,'Initial state has 9 components');
near(Math.hypot(...init0.slice(1,4)),10,1e-14,'Initial position preserved');
assert.ok(init0[4]<0,'p_t is negative for massive particle');
// Check 4-momentum normalization: p_a U^a = -1
const p0=init0.slice(4,8);
const U0=R.raise(x0,p0);
const norm0=R.metric(x0,U0,U0);
near(norm0,-1,1e-10,'Initial 4-velocity is unit timelike');
const init1=R.initial(x0,[.5,0,0],true,0);
// v=[0.5,0,0] in infalling frame means outward radial kick; less energy → p_t less negative
assert.ok(init1[4]>init0[4],'Outward-moving particle has less energy');
const vel=R.initial(x0,[0,0,0],true,0);
const field0=R.field(vel);
assert.ok(field0.length>=8,'Field returns at least 8 components');
const stepped=R.advance(vel,.1);
assert.ok(stepped.y.length===9,'Advance preserves state length');
assert.ok(!stepped.ended,'Static particle does not end');
const tidal=R.tidal(5,1e4);
assert.ok(Array.isArray(tidal)&&tidal.length===3,'Tidal returns 3 eigenvalues');
near(tidal[0],-2*tidal[1],1e-14,'Radial tidal is twice transverse');
const etidal=R.electricTidal(x0,init0.slice(4,8),1e4);
assert.ok(etidal.length===3&&etidal[0].length===3,'Electric tidal is 3x3');

// Experiment engine tests
const {ExperimentEngine,PRESETS}=require('../experiment-engine.js');
assert.ok(PRESETS.Probe,'Probe preset exists');
assert.ok(PRESETS.Rock,'Rock preset exists');
assert.ok(PRESETS.Light,'Light preset exists');
const eng=new ExperimentEngine();
eng.reset({mass:4.3e6});
assert.equal(eng.time,0,'Engine starts at t=0');
assert.equal(eng.objects.length,0,'No objects initially');
const id0=eng.spawn({type:'Probe',r:8});
assert.equal(id0,1,'First object gets id 1');
assert.equal(eng.objects.length,1,'One object after spawn');
assert.equal(eng.objects[0].type,'Probe','Object type preserved');
assert.ok(eng.objects[0].history.length>=1,'Object has history after spawn');
const snap=eng.snapshot();
assert.equal(snap.version,1,'Snapshot has version');
assert.equal(snap.objects.length,1,'Snapshot contains object');
assert.ok(snap.rs>0,'Snapshot has positive rs');
assert.ok(snap.units>0,'Snapshot has positive units');
const snap2=eng.advance(0.1);
assert.ok(eng.time>0,'Engine advanced in time');
assert.ok(snap2.objects[0].history.length>=2,'History grew after advance');
assert.ok(Number.isFinite(snap2.objects[0].y[0]),'Object KS time is finite');
const id1=eng.spawn({type:'Rock',r:10,speed:.3});
assert.equal(id1,2,'Second object gets id 2');
assert.equal(eng.objects.length,2,'Two objects after second spawn');
eng.advance(0.5);
assert.ok(eng.objects[0].history.length>2,'Probe history continues growing');
const idLight=eng.spawn({type:'Light',r:6,speed:1,direction:0});
assert.equal(eng.objects.length,3,'Three objects after light spawn');
assert.equal(eng.objects[2].type,'Light','Light type preserved');
eng.advance(1);
const finalSnap=eng.snapshot();
assert.equal(finalSnap.objects.length,3,'All objects in final snapshot');
for(const o of finalSnap.objects){
  assert.ok(o.history.length>0,o.type+' has history');
  assert.ok(o.history[0].t!==undefined,o.type+' history has time');
  assert.ok(Array.isArray(o.history[0].x),o.type+' history has position');
  assert.ok(Array.isArray(o.history[0].u),o.type+' history has 4-velocity');
}
assert.ok(finalSnap.events.length>0,'Engine records events');
eng.reset({mass:1e6});
assert.equal(eng.time,0,'Reset clears time');
assert.equal(eng.objects.length,0,'Reset clears objects');
for(let i=0;i<8;i++)eng.spawn({type:'Probe',r:5+i});
assert.equal(eng.objects.length,8,'Eight objects spawned');
assert.throws(()=>eng.spawn({type:'Probe'}),/maximum/,'Ninth object throws');
const eng2=new ExperimentEngine();
eng2.reset({mass:4.3e6});
const rId=eng2.spawn({type:'Rock',r:3.5,speed:0});
eng2.advance(2);
const rObj=eng2.objects.find(o=>o.id===rId);
assert.ok(rObj,'Rock object exists');
assert.ok(rObj.history.length>2,'Rock has multiple history entries');
assert.ok(rObj.axes.some(a=>a!==1)||rObj.stress>=0,'Rock has material response');

console.log('PASS: scales, photon orbit, capture/escape, winding, weak deflection, RK4 convergence, invariant, SS/NT disk laws, aberration, Planck radiance, EF null launch and horizon continuity, infall and flyby energy/periapsis, relativity module, experiment engine.');
