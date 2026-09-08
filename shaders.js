/* Original shaders. Exact Schwarzschild geometry is isolated from presentation.
   All lengths: rs=1, M=1/2. See PHYSICS.md for derivations and approximation limits. */
window.BHShaders = {};
BHShaders.vertex = `precision highp float;
in vec3 position;
void main(){gl_Position=vec4(position,1.0);}`;

BHShaders.frame = `
uniform vec2 resolution;
uniform vec3 cameraPosition, cameraRight, cameraUp, cameraForward, cameraVelocity;
uniform float tanHalfFov;
uniform bool infalling;
// Static tetrad is orthonormal. These vectors express its spatial axes in the
// pseudo-Cartesian orientation of the orbital plane, not coordinate velocities.
vec3 skyRay(vec2 screenUV,out float observerFrequency) {
  vec2 uv=(2.0*screenUV-1.0)*vec2(resolution.x/resolution.y,1.0);
  vec3 q=normalize(cameraForward+tanHalfFov*(uv.x*cameraRight+uv.y*cameraUp));
  float b2=dot(cameraVelocity,cameraVelocity);
  observerFrequency=1.0;
  if(infalling)return q; // The regular EF tetrad is applied in the spatial launch below.
  if(b2<1e-12)return q;
  // Lorentz-transform past-directed k=(-1,q) into the static tetrad.
  // q_s=[q+((gamma-1)(v.q)/b²-gamma)v]/[gamma(1-v.q)].
  float gamma=inversesqrt(1.0-b2),vq=dot(cameraVelocity,q);
  float denominator=gamma*(1.0-vq);
  observerFrequency=1.0/denominator;
  return normalize((q+((gamma-1.0)*vq/b2-gamma)*cameraVelocity)/denominator);
}
vec3 launchRay(out float observerFrequency){return skyRay(gl_FragCoord.xy/resolution,observerFrequency);}
`;

