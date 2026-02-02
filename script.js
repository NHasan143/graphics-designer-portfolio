"use strict"; // Enforce stricter parsing/error handling (prevents silent bugs)

/* =====================================================
   CANVAS + SIM CONFIGURATION
   - Select the canvas
   - Define fluid simulation parameters
===================================================== */

let canvas = document.getElementById("cursor-canvas"); // Canvas used for the cursor fluid effect

// Simulation tuning parameters (feel/behavior of the fluid)
let config = {
  TEXTURE_DOWNSAMPLE: 1,        // Lower resolution textures for performance
  DENSITY_DISSIPATION: 0.98,    // How quickly the "ink/smoke" fades
  VELOCITY_DISSIPATION: 0.99,   // How quickly movement energy fades
  PRESSURE_DISSIPATION: 0.8,    // How quickly pressure fades (stability)
  PRESSURE_ITERATIONS: 25,      // Iterations to solve pressure each frame (more = smoother but slower)
  CURL: 35,                     // Vorticity strength (swirly-ness)
  SPLAT_RADIUS: 0.002           // Size of injected “splat” from cursor movement
};

// Tracks user input points (mouse/touches) that inject force/color
let pointers = [];
let splatStack = []; // Used to inject random splats (if you push values into it elsewhere)


/* =====================================================
   WEBGL CONTEXT INITIALIZATION
   - Create WebGL1/WebGL2 context
   - Detect supported float/half-float texture features
   - Prepare format info used for framebuffers
===================================================== */

let _getWebGLContext = getWebGLContext(canvas);
let gl = _getWebGLContext.gl;                         // The WebGL rendering context
let ext = _getWebGLContext.ext;                       // Texture format info (depends on WebGL version)
let support_linear_float = _getWebGLContext.support_linear_float; // Whether linear float filtering is supported

function getWebGLContext(canvas) {
  // WebGL context parameters (turn off things we don't need for performance)
  let params = {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false
  };

  // Try WebGL2 first (preferred)
  let gl = canvas.getContext("webgl2", params);
  let isWebGL2 = !!gl;

  // Fallback to WebGL1 if needed
  if (!isWebGL2)
    gl =
      canvas.getContext("webgl", params) ||
      canvas.getContext("experimental-webgl", params);

  // Extensions for half-float textures + linear filtering
  let halfFloat = gl.getExtension("OES_texture_half_float");
  let support_linear_float = gl.getExtension("OES_texture_half_float_linear");

  // WebGL2 uses different float/linear extensions
  if (isWebGL2) {
    gl.getExtension("EXT_color_buffer_float");
    support_linear_float = gl.getExtension("OES_texture_float_linear");
  }

  // Default clear color (not super visible since you draw fullscreen each frame)
  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  // Internal formats differ between WebGL1 and WebGL2
  let internalFormat = isWebGL2 ? gl.RGBA16F : gl.RGBA;
  let internalFormatRG = isWebGL2 ? gl.RG16F : gl.RGBA;
  let formatRG = isWebGL2 ? gl.RG : gl.RGBA;
  let texType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;

  return {
    gl: gl,
    ext: {
      internalFormat: internalFormat,
      internalFormatRG: internalFormatRG,
      formatRG: formatRG,
      texType: texType
    },
    support_linear_float: support_linear_float
  };
}


/* =====================================================
   POINTER / INPUT STATE
   Represents a mouse/touch "pointer" that injects force & dye
===================================================== */

function pointerPrototype() {
  this.id = -1;         // Touch identifier (or -1 for mouse)
  this.x = 0;           // Current pointer x (in canvas pixels)
  this.y = 0;           // Current pointer y (in canvas pixels)
  this.dx = 0;          // Delta x (movement) used as force
  this.dy = 0;          // Delta y (movement) used as force
  this.down = false;    // Whether pointer is active
  this.moved = false;   // Whether pointer moved since last frame
  this.color = [30, 0, 300]; // Default color contribution
}

// Start with one pointer slot (mouse)
pointers.push(new pointerPrototype());


