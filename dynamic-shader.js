/* Moving-source worldtube intersections. Histories use the SAME regular KS time
   as the receiving observer. Missing/pre-birth history emits nothing. */
BHShaders.dynamic = `
uniform int objectCount;
uniform sampler2D objectPositions,objectVelocities,objectShapes;
uniform int historyCounts[8];
uniform vec3 objectBoundsMin[8],objectBoundsMax[8];
uniform float coordinateTime;
float ksMetric(vec3 p,vec4 a,vec4 b){vec3 n=normalize(p);return -a.x*b.x+dot(a.yzw,b.yzw)+(a.x+dot(n,a.yzw))*(b.x+dot(n,b.yzw))/length(p);}
bool history(int id,float t,out vec3 center,out vec4 U,out vec4 shape){
  int count=historyCounts[id];if(count<2)return false;
  vec4 first=texelFetch(objectPositions,ivec2(0,id),0),last=texelFetch(objectPositions,ivec2(count-1,id),0);
  if(t<first.x||t>last.x)return false;
  int lo=0,hi=count-1;
  for(int j=0;j<11;j++){if(hi-lo<=1)break;int mid=(lo+hi)/2;if(texelFetch(objectPositions,ivec2(mid,id),0).x<t)lo=mid;else hi=mid;}
  vec4 a=texelFetch(objectPositions,ivec2(lo,id),0),b=texelFetch(objectPositions,ivec2(hi,id),0);
  float f=clamp((t-a.x)/max(b.x-a.x,1e-9),0.0,1.0);
  center=mix(a.yzw,b.yzw,f);U=mix(texelFetch(objectVelocities,ivec2(lo,id),0),texelFetch(objectVelocities,ivec2(hi,id),0),f);
  float norm=-ksMetric(center,U,U);if(norm<=0.0)return false;U/=sqrt(norm);
  shape=mix(texelFetch(objectShapes,ivec2(lo,id),0),texelFetch(objectShapes,ivec2(hi,id),0),f);
  return shape.x>0.0;
}
float bodyDistance(vec3 p,vec3 center,vec4 U,vec3 axes){
  vec3 n=normalize(center),t=normalize(cross(n,abs(n.y)<.9?vec3(0,1,0):vec3(1,0,0))),b=cross(n,t);
  float s=inversesqrt(length(center));vec4 F=vec4(1.0/(1.0+s)+s,-s*n);
  vec4 e[3];e[0]=vec4(-s/(1.0+s),n);e[1]=vec4(0,t);e[2]=vec4(0,b);
  float gamma=-ksMetric(center,F,U);vec3 beta=vec3(ksMetric(center,e[0],U),ksMetric(center,e[1],U),ksMetric(center,e[2],U))/gamma;
  vec4 v=beta.x*e[0]+beta.y*e[1]+beta.z*e[2],delta=vec4(0,p-center);
  float b2=dot(beta,beta),q=0.0;
  for(int j=0;j<3;j++){vec4 axis=e[j]+gamma*beta[j]*F+(b2>1e-12?(gamma-1.0)*beta[j]/b2:0.0)*v;float distance=ksMetric(center,axis,delta)/max(axes[j],1e-15);q+=distance*distance;}
  return q;
}
// Exact dt_KS/dphi in Schwarzschild orbital reduction, rationalized at future horizon.
float ksTimeRate(vec2 y,float e){return -((1.0+y.x)*y.y*y.y+y.x*y.x)/max((e-y.x*y.y)*y.x*y.x,1e-20);}
bool movingHit(vec3 p0,vec3 p1,float t0,float t1,out vec4 hitData,out vec4 hitVelocity,out vec4 hitShape){
  float closest=2.0;bool found=false;
  for(int id=0;id<8;id++){
    if(id>=objectCount)break;
    if(any(lessThan(max(p0,p1),objectBoundsMin[id]))||any(greaterThan(min(p0,p1),objectBoundsMax[id])))continue;
    vec3 c0,c1;vec4 u0,u1,s0,s1;
    if(!history(id,t0,c0,u0,s0)||!history(id,t1,c1,u1,s1))continue;
    vec3 a=p0-c0,d=(p1-c1)-a;
    float fraction=clamp(-dot(a,d)/max(dot(d,d),1e-20),0.0,1.0);
    vec3 center;vec4 U,shape;
    if(!history(id,mix(t0,t1,fraction),center,U,shape))continue;
    if(bodyDistance(mix(p0,p1,fraction),center,U,shape.xyz)>1.0)continue;
    float lo=0.0,hi=fraction;
    // Refine the earliest intersection of the finite ray segment and moving ellipsoid.
    for(int j=0;j<12;j++){float m=(lo+hi)*.5;history(id,mix(t0,t1,m),center,U,shape);if(bodyDistance(mix(p0,p1,m),center,U,shape.xyz)>1.0)lo=m;else hi=m;}
    if(hi<closest){closest=hi;history(id,mix(t0,t1,hi),center,U,shape);hitData=vec4(mix(p0,p1,hi),float(id));hitVelocity=U;hitShape=vec4(shape.w,hi,0.0,0.0);found=true;}
  }
  return found;
}
`;
// Inject into the original geometry kernel; static-scene equations remain unchanged.
BHShaders.geometry=BHShaders.geometry.replace('vec2 field(vec2 y)',BHShaders.dynamic+'\nvec2 field(vec2 y)');
BHShaders.geometry=BHShaders.geometry.replace('if(!infalling && useLookup','if(objectCount==0 && !infalling && useLookup');
BHShaders.geometry=BHShaders.geometry.replace('float phi=0.0,angleCorrection','float rayTime=coordinateTime;\n  float phi=0.0,angleCorrection');
BHShaders.geometry=BHShaders.geometry.replace('y=next;phi=nextPhi;minR',`
    if(objectCount>0){
      float dt=h/6.0*(ksTimeRate(y,1.0/b)+4.0*ksTimeRate(halfState,1.0/b)+ksTimeRate(next,1.0/b));
      vec3 p0=(e1*cos(phi)+e2*sin(phi))/y.x,p1=(e1*cos(nextPhi)+e2*sin(nextPhi))/next.x;
      vec4 objectHit,U,shape;
      if(movingHit(p0,p1,rayTime,rayTime+dt,objectHit,U,shape)){
        float a=shape.y,angle=mix(phi,nextPhi,a);vec2 state=mix(y,next,a);
        vec3 er=e1*cos(angle)+e2*sin(angle),et=-e1*sin(angle)+e2*cos(angle);
        vec4 pastK=vec4(ksTimeRate(state,1.0/b)*state.x*state.x,-state.y*er+state.x*et);
        float emissionEnergy=ksMetric(objectHit.xyz,U,pastK);
        float observedEnergy=obs/(b*(infalling?1.0:sqrt(f0)));
        if(emissionEnergy>0.0){physical=vec4(length(objectHit.xyz),shape.x,1.0,observedEnergy/emissionEnergy);intersection=vec4(objectHit.xyz,20.0+objectHit.w);rayMetadata.y=angle;rayMetadata.w=float(i+1);return;}
      }
      rayTime+=dt;
    }
    y=next;phi=nextPhi;minR`);
BHShaders.presentation=BHShaders.presentation.replace('tag>=3.0||(tag>.5','(tag>=3.0&&tag<20.0)||(tag>.5');
BHShaders.presentation=BHShaders.presentation.replace('}else{\n    float D=dopplerEnabled',`}else if(tag>=20.0){
    // Full four-vector frequency ratio for a moving source, including interior emitters.
    // Material emission is blackbody; a dark body stays dark. No enlarged observer objects.
    color=blackbody(p.y*p.w)*.08;
  }else{\n    float D=dopplerEnabled`);
