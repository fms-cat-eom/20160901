#define MARCH_ITER 120
#define RAYAMP_MIN 0.0
#define INIT_LEN 0.01
#define NSAMPLE 1
#define NREF 10
#define SKY_COLOR vec3( 0.4, 0.7, 0.9 )

#define CLOUD_COLOR vec3( 0.5 )
#define CLOUD_DIST 0.05

#define SUN_POSITION vec3( 50.0, 100.0, 100.0 )

#define IFS_ITER 4

// ---

#define PI 3.14159265
#define V vec2(0.,1.)
#define saturate(i) clamp(i,0.,1.)
#define lofi(i,m) (floor((i)/(m))*(m))

// ---

precision highp float;

uniform float time;
uniform vec2 resolution;

uniform sampler2D textureRandom;
uniform sampler2D textureRandomStatic;
uniform sampler2D textureImageKugatsu;
uniform sampler2D textureDistanceAlready;
uniform sampler2D textureDistanceSeptember;
uniform sampler2D textureDistanceKugatsu;
uniform sampler2D textureDistance32;

// ---

vec3 color;
vec3 amp;

// ---

vec4 seed;
float random() { // weird prng
  const vec4 q = vec4(   1225.0,    1585.0,    2457.0,    2098.0);
  const vec4 r = vec4(   1112.0,     367.0,      92.0,     265.0);
  const vec4 a = vec4(   3423.0,    2646.0,    1707.0,    1999.0);
  const vec4 m = vec4(4194287.0, 4194277.0, 4194191.0, 4194167.0);

  vec4 beta = floor(seed / q);
  vec4 p = a * (seed - beta * q) - beta * r;
  beta = (sign(-p) + vec4(1.0)) * vec4(0.5) * m;
  seed = (p + beta);

  return fract(dot(seed / m, vec4(1.0, -1.0, 1.0, -1.0)));
}

vec4 random4() {
  return vec4(
    random(),
    random(),
    random(),
    random()
  );
}

float noise3d( in vec3 x ) { // thanks iq
  vec3 p = floor( x );
  vec3 f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	vec2 uv = ( p.xy + vec2( 37.0, 17.0 ) * p.z ) + f.xy;
	vec2 rg = texture2D( textureRandomStatic, ( uv + 0.5 ) / 256.0, -100.0 ).yx;
	return mix( rg.x, rg.y, f.z );
}

// ---

mat2 rotate2D( float _t ) {
  return mat2( cos( _t ), sin( _t ), -sin( _t ), cos( _t ) );
}

vec3 rotateEuler( vec3 _p, vec3 _r ) {
  vec3 p = _p;
  p.yz = rotate2D( _r.x ) * p.yz;
  p.zx = rotate2D( _r.y ) * p.zx;
  p.xy = rotate2D( _r.z ) * p.xy;
  return p;
}

float gaussian( float _x, float _v ) {
  return 1.0 / sqrt( 2.0 * PI * _v ) * exp( - _x * _x / 2.0 / _v );
}

float smin( float _a, float _b, float _k ) {
  float h = clamp( 0.5 + 0.5 * ( _b - _a ) / _k, 0.0, 1.0 );
  return mix( _b, _a, h ) - _k * h * ( 1.0 - h );
}

// ---

struct Camera {
  vec3 pos;
  vec3 dir;
  vec3 sid;
  vec3 top;
};

struct Ray {
  vec3 dir;
  vec3 ori;
  bool inside;
};

struct Material {
  vec3 color;

  vec3 emissive;
  vec3 edgeEmissive;

  float reflective;
  float reflectiveRoughness;
  float refractive;
  float refractiveIndex;

  float transparency;
};

struct Map {
  float dist;
  Material material;
};

struct March {
  Ray ray;
  Map map;
  float len;
  vec3 pos;
  vec3 normal;
};

// ---

Camera camInit( in vec3 _pos, in vec3 _tar ) {
  Camera cam;
  cam.pos = _pos;
  cam.dir = normalize( _tar - _pos );
  cam.sid = normalize( cross( cam.dir, V.xyx ) );
  cam.top = normalize( cross( cam.sid, cam.dir ) );

  return cam;
}

