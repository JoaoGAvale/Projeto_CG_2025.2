/* ============================================================================
   Trabalho de Compputação Gráfica - 2025.2 - Prof. Darlan Bruno
   Alunos: Anderson Lopes e João Guilherme
   ============================================================================ */


// Montando o WebGL
const canvas = document.getElementById("glcanvas");
let gl = WebGLUtils.setupWebGL(canvas);
if (!gl) alert("WebGL não disponível.");

let program = initShaders(gl, "vertex-shader", "fragment-shader");
gl.useProgram(program);

// Atributos
const aPos = gl.getAttribLocation(program, "aPos");
const modelLoc = gl.getUniformLocation(program, "model");
const uRes = gl.getUniformLocation(program, "uResolution");
const uColor = gl.getUniformLocation(program, "uColor");

// Buffer para os vértices
const vbo = gl.createBuffer();

// OBJETOS DA CENA
let objects = [
  {
    id: 1,
    name: "Triângulo",
    vertices: [vec2(-80,-40), vec2(0,80), vec2(80,-40)],
    color: vec4(0.2,0.7,0.2,1),
    transform: translate(200,300,0),
    selected: false,
  },
  {
    id: 2,
    name: "Quadrado",
    vertices: [vec2(-60,-60), vec2(-60,60), vec2(60,60), vec2(60,-60)],
    color: vec4(0.2,0.4,0.9,1),
    transform: translate(500,300,0),
    selected: false,
  }
];

// Desenho da reta para espelhamento

const overlayCanvas = document.createElement("canvas");
overlayCanvas.width = canvas.width;
overlayCanvas.height = canvas.height;

overlayCanvas.style.position = "absolute";
overlayCanvas.style.left = canvas.offsetLeft + "px";
overlayCanvas.style.top = canvas.offsetTop + "px";
overlayCanvas.style.pointerEvents = "none";

document.getElementById("container").appendChild(overlayCanvas);

const octx = overlayCanvas.getContext("2d");

function drawOverlay() {
    overlayCanvas.style.left = canvas.offsetLeft + "px";
    overlayCanvas.style.top = canvas.offsetTop + "px";
    
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (!mirrorLine || !mirrorLine.p1 || !mirrorLine.p2) return;

    octx.beginPath();
    octx.moveTo(mirrorLine.p1[0], mirrorLine.p1[1]);
    octx.lineTo(mirrorLine.p2[0], mirrorLine.p2[1]);
    octx.strokeStyle = "black";
    octx.lineWidth = 2;
    octx.setLineDash([6,4]);
    octx.stroke();
    octx.setLineDash([]);
}

// Funções de tratamento das coordenadas

// Clona mat4 preservando a flag interno de matriz
function cloneMat4(M) {
  let r = [];
  for (let i = 0; i < 4; i++) r.push(vec4(M[i]));
  r.matrix = true;
  return r;
}

// Aplica mat4 num único ponto
function applyMat4ToPoint(mat, p) {
  let v = vec4(p[0], p[1], 0, 1);

  let x = mat[0][0]*v[0] + mat[0][1]*v[1] + mat[0][2]*v[2] + mat[0][3]*v[3];
  let y = mat[1][0]*v[0] + mat[1][1]*v[1] + mat[1][2]*v[2] + mat[1][3]*v[3];
  let w = mat[3][0]*v[0] + mat[3][1]*v[1] + mat[3][2]*v[2] + mat[3][3]*v[3];

  return [x / w, y / w];
}

// Aplica mat4 em todos os vértices
function applyMat4ToPoints(mat, pts) {
  return pts.map(p => {
    let r = applyMat4ToPoint(mat, p);
    return vec2(r[0], r[1]);
  });
}

// Centro do shape
function centroid(verts) {
  let sx=0, sy=0;
  for (let v of verts) { sx+=v[0]; sy+=v[1]; }
  return [sx/verts.length, sy/verts.length];
}


// 1. Operação de seleção
const pickFBO = gl.createFramebuffer();
const pickTex = gl.createTexture();

