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
console.log('PASS: scales, photon orbit, capture/escape, winding, weak deflection, RK4 convergence, invariant, SS/NT disk laws, aberration, Planck radiance, EF null launch and horizon continuity, infall and flyby energy/periapsis.');