/* =====================================================
   SHADER PROGRAM WRAPPER
   - Links vertex + fragment shader into a program
   - Collects uniform locations for quick access
===================================================== */

let GLProgram = (function () {
  function GLProgram(vertexShader, fragmentShader) {
    if (!(this instanceof GLProgram))
      throw new TypeError("Cannot call a class as a function");

    this.uniforms = {};
    this.program = gl.createProgram();

    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    // Fail fast if linking fails
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw gl.getProgramInfoLog(this.program);

    // Cache all uniform locations for performance
    let uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
      let uniformName = gl.getActiveUniform(this.program, i).name;
      this.uniforms[uniformName] = gl.getUniformLocation(this.program, uniformName);
    }
  }

  // Activate this shader program
  GLProgram.prototype.bind = function bind() {
    gl.useProgram(this.program);
  };

  return GLProgram;
})();


/* =====================================================
   SHADER COMPILATION
   Utility for compiling GLSL sources into a shader object
===================================================== */

function compileShader(type, source) {
  let shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  // Fail fast if compilation fails
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw gl.getShaderInfoLog(shader);

  return shader;
}


/* =====================================================
   SHADER DEFINITIONS
   These shaders implement the fluid simulation steps:
   - clear, display, splat injection, advection, divergence,
     curl/vorticity, pressure solve, gradient subtraction
===================================================== */

let baseVertexShader = compileShader(
  gl.VERTEX_SHADER,
  "precision highp float; precision mediump sampler2D; attribute vec2 aPosition; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform vec2 texelSize; void main () {     vUv = aPosition * 0.5 + 0.5;     vL = vUv - vec2(texelSize.x, 0.0);     vR = vUv + vec2(texelSize.x, 0.0);     vT = vUv + vec2(0.0, texelSize.y);     vB = vUv - vec2(0.0, texelSize.y);     gl_Position = vec4(aPosition, 0.0, 1.0); }"
);

let clearShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTexture; uniform float value; void main () {     gl_FragColor = value * texture2D(uTexture, vUv); }"
);

let displayShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTexture; void main () {     gl_FragColor = texture2D(uTexture, vUv); }"
);

let splatShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius; void main () {     vec2 p = vUv - point.xy;     p.x *= aspectRatio;     vec3 splat = exp(-dot(p, p) / radius) * color;     vec3 base = texture2D(uTarget, vUv).xyz;     gl_FragColor = vec4(base + splat, 1.0); }"
);

// If linear float filtering is not supported, use manual bilerp advection
let advectionManualFilteringShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform float dt; uniform float dissipation; vec4 bilerp (in sampler2D sam, in vec2 p) {     vec4 st;     st.xy = floor(p - 0.5) + 0.5;     st.zw = st.xy + 1.0;     vec4 uv = st * texelSize.xyxy;     vec4 a = texture2D(sam, uv.xy);     vec4 b = texture2D(sam, uv.zy);     vec4 c = texture2D(sam, uv.xw);     vec4 d = texture2D(sam, uv.zw);     vec2 f = p - st.xy;     return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); } void main () {     vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;     gl_FragColor = dissipation * bilerp(uSource, coord);     gl_FragColor.a = 1.0; }"
);

let advectionShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform float dt; uniform float dissipation; void main () {     vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;     gl_FragColor = dissipation * texture2D(uSource, coord); }"
);

let divergenceShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; vec2 sampleVelocity (in vec2 uv) {     vec2 multiplier = vec2(1.0, 1.0);     if (uv.x < 0.0) { uv.x = 0.0; multiplier.x = -1.0; }     if (uv.x > 1.0) { uv.x = 1.0; multiplier.x = -1.0; }     if (uv.y < 0.0) { uv.y = 0.0; multiplier.y = -1.0; }     if (uv.y > 1.0) { uv.y = 1.0; multiplier.y = -1.0; }     return multiplier * texture2D(uVelocity, uv).xy; } void main () {     float L = sampleVelocity(vL).x;     float R = sampleVelocity(vR).x;     float T = sampleVelocity(vT).y;     float B = sampleVelocity(vB).y;     float div = 0.5 * (R - L + T - B);     gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }"
);

let curlShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; void main () {     float L = texture2D(uVelocity, vL).y;     float R = texture2D(uVelocity, vR).y;     float T = texture2D(uVelocity, vT).x;     float B = texture2D(uVelocity, vB).x;     float vorticity = R - L - T + B;     gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0); }"
);

let vorticityShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt; void main () {     float L = texture2D(uCurl, vL).y;     float R = texture2D(uCurl, vR).y;     float T = texture2D(uCurl, vT).x;     float B = texture2D(uCurl, vB).x;     float C = texture2D(uCurl, vUv).x;     vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));     force *= 1.0 / length(force + 0.00001) * curl * C;     vec2 vel = texture2D(uVelocity, vUv).xy;     gl_FragColor = vec4(vel + force * dt, 0.0, 1.0); }"
);

let pressureShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uPressure; uniform sampler2D uDivergence; vec2 boundary (in vec2 uv) {     uv = min(max(uv, 0.0), 1.0);     return uv; } void main () {     float L = texture2D(uPressure, boundary(vL)).x;     float R = texture2D(uPressure, boundary(vR)).x;     float T = texture2D(uPressure, boundary(vT)).x;     float B = texture2D(uPressure, boundary(vB)).x;     float C = texture2D(uPressure, vUv).x;     float divergence = texture2D(uDivergence, vUv).x;     float pressure = (L + R + B + T - divergence) * 0.25;     gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0); }"
);

let gradientSubtractShader = compileShader(
  gl.FRAGMENT_SHADER,
  "precision highp float; precision mediump sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uPressure; uniform sampler2D uVelocity; vec2 boundary (in vec2 uv) {     uv = min(max(uv, 0.0), 1.0);     return uv; } void main () {     float L = texture2D(uPressure, boundary(vL)).x;     float R = texture2D(uPressure, boundary(vR)).x;     float T = texture2D(uPressure, boundary(vT)).x;     float B = texture2D(uPressure, boundary(vB)).x;     vec2 velocity = texture2D(uVelocity, vUv).xy;     velocity.xy -= vec2(R - L, T - B);     gl_FragColor = vec4(velocity, 0.0, 1.0); }"
);


/* =====================================================
   FRAMEBUFFERS / SIMULATION TEXTURES
   Creates GPU textures used for:
   - density (color)
   - velocity (motion)
   - divergence, curl, pressure
===================================================== */

let textureWidth = void 0;
let textureHeight = void 0;
let density = void 0;
let velocity = void 0;
let divergence = void 0;
let curl = void 0;
let pressure = void 0;

// Initialize all simulation buffers
initFramebuffers();


/* =====================================================
   BUILD PROGRAMS (PIPELINE STAGES)
   Each step of the simulation uses its own shader program
===================================================== */

let clearProgram = new GLProgram(baseVertexShader, clearShader);
let displayProgram = new GLProgram(baseVertexShader, displayShader);
let splatProgram = new GLProgram(baseVertexShader, splatShader);
let advectionProgram = new GLProgram(
  baseVertexShader,
  support_linear_float ? advectionShader : advectionManualFilteringShader
);
let divergenceProgram = new GLProgram(baseVertexShader, divergenceShader);
let curlProgram = new GLProgram(baseVertexShader, curlShader);
let vorticityProgram = new GLProgram(baseVertexShader, vorticityShader);
let pressureProgram = new GLProgram(baseVertexShader, pressureShader);
let gradienSubtractProgram = new GLProgram(baseVertexShader, gradientSubtractShader);


/* =====================================================
   FRAMEBUFFER CREATION HELPERS
   - FBO = texture + framebuffer
   - DoubleFBO = ping-pong buffers for iterative updates
===================================================== */