Map distFunc( in vec3 _p );
Ray rayInit( in vec3 _ori, in vec3 _dir ) {
  Ray ray;
  ray.dir = _dir;
  ray.ori = _ori;
  ray.inside = distFunc( ray.ori ).dist < 0.0;
  return ray;
}

Ray rayFromCam( in vec2 _p, in Camera _cam ) {
  vec3 dir = normalize( _p.x * _cam.sid + _p.y * _cam.top + _cam.dir );
  return rayInit( _cam.pos, dir );
}

Material mtlInit( in vec3 _col ) {
  Material material;
  material.color = _col;

  material.emissive = V.xxx;
  material.edgeEmissive = V.xxx;

  material.reflective = 0.0;
  material.reflectiveRoughness = 0.0;
  material.refractive = 0.0;
  material.refractiveIndex = 1.0;

  material.transparency = 0.0;

  return material;
}

Map mapInit( in float _dist ) {
  Map map;
  map.dist = _dist;
  map.material = mtlInit( V.xxx );
  return map;
}

March marchInit( in Ray _ray ) {
  March march;
  march.ray = _ray;
  march.len = INIT_LEN;
  march.pos = _ray.ori + _ray.dir * march.len;
  return march;
}

// ---

float sphere( in vec3 _p, in float _r ) {
  return length( _p ) - _r;
}

float box( in vec3 _pos, in vec3 _size ) {
  vec3 d = abs( _pos ) - _size;
  return min( max( d.x, max( d.y, d.z ) ), 0.0 ) + length( max( d, 0.0 ) );
}

float tri( in vec3 _p, in float _size ) {
  vec3 q = abs( _p );
  return max( q.x * 0.866025 + _p.y * 0.5, -_p.y ) - _size * 0.5;
}

float slasher( vec3 _p, float _density, float _ratio ) {
  float phase = ( _p.x + _p.y ) * _density;
  float slash = abs( 0.5 - ( phase - floor( phase ) ) ) * 2.0;
  return ( slash - _ratio ) / _density / sqrt( 3.0 );
}

vec2 wordUv( vec3 _p, float _size ) {
  return 0.5 + _p.xy / _size;
}

vec3 word( vec3 _p, sampler2D _tex, float _size, float _ext, float _bold ) {
  vec3 pos = _p;
  if ( box( pos, vec2( 0.5 * _size, _ext * 2.0 ).xxy ) < 0.0 ) {
    vec4 tex = V.xxxx;
    for ( int iy = -1; iy < 2; iy ++ ) {
      for ( int ix = -1; ix < 2; ix ++ ) {
        vec2 coord = wordUv( pos, _size ) + vec2( ix, iy ) / 2048.0;
        tex += texture2D( _tex, coord ) / 9.0;
      }
    }
    vec2 distXY = vec2(
      ( ( tex.x - tex.y ) - _bold ) * _size / 8.0,
      abs( pos.z ) - _ext
    );

    float dist = min( max( distXY.x, distXY.y ), 0.0 ) + length( max( distXY, 0.0 ) );
    return vec3( dist, distXY );
  } else {
    return vec3( box( pos, vec2( 0.5 * _size, _ext * 2.0 ).xxy * 0.9 ), 0.0, 0.0 );
  }
}

vec3 ifs( vec3 _p, vec3 _rot, vec3 _shift ) {
  vec3 pos = _p;

  vec3 shift = _shift;

  for ( int i = 0; i < IFS_ITER; i ++ ) {
    float intensity = pow( 2.0, -float( i ) );

    pos.y -= 0.0;

    pos = abs( pos )
      - shift
      * intensity;

    shift.yz = rotate2D( _rot.x ) * shift.yz;
    shift.zx = rotate2D( _rot.y ) * shift.zx;
    shift.xy = rotate2D( _rot.z ) * shift.xy;

    if ( pos.x < pos.y ) { pos.xy = pos.yx; }
    if ( pos.x < pos.z ) { pos.xz = pos.zx; }
    if ( pos.y < pos.z ) { pos.yz = pos.zy; }
  }

  return pos;
}

