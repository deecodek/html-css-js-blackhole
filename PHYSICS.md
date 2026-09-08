# Schwarzschild laboratory — model and research notes

## Equations confirmed before implementation

All ray distances are measured in the current Schwarzschild radius. Thus G=c=1,
rs=1 and M=1/2 inside the shader; SI values are used for the readouts.

* `rs = 2 G M / c²`. Metric: `ds²=−f dt²+dr²/f+r² dΩ²`, `f=1−1/r`.
* Spherical symmetry fixes each null ray to a plane. For `u=1/r`,
  `u′=w`, `w′=1.5u²−u`; primes mean derivatives with respect to orbital angle.
  The invariant is `w²+u²−u³=1/b²`, where `b=L/E`.
* A local static-frame launch direction has radial component `nr` and tangential
  magnitude `nt`. Its initial data are `b=r nt/sqrt(f)`, `w=−nr sqrt(f)/(r nt)`.
  Radial rays are a separate limiting case. Future outward rays between rs and
  the photon sphere can escape; a radius-only capture test is incorrect.
* Horizon `r=1`; unstable circular photon orbit `r=1.5`; ISCO `r=3`.
  Critical impact parameter `bc=sqrt(27)/2`. A static observer sees angular
  shadow radius `asin(bc sqrt(f)/r)` outside the photon sphere. This is not a
  luminous shell at r=1.5. Bright rings need disk or background illumination.
* Local circular speed `β=sqrt[1/(2(r−1))]`; coordinate angular frequency
  `Ω=sqrt[1/(2r³)]`; `dt/dτ=1/sqrt[1−3/(2r)]`.
  The prompt's `sqrt(M/r)/sqrt(1−3M/r)` equals `r dφ/dτ`, not local β.
  Stable circular cameras are restricted to r>3.
* Static tetrad: `e_(t)=f^−1/2 ∂t`, `e_(r)=sqrt(f) ∂r`,
  `e_(θ)=r^−1 ∂θ`, `e_(φ)=(r sinθ)^−1 ∂φ`.
  Lorentz-boost the past-directed camera ray into this frame. For skyward
  direction q and observer velocity v, `q_static =
  [q+((γ−1)(v·q)/β²−γ)v]/[γ(1−v·q)]`.
  Observer frequency factor is `1/[γ(1−v·q)]`.
* Emission direction is the reversed integrated tangent in the emitter's local
  static tetrad, not a straight line from disk to camera.
  `D=1/[γ_emit(1−β_emit·n_emit)]`.
  `g_grav=sqrt(f_emit/f_observer)`; `g=g_grav D g_observer`.
* Thin, opaque, stationary disk: `T⁴=3GM Mdot/(8πσr³)(1−sqrt(rISCO/r))`.
  We expose peak temperature as the normalization (equivalent to choosing Mdot).
  Its maximum is at `r=(49/36)rISCO`; temperature is zero at the zero-torque ISCO.
  This is the Newtonian Shakura–Sunyaev radial profile, not Novikov–Thorne or GRMHD.
* `Iν,obs(ν)=g³ Iν,em(ν/g)`; bolometric `Iobs=g⁴ Iem`.
  For a blackbody this is exactly `Bν(ν,gT)`; multiplying by g⁴ again would
  double-count the boost. Three versus four is spectral versus bolometric,
  not a universal optically-thin versus optically-thick rule.
* Planck: `Bλ=2hc²/[λ⁵(exp(hc/(λkT))−1)]`. Numerically integrate 380–780 nm
  at 5 nm intervals against Wyman et al.'s analytic CIE 1931 fits, convert XYZ
  to linear sRGB, cache a log-temperature table, apply exposure, an ACES-like
  filmic fit, then the sRGB transfer function. CIE fits, finite quadrature,
  RGB gamut clipping and tone mapping are presentation approximations.
* Gravity overlays sample disk emission radius, or minimum ray radius for sky:
  `z=1/sqrt(f)−1`, `Φ/c²=−1/(2r)`, `K rs⁴=12/r⁶`.
  The last two are a dimensionless potential and normalized curvature, respectively.

## Numerical implementation and explicit limits

The GPU integrates the exact spatial Schwarzschild null equation with adaptive
RK4 and compensated accumulation of angle and state. Disk-plane crossing angles
are solved analytically in the ray plane and the integration step ends exactly
at each crossing. No disk mesh, radial distortion or painted photon ring is used.
Step size ranges over 100× near the photon sphere; step doubling estimates local
error. Finite work budgets leave unresolved rays black; the diagnostic view
marks those rays magenta. No claim of unlimited higher-order image resolution
is made: WebGL highp is single precision, even with compensated accumulation.