BHShaders.geometry = `precision highp float;
precision highp int;
${BHShaders.frame}
uniform bool diskEnabled, useLookup;
uniform sampler2D weakLookup;
uniform vec3 lookupRange;
uniform int maxSteps;
uniform float tolerance, peakTemperature;
uniform int diskModel;
uniform float ntPeakFlux;
layout(location=0) out vec4 physical;
layout(location=1) out vec4 intersection;
layout(location=2) out vec4 rayMetadata;
const float PI=3.141592653589793, ISCO=3.0;
const float OUTER_DISK=12.0; // Scene boundary of our finite thin disk; not a GR radius.
const float MIN_STEP=0.0008, MAX_STEP=0.08; // Numerical angular bounds: 100x range.

vec2 field(vec2 y){return vec2(y.y,1.5*y.x*y.x-y.x);}
vec2 increment(vec2 y,float h){
  // Exact GR ODE: u''+u=(3/2)u²; fourth-order numerical quadrature.
  vec2 a=field(y),b=field(y+0.5*h*a),c=field(y+0.5*h*b),d=field(y+h*c);
  return (h/6.0)*(a+2.0*b+2.0*c+d);
}
vec2 rk4(vec2 y,float h){return y+increment(y,h);}
void main(){
  float obs;
  vec3 direction=launchRay(obs);
  float r0=length(cameraPosition),f0=1.0-1.0/r0;
  vec3 e1=cameraPosition/r0;
  float nr=dot(direction,e1);
  vec3 tangent=direction-nr*e1;
  float nt=length(tangent);
  physical=vec4(r0,0.0,1.0,obs);
  intersection=vec4(direction,-2.0); // -2 unresolved; never invent a luminous ring.
  rayMetadata=vec4(0.0);
  float efEnergy=1.0+nr/sqrt(r0);
  if(infalling){
    // EF past-directed ray from the radial infaller: E=1+nr/sqrt(r), kr=nr+1/sqrt(r).
    // E<=0 has no external stationary disk/sky source in this one-exterior scene.
    if(efEnergy<=0.0){intersection=vec4(0.0,0.0,0.0,-1.0);return;}
    obs=1.0/efEnergy;physical.w=obs;
  }
  if(nt<1e-7){intersection.w=(infalling?nr+inversesqrt(r0):nr)<0.0?-1.0:0.0;return;}
  vec3 e2=tangent/nt;
  // Conserved b=L/E from a local static observer: b=r sin(alpha)/sqrt(f).
  float b=infalling?r0*nt/efEnergy:r0*nt/sqrt(f0);
  vec2 y=vec2(1.0/r0,infalling?-(nr+inversesqrt(r0))/(r0*nt):-nr*sqrt(f0)/(r0*nt));
  float initialInvariant=1.0/(b*b);
  rayMetadata.x=b;
  // Numerical weak-field table is valid only at its exact observer radius.
  // r>60, b>32 implies periapsis>31rs, beyond the finite disk at 12rs.
  if(!infalling && useLookup && abs(r0-lookupRange.z)<1e-4 && b>lookupRange.x && b<0.97*lookupRange.y){
    float x=(b-lookupRange.x)/(lookupRange.y-lookupRange.x);
    float width=float(textureSize(weakLookup,0).x);
    vec4 deflection=texture(weakLookup,vec2((x*(width-1.0)+0.5)/width,nr<0.0?0.25:0.75));
    physical.x=deflection.z;
    intersection=vec4(normalize(e1*deflection.x+e2*deflection.y),0.0);
    rayMetadata.y=mod(atan(deflection.y,deflection.x)+2.0*PI,2.0*PI);
    rayMetadata.z=-1.0; // LUT diagnostic unavailable per pixel; inspector uses CPU reference.
    return;
  }
  // p_y(phi)=[e1_y cos(phi)+e2_y sin(phi)]/u.
  // Disk crossings have phi=atan2(-e1_y,e2_y)+n*pi: no chord approximation.
  float crossing=mod(atan(-e1.y,e2.y),PI);
  if(crossing<1e-5)crossing+=PI;
  bool coplanar=abs(e1.y)+abs(e2.y)<1e-7;
  float phi=0.0,angleCorrection=0.0,minR=r0;
  vec2 stateCorrection=vec2(0.0);
  float trialStep=MAX_STEP;
  for(int i=0;i<2048;i++){
    if(i>=maxSteps)break;
    // Shrink around u_ph=2/3. Tight region is narrow so ordinary rays stay cheap.
    float proximity=abs(y.x-2.0/3.0);
    float curvatureStep=mix(MIN_STEP,MAX_STEP,smoothstep(0.0,0.004,proximity));
    float h=min(trialStep,curvatureStep);
    if(diskEnabled&&!coplanar)h=min(h,crossing-phi);
    vec2 whole=rk4(y,h),halfState=rk4(y,h*0.5),fine=rk4(halfState,h*0.5);
    // Step doubling estimates RK4 local error /15. Highp is finite precision.
    float error=length(fine-whole)/15.0;
    float allowed=tolerance*max(length(y),0.01);
    if(error>allowed&&h>MIN_STEP){trialStep=max(MIN_STEP,h*0.5);continue;}
    vec2 delta=increment(y,h*0.5)+increment(halfState,h*0.5);
    // Kahan compensated sums preserve small increments of state and winding angle.
    vec2 corrected=delta-stateCorrection,next=y+corrected;
    stateCorrection=(next-y)-corrected;
    float correctedAngle=h-angleCorrection,nextPhi=phi+correctedAngle;
    angleCorrection=(nextPhi-phi)-correctedAngle;
    if(next.x<=0.0){
      // Root u(phi)=0 means source at infinity. Bisect the final RK4 step.
      float lo=0.0,hi=h;
      for(int j=0;j<12;j++){float mid=(lo+hi)*0.5;if(rk4(y,mid).x>0.0)lo=mid;else hi=mid;}
      float escapedPhi=phi+0.5*(lo+hi);
      rayMetadata.y=escapedPhi;
      physical.x=minR;
      intersection=vec4(e1*cos(escapedPhi)+e2*sin(escapedPhi),escapedPhi>2.0*PI?1.0:0.0);
      return;
    }
    y=next;phi=nextPhi;minR=min(minR,1.0/y.x);
    rayMetadata.y=phi;rayMetadata.w=float(i+1);
    rayMetadata.z=max(rayMetadata.z,abs(y.y*y.y+y.x*y.x*(1.0-y.x)-initialInvariant)/initialInvariant);
    // u=1 is the horizon. Spatial u(phi) is regular; no coordinate t is evolved.
    if(y.x>=1.0&&(!infalling||r0>1.0||y.y>0.0)){physical.x=1.0;intersection=vec4(0.0,0.0,0.0,-1.0);return;}
    bool onDisk=diskEnabled&&(!coplanar&&abs(phi-crossing)<2e-5);
    if(onDisk){
      float r=1.0/y.x;
      if(r>=ISCO&&r<=OUTER_DISK){
        vec3 er=e1*cos(phi)+e2*sin(phi),et=-e1*sin(phi)+e2*cos(phi);
        vec3 p=r*er;
        float f=1.0-1.0/r;
        // Local static-frame tangent from dr/dphi=-w/u², dl_r=dr/sqrt(f).
        // Reverse it: emitted light propagates from disk toward observer.
        vec3 emissionDirection=-normalize(-y.y/sqrt(f)*er+y.x*et);
        vec3 orbitDirection=normalize(vec3(-p.z,0.0,p.x));
        float beta=sqrt(1.0/(2.0*(r-1.0))),gamma=inversesqrt(1.0-beta*beta);
        float doppler=1.0/(gamma*(1.0-beta*dot(orbitDirection,emissionDirection)));
        // Simplified SS disk T^4 proportional to r^-3(1-sqrt(rISCO/r)).
        float rPeak=49.0/12.0;
        float peakProfile=(1.0-sqrt(ISCO/rPeak))/(rPeak*rPeak*rPeak);
        float temperature=peakTemperature*pow(max(0.0,(1.0-sqrt(ISCO/r))/(r*r*r))/peakProfile,0.25);
        if(diskModel==1){
          // Exact Schwarzschild Page-Thorne flux shape; same normalization as physics.js.
          float x=sqrt(2.0*r),a=sqrt(3.0),x0=sqrt(6.0);
          float integral=0.5*(x-x0-a*0.5*log((x-a)/(x+a)*(x0+a)/(x0-a)));
          float flux=max(0.0,3.0*sqrt(0.5)/(8.0*PI)*integral/(pow(r,3.5)*(1.0-1.5/r)));
          temperature=peakTemperature*pow(flux/ntPeakFlux,0.25);
        }
        physical=vec4(r,temperature,doppler,obs);
        // 2 = direct disk, 3+ = progressively wound disk images.
        intersection=vec4(p,2.0+floor(phi/PI));
        return;
      }
      crossing+=PI;
    }
    // Exactly coplanar opaque disk: enter its radial support on the first side.
    if(diskEnabled&&coplanar&&1.0/y.x>=ISCO&&1.0/y.x<=OUTER_DISK){
      intersection=vec4(0.0,0.0,0.0,-1.0);return;
    }
    trialStep=min(MAX_STEP,error<allowed*0.05?h*1.5:h);
  }
  physical.x=minR;
}`;