function initFramebuffers() {
  textureWidth = gl.drawingBufferWidth >> config.TEXTURE_DOWNSAMPLE;
  textureHeight = gl.drawingBufferHeight >> config.TEXTURE_DOWNSAMPLE;

  let iFormat = ext.internalFormat;
  let iFormatRG = ext.internalFormatRG;
  let formatRG = ext.formatRG;
  let texType = ext.texType;

  // Density: stores “ink/smoke” color
  density = createDoubleFBO(
    0, textureWidth, textureHeight,
    iFormat, gl.RGBA, texType,
    support_linear_float ? gl.LINEAR : gl.NEAREST
  );

  // Velocity: stores movement vectors
  velocity = createDoubleFBO(
    2, textureWidth, textureHeight,
    iFormatRG, formatRG, texType,
    support_linear_float ? gl.LINEAR : gl.NEAREST
  );

  // Divergence: used to enforce incompressibility
  divergence = createFBO(
    4, textureWidth, textureHeight,
    iFormatRG, formatRG, texType,
    gl.NEAREST
  );

  // Curl: measures swirling amount
  curl = createFBO(
    5, textureWidth, textureHeight,
    iFormatRG, formatRG, texType,
    gl.NEAREST
  );

  // Pressure: used in the pressure solve step (ping-pong)
  pressure = createDoubleFBO(
    6, textureWidth, textureHeight,
    iFormatRG, formatRG, texType,
    gl.NEAREST
  );
}

function createFBO(texId, w, h, internalFormat, format, type, param) {
  // Bind texture slot
  gl.activeTexture(gl.TEXTURE0 + texId);

  // Create & configure the texture
  let texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Allocate texture storage (no initial data)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

  // Create framebuffer and attach texture
  let fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0
  );

  // Clear once
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return [texture, fbo, texId];
}

function createDoubleFBO(texId, w, h, internalFormat, format, type, param) {
  // Two buffers for ping-pong rendering
  let fbo1 = createFBO(texId, w, h, internalFormat, format, type, param);
  let fbo2 = createFBO(texId + 1, w, h, internalFormat, format, type, param);

  return {
    get first() { return fbo1; },
    get second() { return fbo2; },
    swap: function swap() {
      let temp = fbo1;
      fbo1 = fbo2;
      fbo2 = temp;
    }
  };
}


/* =====================================================
   FULLSCREEN QUAD DRAW (BLIT)
   Sets up a rectangle covering the screen so shaders run
   across the entire target framebuffer/texture.
===================================================== */

let blit = (function () {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
    gl.STATIC_DRAW
  );

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([0, 1, 2, 0, 2, 3]),
    gl.STATIC_DRAW
  );

  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  // Draw into a framebuffer (or null for the screen)
  return function (destination) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };
})();


/* =====================================================
   MAIN ANIMATION LOOP
   Steps the simulation each frame and renders result
===================================================== */

let lastTime = Date.now();
update();