Map distFunc( in vec3 _p, in float _time ) {
  Map map = mapInit( 1E9 );
  float phaseStart = exp( -time * 10.0 );
  float phaseEnd = pow( max( 0.0, time - 0.7 ) / 0.3, 2.0 );

  { // already
    vec3 p = _p;
    p.xy = rotate2D( -phaseEnd ) * p.xy;
    p -= vec3( 0.0, 0.0, 5.0 ) * phaseEnd;
    p -= vec3( 0.0, ( cos( phaseStart * PI / 2.0 ) - 1.0 ), -sin( phaseStart * PI / 2.0 ) ) * 4.0;
    p -= vec3( 0.0, 0.4, -0.3 );
    p.xy = rotate2D( sin( time * PI * 4.0 ) * 0.3 ) * p.xy;
    p.zx = rotate2D( sin( time * PI * 4.0 + 1.0 ) * 0.3 ) * p.zx;
    p.yz = rotate2D( sin( time * PI * 4.0 + 2.0 ) * 0.3 ) * p.yz;
    float dist = word( p, textureDistanceAlready, 6.0 * ( 1.0 - phaseStart ), 0.1, 0.0 ).x;

    if ( dist < map.dist ) {
      map = mapInit( dist );
      map.material = mtlInit( vec3( 0.2, 0.4, 0.9 ) );
      map.material.reflective = 0.1;
    }
  }

  { // september
    vec3 p = _p;
    p.xy = rotate2D( -phaseEnd ) * p.xy;
    p -= vec3( 0.0, 0.0, 5.0 ) * phaseEnd;
    p -= vec3( 0.0, ( cos( phaseStart * PI / 2.0 ) - 1.0 ), -sin( phaseStart * PI / 2.0 ) ) * 4.0;
    p -= vec3( 0.0, -0.4, 0.4 );
    p.yz = rotate2D( 0.1 ) * p.yz;
    p.y += sin( p.x * 3.0 + time * PI * 4.0 ) * 0.07;
    float dist = word( p, textureDistanceSeptember, 6.0 * ( 1.0 - phaseStart ), 0.2, 0.0 ).x;

    if ( dist < map.dist ) {
      map = mapInit( dist );
      map.material = mtlInit( vec3( 0.9, 0.2, 0.8 ) );
    }
  }

  { // kugatsu
    vec3 p = _p;
    p -= vec3( 0.0, -10.0, 0.0 ) * phaseEnd;
    p -= vec3( 0.0, 2.5 + 6.0 * exp( -max( time - 0.2, 0.0 ) * 10.0 ), -2.0 );
    p.yz = rotate2D( -0.1 ) * p.yz;
    float dist = word( p, textureDistanceKugatsu, 7.0, 0.1, 0.0 ).x;

    if ( dist < map.dist ) {
      map = mapInit( dist );
      vec3 col = texture2D( textureImageKugatsu, wordUv( p, 7.0 ) ).xyz;
      map.material = mtlInit( col );
    }
  }

  if(false){ // 32
    vec3 p = _p;
    float dir = sign( p.x );
    p -= vec3( 0.0, 7.0, 0.0 ) * phaseEnd;
    p -= vec3( ( 2.8 + 5.0 * exp( -max( time - 0.3, 0.0 ) * 10.0 ) ) * dir, 2.5, -1.0 );
    p.yz = rotate2D( 0.2 ) * p.yz;
    p.zx = rotate2D( 0.4 * dir ) * p.zx;
    float dist = word( p, textureDistance32, 1.3, 0.1, 0.05 ).x;

    if ( dist < map.dist ) {
      map = mapInit( dist );
      vec3 col = 0.6 + 0.4 * vec3(
        cos( -p.y * 4.0 + time * 17.0 ),
        cos( -p.y * 4.0 + time * 17.0 + PI / 3.0 * 2.0 ),
        cos( -p.y * 4.0 + time * 17.0 + PI / 3.0 * 4.0 )
      );
      map.material = mtlInit( col );
      map.material.reflective = 0.1;
    }
  }

  { // balloon
    vec3 pp = _p;

    pp -= vec3( 0.0, ( time - 0.5 ) * 60.0, -13.0 );
    pp.zx = rotate2D( time * 3.0 ) * pp.zx;

    float phase = lofi( atan( pp.z, pp.x ), PI / 4.0 );
    pp.zx = rotate2D( phase + PI / 8.0 ) * pp.zx;
    pp -= vec3( 7.0, 0.0, 0.0 );

    { // balloon body
      vec3 p = pp;
      p.y -= min( p.y, 0.0 ) * 0.3;
      float dist = sphere( p, 1.0 );

      if ( dist < map.dist ) {
        map = mapInit( dist );
        map.material = mtlInit( pow( 0.5 + 0.5 * vec3(
          cos( phase ),
          cos( phase + PI / 3.0 * 2.0 ),
          cos( phase + PI / 3.0 * 4.0 )
        ), V.yyy * 2.0 ) );
        map.material.reflective = 0.3;
      }
    }

    { // balloon rope
      vec3 p = pp;
      p.y -= -2.0;
      p.zx = rotate2D( pow( 1.0 - p.y, 2.0 ) * 2.5 ) * p.zx;
      p.x -= ( 1.0 - exp( ( p.y - 1.0 ) * 2.0 ) ) * 0.1;
      float dist = box( p, vec3( 0.05, 1.0, 0.01 ) );

      if ( dist < map.dist ) {
        map = mapInit( dist );
        map.material = mtlInit( vec3( 1.0, 0.1, 0.1 ) );
      }
    }
  }

  { // light
    vec3 p = _p;
    p -= SUN_POSITION;

    float dist = sphere( p, 100.0 );

    if ( dist < map.dist ) {
      map = mapInit( dist );
      map.material = mtlInit( vec3( 0.4 ) );
      map.material.emissive = vec3( 8.0 );
    }
  }

  return map;
}

