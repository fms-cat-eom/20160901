import xorshift from './xorshift';
xorshift( 187 );
import GLCat from './glcat';
import step from './step';
import Tweak from './tweak';

let glslify = require( 'glslify' );

// ---

let clamp = ( _value, _min, _max ) => Math.min( Math.max( _value, _min ), _max );
let saturate = ( _value ) => clamp( _value, 0.0, 1.0 );

// ---

let width = canvas.width = 300;
let height = canvas.height = 300;

let gl = canvas.getContext( 'webgl' );
let glCat = new GLCat( gl );

// ---

let tweak = new Tweak( divTweak );

// ---

let frame = 0;
let frames = 120;
let iSample = 0;
let nSample = 1;
let time = 0.0;
let deltaTime = 1.0 / 60.0;

let timeUpdate = () => {
  let timePrev = time;
  time = ( frame + iSample / nSample ) / frames;
  time = time % 1.0;
};

// ---

let vboQuad = glCat.createVertexbuffer( [ -1, -1, 1, -1, -1, 1, 1, 1 ] );

// ---

let vertQuad = glslify( './shader/quad.vert' );

let programReturn = glCat.createProgram(
  vertQuad,
  glslify( './shader/return.frag' )
);

let programDistance = glCat.createProgram(
  vertQuad,
  glslify( './shader/distance.frag' )
);

let programRaymarch = glCat.createProgram(
  vertQuad,
  glslify( './shader/raymarch.frag' )
);

let programSum = glCat.createProgram(
  vertQuad,
  glslify( './shader/sum.frag' )
);

let programGamma = glCat.createProgram(
  vertQuad,
  glslify( './shader/gamma.frag' )
);

// ---

let framebufferReturn = glCat.createFloatFramebuffer( width, height );
let framebufferRaymarch = glCat.createFloatFramebuffer( width, height );
let framebufferSum = glCat.createFloatFramebuffer( width, height );

// ---

let textureRandomSize = 256;

let textureRandomUpdate = ( _tex ) => {
  glCat.setTextureFromArray( _tex, textureRandomSize, textureRandomSize, ( () => {
    let len = textureRandomSize * textureRandomSize * 4;
    let ret = new Uint8Array( len );
    for ( let i = 0; i < len; i ++ ) {
      ret[ i ] = Math.floor( xorshift() * 256.0 );
    }
    return ret;
  } )() );
};

let textureRandom = glCat.createTexture();
glCat.textureWrap( textureRandom, gl.REPEAT );

let textureRandomStatic = glCat.createTexture();
glCat.textureWrap( textureRandomStatic, gl.REPEAT );
textureRandomUpdate( textureRandomStatic );

// ---

let prepareTexture = ( _texture, _url, _callback ) => {
  let image = new Image();
  image.onload = () => {
    glCat.setTexture( _texture, image );
    _callback();
  };
  image.src = _url;
};

let textureImageKugatsu = glCat.createTexture();

// ---

let distSize = 1024;

let textureDistanceTemp = glCat.createTexture();
let framebufferDistanceTemp = glCat.createFramebuffer( distSize, distSize );

let prepareDistance = ( _framebuffer, _url, _callback ) => {
  prepareTexture( textureDistanceTemp, _url, () => {
    gl.viewport( 0, 0, distSize, distSize );
    glCat.useProgram( programDistance );
    gl.bindFramebuffer( gl.FRAMEBUFFER, framebufferDistanceTemp );
    glCat.clear();

    glCat.attribute( 'p', vboQuad, 2 );

    glCat.uniform1i( 'isVert', false );
    glCat.uniform2fv( 'resolution', [ distSize, distSize ] );
    glCat.uniformTexture( 'texture', textureDistanceTemp, 0 );

    gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 );

    // ---

    gl.viewport( 0, 0, distSize, distSize );
    glCat.useProgram( programDistance );
    gl.bindFramebuffer( gl.FRAMEBUFFER, _framebuffer );
    glCat.clear();

    glCat.attribute( 'p', vboQuad, 2 );

    glCat.uniform1i( 'isVert', true );
    glCat.uniform2fv( 'resolution', [ distSize, distSize ] );
    glCat.uniformTexture( 'texture', framebufferDistanceTemp.texture, 0 );

    gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 );

    // ---

    _callback();
  } );
};

let framebufferDistanceAlready = glCat.createFramebuffer( distSize, distSize );
let framebufferDistanceSeptember = glCat.createFramebuffer( distSize, distSize );
let framebufferDistanceKugatsu = glCat.createFramebuffer( distSize, distSize );
let framebufferDistance32 = glCat.createFramebuffer( distSize, distSize );