function update() {
  // Ensure canvas matches viewport size and rebuild framebuffers if needed
  resizeCanvas();

  // Delta time (clamped for stability)
  let dt = Math.min((Date.now() - lastTime) / 1000, 0.016);
  lastTime = Date.now();

  // Run simulation at texture resolution
  gl.viewport(0, 0, textureWidth, textureHeight);

  /* ---------- Optional Random Splats ---------- */
  if (splatStack.length > 0) {
    for (let m = 0; m < splatStack.pop(); m++) {
      let color = [Math.random() * 10, Math.random() * 10, Math.random() * 10];
      let x = canvas.width * Math.random();
      let y = canvas.height * Math.random();
      let dx = 1000 * (Math.random() - 0.5);
      let dy = 1000 * (Math.random() - 0.5);
      splat(x, y, dx, dy, color);
    }
  }

  /* ---------- Advection: Move velocity field ---------- */
  advectionProgram.bind();
  gl.uniform2f(advectionProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
  gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.first[2]);
  gl.uniform1i(advectionProgram.uniforms.uSource, velocity.first[2]);
  gl.uniform1f(advectionProgram.uniforms.dt, dt);
  gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
  blit(velocity.second[1]);
  velocity.swap();

  /* ---------- Advection: Move density (color) field ---------- */
  gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.first[2]);
  gl.uniform1i(advectionProgram.uniforms.uSource, density.first[2]);
  gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
  blit(density.second[1]);
  density.swap();

  /* ---------- Apply User Input Splats ---------- */
  for (let i = 0, len = pointers.length; i < len; i++) {
    let pointer = pointers[i];
    if (pointer.moved) {
      // Inject force + color where cursor moved
      splat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color);
      pointer.moved = false;
    }
  }

  /* ---------- Curl (vorticity measurement) ---------- */
  curlProgram.bind();
  gl.uniform2f(curlProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
  gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.first[2]);
  blit(curl[1]);

  /* ---------- Vorticity Confinement (adds swirl) ---------- */
  vorticityProgram.bind();
  gl.uniform2f(vorticityProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
  gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.first[2]);
  gl.uniform1i(vorticityProgram.uniforms.uCurl, curl[2]);
  gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
  gl.uniform1f(vorticityProgram.uniforms.dt, dt);
  blit(velocity.second[1]);
  velocity.swap();

  /* ---------- Divergence (how compressible the flow is) ---------- */
  divergenceProgram.bind();
  gl.uniform2f(divergenceProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
  gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.first[2]);
  blit(divergence[1]);

  /* ---------- Clear pressure slightly each frame (dissipation) ---------- */
  clearProgram.bind();
  let pressureTexId = pressure.first[2];
  gl.activeTexture(gl.TEXTURE0 + pressureTexId);
  gl.bindTexture(gl.TEXTURE_2D, pressure.first[0]);
  gl.uniform1i(clearProgram.uniforms.uTexture, pressureTexId);
  gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE_DISSIPATION);
  blit(pressure.second[1]);
  pressure.swap();

  /* ---------- Pressure Solve (enforce incompressibility) ---------- */
  pressureProgram.bind();
  gl.uniform2f(pressureProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
  gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence[2]);
  pressureTexId = pressure.first[2];
  gl.activeTexture(gl.TEXTURE0 + pressureTexId);

  for (let _i = 0; _i < config.PRESSURE_ITERATIONS; _i++) {
    gl.bindTexture(gl.TEXTURE_2D, pressure.first[0]);
    gl.uniform1i(pressureProgram.uniforms.uPressure, pressureTexId);
    blit(pressure.second[1]);
    pressure.swap();
  }

  /* ---------- Subtract Pressure Gradient from Velocity ---------- */
  gradienSubtractProgram.bind();
  gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
  gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.first[2]);
  gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.first[2]);
  blit(velocity.second[1]);
  velocity.swap();

  /* ---------- Render final density to the screen ---------- */
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  displayProgram.bind();
  gl.uniform1i(displayProgram.uniforms.uTexture, density.first[2]);
  blit(null);

  // Continue the animation loop
  requestAnimationFrame(update);
}


/* =====================================================
   SPLAT FUNCTION
   Injects force into velocity + dye into density at a point
===================================================== */

function splat(x, y, dx, dy, color) {
  splatProgram.bind();

  // Add impulse to velocity field
  gl.uniform1i(splatProgram.uniforms.uTarget, velocity.first[2]);
  gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
  gl.uniform2f(
    splatProgram.uniforms.point,
    x / canvas.width,
    1.0 - y / canvas.height
  );
  gl.uniform3f(splatProgram.uniforms.color, dx, -dy, 1.0);
  gl.uniform1f(splatProgram.uniforms.radius, config.SPLAT_RADIUS);
  blit(velocity.second[1]);
  velocity.swap();

  // Add dye to density field
  gl.uniform1i(splatProgram.uniforms.uTarget, density.first[2]);
  gl.uniform3f(
    splatProgram.uniforms.color,
    color[0] * 0.3,
    color[1] * 0.3,
    color[2] * 0.3
  );
  blit(density.second[1]);
  density.swap();
}