function ensurePickBuffer() {
  gl.bindTexture(gl.TEXTURE_2D, pickTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
    canvas.width, canvas.height,
    0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, pickFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                          gl.TEXTURE_2D, pickTex, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
ensurePickBuffer();

function idToColor(id) {
  return vec4(
    (id & 255)/255,
    ((id>>8)&255)/255,
    ((id>>16)&255)/255,
    1
  );
}

function colorToId(px) {
  return px[0] + (px[1]<<8) + (px[2]<<16);
}

function pickAt(x,y) {
  ensurePickBuffer();

  gl.bindFramebuffer(gl.FRAMEBUFFER, pickFBO);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(0,0,0,1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
  gl.enableVertexAttribArray(aPos);
  gl.uniform2f(uRes, canvas.width, canvas.height);

  for (const obj of objects) {
    gl.uniformMatrix4fv(modelLoc,false,flatten(obj.transform));
    gl.uniform4fv(uColor, idToColor(obj.id));

    gl.bufferData(gl.ARRAY_BUFFER, flatten(obj.vertices), gl.STATIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, obj.vertices.length);
  }

  let px = new Uint8Array(4);
  gl.readPixels(x, canvas.height-y, 1,1, gl.RGBA, gl.UNSIGNED_BYTE, px);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let id = colorToId(px);
  return objects.find(o => o.id === id) || null;
}


// 2. Operação de espelhamento
let mirrorLine = null;

// Reflete um ponto em relação a reta AB
function reflectPointAcrossLine(p, a, b) {
  let vx = b[0] - a[0], vy = b[1] - a[1];
  let L2 = vx*vx + vy*vy;
  if (L2 === 0) return p;

  let t = ((p[0]-a[0])*vx + (p[1]-a[1])*vy) / L2;
  let proj = [a[0] + t*vx, a[1] + t*vy];

  return [ proj[0] + (proj[0]-p[0]),
           proj[1] + (proj[1]-p[1]) ];
}

function mirrorSelectedOverLine() {
  if (!selectedObj || !mirrorLine) return;

  let ws = applyMat4ToPoints(selectedObj.transform, selectedObj.vertices);

  let reflected = ws.map(p =>
    reflectPointAcrossLine([p[0],p[1]], mirrorLine.p1, mirrorLine.p2)
  );

  let cx = reflected.reduce((s,v)=>s+v[0],0) / reflected.length;
  let cy = reflected.reduce((s,v)=>s+v[1],0) / reflected.length;

  selectedObj.vertices = reflected.map(v => vec2(v[0]-cx, v[1]-cy));
  selectedObj.transform = translate(cx, cy, 0);

  render();
}

// 3. Interações das transformações usando o mouse

let mode = document.getElementById("mode").value;
let selectedObj = null;

let mouseDown = false;
let dragStart = null;
let originalTransform = null;

document.getElementById("mode").addEventListener("change",
  e => mode = e.target.value
);

canvas.addEventListener("mousedown", e => {
  let r = canvas.getBoundingClientRect();
  let x = e.clientX - r.left;
  let y = e.clientY - r.top;

  mouseDown = true;

  if (mode === "select") {
    let p = pickAt(x,y);

    objects.forEach(o => o.selected = false);
    if (p) p.selected = true;
    selectedObj = p;

    render();
    return;
  }

  // Garante que o clique foi no mesmo objeto que já está selecionado
  if (["translate","rotate","scale"].includes(mode)) {
    let p = pickAt(x,y);
    if (p && selectedObj && p.id === selectedObj.id) {
      dragStart = [x,y];
      originalTransform = cloneMat4(selectedObj.transform);
    }
  }

  if (mode === "drawline") {
    if (!mirrorLine || (mirrorLine.p1 && mirrorLine.p2)) {
        mirrorLine = { p1: [x,y], p2: null };
        drawOverlay();
        return;
    }
    if (!mirrorLine.p2) {
        mirrorLine.p2 = [x,y];
        drawOverlay();
        return;
    }
}

  if (mode === "mirror") {
    mirrorSelectedOverLine();
  }
});

canvas.addEventListener("mousemove", e => {
  if (!mouseDown || !selectedObj || !dragStart) return;

  let r = canvas.getBoundingClientRect();
  let x = e.clientX - r.left;
  let y = e.clientY - r.top;
  let dx = x - dragStart[0];
  let dy = y - dragStart[1];

  if (mode === "translate") {
    let t = translate(dx, dy, 0);
    selectedObj.transform = mult(t, originalTransform);
  }

  else if (mode === "rotate") {
    let localC = centroid(selectedObj.vertices);
    let worldC = applyMat4ToPoint(originalTransform, localC);

    let a1 = Math.atan2(dragStart[1]-worldC[1], dragStart[0]-worldC[0]);
    let a2 = Math.atan2(y-worldC[1], x-worldC[0]);
    let delta = a2 - a1;

    let T1 = translate(-worldC[0], -worldC[1], 0);
    let R  = rotate(delta*180/Math.PI, [0,0,1]);
    let T2 = translate(worldC[0], worldC[1], 0);

    selectedObj.transform = mult(T2, mult(R, mult(T1, originalTransform)));
  }

  else if (mode === "scale") {
    let localC = centroid(selectedObj.vertices);
    let worldC = applyMat4ToPoint(originalTransform, localC);

    let d0 = Math.hypot(dragStart[0]-worldC[0], dragStart[1]-worldC[1]);
    let d1 = Math.hypot(x-worldC[0], y-worldC[1]);
    let s = d1 / d0;

    let T1 = translate(-worldC[0], -worldC[1], 0);
    let S  = scalem(s,s,1);
    let T2 = translate(worldC[0], worldC[1], 0);

    selectedObj.transform = mult(T2, mult(S, mult(T1, originalTransform)));
  }

  render();
});

canvas.addEventListener("mouseup", ()=>{
  mouseDown = false;
  dragStart = null;
  originalTransform = null;
});


// 5. Resetar pro estado incial da cena
document.getElementById("reset").addEventListener("click", ()=>{

  objects[0].vertices = [
    vec2(-80,-40), vec2(0,80), vec2(80,-40)
  ];
  objects[0].transform = translate(200,300,0);

  objects[1].vertices = [
    vec2(-60,-60), vec2(-60,60), vec2(60,60), vec2(60,-60)
  ];
  objects[1].transform = translate(500,300,0);

  objects.forEach(o => o.selected = false);

  selectedObj = null;
  mirrorLine = null;

  render();
});

// 6. Renderização
function render() {
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(0.95,0.95,0.95,1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
  gl.enableVertexAttribArray(aPos);

  gl.uniform2f(uRes, canvas.width, canvas.height);

  for (let obj of objects) {
    let col = obj.selected ? vec4(1,0.2,0.2,1) : obj.color;
    gl.uniform4fv(uColor, col);
    gl.uniformMatrix4fv(modelLoc, false, flatten(obj.transform));
    gl.bufferData(gl.ARRAY_BUFFER, flatten(obj.vertices), gl.STATIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, obj.vertices.length);
  }
  drawOverlay();
}

render();