For rays guaranteed to miss the outer disk, a camera-radius-dependent table of
outgoing direction versus impact parameter is integrated in JavaScript double
precision. This table accelerates eligible weak-field sky paths only. Strong
lensing and disk rays retain GPU RK4. The table is invalidated when radius changes.

The finite scene disk ends at 12rs; this outer boundary is a scene parameter,
not an additional special radius of the metric. The stationary scene needs no coordinate time integration or retarded texture
animation. u(φ) is regular at the horizon; no Schwarzschild-time singularity is
introduced. All observers remain outside r=1.5. Horizon-crossing observers would
require an additional regular observer tetrad (e.g. ingoing Eddington–Finkelstein)
and are not implemented. Neither Kerr nor a purported plunge animation is offered.

The sky is a deterministic synthetic extended-source environment, not a measured
catalog. Finite star sizes and texture filtering approximate finite pixel beams;
this is less accurate than DNGR or Bruneton's specialized star-beam integration.
Geodesic mapping conserves surface brightness and naturally changes image area.

All color modes share the same floating-point geometry buffers. Disabling disk
Doppler sets D=1, and disabling gravitational shift sets g_grav=1. The higher-order
light switch discards that source contribution by winding order: it is an
educational, nonphysical emission filter, not a change to GR. Sky-lensing off
samples the original skyward direction while retaining the computed capture mask.

Changing mass holds camera distance in kilometres fixed, changing its dimensionless
radius and the apparent geometry. Changing distance holds mass fixed. Orbital time
is proper time with an explicitly displayed adjustable simulation clock multiplier.

## Sources

1. [Cambridge, Schwarzschild solution and classic tests](https://www.damtp.cam.ac.uk/user/us248/Lectures/Notes/grII.pdf): metric, geodesics, photon orbit, ISCO.
2. [James, von Tunzelmann, Franklin & Thorne (2015), DNGR](https://arxiv.org/abs/1502.03808): moving cameras and ray bundles. Reference only; original implementation here.
3. [Bruneton (2020), real-time Schwarzschild rendering](https://ebruneton.github.io/black_hole_shader/paper.pdf) and [open-source implementation](https://github.com/ebruneton/black_hole_shader): orbital reduction, tables, local frames, spectral transport. Reference only; no shader code copied.
4. [Urry & Padovani, Doppler parameters](https://ned.ipac.caltech.edu/level5/Urry1/UrryP_appena.html) and [intensity transformation](https://ned.ipac.caltech.edu/level5/Urry1/UrryP_appenb.html).
5. [Armitage, accretion disk lectures](https://arxiv.org/abs/astro-ph/0701485): zero-torque thin-disk temperature law.
6. [Wyman, Sloan & Shirley (2013), CIE fits](https://jcgt.org/published/0002/02/01/paper.pdf): analytic color matching coefficients.

## Dynamic objects

Moving objects are tracked as worldtubes in ingoing Kerr–Schild coordinates (`relativity.js`).
Each object carries a history of position, 4-velocity and shape (axes + temperature) that is
uploaded to the GPU as float textures. The geometry shader (`dynamic-shader.js`) performs a
ray–ellipsoid intersection test at each RK4 step: it binary-searches the object history for
the ray's current KS coordinate time, interpolates center and 4-velocity, transforms the
ray into the object's local orthonormal tetrad, and evaluates an ellipsoidal distance
function. A bisection refines the earliest intersection along the finite ray segment.
The hit emits blackbody radiation modulated by the full four-vector frequency ratio.

Object types: Probe (point beacon), Rock (tidal disruption), Spacecraft, Star (spaghetti
effect + debris cloud), Cloud (collisionless particle set), Light (null geodesic tracer).
Material response uses a reduced affine model with spring restoring force and viscous
damping; disruption occurs when tidal stress exceeds the configured strength threshold.

## Build checklist

- [x] CDN harness and responsive page
- [x] Static observer, RK4, conserved-quantity and capture validation
- [x] Opaque disk, frequency transport, lensed sky
- [x] Five presentation modes and legends
- [x] Orbiting tetrad, aberration and proper-time clock
- [x] Zoom bands, numerical LOD, weak-field lookup, annotations and radar
- [x] Browser checks, diagnostics, documentation and handoff
- [x] Dynamic objects: moving-source worldtube intersections, experiment engine, relativity module
- [x] Experiment UI: spawn/remove/reset controls, object list panel, GUI folder
- [x] Tests: relativity module (initial, advance, tidal, electric tidal), experiment engine (spawn, advance, snapshot, material, disruption, 8-object limit)
