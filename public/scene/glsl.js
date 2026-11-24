// GLSL shared by the scene shaders, so they all agree on the water colour and the light.

export const FINE_TILE = 32;
export const SWELL_TILE = 128;
export const NOISE_SIZE = 256; // pixels along one side of the noise texture

export const common = /* glsl */ `
uniform sampler2D uWaveTex;   // fine waves.  r: caustic, gb: height gradient, a: height
uniform sampler2D uSwellTex;  // swell waves. same layout
uniform vec3 uSunWater;       // unit vector toward the sun, under water
uniform vec2 uTravel;         // distance the whale has swum, wrapped to the 512 m terrain tile
uniform float uCamDepth;      // depth of the camera in metres
uniform sampler2D uNoise;     // tileable noise, four independent channels

const float TAU = 6.2831853;
const float FINE_TILE = ${FINE_TILE.toFixed(1)};
const float SWELL_TILE = ${SWELL_TILE.toFixed(1)};
const float NOISE_SIZE = ${NOISE_SIZE.toFixed(1)};
const vec3 EXT = vec3(0.058, 0.021, 0.0155);    // loss per metre along the view path
const vec3 ABSORB = vec3(0.110, 0.020, 0.0125); // loss per metre for sunlight going down
const float FLOOR_Y = -74.0;                    // mean height of the sea floor
const vec3 SAND = vec3(0.50, 0.44, 0.33);
const vec3 AMBIENT_LOSS = vec3(0.060, 0.020, 0.014); // loss per metre for light scattered down from the surface

// Colour of open water in a view direction. Fog and the background both use it, so objects fade into it.
vec3 waterBg(vec3 dir) {
  float y = dir.y;
  vec3 deep = vec3(0.0005, 0.0085, 0.036);
  vec3 mid  = vec3(0.0035, 0.060, 0.140);
  vec3 up   = vec3(0.026, 0.210, 0.320);
  vec3 c = mix(deep, mid, smoothstep(-0.95, 0.10, y));
  c = mix(c, up, smoothstep(0.02, 1.0, y));
  float toSun = max(dot(dir, uSunWater), 0.0);
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

// Texture coordinate that eases between texels. Plain linear filtering leaves a visible grid of creases in the sand.
vec2 eased(vec2 uv) {
  uv = uv * NOISE_SIZE + 0.5;
  vec2 f = fract(uv);
  return (floor(uv) + f * f * (3.0 - 2.0 * f) - 0.5) / NOISE_SIZE;
}

// Height of the sand at a world position: broad dunes plus small bumps. The pattern repeats every 512 m.
float floorHeight(vec2 xz) {
  vec2 uv = (xz + uTravel) / 512.0;
  float dunes = textureLod(uNoise, eased(uv), 0.0).r;
  float bumps = textureLod(uNoise, eased(uv * 4.0 + 0.3), 0.0).g;
  return FLOOR_Y + (dunes - 0.5) * 16.0 + (bumps - 0.5) * 3.5;
}

// Point on the surface that the sun ray through worldPos came from.
vec2 surfacePoint(vec3 worldPos) {
  float depth = max(-worldPos.y, 0.0);
  return worldPos.xz + uSunWater.xz * (depth / uSunWater.y) + uTravel;
}

// Caustic brightness. Deeper points get a blurrier pattern.
float causticAt(vec3 worldPos) {
  float depth = max(-worldPos.y, 0.0);
  vec2 sp = surfacePoint(worldPos);
  float lod = clamp(depth * 0.045, 0.0, 3.5);
  float fine = textureLod(uWaveTex, sp / FINE_TILE, lod).r;
  float swell = textureLod(uSwellTex, sp / SWELL_TILE, lod * 0.5).r;
  // Far down only the broad swell pattern is left. The blurred fine waves would show as a regular grid.
  float deep = smoothstep(25.0, 60.0, depth);
  return mix(fine, 1.0, deep * 0.9) * mix(1.0, swell, 0.30 + 0.55 * deep);
}

vec3 sunAt(float depth) {
  return vec3(1.0, 0.96, 0.88) * exp(-ABSORB * max(depth, 0.0) / uSunWater.y);
}

// Standard lighting for an opaque surface: caustic sunlight from above, scattered light from all sides, then fog.
vec3 shadeSurface(vec3 albedo, vec3 N, vec3 V, vec3 worldPos, float gloss, float flash) {
  float depth = -worldPos.y;
  float ndl = dot(N, uSunWater);
  float caustic = causticAt(worldPos);
  vec3 sun = sunAt(depth) * clamp((ndl + 0.35) / 1.35, 0.0, 1.0) * mix(1.0, caustic, 0.8 * smoothstep(-0.05, 0.35, ndl));
  float skyward = N.y * 0.5 + 0.5;
  vec3 ambient = mix(vec3(0.010, 0.060, 0.110), vec3(0.060, 0.330, 0.470), skyward * skyward)
               * exp(-AMBIENT_LOSS * depth);
  vec3 col = albedo * (sun * 1.3 + ambient * 1.5);
  vec3 H = normalize(uSunWater + V);
  col += sunAt(depth) * pow(max(dot(N, H), 0.0), gloss) * flash * (0.3 + caustic);
  col += waterBg(reflect(-V, N)) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.6;
  return fogged(col, worldPos);
}
`;