BHShaders.presentation = `precision highp float;
precision highp int;
${BHShaders.frame}
uniform sampler2D physicalBuffer, intersectionBuffer, spectrum, sky;
uniform int colorMode, thermalConvention, gravityDriver;
uniform bool dopplerEnabled, redshiftEnabled, skyLensing, higherImages, gravityOverlay, diagnostics;
uniform float exposure, gravityOpacity, dopplerExaggeration, peakTemperature;
uniform vec3 paletteA,paletteB,paletteC;
uniform bool comparisonEnabled;
uniform int comparisonMode, samplesPerPixel;
uniform float comparisonSplit;
out vec4 fragColor;
const float PI=3.141592653589793;
vec3 thermal(float t){
  t=clamp(t,0.0,1.0);
  // False-color convention, not a physical emission spectrum.
  if(thermalConvention==1)return t<0.5?mix(vec3(.85,.025,.018),vec3(1.0,.92,.67),t*2.0):mix(vec3(1.0,.92,.67),vec3(.035,.32,1.0),(t-.5)*2.0);
  if(t<.25)return mix(vec3(.008,.001,0),vec3(.55,.008,.002),t*4.0);
  if(t<.5)return mix(vec3(.55,.008,.002),vec3(1.0,.18,.01),(t-.25)*4.0);
  if(t<.75)return mix(vec3(1.0,.18,.01),vec3(1.0,.62,.07),(t-.5)*4.0);
  return mix(vec3(1.0,.62,.07),vec3(1.0,.97,.82),(t-.75)*4.0);
}
vec3 blackbody(float temperature){
  // LUT: integral B_lambda(lambda,T)*CIE(lambda) d lambda -> XYZ -> linear sRGB.
  float x=clamp(log(max(temperature,100.0)/100.0)/log(1e6),0.0,1.0);
  float width=float(textureSize(spectrum,0).x);
  return texture(spectrum,vec2((x*(width-1.0)+0.5)/width,.5)).rgb;
}
vec3 filmic(vec3 x){
  // Presentation only: ACES-like rational fit, coefficients of the Narkowicz fit.
  return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);
}
vec3 srgb(vec3 x){return mix(12.92*x,1.055*pow(x,vec3(1.0/2.4))-.055,step(vec3(.0031308),x));}
vec3 shade(vec2 uv){
  vec4 p=texture(physicalBuffer,uv),hit=texture(intersectionBuffer,uv);
  float tag=hit.w;
  int mode=comparisonEnabled&&uv.x>comparisonSplit?comparisonMode:colorMode;
  float observerFactor;vec3 initial=skyRay(uv,observerFactor);
  vec3 skyDirection=tag<1.5&&tag>=0.0&&skyLensing?normalize(hit.xyz):initial;
  vec2 skyUV=vec2(atan(skyDirection.z,skyDirection.x)/(2.0*PI)+.5,asin(clamp(skyDirection.y,-1.0,1.0))/PI+.5);
  // Explicit derivatives outside the divergent hit branches. Wrap longitude
  // derivatives at the map seam; mip filtering integrates finite source footprints.
  vec2 dx=dFdx(skyUV),dy=dFdy(skyUV);
  dx.x-=round(dx.x);dy.x-=round(dy.x);
  if(tag<-.5)return diagnostics&&tag< -1.5?vec3(1.0,0.0,.7):vec3(0.0);
  if(!higherImages&&(tag>=3.0||(tag>.5&&tag<1.5)))return vec3(0.0);
  float r0=length(cameraPosition),f0=1.0-1.0/r0;
  vec3 color;
  if(tag<1.5){
    // An extended-source sky: surface brightness is preserved, apparent area changes.
    color=textureGrad(sky,skyUV,dx,dy).rgb;
    // Background radiance uses a reference 6000 K spectrum to approximate its boost.
    // The star map has no measured per-source spectra. This is explicitly a sky model.
    float shift=(!infalling&&redshiftEnabled?inversesqrt(f0):1.0)*p.w;
    color*=blackbody(6000.0*shift)/max(blackbody(6000.0),vec3(1e-5));
  }else{
    float D=dopplerEnabled?p.z:1.0;
    // Exact static-to-static finite-distance gravitational frequency ratio.
    // An EF observer has no static-frame split at/inside the horizon. p.w=1/E
    // already carries its complete infinity-to-observer shift; only emission lapse is separate.
    float grav=redshiftEnabled?sqrt((1.0-1.0/p.x)/(infalling?1.0:f0)):1.0;
    float g=D*grav*p.w,Tobs=p.y*g;
    // Bolometric intensity normalized by sigma*T_peak^4/pi; g^4 is already in Tobs.
    float intensity=pow(Tobs/peakTemperature,4.0);
    float t=clamp(Tobs/peakTemperature,0.0,1.0);
    if(mode==0||mode==2){
      // B_nu(nu,gT) = g^3 B_nu(nu/g,T): do NOT multiply by g^4 a second time.
      color=blackbody(Tobs)*.08; // Declared exposure calibration: 10000 K reference.
    }else if(mode==1){color=thermal(t)*intensity;}
    else if(mode==3){
      color=(t<.5?mix(paletteA,paletteB,t*2.0):mix(paletteB,paletteC,(t-.5)*2.0))*intensity;
    }else{
      // Educational D-only display: symmetric around D=1. Exaggeration changes LUT only.
      float d=clamp((D-1.0)*dopplerExaggeration,-1.0,1.0);
      color=mix(vec3(1.0),d>0.0?vec3(.015,.23,1.0):vec3(1.0,.025,.01),abs(d));
      color*=pow(D,4.0)*.45; // D^4 bolometric beaming; deliberately independent of T.
    }
  }
  color=filmic(color*exp2(exposure));
  if((gravityOverlay||mode==2)&&p.x>1.0){
    // On sky pixels r is closest approach; on disk pixels it is emission radius.
    // z is infinity-referenced, potential dimensionless, K normalized by rs^4.
    float r=max(p.x,1.00001),value;
    if(gravityDriver==0){float z=inversesqrt(1.0-1.0/r)-1.0;value=z/(1.0+z);}
    else if(gravityDriver==1)value=1.0/r; // maps |Phi/c²| in [0,.5] to [0,1].
    else value=pow(r,-6.0); // K rs^4/12 = r^-6.
    vec3 wash=mix(vec3(.015,.18,.42),vec3(1.0,.13,.025),clamp(value,0.0,1.0));
    color=mix(color,wash,gravityOpacity);
  }
  return color;
}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution;
  vec3 color;
  if(samplesPerPixel==4){
    // Four independently traced subpixels; never interpolate physical hit records.
    // Filter display-linear samples before sRGB encoding. Filmic mapping is per sample.
    vec2 d=vec2(.25)/resolution;
    color=(shade(uv+d)+shade(uv-d)+shade(uv+vec2(d.x,-d.y))+shade(uv+vec2(-d.x,d.y)))*.25;
  }else color=shade(uv);
  fragColor=vec4(srgb(color),1.0);
}`;