Map distFunc( in vec3 _p ) {
  return distFunc( _p, time );
}

vec3 normalFunc( in vec3 _p, in float _d ) {
  vec2 d = V * _d;
  return normalize( vec3(
    distFunc( _p + d.yxx ).dist - distFunc( _p - d.yxx ).dist,
    distFunc( _p + d.xyx ).dist - distFunc( _p - d.xyx ).dist,
    distFunc( _p + d.xxy ).dist - distFunc( _p - d.xxy ).dist
  ) );
}

// ---

March march( in Ray _ray ) {
  Ray ray = _ray;
  March march = marchInit( ray );

  for ( int iMarch = 0; iMarch < MARCH_ITER; iMarch ++ ) {
    Map map = distFunc( march.pos );
    map.dist *= ( ray.inside ? -1.0 : 1.0 ) * 0.8;

    march.map = map;
    march.len += map.dist;
    march.pos = ray.ori + ray.dir * march.len;

    if ( 1E3 < march.len || abs( map.dist ) < INIT_LEN * 0.01 ) { break; }
  }

  march.normal = normalFunc( march.pos, 1E-4 );

  return march;
}

// ---

vec3 randomSphere() {
  vec3 dir = V.xxx;
  for ( int i = 0; i < 9; i ++ ) {
    dir = random4().xyz * 2.0 - 1.0;
    if ( length( dir ) < 1.0 ) { break; }
  }
  dir = normalize( dir );
  return dir;
}

vec3 randomHemisphere( in vec3 _normal ) {
  vec3 dir = randomSphere();
  if ( dot( dir, _normal ) < 0.0 ) { dir = -dir; }
  return dir;
}

float cloudDensity( in vec3 _p ) {
  float v = 4.0;
  float d = gaussian( _p.y + 7.0, v ) / gaussian( 0.0, v ) * 0.9;
  vec3 p = _p;
  p.xy = rotate2D( 1.0 ) * p.xy;
  p.yz = rotate2D( 1.0 ) * p.yz;
  return smoothstep( 1.0, 1.1, noise3d( vec3( p * 1.0 ) ) + d );
}