// ---

let renderA = document.createElement( 'a' );

let saveFrame = () => {
  renderA.href = canvas.toDataURL();
  renderA.download = ( '0000' + frame ).slice( -5 ) + '.png';
  renderA.click();
};

// ---

let render = () => {
  gl.viewport( 0, 0, width, height );
  glCat.useProgram( programRaymarch );
  gl.bindFramebuffer( gl.FRAMEBUFFER, framebufferRaymarch );
  glCat.clear();

  glCat.attribute( 'p', vboQuad, 2 );

  glCat.uniform1f( 'time', time );
  glCat.uniform2fv( 'resolution', [ width, height ] );

  glCat.uniformTexture( 'textureRandom', textureRandom, 0 );
  glCat.uniformTexture( 'textureRandomStatic', textureRandomStatic, 1 );
  glCat.uniformTexture( 'textureImageKugatsu', textureImageKugatsu, 2 );
  glCat.uniformTexture( 'textureDistanceAlready', framebufferDistanceAlready.texture, 3 );
  glCat.uniformTexture( 'textureDistanceSeptember', framebufferDistanceSeptember.texture, 4 );
  glCat.uniformTexture( 'textureDistanceKugatsu', framebufferDistanceKugatsu.texture, 5 );
  glCat.uniformTexture( 'textureDistance32', framebufferDistance32.texture, 6 );

  gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 );

  // ---

  gl.viewport( 0, 0, width, height );
  glCat.useProgram( programReturn );
  gl.bindFramebuffer( gl.FRAMEBUFFER, framebufferReturn );
  glCat.clear();

  glCat.attribute( 'p', vboQuad, 2 );
  glCat.uniform2fv( 'resolution', [ width, height ] );
  glCat.uniformTexture( 'texture', framebufferSum.texture, 0 );

  gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 );

  // ---

  gl.viewport( 0, 0, width, height );
  glCat.useProgram( programSum );
  gl.bindFramebuffer( gl.FRAMEBUFFER, framebufferSum );
  glCat.clear();

  glCat.attribute( 'p', vboQuad, 2 );
  glCat.uniform1f( 'add', 1.0 / nSample );
  glCat.uniform1i( 'init', iSample === 0 );
  glCat.uniform2fv( 'resolution', [ width, height ] );
  glCat.uniformTexture( 'textureBase', framebufferReturn.texture, 0 );
  glCat.uniformTexture( 'textureAdd', framebufferRaymarch.texture, 1 );

  gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 );
};

// ---

let preview = () => {
  gl.viewport( 0, 0, width, height );
  glCat.useProgram( programReturn );
  gl.bindFramebuffer( gl.FRAMEBUFFER, null );
  glCat.clear();

  glCat.attribute( 'p', vboQuad, 2 );
  glCat.uniform2fv( 'resolution', [ width, height ] );
  glCat.uniformTexture( 'texture', framebufferSum.texture, 0 );

  gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 );
};

// ---

let post = () => {
  gl.viewport( 0, 0, width, height );
  glCat.useProgram( programGamma );
  gl.bindFramebuffer( gl.FRAMEBUFFER, null );
  glCat.clear();

  glCat.attribute( 'p', vboQuad, 2 );
  glCat.uniform2fv( 'resolution', [ width, height ] );
  glCat.uniformTexture( 'texture', framebufferSum.texture, 0 );

  gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 );
};

// ---

let update = () => {
  if ( !checkboxPlay.checked ) {
    setTimeout( update, 10 );
    return;
  }

  timeUpdate();
  textureRandomUpdate( textureRandom );

  render();

  iSample ++;
  if ( iSample === nSample ) {
    iSample = 0;
    console.log( frame );

    post();

    if ( checkboxSave.checked ) {
      saveFrame();
    }
    nSample = Math.floor( tweak.range( 'nSample', { value: 1.0, min: 1.0, max: 1000.0, step: 1.0 } ) );
    frame ++;
  } else {
    preview();
  }

  requestAnimationFrame( update );
};

// ---

step( {
  0: ( done ) => {
    prepareTexture( textureImageKugatsu, './kugatsu.png', done );
    prepareDistance( framebufferDistanceAlready, './already.png', done );
    prepareDistance( framebufferDistanceSeptember, './september.png', done );
    prepareDistance( framebufferDistanceKugatsu, './kugatsu.png', done );
    prepareDistance( framebufferDistance32, './32.png', done );
  },

  5: ( done ) => {
    update();
  }
} );

window.addEventListener( 'keydown', ( _e ) => {
  if ( _e.which === 27 ) {
    checkboxPlay.checked = false;
  }
} );