/* =====================================================
   CANVAS RESIZE HANDLER
   - Matches drawing buffer to viewport size with DPR
   - Rebuilds simulation buffers when size changes
===================================================== */

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);

  // Only reallocate if the size changed
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    initFramebuffers(); // Recreate textures for new resolution
  }
}


/* =====================================================
   INPUT HANDLERS (MOUSE + TOUCH)
   - Converts screen coords to canvas coords
   - Updates pointer state so update() can apply splats
===================================================== */

// Used to periodically randomize the color
let count = 0;
let colorArr = [Math.random() + 0.2, Math.random() + 0.2, Math.random() + 0.2];

/* ---------- Mouse Movement ---------- */
window.addEventListener("mousemove", function (e) {
  count++;

  // Change color every N events
  if (count > 25) {
    colorArr = [Math.random() + 0.2, Math.random() + 0.2, Math.random() + 0.2];
    count = 0;
  }

  // Mouse position in viewport coordinates
  const x = e.clientX;
  const y = e.clientY;

  // Mark the pointer as active and moved
  pointers[0].down = true;
  pointers[0].color = colorArr;
  pointers[0].moved = true;

  // Convert viewport coords -> canvas pixel coords
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const cx = (x - rect.left) * scaleX;
  const cy = (y - rect.top) * scaleY;

  // Calculate movement delta (force)
  pointers[0].dx = (cx - pointers[0].x) * 10.0;
  pointers[0].dy = (cy - pointers[0].y) * 10.0;

  // Store new position
  pointers[0].x = cx;
  pointers[0].y = cy;
}, { passive: true });

/* ---------- Touch Movement ---------- */
window.addEventListener("touchmove", function (e) {
  e.preventDefault(); // Prevent page scrolling while touching

  let touches = e.targetTouches;

  count++;
  if (count > 25) {
    colorArr = [Math.random() + 0.2, Math.random() + 0.2, Math.random() + 0.2];
    count = 0;
  }

  // Track each touch as a separate pointer
  for (let i = 0, len = touches.length; i < len; i++) {
    if (i >= pointers.length) pointers.push(new pointerPrototype());

    pointers[i].id = touches[i].identifier;
    pointers[i].down = true;
    pointers[i].color = colorArr;

    const x = touches[i].clientX;
    const y = touches[i].clientY;

    // Convert viewport coords -> canvas pixel coords
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const cx = (x - rect.left) * scaleX;
    const cy = (y - rect.top) * scaleY;

    let pointer = pointers[i];
    pointer.moved = true;

    // Movement delta for force injection
    pointer.dx = (cx - pointer.x) * 10.0;
    pointer.dy = (cy - pointer.y) * 10.0;

    // Store new position
    pointer.x = cx;
    pointer.y = cy;
  }
}, { passive: false });


/* =====================================================
   DYNAMIC COPYRIGHT YEAR
   Automatically updates the year so it stays current
===================================================== */

const currentYearElement = document.getElementById('current-year');
currentYearElement.textContent = new Date().getFullYear();


/* =====================================================
   FORM SUBMISSION (AJAX / NO PAGE RELOAD)
   Handles form submit, sends data via fetch,
   shows success message, handles errors
===================================================== */

const form = document.getElementById("my-form");
const successMessage = document.getElementById("success-message");

async function handleSubmit(event) {
    event.preventDefault(); // Stop default form reload

    const status = document.getElementById("submit-btn");
    const data = new FormData(event.target);

    // UI feedback
    status.innerHTML = "Sending...";
    status.disabled = true;

    fetch(event.target.action, {
        method: form.method,
        body: data,
        headers: { 'Accept': 'application/json' }
    })
    .then(response => {
        if (response.ok) {
            // Success: hide form, show message
            form.style.display = "none";
            successMessage.style.display = "block";
        } else {
            // Handle server-side validation errors
            response.json().then(data => {
                if (Object.hasOwn(data, 'errors')) {
                    alert(
                        data.errors
                            .map(error => error.message)
                            .join(", ")
                    );
                } else {
                    alert("Oops! There was a problem submitting your form");
                }
            });
        }
    })
    .catch(() => {
        // Network or unexpected error
        alert("Oops! There was a problem submitting your form");
    })
    .finally(() => {
        // Reset button state
        status.innerHTML = "Submit";
        status.disabled = false;
    });
}

