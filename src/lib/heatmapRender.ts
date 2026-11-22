interface GlBag {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  program: WebGLProgram
  buffer: WebGLBuffer
  texture: WebGLTexture
}

let glBag: GlBag | null = null
let glFailed = false
let canvas2d: HTMLCanvasElement | null = null

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uRssi;

vec3 ramp(float x) {
  vec3 c0 = vec3(0.451, 0.071, 0.125);
  vec3 c1 = vec3(0.769, 0.188, 0.165);
  vec3 c2 = vec3(0.839, 0.361, 0.141);
  vec3 c3 = vec3(0.878, 0.643, 0.165);
  vec3 c4 = vec3(0.659, 0.729, 0.227);
  vec3 c5 = vec3(0.220, 0.690, 0.376);
  vec3 c6 = vec3(0.125, 0.722, 0.659);
  if (x < -84.0) return mix(c0, c1, clamp((x + 92.0) / 8.0, 0.0, 1.0));
  if (x < -75.0) return mix(c1, c2, clamp((x + 84.0) / 9.0, 0.0, 1.0));
  if (x < -67.0) return mix(c2, c3, clamp((x + 75.0) / 8.0, 0.0, 1.0));
  if (x < -58.0) return mix(c3, c4, clamp((x + 67.0) / 9.0, 0.0, 1.0));
  if (x < -50.0) return mix(c4, c5, clamp((x + 58.0) / 8.0, 0.0, 1.0));
  return mix(c5, c6, clamp((x + 50.0) / 10.0, 0.0, 1.0));
}

void main() {
  float rssi = texture(uRssi, vec2(vUv.x, 1.0 - vUv.y)).r * 80.0 - 110.0;
  if (rssi < -100.0) {
    frag = vec4(0.0);
    return;
  }
  float a = smoothstep(-100.0, -86.0, rssi) * 0.76;
  frag = vec4(ramp(rssi), a);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? ''
    gl.deleteShader(shader)
    throw new Error(log)
  }
  return shader
}

function ensureGl(): GlBag {
  if (glBag) return glBag
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true })
  if (!gl) throw new Error('no-webgl2')
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  const program = gl.createProgram()
  if (!program) throw new Error('program')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'aPos')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('buffer')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const texture = gl.createTexture()
  if (!texture) throw new Error('texture')
  glBag = { canvas, gl, program, buffer, texture }
  return glBag
}

function encode(rssi: Float32Array): Uint8Array {
  const bytes = new Uint8Array(rssi.length * 4)
  for (let i = 0; i < rssi.length; i++) {
    const t = Math.max(0, Math.min(1, (rssi[i] + 110) / 80))
    bytes[i * 4] = Math.round(t * 255)
    bytes[i * 4 + 3] = 255
  }
  return bytes
}

function drawGl(rssi: Float32Array, width: number, height: number): HTMLCanvasElement {
  const bag = ensureGl()
  const { gl, canvas, program, buffer, texture } = bag
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  gl.viewport(0, 0, width, height)
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, encode(rssi))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(gl.getUniformLocation(program, 'uRssi'), 0)
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
  const error = gl.getError()
  if (error !== gl.NO_ERROR) throw new Error(String(error))
  return canvas
}

function colorAt(rssi: number): [number, number, number, number] {
  if (rssi < -100) return [0, 0, 0, 0]
  const stops: { t: number; c: [number, number, number] }[] = [
    { t: -92, c: [115, 18, 32] },
    { t: -84, c: [196, 48, 42] },
    { t: -75, c: [214, 92, 36] },
    { t: -67, c: [224, 164, 42] },
    { t: -58, c: [168, 186, 58] },
    { t: -50, c: [56, 176, 96] },
    { t: -40, c: [32, 184, 168] },
  ]
  let color = stops[stops.length - 1].c
  if (rssi <= stops[0].t) color = stops[0].c
  else {
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i]
      const b = stops[i + 1]
      if (rssi <= b.t) {
        const u = (rssi - a.t) / (b.t - a.t)
        color = [
          Math.round(a.c[0] + (b.c[0] - a.c[0]) * u),
          Math.round(a.c[1] + (b.c[1] - a.c[1]) * u),
          Math.round(a.c[2] + (b.c[2] - a.c[2]) * u),
        ]
        break
      }
    }
  }
  const alpha = rssi < -86 ? Math.round(((rssi + 100) / 14) * 190) : 194
  return [color[0], color[1], color[2], Math.max(0, Math.min(210, alpha))]
}

function draw2d(rssi: Float32Array, width: number, height: number): HTMLCanvasElement {
  if (!canvas2d) canvas2d = document.createElement('canvas')
  if (canvas2d.width !== width || canvas2d.height !== height) {
    canvas2d.width = width
    canvas2d.height = height
  }
  const ctx = canvas2d.getContext('2d')
  if (!ctx) return canvas2d
  const image = ctx.createImageData(width, height)
  for (let i = 0; i < rssi.length; i++) {
    const [r, g, b, a] = colorAt(rssi[i])
    image.data[i * 4] = r
    image.data[i * 4 + 1] = g
    image.data[i * 4 + 2] = b
    image.data[i * 4 + 3] = a
  }
  ctx.putImageData(image, 0, 0)
  return canvas2d
}

export function renderRssi(rssi: Float32Array, width: number, height: number): {
  canvas: HTMLCanvasElement
  renderer: 'webgl2' | 'canvas2d'
} {
  if (!glFailed) {
    try {
      return { canvas: drawGl(rssi, width, height), renderer: 'webgl2' }
    } catch {
      glFailed = true
      glBag = null
    }
  }
  return { canvas: draw2d(rssi, width, height), renderer: 'canvas2d' }
}
