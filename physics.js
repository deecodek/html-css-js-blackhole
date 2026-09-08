/* Pure numerical physics, also runnable under Node for independent checks.
   Equations and citations: PHYSICS.md. No rendering or UI dependencies. */
(function (root) {
  'use strict';
  const G = 6.67430e-11, C = 299792458, SOLAR_MASS = 1.98847e30;
  const BC = Math.sqrt(27) / 2, ISCO = 3, PHOTON_SPHERE = 1.5;
  const TEMP_MIN = 100, TEMP_MAX = 1e8;
  const schwarzschildKm = solarMass => 2 * G * solarMass * SOLAR_MASS / (C * C) / 1000;
  const lapse = r => 1 - 1 / r;
  // Exact local static-frame speed of a timelike circular Schwarzschild geodesic.
  const orbitalBeta = r => Math.sqrt(1 / (2 * (r - 1)));
  const invariant = ([u, w]) => w * w + u * u * (1 - u);
  const derivative = ([u, w]) => [w, 1.5 * u * u - u];
  function rk4(y, h) {
    // y'=F(y); RK4 increment h(k1+2k2+2k3+k4)/6, local truncation O(h^5).
    const k1 = derivative(y);
    const k2 = derivative(y.map((x, i) => x + h * k1[i] / 2));
    const k3 = derivative(y.map((x, i) => x + h * k2[i] / 2));
    const k4 = derivative(y.map((x, i) => x + h * k3[i]));
    return y.map((x, i) => x + h * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]) / 6);
  }
  function trace(b, r = 1000, inward = true, h = 0.005) {
    const u = 1/r;
    let y = [u, (inward ? 1 : -1) * Math.sqrt(Math.max(0, 1/(b*b) - u*u*(1-u)))];
    let angle = 0, minR = r, drift = 0;
    for (let i=0; i<20000; i++) {
      const next = rk4(y,h);
      if (next[0] <= 0) {
        // Refine the root u=0 in the last step; infinity has a finite orbital angle.
        let lo=0, hi=h;
        for(let j=0;j<24;j++) {const mid=(lo+hi)/2; if(rk4(y,mid)[0]>0)lo=mid;else hi=mid;}
        return {captured:false,angle:angle+(lo+hi)/2,minR,drift};
      }
      y=next; angle+=h; minR=Math.min(minR,1/y[0]);
      drift=Math.max(drift,Math.abs(invariant(y)*b*b-1));
      if(y[0]>=1) return {captured:true,angle,minR,drift};
    }
    return {unresolved:true,angle,minR,drift};
  }
  function temperature(r, peak=45000) {
    // Zero-torque SS disk; T maximum at (49/36)*rISCO = 49/12 rs.
    const f=x => Math.max(0, (1-Math.sqrt(ISCO/x))/(x*x*x));
    return peak * Math.pow(f(r)/f(49/12), 0.25);
  }
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  function boostSky(q,v) {
    // Inverse aberration of a past-directed sky ray from moving to static tetrad.
    const b2=dot(v,v); if(b2<1e-16)return {direction:q.slice(),frequency:1};
    const gamma=1/Math.sqrt(1-b2), vq=dot(v,q), denominator=gamma*(1-vq);
    return {direction:q.map((x,i)=>(x+((gamma-1)*vq/b2-gamma)*v[i])/denominator),frequency:1/denominator};
  }
  function cie(w) {
    // Wyman/Sloan/Shirley Eq.4 CIE 1931 fit; wavelength in nm.
    // These fitted centers, widths and amplitudes are published colorimetry data.
    const g=(mu,left,right)=>Math.exp(-0.5*Math.pow((w-mu)*(w<mu?left:right),2));
    return [1.056*g(599.8,.0264,.0323)+.362*g(442,.0624,.0374)-.065*g(501.1,.049,.0382),
      .821*g(568.8,.0213,.0247)+.286*g(530.9,.0613,.0322),
      1.217*g(437,.0845,.0278)+.681*g(459,.0385,.0725)];
  }
  function spectrumXYZ(t) {
    const xyz=[0,0,0], h=6.62607015e-34,k=1.380649e-23;
    // Planck B_lambda in SI; trapezoidal spectral quadrature over visible wavelengths.
    for(let nm=380;nm<=780;nm+=5){
      const wavelength=nm*1e-9;
      const radiance=2*h*C*C/(Math.pow(wavelength,5)*Math.expm1(h*C/(wavelength*k*t)));
      const cmf=cie(nm), weight=(nm===380||nm===780?.5:1)*5e-9;
      for(let i=0;i<3;i++)xyz[i]+=radiance*cmf[i]*weight;
    }
    return xyz;
  }
  function spectrumTable(size=1024) {
    const data=new Float32Array(size*4), reference=spectrumXYZ(10000)[1];
    for(let i=0;i<size;i++){
      const t=TEMP_MIN*Math.pow(TEMP_MAX/TEMP_MIN,i/(size-1));
      const [x,y,z]=spectrumXYZ(t).map(v=>v/reference);
      // Standard CIE XYZ -> linear sRGB D65 matrix; clip out-of-gamut negative channels.
      data.set([Math.max(0,3.2406*x-1.5372*y-.4986*z),Math.max(0,-.9689*x+1.8758*y+.0415*z),Math.max(0,.0557*x-.204*y+1.057*z),1],i*4);
    }
    return data;
  }
  function weakTable(r,size=512) {
    // Double-precision numerical deflection LUT. b>=32rs is safely outside disk r<=12rs.
    // Two rows: inward and outward. Texture uses b, not a hand-fitted bending formula.
    const bMin=32,bMax=r/Math.sqrt(lapse(r)),data=new Float32Array(size*2*4);
    if(bMax<=bMin)return null;
    for(let row=0;row<2;row++) for(let i=0;i<size;i++) {
      const b=bMin+(bMax-bMin)*i/(size-1),result=trace(b,r,row===0,.025);
      data.set([Math.cos(result.angle),Math.sin(result.angle),result.minR,1],(row*size+i)*4);
    }
    return {data,bMin,bMax,r,size};
  }
  root.BHPhysics={G,C,SOLAR_MASS,BC,ISCO,PHOTON_SPHERE,TEMP_MIN,TEMP_MAX,
    schwarzschildKm,lapse,orbitalBeta,invariant,derivative,rk4,trace,temperature,boostSky,spectrumXYZ,spectrumTable,weakTable};
  if(typeof module!=='undefined')module.exports=root.BHPhysics;
})(globalThis);
