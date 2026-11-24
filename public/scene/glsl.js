// GLSL shared by every material in the scene. All of them agree on the water colour and the light.

export const FINE_TILE = 32;
export const SWELL_TILE = 128;

export const common = /* glsl */ `
uniform sampler2D uWaveTex;   // fine waves.  r: caustic, gb: height gradient, a: height
uniform sampler2D uSwellTex;  // swell waves. same layout
uniform vec3 uSunDir;         // unit vector toward the sun, under water
uniform vec2 uTravel;         // distance the whale has swum, wrapped to the swell tile
uniform float uCamDepth;      // metres below the surface

const float FINE_TILE = 32.0;
const float SWELL_TILE = 128.0;
const vec3 EXT = vec3(0.058, 0.021, 0.0155);    // loss per metre along the view path
const vec3 ABSORB = vec3(0.110, 0.020, 0.0125); // loss per metre for sunlight going down

// Colour of open water in a view direction. Fog and the background both use it, so objects fade into it.
vec3 waterBg(vec3 dir) {
  float y = dir.y;
  vec3 deep = vec3(0.0005, 0.0085, 0.036);
  vec3 mid  = vec3(0.0035, 0.060, 0.140);
  vec3 up   = vec3(0.026, 0.210, 0.320);
  vec3 c = mix(deep, mid, smoothstep(-0.95, 0.10, y));
  c = mix(c, up, smoothstep(0.02, 1.0, y));
  float toSun = max(dot(dir, uSunDir), 0.0);
  c += vec3(0.010, 0.085, 0.105) * pow(toSun, 4.0);
  float path = uCamDepth * (1.0 - 0.5 * max(y, 0.0));
  c *= exp(-vec3(0.050, 0.019, 0.013) * path);
  return c;
}

vec3 fogged(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - cameraPosition;
  float d = length(v);
  return mix(waterBg(v / d), col, exp(-EXT * d));
}

// Point on the surface that the sun ray through worldPos came from.
vec2 surfacePoint(vec3 worldPos) {
  float depth = max(-worldPos.y, 0.0);
  return worldPos.xz + uSunDir.xz * (depth / uSunDir.y) + uTravel;
}

// Caustic brightness, mean close to 1. Deeper points get a blurrier pattern.
float causticAt(vec3 worldPos) {
  float depth = max(-worldPos.y, 0.0);
  vec2 sp = surfacePoint(worldPos);
  float lod = clamp(depth * 0.045, 0.0, 3.5);
  float fine = textureLod(uWaveTex, sp / FINE_TILE, lod).r;
  float swell = textureLod(uSwellTex, sp / SWELL_TILE, lod * 0.5).r;
  return fine * mix(1.0, swell, 0.30);
}

vec3 sunAt(float depth) {
  return vec3(1.0, 0.96, 0.88) * exp(-ABSORB * max(depth, 0.0) / uSunDir.y);
}
`;