// Attach submit handler
form.addEventListener("submit", handleSubmit);



/* =====================================================
   BACK TO TOP BUTTON
   Shows button after scrolling down the page
===================================================== */

const backToTop = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
    if (window.scrollY > 150) {
        backToTop.classList.add('show');
    } else {
        backToTop.classList.remove('show');
    }
});



/* =====================================================
   MOBILE NAVIGATION (HAMBURGER MENU)
   Toggles menu open/close on small screens
===================================================== */

const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('nav-links');

// Toggle menu on hamburger click
hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    hamburger.classList.toggle('toggle');
});

// Close menu when a nav link is clicked
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        hamburger.classList.remove('toggle');
    });
});

/* =====================================================
   CAROUSEL ARROW VISIBILITY CONTROL
   Shows / hides left and right arrows based on
   horizontal scroll position of the carousel
===================================================== */

// Carousel container element
const carousel = document.getElementById('expertCarousel');

// Navigation arrows
const leftArrow = document.querySelector('.arrow-left');
const rightArrow = document.querySelector('.arrow-right');

// Listen for horizontal scroll inside the carousel
carousel.addEventListener('scroll', () => {

    // Current horizontal scroll position
    const scrollLeft = carousel.scrollLeft;

    // Maximum possible scroll position
    const maxScroll = carousel.scrollWidth - carousel.clientWidth;

    /* ---------- Left Arrow ---------- */
    // Show left arrow once user scrolls right
    if (scrollLeft > 10) {
        leftArrow.style.display = 'flex';
    } else {
        leftArrow.style.display = 'none';
    }

    /* ---------- Right Arrow ---------- */
    // Hide right arrow when reaching the end
    if (scrollLeft >= maxScroll - 10) {
        rightArrow.style.display = 'none';
    } else {
        rightArrow.style.display = 'flex';
    }
});

/* =====================================================
   TYPEWRITER TEXT EFFECT
   Types and deletes phrases in a loop
   with configurable typing speeds and pauses
===================================================== */

// Element where the typewriter text appears
const typewriterText = document.getElementById('typewriter');

// Text phrases to cycle through
const phrases = ["Video Editor", "Graphic Designer"];

// State trackers
let phraseIndex = 0;   // Which phrase is active
let charIndex = 0;     // Current character position
let isDeleting = false; // Whether text is deleting or typing

/* ---------- Speed Settings (milliseconds) ---------- */
const TYPING_SPEED = 350;      // Slower typing speed
const DELETING_SPEED = 150;    // Slower deleting speed
const PAUSE_AT_END = 2500;     // Pause after finishing a phrase
const PAUSE_BEFORE_TYPE = 800; // Pause before starting next phrase


/* ---------- Main Typewriter Function ---------- */
function type() {
    const currentPhrase = phrases[phraseIndex];
    let typeSpeed = TYPING_SPEED;

    // Handle typing vs deleting
    if (isDeleting) {
        typewriterText.textContent =
            currentPhrase.substring(0, charIndex - 1);
        charIndex--;
        typeSpeed = DELETING_SPEED;
    } else {
        typewriterText.textContent =
            currentPhrase.substring(0, charIndex + 1);
        charIndex++;
    }

    /* ----- Pause & Direction Logic ----- */
    if (!isDeleting && charIndex === currentPhrase.length) {
        // Finished typing a phrase
        isDeleting = true;
        typeSpeed = PAUSE_AT_END;
    } 
    else if (isDeleting && charIndex === 0) {
        // Finished deleting, move to next phrase
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        typeSpeed = PAUSE_BEFORE_TYPE;
    }

    // Schedule next frame
    setTimeout(type, typeSpeed);
}


/* ---------- Start Effect When Page Loads ---------- */
window.addEventListener('DOMContentLoaded', type);
