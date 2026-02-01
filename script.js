// Set dynamic year
document.getElementById('current-year').textContent = new Date().getFullYear();

// Form Handling Script
const form = document.getElementById("my-form");
const successMessage = document.getElementById("success-message");

async function handleSubmit(event) {
    event.preventDefault();
    const status = document.getElementById("submit-btn");
    const data = new FormData(event.target);
    status.innerHTML = "Sending...";
    status.disabled = true;

    fetch(event.target.action, {
        method: form.method,
        body: data,
        headers: { 'Accept': 'application/json' }
    }).then(response => {
        if (response.ok) {
            form.style.display = "none";
            successMessage.style.display = "block";
        } else {
            response.json().then(data => {
                if (Object.hasOwn(data, 'errors')) {
                    alert(data["errors"].map(error => error["message"]).join(", "));
                } else {
                    alert("Oops! There was a problem submitting your form");
                }
            })
        }
    }).catch(error => {
        alert("Oops! There was a problem submitting your form");
    }).finally(() => {
        status.innerHTML = "Submit";
        status.disabled = false;
    });
}
form.addEventListener("submit", handleSubmit);

const backToTop = document.getElementById('backToTop');
window.addEventListener('scroll', () => {
    if (window.scrollY > 400) { backToTop.classList.add('show'); } 
    else { backToTop.classList.remove('show'); }
});

const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('nav-links');
hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    hamburger.classList.toggle('toggle');
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        hamburger.classList.remove('toggle');
    });
});

// NEW: Arrow Toggle Logic
const carousel = document.getElementById('expertCarousel');
const leftArrow = document.querySelector('.arrow-left');
const rightArrow = document.querySelector('.arrow-right');

carousel.addEventListener('scroll', () => {
    const scrollLeft = carousel.scrollLeft;
    const maxScroll = carousel.scrollWidth - carousel.clientWidth;

    // Toggle Left Arrow
    if (scrollLeft > 10) {
        leftArrow.style.display = 'flex';
    } else {
        leftArrow.style.display = 'none';
    }

    // Toggle Right Arrow
    if (scrollLeft >= maxScroll - 10) {
        rightArrow.style.display = 'none';
    } else {
        rightArrow.style.display = 'flex';
    }
});

