/* Deterministic test bodies in fixed Schwarzschild spacetime. Backreaction omitted.
   Material responses are explicitly reduced affine/spring models, not GRMHD or vehicle certification. */
(function(root){
  'use strict';
  const R=root.BHRelativity;
  const PRESETS={
    Probe:{radius:1,mass:10,density:2700,young:0,strength:Infinity,temperature:6000},
    Rock:{radius:5,mass:1.57e6,density:3000,young:3e10,strength:1e7,temperature:300},
    Spacecraft:{radius:10,mass:10000,density:100,young:1e9,strength:1e6,temperature:300},
    Star:{radius:6.957e8,mass:1.98847e30,density:1408,young:0,strength:Infinity,temperature:5772},
    Cloud:{radius:1e7,mass:0,density:0,young:0,strength:0,temperature:0},
    Light:{radius:0,mass:0,density:0,young:0,strength:Infinity,temperature:0}
  };
  class ExperimentEngine{
    constructor(){this.reset();}
    reset(config={}){this.time=0;this.mass=config.mass||4.3e6;this.rs=2*6.67430e-11*this.mass*1.98847e30/299792458**2;this.units=this.rs/299792458;this.objects=[];this.events=[];this.sequence=0;this.seed=config.seed||1729;this.heating=!!config.heating;this.diskLuminosity=config.diskLuminosity||0;}
    event(type,o,detail){this.events.push({time:this.time,properTime:o.y[8]*this.units,object:o.id,type,detail});if(this.events.length>1024)this.events.shift();}
    spawn(config={}){
      if(this.objects.length>=8)throw Error('Eight objects maximum. Remove an object before adding another.');
      const type=Object.hasOwn(PRESETS,config.type)?config.type:'Probe',p={...PRESETS[type],...config};
      const r=Math.max(.055,Math.min(80,p.r||8)),az=p.azimuth||0,elev=p.elevation??.12;
      const x=[r*Math.cos(elev)*Math.cos(az),r*Math.sin(elev),r*Math.cos(elev)*Math.sin(az)];
      const angle=(p.direction||0)*Math.PI/180,speed=type==='Light'?1:Math.min(.95,Math.max(0,p.speed??0));
      const velocity=[Math.cos(angle)*speed,0,Math.sin(angle)*speed];
      const o={id:++this.sequence,type,config:p,y:R.initial(x,velocity,type!=='Light',this.time),visible:true,paused:false,ended:false,
        axes:[1,1,1],axisVelocity:[0,0,0],stress:0,temperature:p.temperature,history:[],trail:[],particles:[],broken:false,valid:true,maxError:0,emitted:0,clock:0};
      if(type==='Cloud'||type==='Star'){
        // A deterministic family of independently integrated geodesics after release/disruption.
        // Stars begin with an affine pressure/self-gravity response; debris is collisionless.
        for(let i=0;i<24;i++){
          const z=1-2*(i+.5)/24,phi=i*Math.PI*(3-Math.sqrt(5)),q=Math.sqrt(1-z*z),radius=p.radius/this.rs;
          const offset=[q*Math.cos(phi),z,q*Math.sin(phi)].map(v=>v*radius);
          const at=x.map((v,j)=>v+offset[j]);o.particles.push({y:R.initial(at,velocity,true,this.time),ended:false});
        }
      }
      this.objects.push(o);this.record(o);this.event('released',o,type+' released in the local radial-infall frame');return o.id;
    }
    record(o){
      o.history.push({t:o.y[0],x:o.y.slice(1,4),u:R.raise(o.y.slice(1,4),o.y.slice(4,8)),tau:o.y[8],temperature:o.temperature,axes:o.axes.slice(),ended:o.ended});
      if(o.history.length>2048)o.history.shift();
      o.trail.push(o.y.slice(1,4));if(o.trail.length>1000)o.trail.shift();
    }
    advance(interval){
      let remaining=Math.max(0,Math.min(interval,4));
      while(remaining>1e-9){
        const h=Math.min(.1,remaining);this.time+=h;remaining-=h;
        for(const o of this.objects){
          if(o.ended||o.paused)continue;
          const oldR=Math.hypot(...o.y.slice(1,4)),oldTau=o.y[8];
          const result=R.advance(o.y,h,true);o.y=result.y;o.maxError=Math.max(o.maxError,result.error);
          const r=Math.hypot(...o.y.slice(1,4)),dTau=(o.y[8]-oldTau)*this.units;
          if(oldR>1&&r<=1)this.event('horizon',o,'Crossed the future horizon; external signals cannot escape.');
          if(result.ended||r<=.05){o.ended=true;this.event('cutoff',o,'Numerical cutoff reached, not a claim about singularity physics.');}
          if(result.unresolved){o.paused=true;this.event('precision',o,'Integrator work limit; paused rather than inventing a trajectory.');}
          if(o.type!=='Light')this.material(o,dTau,r);
          if(o.type==='Cloud'||o.broken){for(const particle of o.particles){if(particle.ended)continue;const step=R.advance(particle.y,h,true);particle.y=step.y;particle.ended=step.ended;}}
          const pulses=Math.floor(o.y[8]*this.units/Math.max(.01,o.config.pulsePeriod||this.units));
          if(o.type==='Probe'&&pulses>o.emitted){o.emitted=pulses;this.event('pulse',o,r>1?'Beacon pulse emitted; reception requires a null path.':'Pulse emitted inside horizon; no external reception.');}
          this.record(o);
        }
      }
      return this.snapshot();
    }
    material(o,dTau,r){
      if(o.type==='Probe')return;
      const p=o.config,tidal=R.electricTidal(o.y.slice(1,4),R.raise(o.y.slice(1,4),o.y.slice(4,8)),this.rs);
      o.tidal=tidal;
      // Reduced affine model: principal radial/transverse stretches. Off-diagonal
      // tidal components are reported but shear response is omitted; validity is labelled.
      const restoring=o.broken?0:o.type==='Star'?6.67430e-11*p.mass/p.radius**3:p.young/(Math.max(p.density,1)*p.radius**2);
      const damping=2*Math.sqrt(restoring),steps=Math.max(1,Math.ceil(dTau*Math.sqrt(Math.max(...tidal.map((row,i)=>Math.abs(row[i]))))/.05));
      if(steps>512){o.valid=false;o.paused=true;this.event('validity',o,'Material timestep limit reached.');return;}
      const dt=dTau/steps;
      for(let n=0;n<steps;n++)for(let i=0;i<3;i++){
        const force=tidal[i][i]*o.axes[i]-restoring*(o.axes[i]-1);
        o.axisVelocity[i]=(o.axisVelocity[i]+dt*force)/(1+damping*dt+restoring*dt*dt);
        o.axes[i]=Math.max(.001,o.axes[i]+dt*o.axisVelocity[i]);
      }
      o.stress=p.young*Math.max(...o.axes.map(a=>Math.abs(a-1)));
      const disrupted=o.type==='Star'?tidal[0][0]>restoring:o.stress>p.strength;
      if(disrupted&&!o.broken){o.broken=true;this.event('disrupted',o,'Reduced material model exceeded its restoring/strength threshold.');
        if(!o.particles.length)for(let i=0;i<16;i++){
          const x=o.y.slice(1,4).map((v,j)=>v+Math.sin(i*2.399+j*2)*p.radius/this.rs*o.axes[j]);
          // Local debris initially shares the central body's coordinate velocity to first order.
          const U=R.raise(o.y.slice(1,4),o.y.slice(4,8)),normal=Math.sqrt(-R.metric(x,U,U));
          if(Number.isFinite(normal))o.particles.push({y:[o.y[0],...x,...R.lower(x,U.map(v=>v/normal)),o.y[8]],ended:false});
        }
      }
      if(p.radius*Math.max(...o.axes)/(r*this.rs)>.1&&!o.broken){o.valid=false;o.paused=true;this.event('validity',o,'Body is too large for the local affine approximation; choose debris/cloud mode.');}
      if(this.heating&&p.mass>0){
        // Approximate isotropic irradiation L/(4pi R²), not GR radiative transfer.
        // Implicit cooling balance avoids negative T under large proper-time steps.
        const area=4*Math.PI*p.radius**2,absorbed=this.diskLuminosity*p.radius**2/(4*(r*this.rs)**2),capacity=p.mass*800;
        let lo=0,hi=Math.max(o.temperature+absorbed*dTau/capacity,1);
        for(let i=0;i<32;i++){const t=(lo+hi)/2,residual=capacity*(t-o.temperature)/Math.max(dTau,1e-12)+area*5.670374419e-8*t**4-absorbed;if(residual>0)hi=t;else lo=t;}
        o.temperature=(lo+hi)/2;
      }
    }
    snapshot(){return {version:1,time:this.time,mass:this.mass,rs:this.rs,units:this.units,events:this.events.slice(-40),objects:this.objects.map(o=>({...o,history:o.history.slice()}))};}
  }
  root.BHExperimentEngine=ExperimentEngine;root.BHObjectPresets=PRESETS;
  if(typeof module!=='undefined')module.exports={ExperimentEngine,PRESETS};
})(globalThis);