March cloud( in March _march ) {
  March march = _march;

  vec3 ori = march.ray.ori;
  vec3 dir = march.ray.dir;
  float len = 0.0;

  for ( int i = 0; i < 30; i ++ ) {
    len += CLOUD_DIST;
    if ( march.len < len ) { break; }

    vec3 pos = ori + len * dir;
    float octaveAmp = 0.5;

    for ( int j = 0; j < 5; j ++ ) {
      float d = pow( 1.7, float( j ) );
      float density = mix(
        cloudDensity( pos * d - vec3( 2.0, 1.0, 5.0 ) * time * ( 1.0 + d * 0.2 ) ),
        cloudDensity( pos * d - vec3( 2.0, 1.0, 5.0 ) * ( time - 1.0 ) * ( 1.0 + d * 0.2 ) ),
        time
      ) * octaveAmp;
      octaveAmp *= 0.7;

      if ( random() < density ) {
        march.pos = pos;
        march.len = len;
        march.normal = randomHemisphere( -march.ray.dir );
        march.map.dist = 0.0;
        march.map.material = mtlInit( CLOUD_COLOR );
        march.map.material.transparency = 0.5;
      }
    }
  }

  return march;
}

Ray shade( in March _march ) {
  March march = _march;

  march = cloud( march );

  if ( abs( march.map.dist ) < 1E-2 ) {
    bool inside = march.ray.inside;
    vec3 normal = march.normal;
    float edge = length( saturate( ( normalFunc( march.pos, 4E-4 ) - normal ) * 4.0 ) );

    normal = inside ? -normal : normal;
    Material material = march.map.material;

    vec3 dir = V.xxx;
    float dice = random4().x;

    // color += amp * max( 0.0, dot( normal, -march.ray.dir ) ) * march.map.material.emissive;
    color += amp * march.map.material.emissive;
    color += amp * edge * march.map.material.edgeEmissive;

    amp *= mix( march.map.material.color, V.yyy, march.map.material.transparency );
    if ( dice < material.reflective ) { // reflect
      vec3 ref = normalize( reflect(
        march.ray.dir,
        normal
      ) );
      vec3 dif = randomHemisphere( normal );
      dir = normalize( mix(
        ref,
        dif,
        material.reflectiveRoughness
      ) );
      amp *= max( dot( dir, dif ), 0.0 );

    } else if ( dice < material.reflective + material.refractive ) { // refract
      vec3 inc = normalize( march.ray.dir );
      bool toAir = ( 0.0 < dot( normal, inc ) );
      float eta = 1.0 / march.map.material.refractiveIndex;
      eta = inside ? 1.0 / eta : eta;

      dir = refract(
        inc,
        toAir ? -normal : normal,
        toAir ? 1.0 / eta : eta
      );
      dir = ( dir == V.xxx )
      ? ( normalize( reflect(
        march.ray.dir,
        normal
      ) ) )
      : normalize( dir );
      inside = !inside;

    } else { // diffuse
      dir = randomHemisphere( normal );
      amp *= mix( max( dot( dir, normal ), 0.0 ), 1.0, march.map.material.transparency );
    }

    Ray ray = rayInit( march.pos, dir );
    ray.inside = inside;
    return ray;
  } else {
    color += amp * SKY_COLOR;
    amp *= 0.0;

    return rayInit( V.xxx, V.xxx );
  }
}

// ---

void main() {
  seed = texture2D( textureRandom, gl_FragCoord.xy / resolution );

  vec3 sum = V.xxx;

  for ( int iSample = 0; iSample < NSAMPLE; iSample ++ ) {
    Camera cam = camInit(
      vec3( 0.0, 0.0, 3.0 ),
      vec3( 0.0, 0.0, 0.0 )
    );
    cam.pos += ( random4().y - 0.5 ) * 0.01 * cam.sid;
    cam.pos += ( random4().y - 0.5 ) * 0.01 * cam.top;

    vec2 pix = gl_FragCoord.xy + random4().xy - 0.5;
    vec2 p = ( pix * 2.0 - resolution ) / resolution.x;
    Ray ray = rayFromCam( p, cam );

    color = V.xxx;
    amp = V.yyy;

    for ( int iRef = 0; iRef < NREF; iRef ++ ) {
      ray = shade( march( ray ) );

      if ( length( amp ) < RAYAMP_MIN ) { break; }
    }

    sum += color / float( NSAMPLE );
  }

  gl_FragColor = vec4( sum, 1.0 );
}