// Cursor effect: WebGL Smoke/Fluid Simulation (based on real-time fluid dynamics)
(() => {
    const canvas = document.getElementById('bubble-canvas');
    if (!canvas) return;

    // If WebGL is unavailable, fail gracefully (site still works).
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false }) ||
               canvas.getContext('webgl',  { alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    // --- Config (tuned for "cursor smoke" look) ---
    const config = {
        SIM_RESOLUTION: 128,
        DYE_RESOLUTION: 512,
        DENSITY_DISSIPATION: 0.98,
        VELOCITY_DISSIPATION: 0.99,
        PRESSURE_DISSIPATION: 0.8,
        PRESSURE_ITERATIONS: 20,
        CURL: 30,
        SPLAT_RADIUS: 0.004,
        SHADING: true,
    };

    // --- Utilities ---
    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const ext = {
        linearFloat: gl.getExtension('OES_texture_float_linear'),
        textureFloat: gl.getExtension('OES_texture_float'),
        halfFloat: gl.getExtension('OES_texture_half_float'),
        halfFloatLinear: gl.getExtension('OES_texture_half_float_linear'),
        colorBufferFloat: gl.getExtension('EXT_color_buffer_float') || gl.getExtension('WEBGL_color_buffer_float'),
        colorBufferHalfFloat: gl.getExtension('EXT_color_buffer_half_float'),
    };

    const supportLinearFloat = !!(ext.linearFloat || ext.halfFloatLinear);
    const texType = isWebGL2 ? gl.HALF_FLOAT : (ext.halfFloat ? ext.halfFloat.HALF_FLOAT_OES : gl.FLOAT);
    const filtering = supportLinearFloat ? gl.LINEAR : gl.NEAREST;

    function clamp01(v) { return Math.max(0, Math.min(1, v)); }

    function resizeCanvas() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.floor(window.innerWidth * dpr);
        const height = Math.floor(window.innerHeight * dpr);

        if (canvas.width === width && canvas.height === height) return false;
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
        return true;
    }

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            // Keep silent in production, but free resources.
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    function createProgram(vsSource, fsSource) {
        const vs = compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        gl.deleteShader(vs);
        gl.deleteShader(fs);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            gl.deleteProgram(program);
            return null;
        }
        return program;
    }

    // --- Fullscreen quad ---
    const baseVertexShader = `
        precision highp float;
        attribute vec2 aPosition;
        varying vec2 vUv;
        void main () {
            vUv = 0.5 * (aPosition + 1.0);
            gl_Position = vec4(aPosition, 0.0, 1.0);
        }
    `;

    const quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    // --- Shaders (fluid sim) ---
    const clearShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTexture;
        uniform float value;
        void main () {
            gl_FragColor = value * texture2D(uTexture, vUv);
        }
    `;

    const displayShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTexture;
        void main () {
            vec3 rgb = texture2D(uTexture, vUv).rgb;
            float a = clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0);
            // Make empty areas transparent so the page shows through.
            gl_FragColor = vec4(rgb, a);
        }
    `;

    const splatShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTarget;
        uniform float aspectRatio;
        uniform vec3 color;
        uniform vec2 point;
        uniform float radius;
        void main () {
            vec2 p = vUv - point;
            p.x *= aspectRatio;
            vec3 base = texture2D(uTarget, vUv).xyz;
            float r = exp(-dot(p, p) / radius);
            gl_FragColor = vec4(base + color * r, 1.0);
        }
    `;

    const advectionShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform vec2 texelSize;
        uniform float dt;
        uniform float dissipation;
        void main () {
            vec2 vel = texture2D(uVelocity, vUv).xy;
            vec2 coord = vUv - dt * vel * texelSize;
            vec4 result = texture2D(uSource, coord);
            gl_FragColor = dissipation * result;
        }
    `;

    const divergenceShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform vec2 texelSize;
        void main () {
            float L = texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0)).x;
            float R = texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0)).x;
            float B = texture2D(uVelocity, vUv - vec2(0.0, texelSize.y)).y;
            float T = texture2D(uVelocity, vUv + vec2(0.0, texelSize.y)).y;
            float div = 0.5 * (R - L + T - B);
            gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }
    `;

    const curlShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform vec2 texelSize;
        void main () {
            float L = texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0)).y;
            float R = texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0)).y;
            float B = texture2D(uVelocity, vUv - vec2(0.0, texelSize.y)).x;
            float T = texture2D(uVelocity, vUv + vec2(0.0, texelSize.y)).x;
            float curl = R - L - T + B;
            gl_FragColor = vec4(curl, 0.0, 0.0, 1.0);
        }
    `;

    const vorticityShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uCurl;
        uniform vec2 texelSize;
        uniform float curl;
        uniform float dt;
        void main () {
            float L = abs(texture2D(uCurl, vUv - vec2(texelSize.x, 0.0)).x);
            float R = abs(texture2D(uCurl, vUv + vec2(texelSize.x, 0.0)).x);
            float B = abs(texture2D(uCurl, vUv - vec2(0.0, texelSize.y)).x);
            float T = abs(texture2D(uCurl, vUv + vec2(0.0, texelSize.y)).x);

            float C = texture2D(uCurl, vUv).x;
            vec2 force = 0.5 * vec2(R - L, T - B);
            float len = length(force) + 1e-5;
            force = (force / len) * curl * C;

            vec2 vel = texture2D(uVelocity, vUv).xy;
            gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
        }
    `;

    const pressureShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uPressure;
        uniform sampler2D uDivergence;
        uniform vec2 texelSize;
        void main () {
            float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
            float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
            float B = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;
            float T = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;
            float div = texture2D(uDivergence, vUv).x;
            float p = (L + R + B + T - div) * 0.25;
            gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
        }
    `;

    const gradSubtractShader = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uPressure;
        uniform sampler2D uVelocity;
        uniform vec2 texelSize;
        void main () {
            float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
            float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
            float B = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;
            float T = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;
            vec2 vel = texture2D(uVelocity, vUv).xy;
            vel -= vec2(R - L, T - B) * 0.5;
            gl_FragColor = vec4(vel, 0.0, 1.0);
        }
    `;

    // --- Programs ---
    const programs = {
        clear: createProgram(baseVertexShader, clearShader),
        display: createProgram(baseVertexShader, displayShader),
        splat: createProgram(baseVertexShader, splatShader),
        advection: createProgram(baseVertexShader, advectionShader),
        divergence: createProgram(baseVertexShader, divergenceShader),
        curl: createProgram(baseVertexShader, curlShader),
        vorticity: createProgram(baseVertexShader, vorticityShader),
        pressure: createProgram(baseVertexShader, pressureShader),
        gradSubtract: createProgram(baseVertexShader, gradSubtractShader),
    };

    // If any critical program fails, abort gracefully.
    if (!programs.display || !programs.advection || !programs.splat) return;

    function bindAttrib(program) {
        const aPos = gl.getAttribLocation(program, 'aPosition');
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    }

    // --- Framebuffers ---
    function createTexture(w, h, internalFormat, format, type, param) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (isWebGL2) {
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, type, null);
        }
        return tex;
    }

    function createFBO(w, h, internalFormat, format, type, param) {
        const tex = createTexture(w, h, internalFormat, format, type, param);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { texture: tex, fbo, width: w, height: h };
    }

    function createDoubleFBO(w, h, internalFormat, format, type, param) {
        let fbo1 = createFBO(w, h, internalFormat, format, type, param);
        let fbo2 = createFBO(w, h, internalFormat, format, type, param);
        return {
            get read() { return fbo1; },
            get write() { return fbo2; },
            swap() { const tmp = fbo1; fbo1 = fbo2; fbo2 = tmp; }
        };
    }

    function getResolution(baseRes) {
        const aspect = canvas.width / canvas.height;
        if (aspect < 1) return { w: baseRes, h: Math.round(baseRes / aspect) };
        return { w: Math.round(baseRes * aspect), h: baseRes };
    }

    // WebGL1 fallback formats
    const rgba = isWebGL2 ? gl.RGBA16F : gl.RGBA;
    const rg = isWebGL2 ? gl.RG16F : gl.RGBA;
    const r = isWebGL2 ? gl.R16F : gl.RGBA;
    const fmtRGBA = gl.RGBA;
    const fmtRG = isWebGL2 ? gl.RG : gl.RGBA;
    const fmtR = isWebGL2 ? gl.RED : gl.RGBA;

    let velocity, dye, divergence, curl, pressure;
    let simTexelSize = { x: 1, y: 1 };
    let dyeTexelSize = { x: 1, y: 1 };

    function initFramebuffers() {
        const simRes = getResolution(config.SIM_RESOLUTION);
        const dyeRes = getResolution(config.DYE_RESOLUTION);

        simTexelSize = { x: 1 / simRes.w, y: 1 / simRes.h };
        dyeTexelSize = { x: 1 / dyeRes.w, y: 1 / dyeRes.h };

        velocity = createDoubleFBO(simRes.w, simRes.h, rg, fmtRG, texType, filtering);
        dye = createDoubleFBO(dyeRes.w, dyeRes.h, rgba, fmtRGBA, texType, filtering);
        divergence = createFBO(simRes.w, simRes.h, r, fmtR, texType, gl.NEAREST);
        curl = createFBO(simRes.w, simRes.h, r, fmtR, texType, gl.NEAREST);
        pressure = createDoubleFBO(simRes.w, simRes.h, r, fmtR, texType, gl.NEAREST);
    }

    function blit(destination) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination ? destination.fbo : null);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function setUniforms(program, uniforms) {
        gl.useProgram(program);
        bindAttrib(program);
        let texUnit = 0;
        for (const [name, val] of Object.entries(uniforms)) {
            const loc = gl.getUniformLocation(program, name);
            if (loc == null) continue;

            if (val && val.texture) {
                gl.activeTexture(gl.TEXTURE0 + texUnit);
                gl.bindTexture(gl.TEXTURE_2D, val.texture);
                gl.uniform1i(loc, texUnit);
                texUnit++;
            } else if (Array.isArray(val)) {
                if (val.length === 2) gl.uniform2f(loc, val[0], val[1]);
                else if (val.length === 3) gl.uniform3f(loc, val[0], val[1], val[2]);
                else if (val.length === 4) gl.uniform4f(loc, val[0], val[1], val[2], val[3]);
            } else if (typeof val === 'number') {
                gl.uniform1f(loc, val);
            } else if (typeof val === 'boolean') {
                gl.uniform1i(loc, val ? 1 : 0);
            }
        }
    }

    function clearTarget(target, value) {
        setUniforms(programs.clear, { uTexture: target.read, value });
        blit(target.write);
        target.swap();
    }

    // --- Input (track pointer, but keep pointer-events: none in CSS) ---
    const pointer = {
        down: false,
        moved: false,
        x: 0, y: 0,
        dx: 0, dy: 0,
        color: [1, 0.3, 0.2],
    };

    function updatePointer(e) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = 1.0 - (e.clientY - rect.top) / rect.height;

        pointer.moved = true;
        pointer.down = true;

        pointer.dx = (x - pointer.x) * 5.0;
        pointer.dy = (y - pointer.y) * 5.0;

        pointer.x = x;
        pointer.y = y;

        // Subtle random color shift (keeps "alive" feel)
        if (Math.random() < 0.08) {
            pointer.color = [
                clamp01(0.2 + Math.random()),
                clamp01(0.2 + Math.random()),
                clamp01(0.2 + Math.random())
            ];
        }
    }

    window.addEventListener('mousemove', updatePointer, { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (!e.touches || !e.touches[0]) return;
        updatePointer(e.touches[0]);
    }, { passive: true });

    function splat(x, y, dx, dy, color) {
        // velocity splat
        setUniforms(programs.splat, {
            uTarget: velocity.read,
            aspectRatio: canvas.width / canvas.height,
            point: [x, y],
            color: [dx, dy, 0],
            radius: config.SPLAT_RADIUS
        });
        blit(velocity.write);
        velocity.swap();

        // dye splat
        setUniforms(programs.splat, {
            uTarget: dye.read,
            aspectRatio: canvas.width / canvas.height,
            point: [x, y],
            color,
            radius: config.SPLAT_RADIUS
        });
        blit(dye.write);
        dye.swap();
    }

    let lastTime = performance.now();
    function step() {
        const now = performance.now();
        const dt = Math.min(0.016, (now - lastTime) / 1000);
        lastTime = now;

        // Advect velocity
        setUniforms(programs.advection, {
            uVelocity: velocity.read,
            uSource: velocity.read,
            texelSize: [simTexelSize.x, simTexelSize.y],
            dt,
            dissipation: config.VELOCITY_DISSIPATION
        });
        blit(velocity.write);
        velocity.swap();

        // Advect dye
        setUniforms(programs.advection, {
            uVelocity: velocity.read,
            uSource: dye.read,
            texelSize: [dyeTexelSize.x, dyeTexelSize.y],
            dt,
            dissipation: config.DENSITY_DISSIPATION
        });
        blit(dye.write);
        dye.swap();

        // Curl
        setUniforms(programs.curl, {
            uVelocity: velocity.read,
            texelSize: [simTexelSize.x, simTexelSize.y]
        });
        blit(curl);

        // Vorticity
        setUniforms(programs.vorticity, {
            uVelocity: velocity.read,
            uCurl: curl,
            texelSize: [simTexelSize.x, simTexelSize.y],
            curl: config.CURL,
            dt
        });
        blit(velocity.write);
        velocity.swap();

        // Divergence
        setUniforms(programs.divergence, {
            uVelocity: velocity.read,
            texelSize: [simTexelSize.x, simTexelSize.y]
        });
        blit(divergence);

        // Clear pressure
        clearTarget(pressure, config.PRESSURE_DISSIPATION);

        // Pressure solve
        for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
            setUniforms(programs.pressure, {
                uPressure: pressure.read,
                uDivergence: divergence,
                texelSize: [simTexelSize.x, simTexelSize.y]
            });
            blit(pressure.write);
            pressure.swap();
        }

        // Subtract pressure gradient
        setUniforms(programs.gradSubtract, {
            uPressure: pressure.read,
            uVelocity: velocity.read,
            texelSize: [simTexelSize.x, simTexelSize.y]
        });
        blit(velocity.write);
        velocity.swap();

        // Apply user splat
        if (pointer.moved) {
            pointer.moved = false;
            splat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color);
        }

        // Render to screen
        gl.disable(gl.BLEND);
        setUniforms(programs.display, { uTexture: dye.read });
        blit(null);

        requestAnimationFrame(step);
    }

    function init() {
        resizeCanvas();
        initFramebuffers();

        // Start with clean buffers
        clearTarget(velocity, 0.0);
        clearTarget(dye, 0.0);
        clearTarget(pressure, 0.0);

        requestAnimationFrame(step);
    }

    window.addEventListener('resize', () => {
        const changed = resizeCanvas();
        if (changed) initFramebuffers();
    });

    init();
})();


// --- UPDATED TYPEWRITER LOGIC (Slower Speeds) ---
const typewriterText = document.getElementById('typewriter');
const phrases = ["Video Editor", "Graphic Designer"];
let phraseIndex = 0;
let charIndex = 0;
let isDeleting = false;

// Speed Settings (in milliseconds)
const TYPING_SPEED = 350;     // Higher value provides Slower typing
const DELETING_SPEED = 150;   // Higher value provides Slower deleting
const PAUSE_AT_END = 2500;    // Increased from 2000 (Pause longer on full phrase)
const PAUSE_BEFORE_TYPE = 800; // Increased from 500 (Pause before starting next phrase)

function type() {
    const currentPhrase = phrases[phraseIndex];
    let typeSpeed = TYPING_SPEED;

    if (isDeleting) {
        typewriterText.textContent = currentPhrase.substring(0, charIndex - 1);
        charIndex--;
        typeSpeed = DELETING_SPEED;
    } else {
        typewriterText.textContent = currentPhrase.substring(0, charIndex + 1);
        charIndex++;
    }

    // Logic for pausing and switching directions
    if (!isDeleting && charIndex === currentPhrase.length) {
        isDeleting = true;
        typeSpeed = PAUSE_AT_END; 
    } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        typeSpeed = PAUSE_BEFORE_TYPE;
    }

    setTimeout(type, typeSpeed);
}

// Ensure it starts when the page loads
window.addEventListener('DOMContentLoaded', type);