/* Schwarzschild in ingoing Cartesian Kerr–Schild coordinates, rs=c=1.
   g_ab=eta_ab+(1/r)l_a l_b, l_a=(1,n); signature -+++.
   These coordinates are regular at the future horizon. Not the rotating Kerr metric. */
(function(root){
  'use strict';
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),unit=a=>{const r=Math.hypot(...a);return a.map(x=>x/r);};
  function metric(x,a,b){const r=Math.hypot(...x),n=x.map(v=>v/r);return -a[0]*b[0]+dot(a.slice(1),b.slice(1))+(a[0]+dot(n,a.slice(1)))*(b[0]+dot(n,b.slice(1)))/r;}
  function lower(x,u){const r=Math.hypot(...x),n=x.map(v=>v/r),s=(u[0]+dot(n,u.slice(1)))/r;return [-u[0]+s,...u.slice(1).map((v,i)=>v+s*n[i])];}
  function raise(x,p){const r=Math.hypot(...x),n=x.map(v=>v/r),A=-p[0]+dot(n,p.slice(1));return [-p[0]+A/r,...p.slice(1).map((v,i)=>v-A*n[i]/r)];}
  function frame(x){
    const r=Math.hypot(...x),n=unit(x),s=1/Math.sqrt(r);
    // Radial E=1 infaller U^v=1/(1+s), U^r=-s; t_KS=v-r.
    const U=[1/(1+s)+s,...n.map(v=>-s*v)],R=[-s/(1+s),...n];
    const axis=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];
    const e=unit(axis.map((v,i)=>v-dot(axis,n)*n[i]));
    const b=[n[1]*e[2]-n[2]*e[1],n[2]*e[0]-n[0]*e[2],n[0]*e[1]-n[1]*e[0]];
    return [U,R,[0,...e],[0,...b]];
  }
  function initial(x,velocity=[0,0,0],massive=true,time=0){
    const f=frame(x),speed2=dot(velocity,velocity);
    if(massive&&speed2>=1)throw Error('A massive body must have local speed below c.');
    const v=massive?velocity:unit(velocity),gamma=massive?1/Math.sqrt(1-speed2):1;
    const k=f[0].map((a,i)=>gamma*(a+v[0]*f[1][i]+v[1]*f[2][i]+v[2]*f[3][i]));
    return [time,...x,...lower(x,k),0]; // t,x,y,z, covariant p_t,p_x,p_y,p_z, proper time.
  }
  function field(y,coordinateTime=false){
    const x=y.slice(1,4),p=y.slice(4,8),r=Math.hypot(...x),n=unit(x),np=dot(n,p.slice(1)),A=-p[0]+np;
    // H=1/2[-pt²+p²-(1/r)(-pt+n.p)²]. Hamilton equations below are analytic.
    const k=raise(x,p),dp=n.map((ni,i)=>-A*A*ni/(2*r*r)+A*(p[i+1]-np*ni)/(r*r));
    const derivative=[...k,0,...dp,1];
    return coordinateTime?derivative.map(v=>v/k[0]):derivative;
  }
  function rk4(y,h,coordinateTime=false){const f=z=>field(z,coordinateTime),a=f(y),b=f(y.map((v,i)=>v+h*a[i]/2)),c=f(y.map((v,i)=>v+h*b[i]/2)),d=f(y.map((v,i)=>v+h*c[i]));return y.map((v,i)=>v+h*(a[i]+2*b[i]+2*c[i]+d[i])/6);}
  function advance(y,h,coordinateTime=true,tolerance=2e-8){
    let remaining=h,step=Math.min(h,.04),error=0,work=0;
    while(remaining>1e-12&&work++<8192){
      if(Math.hypot(...y.slice(1,4))<=.05)return {y,ended:true,error};
      step=Math.min(step,remaining,.08*Math.hypot(...y.slice(1,4)));
      const full=rk4(y,step,coordinateTime),half=rk4(y,step/2,coordinateTime),fine=rk4(half,step/2,coordinateTime);
      const e=Math.max(...fine.slice(1,8).map((v,i)=>Math.abs(v-full[i+1])/(1+Math.abs(v))))/15;
      if(e>tolerance&&step>1e-7){step*=.5;continue;}
      y=fine;remaining-=step;error=Math.max(error,e);if(e<tolerance/32)step*=2;
    }
    return {y,ended:false,error,unresolved:remaining>1e-10};
  }
  function tidal(r,rsMeters){
    // Radial freely falling frame: eigenvalues (2GM/r_phys³,-GM/r_phys³,-GM/r_phys³).
    const rate=299792458**2/(rsMeters**2*r**3);return [rate,-rate/2,-rate/2];
  }
  function electricTidal(x,U,rsMeters){
    // Vacuum Weyl tensor in radial infall frame: R_i0j0=diag(-2,1,1)*M/r^3,
    // R_ijkl=-epsilon_ijm epsilon_kln E_mn, magnetic part zero. Boost to body's rest frame.
    const f=frame(x),gamma=-metric(x,U,f[0]),v=f.slice(1).map(e=>metric(x,U,e)/gamma),b2=dot(v,v);
    const rest=Array.from({length:3},(_,i)=>[gamma*v[i],...v.map((vj,j)=>(i===j?1:0)+(b2>1e-14?(gamma-1)*v[i]*vj/b2:0))]);
    const time=[gamma,...v.map(q=>gamma*q)],E=[-2,1,1];
    const eps=(i,j,k)=>i===j||j===k||i===k?0:((i-j)*(j-k)*(k-i)/2);
    const R=(a,b,c,d)=>{
      if(a===b||c===d)return 0;
      if(a===0&&c===0)return b===d?E[b-1]:0;
      if(a===0&&d===0)return b===c?-E[b-1]:0;
      if(b===0&&c===0)return a===d?-E[a-1]:0;
      if(b===0&&d===0)return a===c?E[a-1]:0;
      if(a*b*c*d===0)return 0;
      return -E.reduce((sum,e,m)=>sum+eps(a-1,b-1,m)*eps(c-1,d-1,m)*e,0);
    };
    const scale=299792458**2/(2*rsMeters**2*Math.hypot(...x)**3);
    return rest.map(ei=>rest.map(ej=>{
      let sum=0;for(let a=0;a<4;a++)for(let b=0;b<4;b++)for(let c=0;c<4;c++)for(let d=0;d<4;d++)sum-=R(a,b,c,d)*ei[a]*time[b]*ej[c]*time[d];
      return sum*scale;
    }));
  }
  root.BHRelativity={dot,unit,metric,lower,raise,frame,initial,field,rk4,advance,tidal,electricTidal};
  if(typeof module!=='undefined')module.exports=root.BHRelativity;
})(globalThis);
