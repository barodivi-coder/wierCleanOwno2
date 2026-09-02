/* =========================================================
   VierCleanÓwno — prosta gra przeglądarkowa 3D (Three.js r128)
   ========================================================= */

// Widoczny na ekranie komunikat błędu — gdyby coś w skrypcie rzuciło
// wyjątkiem, zobaczysz to od razu w przeglądarce (górny czerwony pasek)
// zamiast cichej awarii bez śladu w interfejsie.
window.addEventListener('error', (e) => {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999;background:#E4572E;color:#fff;font:13px/1.4 monospace;padding:8px 12px;';
  bar.textContent = 'Błąd skryptu: ' + (e.message || e.error) + ' (linia ' + e.lineno + ')';
  document.body.appendChild(bar);
});

// ---------- Renderer / Scene / Camera ----------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xBFE6F5);
scene.fog = new THREE.Fog(0xBFE6F5, 60, 185);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 500);

function onViewportResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onViewportResize);
window.addEventListener('orientationchange', () => setTimeout(onViewportResize, 250));
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', onViewportResize);
}

// ---------- Toon shading helper ----------
function makeToonGradient() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 1;
  const ctx = c.getContext('2d');
  [70, 140, 200, 255].forEach((v, i) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(i, 0, 1, 1);
  });
  const tex = new THREE.Texture(c);
  tex.needsUpdate = true;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}
const toonGradient = makeToonGradient();
function toonMat(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient });
}

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x4c8f32, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.position.set(35, 55, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;
scene.add(sun);

// ---------- Field / Ground ----------
const FIELD = 30; // half-size of the playable meadow (x-extent for meadow, and south edge z)

// Plansze (łąka, hala, ujeżdżalnia) sięgają teraz tylko do PLAY_Z_MAX (zamiast
// do FIELD) — powyżej biegnie wydzielona ogrodzeniem droga (ROAD_Z_MIN..ROAD_Z_MAX)
// na całej szerokości świata gry (od wschodniej ściany łąki po zachodnią ścianę ujeżdżalni).
const PLAY_Z_MIN = -FIELD;      // -30, południowa krawędź wszystkich 3 plansz (bez zmian)
const PLAY_Z_MAX = 20;          // nowa, przycięta północna krawędź plansz
const PLAY_Z_CENTER = (PLAY_Z_MIN + PLAY_Z_MAX) / 2;
const PLAY_Z_HALF = (PLAY_Z_MAX - PLAY_Z_MIN) / 2;
const ROAD_Z_MIN = PLAY_Z_MAX;  // 20
const ROAD_Z_MAX = 28;          // zewnętrzna, północna granica całego świata gry

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(FIELD * 2 + 6, FIELD * 2 + 6, 1, 1),
  toonMat(0x5FAE3E)
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// subtle darker patches for texture variety
const patchMat = toonMat(0x4C8F32);
for (let i = 0; i < 40; i++) {
  const patch = new THREE.Mesh(new THREE.CircleGeometry(1 + Math.random() * 2, 10), patchMat);
  patch.rotation.x = -Math.PI / 2;
  patch.position.set((Math.random() * 2 - 1) * FIELD, 0.02, PLAY_Z_CENTER + (Math.random() * 2 - 1) * PLAY_Z_HALF);
  patch.receiveShadow = true;
  scene.add(patch);
}

// ---------- Background hills (Podkarpacie) ----------
// Wzgórza są rozstawione wokół środka CAŁEGO terenu (łąka + druga działka),
// żeby żaden fragment nie wszedł na żadną z dwóch płaszczyzn.
// (addHills — patrz niżej, po zdefiniowaniu granic świata; potrzebuje WORLD_X_MIN)

function applyWallCollision(prevX, candidateX, wallX, margin, passable) {
  if (passable) return candidateX;
  if (prevX >= wallX && candidateX < wallX + margin) return wallX + margin;
  if (prevX < wallX && candidateX > wallX - margin) return wallX - margin;
  return candidateX;
}

// Jak applyWallCollision, ale ściana istnieje TYLKO w podanym zakresie z
// (poza nim brak kolizji — używane dla wewnętrznych działek, które nie
// sięgają na pas drogi).
function applyWallCollisionZRanged(prevX, candidateX, wallX, margin, z, zMin, zMax) {
  if (z < zMin || z > zMax) return candidateX;
  return applyWallCollision(prevX, candidateX, wallX, margin, false);
}

// Pozioma ściana z dowolną liczbą "okien" bram (przejezdna tylko w ich
// zakresie x, z uwzględnionym marginesem traktora).
function applyGatedHorizontalWall(prevZ, candidateZ, wallZ, margin, x, gates) {
  const passable = gates.some((g) => x >= g.from - margin * 0.3 && x <= g.to + margin * 0.3);
  if (passable) return candidateZ;
  if (prevZ <= wallZ && candidateZ > wallZ - margin) return wallZ - margin;
  if (prevZ > wallZ && candidateZ < wallZ + margin) return wallZ + margin;
  return candidateZ;
}

// ---------- Fence (generic builder, reused by both plots) ----------
const postMat = toonMat(0xF7F5EF);
const railMat = toonMat(0xEDEAdd);
const FENCE_SPACING = 4;

// gateGroup holds the fence posts/rails covering the gate opening in the
// meadow's left fence — initially visible (gate closed), hidden once the
// player unlocks the second plot (gate opens).
const gateGroup = new THREE.Group();
scene.add(gateGroup);
let gateOpen = false;

function buildFenceSegment(x1, z1, x2, z2, gate) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const n = Math.round(len / FENCE_SPACING);
  const angle = Math.atan2(dz, dx);

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.7, 8), postMat);
    post.position.set(x1 + dx * t, 0.85, z1 + dz * t);
    post.castShadow = true;
    if (gate && t >= gate.from && t <= gate.to) {
      gateGroup.add(post);
    } else {
      scene.add(post);
    }
  }

  function addRailPiece(a, b, isGate) {
    const segLen = len * (b - a);
    const midT = (a + b) / 2;
    [0.55, 1.15].forEach((y) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.12, 0.12), railMat);
      rail.position.set(x1 + dx * midT, y, z1 + dz * midT);
      rail.rotation.y = -angle;
      rail.castShadow = true;
      (isGate ? gateGroup : scene).add(rail);
    });
  }

  if (gate) {
    if (gate.from > 0) addRailPiece(0, gate.from, false);
    addRailPiece(gate.from, gate.to, true);
    if (gate.to < 1) addRailPiece(gate.to, 1, false);
  } else {
    addRailPiece(0, 1, false);
  }
}

// ---------- Second plot: hala (concrete) + third plot: ujeżdżalnia (sand) ----------
const PLOT2_X_MIN = -90;
const PLOT2_X_MAX = -30; // shared border with the meadow's left fence
const PLOT2_Z_MIN = PLAY_Z_MIN;
const PLOT2_Z_MAX = PLAY_Z_MAX;

// Wewnętrzne ogrodzenie dzieli drugą działkę mniej więcej na pół:
// - PLOT2_DIVIDER_X..PLOT2_X_MAX -> plansza 2 (hala, beton)
// - PLOT2_X_MIN..PLOT2_DIVIDER_X -> plansza 3 (ujeżdżalnia, piasek)
const PLOT2_DIVIDER_X = (PLOT2_X_MIN + PLOT2_X_MAX) / 2; // -60
const PLOT2_CENTER_X = (PLOT2_DIVIDER_X + PLOT2_X_MAX) / 2;
const PLOT3_CENTER_X = (PLOT2_X_MIN + PLOT2_DIVIDER_X) / 2;

// ---------- Plansza 4: nowa działka, wielkości plansza-2, dalej na zachód ----------
const PLOT4_X_MAX = PLOT2_X_MIN;                      // -90, wspólna granica z plansza-3
const PLOT4_X_MIN = PLOT4_X_MAX - (PLOT2_X_MAX - PLOT2_DIVIDER_X); // -120 (ta sama szerokość co plansza-2)
const PLOT4_CENTER_X = (PLOT4_X_MIN + PLOT4_X_MAX) / 2; // -105

// ---------- Plansza 5: "parking" — pusty, szary plac za planszą-4 ----------
const PLOT5_X_MAX = PLOT4_X_MIN;                          // wspólna granica z plansza-4 (bez ogrodzenia)
const PLOT5_WIDTH = (PLOT4_X_MAX - PLOT4_X_MIN) * 0.75;   // 3/4 szerokości plansza-4
const PLOT5_X_MIN = PLOT5_X_MAX - PLOT5_WIDTH;
const PLOT5_CENTER_X = (PLOT5_X_MIN + PLOT5_X_MAX) / 2;

// Zachodnia krawędź plansza-5 to teraz prawdziwa granica całego świata gry.
let WORLD_X_MIN = PLOT5_X_MIN;

// ---------- Background hills (elipsa dopasowana do wydłużonego świata) ----------
// Świat gry jest dużo dłuższy (oś X, ~150) niż głęboki (oś Z, ~58), więc
// pagórki rozstawione są na elipsie dopasowanej do tych proporcji — dzięki
// temu żaden nie nachodzi na budynek przy skrajnej, zachodniej ścianie.
function addHills() {
  const hillMat = toonMat(0x4C8F32);
  const hillMat2 = toonMat(0x64A83F);
  const worldCenterX = (FIELD + WORLD_X_MIN) / 2;
  const worldHalfW = (FIELD - WORLD_X_MIN) / 2;
  const worldCenterZ = (PLAY_Z_MIN + ROAD_Z_MAX) / 2;
  const worldHalfD = (ROAD_Z_MAX - PLAY_Z_MIN) / 2;
  const buffer = 24; // zapas ponad promień największego pagórka + margines
  const safetyMargin = 6; // dodatkowy, gwarantowany zapas przy korekcie
  for (let i = 0; i < 34; i++) {
    const angle = (i / 34) * Math.PI * 2;
    const r = 8 + Math.random() * 10;
    const distX = worldHalfW + buffer + Math.random() * 20;
    const distZ = worldHalfD + buffer + Math.random() * 20;
    let x = worldCenterX + Math.cos(angle) * distX;
    let z = worldCenterZ + Math.sin(angle) * distZ;

    // Gwarantowana korekta: świat gry jest bardzo wydłużony (znacznie
    // szerszy niż głębszy), więc sama elipsa czasem nie daje pewności przy
    // kątach ukośnych — tutaj sprawdzamy odległość od faktycznego
    // prostokąta świata i w razie potrzeby odpychamy pagórek dalej.
    const closestX = THREE.Math.clamp(x, WORLD_X_MIN, FIELD);
    const closestZ = THREE.Math.clamp(z, PLAY_Z_MIN, ROAD_Z_MAX);
    const dx = x - closestX, dz = z - closestZ;
    const dist = Math.hypot(dx, dz);
    const needed = r + safetyMargin;
    if (dist < needed) {
      const push = needed - dist;
      if (dist > 0.001) {
        x += (dx / dist) * push;
        z += (dz / dist) * push;
      } else {
        x += Math.cos(angle) * push;
        z += Math.sin(angle) * push;
      }
    }

    const h = 6 + Math.random() * 11;
    const geo = new THREE.SphereGeometry(r, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const hill = new THREE.Mesh(geo, i % 2 === 0 ? hillMat : hillMat2);
    hill.position.set(x, -1.5, z);
    hill.scale.y = h / r;
    scene.add(hill);
  }
}
// addHills(); przeniesione na koniec, po integracji plansza-6

// Brama 1 (łąka -> droga): w rogu ogrodzenia łąki z halą (przy x = -30).
const GATE_WIDTH = 10;
const GATE1_X_MIN = PLOT2_X_MAX;              // -30
const GATE1_X_MAX = PLOT2_X_MAX + GATE_WIDTH; // -20
// Brama 2 (droga -> ujeżdżalnia): w rogu ogrodzenia ujeżdżalni z halą (przy x = -60).
const GATE2_X_MIN = PLOT2_DIVIDER_X - GATE_WIDTH; // -70
const GATE2_X_MAX = PLOT2_DIVIDER_X;              // -60

function makeConcreteTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#B7B6B0';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(90,88,82,0.35)';
  ctx.lineWidth = 3;
  const cell = size / 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
  }
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 8);
  return tex;
}

function makeSandTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#D9BB63';
  ctx.fillRect(0, 0, size, size);
  // delikatne, "zagrabione" faliste pasy jak na piaszczystej ujeżdżalni
  ctx.strokeStyle = 'rgba(150,118,45,0.25)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    const y = i * (size / 9);
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.25, y + 10, size * 0.75, y - 10, size, y);
    ctx.stroke();
  }
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(90,66,20,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 8);
  return tex;
}

function makePlankTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6B4526';
  ctx.fillRect(0, 0, size, size);
  const plankCount = 8;
  const plankW = size / plankCount;
  for (let i = 0; i < plankCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#7A4E2D' : '#6B4526';
    ctx.fillRect(i * plankW, 0, plankW - 3, size);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    const y = Math.random() * size;
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (Math.random() * 8 - 4));
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}


function addPlot2Ground() {
  const mat = new THREE.MeshToonMaterial({ map: makeConcreteTexture(), gradientMap: toonGradient });
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(PLOT2_X_MAX - PLOT2_DIVIDER_X, PLOT2_Z_MAX - PLOT2_Z_MIN),
    mat
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(PLOT2_CENTER_X, 0.01, PLAY_Z_CENTER);
  plane.receiveShadow = true;
  scene.add(plane);
}
addPlot2Ground();

function addPlot3Ground() {
  const mat = new THREE.MeshToonMaterial({ map: makeSandTexture(), gradientMap: toonGradient });
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(PLOT2_DIVIDER_X - PLOT2_X_MIN, PLOT2_Z_MAX - PLOT2_Z_MIN),
    mat
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(PLOT3_CENTER_X, 0.011, PLAY_Z_CENTER);
  plane.receiveShadow = true;
  scene.add(plane);
}
addPlot3Ground();

function addPlot4Ground() {
  const mat = new THREE.MeshToonMaterial({ map: makeConcreteTexture(), gradientMap: toonGradient });
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(PLOT4_X_MAX - PLOT4_X_MIN, PLAY_Z_MAX - PLAY_Z_MIN),
    mat
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(PLOT4_CENTER_X, 0.01, PLAY_Z_CENTER);
  plane.receiveShadow = true;
  scene.add(plane);
}
addPlot4Ground();

// ---------- Plansza 5: pusty, płaski, szary plac ("parking") ----------
// Ten sam kolor bazowy co beton przed halą na plansza-4, ale bez żadnej
// tekstury/linii — czysta, jednolita powierzchnia.
function addPlot5Ground() {
  const mat = toonMat(0xB7B6B0);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(PLOT5_X_MAX - PLOT5_X_MIN, PLAY_Z_MAX - PLAY_Z_MIN),
    mat
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(PLOT5_CENTER_X, 0.01, PLAY_Z_CENTER);
  plane.receiveShadow = true;
  scene.add(plane);
}
// Globalna lista przeszkód kolizyjnych budynków (m.in. farma, garaże, plansza-6) —
// zadeklarowana wcześnie, żeby była dostępna dla całego kodu poniżej.
const FARM_BLOCKERS = [];

addPlot5Ground();

// ==================== PLANSZA 6 (wklejona bez modyfikacji) ====================
// ============================================================================
// PLANSZA 6 — dodatkowa działka za parkingiem (plansza 5), ogrodzona żywopłotem
// ============================================================================
//
// Ten plik jest DOKLEJKĄ do istniejącego game.js — nie jest samodzielną grą.
// Zakłada, że w głównym pliku istnieją już (nie trzeba ich redefiniować):
//   - scene (THREE.Scene)
//   - toonMat(color), toonGradient
//   - PLAY_Z_MIN, PLAY_Z_MAX, PLAY_Z_CENTER   (=-30, 20, -5)
//   - PLOT4_X_MIN, PLOT4_X_MAX                (=-120, -90 — do wyliczenia szerokości)
//   - PLOT5_X_MIN                             (zachodnia krawędź parkingu — stary WORLD_X_MIN)
//   - FARM_BLOCKERS                           (globalna tablica {x1,x2,z1,z2} używana
//                                               już w pętli kolizji traktora, patrz game.js ~1612)
//   - createGableWing(...), createLeanToWing(...)  (funkcje budujące skrzydła
//                                               dachowe, już użyte przy budynku
//                                               na plansza-4, patrz game.js ~746 i ~1081)
//
// CO OPISUJE TA PLANSZA (zgodnie z ustaleniami):
//   - Zielona, trawiasta działka, taka sama szerokość (oś X) jak plansza 4.
//   - Przez całą jej długość (oś X) biegnie szara droga (kolor parkingu),
//     przesunięta od geometrycznego środka (nie centralnie) — patrz
//     PLOT6_ROAD_OFFSET niżej, łatwo odwrócić stronę zmieniając znak.
//   - Żywopłot z równo, prostokątnie przyciętych krzewów na 3 bokach
//     (zachód + dwa boki dłuższe). Strona wschodnia (granica z plansza-5,
//     parkingiem) jest CELOWO otwarta — bez żywopłotu, tak jak istniejąca
//     otwarta granica plansza-4 <-> plansza-5.
//   - Dokładnie tam, gdzie droga "wychodzi" przez zachodni żywopłot (czyli
//     tam, gdzie w innym wypadku dałoby się wyjechać poza mapę), stoi
//     zaparkowany Lexus UX 250h (dokładniejszy kształt: spindle grill,
//     wąskie reflektory, emblemat), zwrócony przodem na wschód (w stronę
//     reszty plansz) — jakby właśnie wjechał na podwórko. Zajmuje całą
//     szerokość drogi i ma pełną, niewidoczną kolizję.
//   - W rogu bliżej parkingu, w tej połowie działki gdzie jest więcej trawy
//     (dalej od drogi), stoi drewniany plac zabaw: huśtawki (2 deski na
//     łańcuchach na jednym stojaku) + domek na nóżkach ze zjeżdżalnią
//     skierowaną w stronę zachodniego żywopłotu (ta sama strona co auto).
//
// INSTRUKCJA DOKLEJENIA (dla Claude integrującego to z pełnym game.js):
//   1. Wklej całą zawartość tego pliku ZARAZ PO sekcji planszy 5
//      (po wywołaniu addPlot5Ground()), a PRZED addRoadStrip() / addHills().
//   2. Plansza 6 NIE jest połączona z górnym, łączącym pasem drogi
//      (ROAD_Z_MIN..ROAD_Z_MAX) — wchodzi się na nią wyłącznie z planszy 5,
//      przez otwartą granicę wschodnią. Jeśli kamera/limity świata mają
//      dynamicznie sięgać dalej na zachód, podmień referencje do starego
//      WORLD_X_MIN na PLOT6_X_MIN w np. addHills() i w clampie ruchu traktora.
//   3. Wywołaj na końcu: addPlot6Ground(); addPlot6Road(); addPlot6Hedges();
//      buildLexusUX(); addPlot6Playground(); buildYellowHouse();
//      (kolejność między nimi dowolna)
//   4. Kolizje: ten plik sam dopisuje wszystkie bounding boxy (żywopłot,
//      auto, huśtawki, domek) do istniejącej, globalnej tablicy FARM_BLOCKERS
//      — jeśli Twój game.js woła tę tablicę w pętli kolizji tak jak oryginał
//      (linia ok. 1612: "FARM_BLOCKERS.forEach(...)"), NIE musisz nic więcej
//      dopisywać w logice ruchu.
//   5. Wszystkie liczby są wydzielone jako stałe na górze — łatwo dostroić
//      bez grzebania w geometrii.
// ============================================================================


// ---------- Geometria działki ----------
const PLOT6_X_MAX = PLOT5_X_MIN;                    // = dotychczasowy WORLD_X_MIN; otwarta granica z parkingiem (plansza 5)
const PLOT6_WIDTH = (PLOT4_X_MAX - PLOT4_X_MIN) * 1.15; // skrócona względem poprzedniej wersji (była za duża)
const PLOT6_X_MIN = PLOT6_X_MAX - PLOT6_WIDTH;      // nowa, zachodnia krawędź całego świata gry
const PLOT6_CENTER_X = (PLOT6_X_MIN + PLOT6_X_MAX) / 2;

// Efektywna granica terenu/żywopłotu/drogi — tam gdzie faktycznie stoi ślepa
// ściana domu (czerwona linia), czyli PLOT6_X_MAX pomniejszone o margines
// domu od granicy i połowę jego długości (te same liczby co przy domu w
// buildYellowHouse — jeśli tamte wartości się zmienią, tu też trzeba
// zaktualizować). Dom SAM w sobie się nie rusza — tylko teren/żywopłot/droga
// kończą się teraz dokładnie na jego ślepej ścianie, zamiast ciągnąć się
// dalej w stronę parkingu.
const PLOT6_GROUND_X_MAX = PLOT6_X_MAX - 12 + 19 / 2; // = PLOT6_X_MAX - houseMarginFromParkingEdge + HOUSE_LENGTH/2

// ---------- Droga: pełna długość (oś X) planszy, przesunięta od środka ----------
const PLOT6_ROAD_WIDTH = 6;         // szerokość (w osi Z) szarego pasa drogi (zwężona na życzenie)
// UWAGA: znak tej stałej decyduje o tym, w którą stronę (Z+ czy Z-) droga
// jest przesunięta od PLAY_Z_CENTER. Był już raz odwrócony na życzenie —
// jeśli znowu wyjdzie w złą stronę, wystarczy zmienić znak na przeciwny.
const PLOT6_ROAD_OFFSET = 6;
const PLOT6_ROAD_Z_CENTER = PLAY_Z_CENTER + PLOT6_ROAD_OFFSET;
const PLOT6_ROAD_Z_MIN = PLOT6_ROAD_Z_CENTER - PLOT6_ROAD_WIDTH / 2;
const PLOT6_ROAD_Z_MAX = PLOT6_ROAD_Z_CENTER + PLOT6_ROAD_WIDTH / 2;

// Szerokości dwóch pasów trawy po obu stronach drogi — używane do wybrania
// szerszego pasa pod plac zabaw (patrz addPlot6Playground niżej).
const PLOT6_GRASS_STRIP_A_WIDTH = PLOT6_ROAD_Z_MIN - PLAY_Z_MIN; // pas od strony PLAY_Z_MIN
const PLOT6_GRASS_STRIP_B_WIDTH = PLAY_Z_MAX - PLOT6_ROAD_Z_MAX; // pas od strony PLAY_Z_MAX

// ---------- Kolory ----------
const PLOT6_GRASS_COLOR = 0x5FAE3E;       // ta sama zieleń trawy co reszta gry
const PLOT6_GRASS_PATCH_COLOR = 0x4C8F32; // ciemniejsze plamy dla urozmaicenia
const PLOT6_ROAD_COLOR = 0xB7B6B0;        // ten sam szary co plansza-5 (parking)
const PLOT6_HEDGE_COLOR = 0x1D8A3B;       // intensywna, nasycona zieleń żywopłotu
const PLOT6_WOOD_COLOR = 0x5C3D22;        // ciemne, impregnowane drewno (plac zabaw)
const PLOT6_WOOD_COLOR_DARK = 0x4A311B;   // jeszcze ciemniejszy akcent (deski/łańcuchy)


// ============================================================================
// PODŁOŻE: trawa na całej działce + subtelne, ciemniejsze plamy (poza drogą)
// ============================================================================
function addPlot6Ground() {
  const mat = toonMat(PLOT6_GRASS_COLOR);
  const groundWidth = PLOT6_GROUND_X_MAX - PLOT6_X_MIN;
  const groundCenterX = (PLOT6_X_MIN + PLOT6_GROUND_X_MAX) / 2;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(groundWidth, PLAY_Z_MAX - PLAY_Z_MIN),
    mat
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(groundCenterX, 0.01, PLAY_Z_CENTER);
  plane.receiveShadow = true;
  scene.add(plane);

  const patchMat = toonMat(PLOT6_GRASS_PATCH_COLOR);
  let placed = 0, attempts = 0;
  while (placed < 18 && attempts < 300) {
    attempts++;
    const x = PLOT6_X_MIN + Math.random() * groundWidth;
    const z = PLAY_Z_MIN + Math.random() * (PLAY_Z_MAX - PLAY_Z_MIN);
    const radius = 1 + Math.random() * 2;
    // Sprawdzamy kolizję PROMIENIA plamy z pasem drogi (nie samego środka),
    // żeby duże plamy nie "wystawały" na szary asfalt.
    if (z + radius > PLOT6_ROAD_Z_MIN - 0.3 && z - radius < PLOT6_ROAD_Z_MAX + 0.3) continue;
    if (x - radius < PLOT6_X_MIN + 0.5 || x + radius > PLOT6_GROUND_X_MAX - 0.5) continue;
    if (z - radius < PLAY_Z_MIN + 0.5 || z + radius > PLAY_Z_MAX - 0.5) continue;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(radius, 10), patchMat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, 0.02, z);
    patch.receiveShadow = true;
    scene.add(patch);
    placed++;
  }
}


// ============================================================================
// DROGA: szary pas na całą szerokość (X) działki, przesunięty od środka
// ============================================================================
function addPlot6Road() {
  const mat = toonMat(PLOT6_ROAD_COLOR);
  const roadWidth = PLOT6_GROUND_X_MAX - PLOT6_X_MIN;
  const roadCenterX = (PLOT6_X_MIN + PLOT6_GROUND_X_MAX) / 2;
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(roadWidth, PLOT6_ROAD_WIDTH),
    mat
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(roadCenterX, 0.015, PLOT6_ROAD_Z_CENTER);
  road.receiveShadow = true;
  scene.add(road);
}


// ============================================================================
// ŻYWOPŁOT: 3 boki (zachód + dwa boki dłuższe). Wschodnia granica otwarta.
// Zachodni bok ma przerwę tam, gdzie kończy się droga — wypełnia ją Lexus.
// ============================================================================
const HEDGE_MAT = toonMat(PLOT6_HEDGE_COLOR);
const HEDGE_HEIGHT = 1.6;
const HEDGE_THICKNESS = 1.0;
const HEDGE_SEGMENT_LEN = 2;

function buildHedgeSegment(x1, z1, x2, z2, opening) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / HEDGE_SEGMENT_LEN));
  const angle = Math.atan2(dz, dx);

  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    if (opening && t1 > opening.from && t0 < opening.to) continue;
    const midT = (t0 + t1) / 2;
    const segLen = len / n + 0.15;
    const bush = new THREE.Mesh(
      new THREE.BoxGeometry(segLen, HEDGE_HEIGHT, HEDGE_THICKNESS),
      HEDGE_MAT
    );
    bush.position.set(x1 + dx * midT, HEDGE_HEIGHT / 2, z1 + dz * midT);
    bush.rotation.y = -angle;
    bush.castShadow = true;
    bush.receiveShadow = true;
    scene.add(bush);
  }

  if (!opening) {
    FARM_BLOCKERS.push({
      x1: Math.min(x1, x2) - HEDGE_THICKNESS / 2,
      x2: Math.max(x1, x2) + HEDGE_THICKNESS / 2,
      z1: Math.min(z1, z2) - HEDGE_THICKNESS / 2,
      z2: Math.max(z1, z2) + HEDGE_THICKNESS / 2,
    });
  }
}

function addPlot6Hedges() {
  const openFrom = (PLOT6_ROAD_Z_MIN - PLAY_Z_MIN) / (PLAY_Z_MAX - PLAY_Z_MIN);
  const openTo = (PLOT6_ROAD_Z_MAX - PLAY_Z_MIN) / (PLAY_Z_MAX - PLAY_Z_MIN);

  buildHedgeSegment(PLOT6_X_MIN, PLAY_Z_MIN, PLOT6_X_MIN, PLAY_Z_MAX, { from: openFrom, to: openTo });
  buildHedgeSegment(PLOT6_X_MIN, PLAY_Z_MIN, PLOT6_GROUND_X_MAX, PLAY_Z_MIN);
  buildHedgeSegment(PLOT6_X_MIN, PLAY_Z_MAX, PLOT6_GROUND_X_MAX, PLAY_Z_MAX);
}


// ============================================================================
// TEKSTURA PRZODU AUTA (canvas) — grill "spindle", reflektory, emblemat,
// dolny spojler. Rysowana na płasko i naklejona na przód nadwozia.
// ============================================================================
function makeLexusFrontTexture(plateWidth, plateHeight) {
  const aspect = (plateWidth || 1.75) / (plateHeight || 1.05);
  const h = 340;
  const w = Math.round(h * aspect);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Tło = kolor nadwozia
  ctx.fillStyle = '#76787A';
  ctx.fillRect(0, 0, w, h);

  const gcx = w / 2;

  // ---- Dolny srebrny spojler/skid-plate (jak na zdjęciu — jasny, nie czarny) ----
  ctx.fillStyle = '#B9BBBD';
  ctx.beginPath();
  ctx.moveTo(gcx - w * 0.30, h - 34);
  ctx.lineTo(gcx + w * 0.30, h - 34);
  ctx.lineTo(gcx + w * 0.26, h);
  ctx.lineTo(gcx - w * 0.26, h);
  ctx.closePath();
  ctx.fill();

  // ---- Czarny pas zderzaka pod spojlerem i po bokach ----
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, h - 60, w, 26);

  // ---- Grill "spindle" — szeroka góra, zwężenie w połowie ("talia"), a
  // NIŻEJ rozszerzenie do szerokiej, płaskiej podstawy (bez ponownego
  // zwężania do szpica) ----
  function grillePath() {
    ctx.beginPath();
    ctx.moveTo(gcx - w * 0.20, h * 0.06);   // góra-lewo (szeroko)
    ctx.lineTo(gcx + w * 0.20, h * 0.06);   // góra-prawo (szeroko)
    ctx.lineTo(gcx + w * 0.14, h * 0.20);   // ramię prawe, zwężające się
    ctx.lineTo(gcx + w * 0.07, h * 0.42);   // "talia" — najwęższy punkt (prawo)
    ctx.lineTo(gcx + w * 0.24, h * 0.80);   // szeroka, płaska podstawa (prawo)
    ctx.lineTo(gcx - w * 0.24, h * 0.80);   // szeroka, płaska podstawa (lewo)
    ctx.lineTo(gcx - w * 0.07, h * 0.42);   // "talia" (lewo)
    ctx.lineTo(gcx - w * 0.14, h * 0.20);   // ramię lewe
    ctx.closePath();
  }
  // chromowana ramka
  ctx.strokeStyle = '#D4D4D4';
  ctx.lineWidth = 5;
  grillePath();
  ctx.stroke();
  // czarne wnętrze grilla
  ctx.fillStyle = '#0E0E0E';
  grillePath();
  ctx.fill();

  // Siateczka w kształcie rombów (diamond mesh) — przycięta do kształtu grilla
  ctx.save();
  grillePath();
  ctx.clip();
  ctx.strokeStyle = 'rgba(85,85,85,0.95)';
  ctx.lineWidth = 1.5;
  const cell = 13;
  for (let gy = -20; gy < h + 20; gy += cell) {
    for (let gx = -20; gx < w + 20; gx += cell) {
      const offset = (Math.round(gy / cell) % 2) * (cell / 2);
      ctx.beginPath();
      ctx.moveTo(gx + offset, gy - cell / 2);
      ctx.lineTo(gx + offset + cell / 2, gy);
      ctx.lineTo(gx + offset, gy + cell / 2);
      ctx.lineTo(gx + offset - cell / 2, gy);
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();

  // ---- Emblemat na grillu — ABSTRAKCYJNY, uproszczony (nie kopia logo marki) ----
  ctx.fillStyle = '#C9C9C9';
  ctx.beginPath();
  ctx.ellipse(gcx, h * 0.34, w * 0.042, h * 0.038, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0E0E0E';
  ctx.beginPath();
  ctx.ellipse(gcx, h * 0.34, w * 0.033, h * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#E4E4E4';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // ---- Reflektory: DWUCZĘŚCIOWE — cienka, skośna smuga DRL bliżej grilla +
  // większa, kanciasta lampa główna w rogu zderzaka (jak na zdjęciu) ----
  function drawHeadlight(mirror) {
    ctx.save();
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }

    // Cienka, PROSTOKĄTNA smuga DRL nad główną lampą
    ctx.fillStyle = '#161616';
    ctx.fillRect(w * 0.03, h * 0.18, w * 0.24, h * 0.05);
    ctx.strokeStyle = '#CFE6FF';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.05, h * 0.255);
    ctx.lineTo(w * 0.25, h * 0.255);
    ctx.stroke();

    // Główna lampa — PROSTOKĄTNA, czarna obudowa (obniżona zgodnie ze wskazaniem)
    ctx.fillStyle = '#141414';
    ctx.fillRect(w * 0.03, h * 0.33, w * 0.24, h * 0.24);
    // klosz lampy (jasne wnętrze), lekko mniejszy prostokąt w środku
    ctx.fillStyle = '#E8F1FF';
    ctx.fillRect(w * 0.055, h * 0.355, w * 0.19, h * 0.19);
    // mały, ciemny "projektor" wewnątrz lampy
    ctx.fillStyle = '#1A2530';
    ctx.beginPath();
    ctx.ellipse(w * 0.15, h * 0.45, w * 0.028, w * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();

    // Czarny, poziomy element pod lampą (dodatkowy pas — zgodnie ze
    // wskazaniem na screenie referencyjnym)
    ctx.fillStyle = '#141414';
    ctx.fillRect(w * 0.02, h * 0.59, w * 0.20, h * 0.045);
    ctx.restore();
  }
  drawHeadlight(false);
  drawHeadlight(true);

  // ---- Wloty powietrza w zderzaku — pionowe, kanciaste, z siateczką (dolne rogi) ----
  function drawIntake(mirror) {
    ctx.save();
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.fillStyle = '#0A0A0A';
    ctx.beginPath();
    ctx.moveTo(w * 0.03, h - 100);
    ctx.lineTo(w * 0.19, h - 94);
    ctx.lineTo(w * 0.17, h - 60);
    ctx.lineTo(w * 0.05, h - 60);
    ctx.closePath();
    ctx.fill();
    // pionowe żeberka wlotu
    ctx.strokeStyle = 'rgba(60,60,60,0.9)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      ctx.beginPath();
      ctx.moveTo(w * (0.03 + t * 0.15), h - 98);
      ctx.lineTo(w * (0.05 + t * 0.12), h - 62);
      ctx.stroke();
    }
    ctx.restore();
  }
  drawIntake(false);
  drawIntake(true);

  // ---- Chromowana listwa nad dolnym, srebrnym spojlerem ----
  ctx.strokeStyle = '#C9C9C9';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.22, h - 62);
  ctx.lineTo(w * 0.78, h - 62);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  return tex;
}


// ============================================================================
// LEXUS UX 250h — blokuje wylot drogi w przerwie zachodniego żywopłotu
// ============================================================================
function buildLexusUX() {
  const car = new THREE.Group();

  // ---------- Wymiary auta ----------
  // Szerokość i wysokość ZACHOWANE z poprzedniej wersji (na życzenie) — reszta
  // kształtu przeprojektowana od zera na podstawie zdjęć referencyjnych
  // (przód/tył/bok Lexusa UX).
  const CAR_LEN = 6.4;
  const CAR_WIDTH = 4.15 * (2 / 3);
  const CAR_HEIGHT = 2.9; // ta sama całkowita wysokość co poprzednia wersja
  const halfLen = CAR_LEN / 2;
  const halfW = CAR_WIDTH / 2;

  const bodyMat = toonMat(0x76787A);       // szary lakier (na życzenie - jak dotychczasowy zderzak)
  const bodyMatDark = toonMat(0x9A9C9E);
  const claddingMat = toonMat(0x1C1C1C);   // czarne plastikowe nakładki (nadkola, progi, zderzaki)
  const glassMat = toonMat(0x141618); // czarne, przyciemnione szyby
  const blackMat = toonMat(0x141414);
  const chromeMat = toonMat(0xDCDCDC);
  const rearLightMat = toonMat(0xC0392B);

  // ---------- Nadwozie: dolna bryła (spójny "kręgosłup" na całą długość) ----------
  const bodyBottom = 0.35;
  const bodyTop = 1.95;
  const bodyH = bodyTop - bodyBottom;
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.86, bodyH, CAR_WIDTH), bodyMat);
  lowerBody.position.set(-CAR_LEN * 0.02, (bodyBottom + bodyTop) / 2, 0);
  car.add(lowerBody);

  const rocker = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.82, 0.3, CAR_WIDTH + 0.08), claddingMat);
  rocker.position.set(-CAR_LEN * 0.02, bodyBottom + 0.05, 0);
  car.add(rocker);

  // Cienka linia charakteru na progu (jasny akcent, jak na zdjęciu bocznym)
  const beltLine = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.78, 0.05, CAR_WIDTH + 0.06), bodyMatDark);
  beltLine.position.set(-CAR_LEN * 0.02, bodyBottom + bodyH * 0.62, 0);
  car.add(beltLine);

  // ---------- Maska (płaska, szeroka) — ZACHODZI na nadwozie (nie stoi nad
  // nim z przerwą) i sięga aż do zderzaka ----------
  const hoodTop = bodyTop + 0.32;
  const hood1 = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.4, hoodTop - (bodyTop - 0.3), CAR_WIDTH - 0.15), bodyMat);
  hood1.position.set(halfLen * 0.58, (hoodTop + (bodyTop - 0.3)) / 2, 0);
  car.add(hood1);
  const hood2 = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.16, hoodTop - (bodyTop - 0.1), CAR_WIDTH - 0.25), bodyMat);
  hood2.position.set(halfLen * 0.76, (hoodTop + (bodyTop - 0.1)) / 2 - 0.08, 0);
  car.add(hood2);

  // ---------- Kabina: cofnięta, "coupé-SUV" — ZACHODZI na nadwozie od dołu
  // (dach opada ku tyłowi) ----------
  const cabinBottom = bodyTop - 0.25;
  const roofTop = 2.8;
  const cabinFront = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.33, roofTop - cabinBottom, CAR_WIDTH - 0.35), bodyMat);
  cabinFront.position.set(CAR_LEN * 0.04, (roofTop + cabinBottom) / 2 + 0.05, 0);
  car.add(cabinFront);
  const cabinRear = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.26, roofTop - 0.3 - cabinBottom, CAR_WIDTH - 0.5), bodyMat);
  cabinRear.position.set(-CAR_LEN * 0.27, (roofTop - 0.3 + cabinBottom) / 2, 0);
  car.add(cabinRear);
  const cabinBaseY = cabinBottom; // referencja wysokości dla elementów kabiny poniżej

  // Pas szyb — jaśniejszy niż nadwozie, ale C-słupek (tylna część) czarny,
  // tworzy efekt "pływającego dachu" charakterystyczny dla zdjęcia bocznego
  const glassBand = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.46, roofTop - 0.15 - (cabinBottom + 0.15), CAR_WIDTH - 0.3), glassMat);
  glassBand.position.set(-CAR_LEN * 0.01, (roofTop - 0.15 + cabinBottom + 0.15) / 2 + 0.1, 0);
  car.add(glassBand);
  const cPillar = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN * 0.16, roofTop - 0.1 - cabinBottom, CAR_WIDTH - 0.3), blackMat);
  cPillar.position.set(-CAR_LEN * 0.30, (roofTop - 0.1 + cabinBottom) / 2 + 0.05, 0);
  car.add(cPillar);

  // Przednia szyba — trapezoidalna, mocno pochylona
  const wsHalfW = halfW - 0.15;
  const windshieldShape = new THREE.Shape();
  windshieldShape.moveTo(-wsHalfW, 0);
  windshieldShape.lineTo(wsHalfW, 0);
  windshieldShape.lineTo(wsHalfW * 0.62, 1.05);
  windshieldShape.lineTo(-wsHalfW * 0.62, 1.05);
  windshieldShape.closePath();
  const windshieldGeo = new THREE.ShapeGeometry(windshieldShape);
  const windshieldMat = new THREE.MeshToonMaterial({ color: 0x141618, gradientMap: toonGradient, side: THREE.DoubleSide });
  const windshield = new THREE.Mesh(windshieldGeo, windshieldMat);
  windshield.rotation.set(0, Math.PI / 2, 0);
  windshield.rotation.z = -1.2;
  windshield.position.set(CAR_LEN * 0.20, cabinBaseY + 0.05, 0);
  car.add(windshield);

  [-1, 1].forEach((sign) => {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.15, 0.08), blackMat);
    pillar.position.set(CAR_LEN * 0.16, cabinBaseY + 0.5, sign * wsHalfW * 1.02);
    pillar.rotation.z = -0.58;
    car.add(pillar);
  });

  // Antenka "shark fin" na dachu
  const finGeo = new THREE.ConeGeometry(0.06, 0.16, 6);
  const fin = new THREE.Mesh(finGeo, blackMat);
  fin.rotation.z = -Math.PI / 2.4;
  fin.position.set(-CAR_LEN * 0.32, roofTop - 0.02, 0);
  car.add(fin);

  // ---------- Przód: zderzak (na PEŁNĄ wysokość nadwozia, żeby nie było
  // przerwy między progiem a maską) + spindle grill (canvas texture) ----------
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(0.3, bodyH + 0.35, CAR_WIDTH + 0.05), claddingMat);
  frontBumper.position.set(halfLen - 0.12, bodyBottom + (bodyH + 0.35) / 2 - 0.05, 0);
  car.add(frontBumper);

  const facePlateH = 1.9;
  const faceTex = makeLexusFrontTexture(CAR_WIDTH, facePlateH);
  const faceMat = new THREE.MeshToonMaterial({ map: faceTex, gradientMap: toonGradient });
  const facePlate = new THREE.Mesh(new THREE.PlaneGeometry(CAR_WIDTH, facePlateH), faceMat);
  facePlate.rotation.y = Math.PI / 2;
  facePlate.position.set(halfLen + 0.08, bodyBottom + (bodyH + 0.35) / 2 - 0.05, 0);
  car.add(facePlate);

  // ---------- Tył: zderzak (na pełną wysokość), dyfuzor, pasek LED (WYŻEJ,
  // na wysokości pasa szyb — sygnaturowy element z Twoich zdjęć), spojler ----------
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.25, CAR_WIDTH + 0.05), bodyMat);
  rearBumper.position.set(-halfLen + 0.12, bodyBottom + 0.62, 0);
  car.add(rearBumper);

  // Czarny dyfuzor dolny ze skosem (jak na zdjęciu tyłu)
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, CAR_WIDTH - 0.3), blackMat);
  diffuser.position.set(-halfLen + 0.15, bodyBottom + 0.1, 0);
  car.add(diffuser);
  // Małe, trójkątne odblaski w rogach zderzaka
  [-1, 1].forEach((sign) => {
    const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.32), rearLightMat);
    reflector.position.set(-halfLen + 0.16, bodyBottom + 0.12, sign * (halfW - 0.45));
    car.add(reflector);
  });

  // Charakterystyczny, CIĄGŁY pasek LED na całą szerokość tyłu — PODNIESIONY,
  // na wysokości dolnej krawędzi szyb (widoczny na zdjęciach 2 i 4)
  const lightBarY = cabinBottom + 0.05;
  const lightBar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, CAR_WIDTH - 0.12), rearLightMat);
  lightBar.position.set(-halfLen + 0.11, lightBarY, 0);
  car.add(lightBar);
  // Chromowana listwa tuż pod paskiem LED (jak na zdjęciu referencyjnym)
  const rearGarnish = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, CAR_WIDTH - 0.16), chromeMat);
  rearGarnish.position.set(-halfLen + 0.06, lightBarY - 0.2, 0);
  car.add(rearGarnish);
  // Grubsze "kubełki" lamp po bokach (tam gdzie pasek się poszerza w rogach,
  // lekko zawinięte na bok jak na zdjęciu)
  [-1, 1].forEach((sign) => {
    const lampPod = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.55), rearLightMat);
    lampPod.position.set(-halfLen + 0.09, lightBarY, sign * (halfW - 0.3));
    car.add(lampPod);
    const lampPodSide = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.1), rearLightMat);
    lampPodSide.position.set(-halfLen + 0.2, lightBarY, sign * (halfW - 0.06));
    car.add(lampPodSide);
  });

  // Napis/emblemat z tyłu — jasny, prostokątny akcent (bez marki/tekstu)
  const rearBadge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.4), chromeMat);
  rearBadge.position.set(-halfLen + 0.03, bodyBottom + 0.55, 0);
  car.add(rearBadge);

  // Mały spojler / listwa na krawędzi klapy bagażnika
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, CAR_WIDTH - 0.4), blackMat);
  spoiler.position.set(-halfLen + 0.55, roofTop - 0.05, 0);
  car.add(spoiler);

  // ---------- Lusterka (poziomy, opływowy kształt) ----------
  [-1, 1].forEach((sign) => {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.34), bodyMatDark);
    housing.position.set(CAR_LEN * 0.14, cabinBaseY - 0.18, sign * (halfW + 0.2));
    housing.rotation.y = sign * 0.3;
    car.add(housing);
    const mirrorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.26), chromeMat);
    mirrorGlass.position.set(CAR_LEN * 0.14 - sign * 0.09, cabinBaseY - 0.18, sign * (halfW + 0.2));
    mirrorGlass.rotation.y = sign * 0.3;
    car.add(mirrorGlass);
  });

  // ---------- Klamki drzwi — cienkie, ciemne akcenty na obu bokach ----------
  [-1, 1].forEach((sign) => {
    [0.02, -0.24].forEach((xFrac) => {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.03), blackMat);
      handle.position.set(CAR_LEN * xFrac, bodyBottom + bodyH * 0.72, sign * (halfW + 0.02));
      car.add(handle);
    });
  });

  // ---------- Koła ----------
  const wheelR = 0.75;
  const tireGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.44, 20);
  const hubGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.46, 12);
  const capGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.48, 10);
  const wheelXOff = halfLen - 1.2;
  const wheelZOff = halfW - 0.14;
  [[wheelXOff, wheelZOff], [wheelXOff, -wheelZOff], [-wheelXOff, wheelZOff], [-wheelXOff, -wheelZOff]].forEach(([x, z]) => {
    const tire = new THREE.Mesh(tireGeo, blackMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.set(x, wheelR, z);
    car.add(tire);
    const hub = new THREE.Mesh(hubGeo, chromeMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, wheelR, z);
    car.add(hub);
    const cap = new THREE.Mesh(capGeo, blackMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, wheelR, z);
    car.add(cap);
  });

  car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // Pozycja: CAŁKOWICIE wewnątrz planszy, na drodze, tuż za przerwą w
  // żywopłocie. rotation.y = 0 => lokalny przód (+X) wskazuje wschód / w
  // stronę parkingu.
  const carFrontMargin = 0.4;
  car.position.set(PLOT6_X_MIN + halfLen + carFrontMargin, 0, PLOT6_ROAD_Z_CENTER);
  car.rotation.y = 0;

  scene.add(car);

  FARM_BLOCKERS.push({
    x1: PLOT6_X_MIN - 0.6,
    x2: PLOT6_X_MIN + carFrontMargin + CAR_LEN + 0.6,
    z1: PLOT6_ROAD_Z_MIN - 0.3,
    z2: PLOT6_ROAD_Z_MAX + 0.3,
  });
}


// ============================================================================
// PLAC ZABAW: huśtawki + domek na nóżkach ze zjeżdżalnią w stronę żywopłotu
// po stronie auta. Umieszczony w rogu bliżej parkingu, w szerszym pasie trawy.
// ============================================================================
const woodMat = toonMat(PLOT6_WOOD_COLOR);
const woodMatDark = toonMat(PLOT6_WOOD_COLOR_DARK);
const slideMat = toonMat(0xFFC145);

// Buduje belkę (walec) dokładnie między dwoma punktami 3D — używane dla nóg
// stojaka, żeby wszystko było fizycznie połączone (bez "rozjechanych" brył).
function strutBetween(p1, p2, radius, mat) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const length = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(p1).addScaledVector(dir, 0.5);
  const axis = new THREE.Vector3(0, 1, 0);
  mesh.quaternion.setFromUnitVectors(axis, dir.clone().normalize());
  mesh.castShadow = true;
  return mesh;
}

function buildSwingSet(cx, cz) {
  const group = new THREE.Group();
  const apexHeight = 2.2;   // wysokość punktu, w którym schodzą się nogi stojaka
  const legBaseSpread = 0.85; // rozstaw nóg u podstawy (w osi Z)
  const frameLen = 3.0;       // odległość między dwoma stojakami (A-ramami)

  // Dwa stojaki w kształcie litery A, każdy zbudowany z dwóch nóg schodzących
  // się w jednym punkcie (apex) na górze — tam mocuje się belka.
  const apexPoints = [];
  [-frameLen / 2, frameLen / 2].forEach((xOff) => {
    const apex = new THREE.Vector3(xOff, apexHeight, 0);
    const baseA = new THREE.Vector3(xOff, 0, legBaseSpread);
    const baseB = new THREE.Vector3(xOff, 0, -legBaseSpread);
    group.add(strutBetween(apex, baseA, 0.09, woodMat));
    group.add(strutBetween(apex, baseB, 0.09, woodMat));
    // pozioma belka u podstawy (stabilizacja) — łączy obie stopy nogi
    group.add(strutBetween(baseA, baseB, 0.07, woodMatDark));
    apexPoints.push(apex);
  });

  // Górna belka łącząca oba stojaki (na niej wiszą huśtawki)
  group.add(strutBetween(apexPoints[0], apexPoints[1], 0.11, woodMat));

  // Dwie pojedyncze huśtawki (deska na łańcuchach), zawieszone na górnej belce
  [-0.85, 0.85].forEach((xOff) => {
    const seatY = apexHeight - 1.3;
    const topPoint = new THREE.Vector3(xOff, apexHeight, 0);
    [-0.16, 0.16].forEach((zOff) => {
      const seatAttach = new THREE.Vector3(xOff, seatY + 0.03, zOff);
      group.add(strutBetween(topPoint, seatAttach, 0.02, woodMatDark));
    });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.24), woodMatDark);
    seat.position.set(xOff, seatY, 0);
    seat.castShadow = true;
    group.add(seat);
  });

  group.position.set(cx, 0, cz);
  scene.add(group);

  FARM_BLOCKERS.push({
    x1: cx - frameLen / 2 - 0.3,
    x2: cx + frameLen / 2 + 0.3,
    z1: cz - legBaseSpread - 0.2,
    z2: cz + legBaseSpread + 0.2,
  });
}

function buildPlayhouse(cx, cz, slideTowardMinX) {
  const group = new THREE.Group();

  const legHeight = 1.55;
  const platformSize = 2.0;
  const wallHeight = 1.05;
  const roofHeight = 0.55;

  const legGeo = new THREE.CylinderGeometry(0.09, 0.09, legHeight, 8);
  [-1, 1].forEach((xs) => {
    [-1, 1].forEach((zs) => {
      const leg = new THREE.Mesh(legGeo, woodMat);
      leg.position.set(xs * (platformSize / 2 - 0.12), legHeight / 2, zs * (platformSize / 2 - 0.12));
      leg.castShadow = true;
      group.add(leg);
    });
  });

  const platform = new THREE.Mesh(new THREE.BoxGeometry(platformSize, 0.14, platformSize), woodMatDark);
  platform.position.set(0, legHeight + 0.07, 0);
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  const wallBaseY = legHeight + 0.14;
  const wallThickness = 0.08;

  const wallBack = new THREE.Mesh(new THREE.BoxGeometry(platformSize, wallHeight, wallThickness), woodMat);
  wallBack.position.set(0, wallBaseY + wallHeight / 2, -platformSize / 2 + wallThickness / 2);
  group.add(wallBack);

  [-1, 1].forEach((xs) => {
    const wallSide = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, platformSize), woodMat);
    wallSide.position.set(xs * (platformSize / 2 - wallThickness / 2), wallBaseY + wallHeight / 2, 0);
    group.add(wallSide);
  });

  const doorWidth = 0.7;
  const sideWallLen = (platformSize - doorWidth) / 2;
  [-1, 1].forEach((sign) => {
    const wallFrontPart = new THREE.Mesh(new THREE.BoxGeometry(sideWallLen, wallHeight, wallThickness), woodMat);
    wallFrontPart.position.set(sign * (doorWidth / 2 + sideWallLen / 2), wallBaseY + wallHeight / 2, platformSize / 2 - wallThickness / 2);
    group.add(wallFrontPart);
  });

  const window1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.02), toonMat(0xBFD9E8));
  window1.position.set(0, wallBaseY + wallHeight * 0.6, -platformSize / 2 + 0.05);
  group.add(window1);

  const roofPanelW = platformSize / 2 + 0.35;
  const roofPanelLen = Math.sqrt(roofPanelW * roofPanelW + roofHeight * roofHeight);
  const roofAngle = Math.atan2(roofHeight, roofPanelW);
  [-1, 1].forEach((sign) => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(platformSize + 0.3, 0.07, roofPanelLen), woodMatDark);
    panel.position.set(0, wallBaseY + wallHeight + roofHeight / 2, sign * (roofPanelW / 4));
    panel.rotation.x = sign * roofAngle;
    panel.castShadow = true;
    group.add(panel);
  });

  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(doorWidth, 0.12, 0.32), woodMatDark);
    step.position.set(0, 0.12 + i * 0.42, platformSize / 2 + 0.2 + (2 - i) * 0.32);
    group.add(step);
  }

  const slideDir = slideTowardMinX ? -1 : 1;
  const slideLen = 2.6;
  const slideDrop = wallBaseY - 0.1;
  const slideAngle = Math.atan2(slideDrop, slideLen);
  const slide = new THREE.Mesh(new THREE.BoxGeometry(slideLen / Math.cos(slideAngle), 0.06, 0.55), slideMat);
  slide.position.set(slideDir * (platformSize / 2 + (slideLen / 2) * Math.cos(slideAngle)), wallBaseY - (slideDrop / 2) + 0.05, 0);
  slide.rotation.z = -slideDir * slideAngle;
  slide.castShadow = true;
  group.add(slide);

  [-0.26, 0.26].forEach((zOff) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(slideLen / Math.cos(slideAngle), 0.14, 0.03), slideMat);
    rail.position.set(slideDir * (platformSize / 2 + (slideLen / 2) * Math.cos(slideAngle)), wallBaseY - (slideDrop / 2) + 0.11, zOff);
    rail.rotation.z = -slideDir * slideAngle;
    group.add(rail);
  });

  group.position.set(cx, 0, cz);
  scene.add(group);

  FARM_BLOCKERS.push({
    x1: cx - platformSize / 2 - 0.15,
    x2: cx + platformSize / 2 + 0.15,
    z1: cz - platformSize / 2 - 0.15,
    z2: cz + platformSize / 2 + 0.15,
  });
}

function addPlot6Playground() {
  // Wybór pasa trawy: odwrócony względem poprzedniej wersji (był po złej
  // stronie drogi) — teraz świadomie bierzemy przeciwny pas.
  const useStripB = PLOT6_GRASS_STRIP_B_WIDTH < PLOT6_GRASS_STRIP_A_WIDTH;
  const stripCenterZ = useStripB
    ? (PLOT6_ROAD_Z_MAX + PLAY_Z_MAX) / 2
    : (PLAY_Z_MIN + PLOT6_ROAD_Z_MIN) / 2;

  const marginFromParkingEdge = HOUSE_LENGTH / 2; // ślepa ściana (GARAŻ) dotyka dokładnie granicy z parkingiem
  const houseX = PLOT6_X_MAX - marginFromParkingEdge;

  // Zjeżdżalnia domku wychodzi w stronę zachodniego żywopłotu (mniejsze X,
  // strona auta) — więc huśtawki stawiamy po PRZECIWNEJ stronie domku
  // (w stronę parkingu, większe X), żeby zjeżdżalnia w nie nie "wjeżdżała".
  // Odstęp dobrany tak, żeby huśtawki mieściły się w granicach planszy
  // (nie wchodziły na teren parkingu) i nie stykały się z domkiem.
  const swingX = houseX + 3.5;

  buildPlayhouse(houseX, stripCenterZ, true);
  buildSwingSet(swingX, stripCenterZ);
}


// ============================================================================
// ŻÓŁTY DOM — po przeciwnej stronie drogi niż plac zabaw, z odstępem trawy
// od drogi, blisko krańca planszy od strony parkingu (tak jak w inspiracji).
// ============================================================================
// UWAGA: ta sekcja PONOWNIE WYKORZYSTUJE dwie funkcje pomocnicze, które już
// istnieją w game.js (użyte przy budynku na plansza-4) — NIE trzeba ich
// definiować drugi raz, o ile ten plik jest wklejony PO ich deklaracji:
//   - createGableWing(width, length, wallHeight, pitchDeg, wallColor, roofColor, doorSize)
//   - createLeanToWing(width, length, innerHeight, pitchDeg, wallColor, roofColor, innerSide, doorSize)
// (Jeśli testujesz TYLKO ten plik w oderwaniu od game.js — np. we własnym
// podglądzie HTML — dopisz kopie tych dwóch funkcji przed wczytaniem tego pliku.)
//
// Kształt dachu: dwa bliźniacze szczyty (dwuspadowe "skrzydła" side-by-side,
// każde z własną kalenicą wzdłuż osi Z) — dają charakterystyczny, złamany
// dach z podwójnym trójkątem widoczny od frontu/tyłu, tak jak na zdjęciu
// inspiracji. Dodatkowo mniejsza, niższa dobudówka z boku (jednospadowy dach).

// Kształt dachu (poprawiony po szkicach): JEDNA, ciągła kalenica na stałej
// wysokości, biegnąca przez całą długość budynku (długa oś = Z, "w głąb"
// działki, od strony drogi). Od strony drogi budynek kończy się dużym
// naczółkiem/facjatą sięgającą PEŁNEJ wysokości tej kalenicy (to zwykły
// gable-end elongowanej bryły — createGableWing daje to "za darmo"). Po
// obu bokach głównej połaci wystają mniejsze, niższe lukarny (po 3 z każdej
// strony, symetrycznie) — budowane jako osobne, małe "skrzydła" doczepione
// prostopadle do głównej kalenicy.

const HOUSE_WIDTH = 10;          // szerokość (w poprzek kalenicy, oś X)
const HOUSE_LENGTH = 19;         // długość (wzdłuż kalenicy, oś Z — "w głąb" od drogi)
const HOUSE_WALL_HEIGHT = 7.5 * 0.75; // obniżone o 25% na życzenie (dach/lukarny bez zmian kształtu)
const HOUSE_PITCH_DEG = 30;      // stromy, "mieszkalny" dach
const HOUSE_WALL_COLOR = 0xE8C34A; // żółty
const HOUSE_ROOF_COLOR = 0x9C3A2C; // czerwono-bordowy dach
const HOUSE_FOUNDATION_H = 0.5;    // niski, betonowy cokół pod całym domem

const DORMER_WIDTH = 2.4;   // szerokość MAŁYCH lukarn (rozmiar bez zmian)
const DORMER_PROJECTION = 4.6;        // WYDŁUŻONA kalenica lukarny — wchodzi teraz głęboko w połać główną
                                       // (front i tak zawsze wypadnie dokładnie na ścianie — patrz wzór niżej)
const DORMER_WALL_HEIGHT = 2.6 * 0.75; // ścianki obniżone o 25% (daszek/kąt bez zmian)
const DORMER_PITCH_DEG = 32;
// Dwie MAŁE lukarny — przesunięte głębiej w stronę tylnej (krótszej) ściany
// (dalej od frontu niż poprzednio), odstęp między nimi zachowany (4.5, tak
// jak było: 1.0 i -3.5 -> teraz -2.0 i -6.5).
const SMALL_DORMER_Z_POSITIONS = [-2.0, -6.5];

// Duża, POPRZECZNA kalenica na całą szerokość budynku (zamiast dwóch
// osobnych "wypustek" po bokach) — krzyżuje się z główną kalenicą dokładnie
// w miejscu, gdzie ta jest teraz skrócona (CROSS_RIDGE_Z).
const CROSS_RIDGE_Z = 6.0;           // gdzie kalenica główna się kończy / kalenica poprzeczna krzyżuje
const CROSS_GABLE_PITCH_DEG = HOUSE_PITCH_DEG; // ten sam kąt co główny dach — czyste połączenie kalenic
const CROSS_GABLE_OVERHANG = 1.0;    // ile wystaje poza boczne ściany (okap), po 0.5 na stronę

function buildYellowHouse() {
  const group = new THREE.Group();

  // ---------- Fundament / cokół ----------
  const foundationMat = toonMat(0xC7C6C0);
  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(HOUSE_WIDTH + 0.4, HOUSE_FOUNDATION_H, HOUSE_LENGTH + 0.4),
    foundationMat
  );
  foundation.position.set(0, HOUSE_FOUNDATION_H / 2, 0);
  foundation.receiveShadow = true;
  foundation.castShadow = true;
  group.add(foundation);

  const houseBody = new THREE.Group();
  houseBody.position.y = HOUSE_FOUNDATION_H;
  group.add(houseBody);

  // ---------- Główna bryła: kalenica SKRÓCONA — kończy się dokładnie w
  // miejscu, gdzie krzyżuje się z poprzeczną kalenicą (CROSS_RIDGE_Z), a NIE
  // sięga już do samego frontu. Front budynku (od strony drogi) przejmuje
  // teraz poprzeczna kalenica (patrz niżej). ----------
  const mainWingLength = CROSS_RIDGE_Z + HOUSE_LENGTH / 2; // od tyłu (-L/2) do punktu przecięcia
  const mainWingCenterZ = (CROSS_RIDGE_Z - HOUSE_LENGTH / 2) / 2;
  const mainWing = createGableWing(HOUSE_WIDTH, mainWingLength, HOUSE_WALL_HEIGHT, HOUSE_PITCH_DEG, HOUSE_WALL_COLOR, HOUSE_ROOF_COLOR, null);
  mainWing.position.z = mainWingCenterZ;
  houseBody.add(mainWing);

  const eaveY = HOUSE_WALL_HEIGHT;
  const mainRise = (HOUSE_WIDTH / 2) * Math.tan(HOUSE_PITCH_DEG * Math.PI / 180);
  const mainRidgeY = eaveY + mainRise;

  // ---------- Dwie MAŁE lukarny — front (ścianka zewnętrzna, ta widoczna)
  // zlicowany dokładnie ze ścianą domu (nie wystaje na zewnątrz), a kalenica
  // wydłużona w głąb, żeby realnie wchodziła w główną połać. ----------
  SMALL_DORMER_Z_POSITIONS.forEach((z0) => {
    [-1, 1].forEach((side) => {
      const dormer = createGableWing(DORMER_WIDTH, DORMER_PROJECTION, DORMER_WALL_HEIGHT, DORMER_PITCH_DEG, HOUSE_WALL_COLOR, HOUSE_ROOF_COLOR, null);
      dormer.rotation.y = Math.PI / 2;
      // Front lukarny (zewnętrzny gable-end) ma wypaść dokładnie na linii
      // ściany (side*HOUSE_WIDTH/2). Ponieważ gable-end po rotacji siedzi
      // przy world x = position.x + side*(DORMER_PROJECTION/2), środek
      // lukarny cofamy o połowę projekcji względem linii ściany.
      const dormerX = side * (HOUSE_WIDTH / 2 - DORMER_PROJECTION / 2);
      dormer.position.set(dormerX, eaveY, z0);
      houseBody.add(dormer);

      // Standardowe okno na froncie lukarny — brązowa rama + błękitna szyba.
      // Dodane jako dziecko `dormer`, w TYM SAMYM lokalnym układzie co
      // wewnętrzny gable-end (z = +DORMER_PROJECTION/2), więc automatycznie
      // dziedziczy obrót całej lukarny (nie trzeba nic dodatkowo liczyć).
      const winW = DORMER_WIDTH * 0.5, winH = DORMER_WALL_HEIGHT * 0.55;
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), new THREE.MeshToonMaterial({ color: 0x6B4A2F, gradientMap: toonGradient, side: THREE.DoubleSide }));
      frame.position.set(0, DORMER_WALL_HEIGHT * 0.5, side * (DORMER_PROJECTION / 2 + 0.02));
      dormer.add(frame);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW * 0.8, winH * 0.8), new THREE.MeshToonMaterial({ color: 0x9FD3E8, gradientMap: toonGradient, side: THREE.DoubleSide }));
      glass.position.set(0, DORMER_WALL_HEIGHT * 0.5, side * (DORMER_PROJECTION / 2 + 0.03));
      dormer.add(glass);
    });
  });

  // ---------- Dobudowana ściana pod dużą, poprzeczną kalenicą ----------
  // Gdy skróciliśmy główną bryłę do CROSS_RIDGE_Z, fragment budynku od tego
  // punktu aż do frontu (+HOUSE_LENGTH/2) został bez ścian pod dachem —
  // dach "wisiał" w powietrzu. Domykamy tę przestrzeń pełnowymiarową ścianą
  // (taka sama wysokość jak reszta budynku), nie ruszając samych lukarn/dachu.
  const frontFillLen = HOUSE_LENGTH / 2 - CROSS_RIDGE_Z;
  const frontFillWall = new THREE.Mesh(
    new THREE.BoxGeometry(HOUSE_WIDTH, HOUSE_WALL_HEIGHT, frontFillLen),
    toonMat(HOUSE_WALL_COLOR)
  );
  frontFillWall.position.set(0, HOUSE_WALL_HEIGHT / 2, CROSS_RIDGE_Z + frontFillLen / 2);
  frontFillWall.castShadow = true;
  frontFillWall.receiveShadow = true;
  houseBody.add(frontFillWall);

  // ---------- Poprzeczna kalenica (dawne "duże lukarny" połączone w jedną
  // ciągłą całość na pełną szerokość budynku) — jej własna kalenica
  // krzyżuje się z główną DOKŁADNIE na wysokości mainRidgeY, w punkcie
  // CROSS_RIDGE_Z. Sięga od tego punktu aż po front budynku (+HOUSE_LENGTH/2),
  // czyli to ONA tworzy duży trójkąt widoczny od strony drogi. ----------
  const crossReach = HOUSE_LENGTH / 2 - CROSS_RIDGE_Z; // jak daleko do przodu (od punktu przecięcia do frontu)
  const crossGableWidthParam = crossReach * 2;          // symetryczny gable — tyle samo "do tyłu" (nakłada się na główny dach, bez znaczenia wizualnie)
  const crossHalfW = crossGableWidthParam / 2;
  const crossRise = crossHalfW * Math.tan(CROSS_GABLE_PITCH_DEG * Math.PI / 180);
  const crossWallHeight = Math.max(0.3, mainRidgeY - eaveY - crossRise); // tak, żeby kalenica trafiła dokładnie w mainRidgeY

  const crossGable = createGableWing(
    crossGableWidthParam,
    HOUSE_WIDTH + CROSS_GABLE_OVERHANG,
    crossWallHeight,
    CROSS_GABLE_PITCH_DEG,
    HOUSE_WALL_COLOR,
    HOUSE_ROOF_COLOR,
    null
  );
  crossGable.rotation.y = Math.PI / 2; // kalenica poprzeczna: teraz biegnie wzdłuż światowego X (w poprzek budynku)
  crossGable.position.set(0, eaveY, CROSS_RIDGE_Z);
  houseBody.add(crossGable);

  // ---------- Panele fotowoltaiczne na przedniej połaci (ta od strony drogi) ----------
  // Dodane jako dzieci `crossGable`, w JEGO lokalnym układzie WEWNĘTRZNYM
  // (przed jego własną rotacją o 90°) — czyli dokładnie tak jak roofLeft w
  // createGableWing: lokalny x ujemny = ta połać, po rotacji trafia do przodu.
  const pvPitchRad = CROSS_GABLE_PITCH_DEG * Math.PI / 180;
  const pvMat = toonMat(0x1B2A4A);
  const pvFrameMat = toonMat(0x7A7A7A);
  const pvCols = 4, pvRows = 2;
  const pvMarginT = 0.14; // margines od kalenicy i okapu (ułamek 0..1 długości połaci)
  const pvSpanZ = (HOUSE_WIDTH + CROSS_GABLE_OVERHANG) * 0.62; // ile z szerokości zajmuje pole paneli
  for (let r = 0; r < pvRows; r++) {
    const t = pvMarginT + (r + 0.5) / pvRows * (1 - 2 * pvMarginT);
    const px = -t * crossHalfW;               // wzdłuż połaci: 0=kalenica, -crossHalfW=okap
    const py = crossWallHeight + crossRise * (1 - t) + 0.05; // mały offset nad połacią
    for (let c = 0; c < pvCols; c++) {
      const cz = (c + 0.5) / pvCols * pvSpanZ - pvSpanZ / 2;
      const panelW = crossRise > 0 ? (crossHalfW * (1 - 2 * pvMarginT) / pvRows) * 0.85 : 0.8;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.04, pvSpanZ / pvCols - 0.06), pvMat);
      panel.position.set(px, py, cz);
      panel.rotation.z = pvPitchRad;
      crossGable.add(panel);
    }
  }
  // cienka, jasna ramka wokół całego pola paneli (kosmetyka)
  const pvFieldFrame = new THREE.Mesh(
    new THREE.BoxGeometry(crossHalfW * (1 - 2 * pvMarginT) + 0.1, 0.02, pvSpanZ + 0.1),
    pvFrameMat
  );
  pvFieldFrame.position.set(-0.5 * crossHalfW, crossWallHeight + crossRise * 0.5 - 0.02, 0);
  pvFieldFrame.rotation.z = pvPitchRad;
  crossGable.add(pvFieldFrame);

  // Ściany pod wystającym okapem dużej kalenicy poprzecznej — ta wystaje
  // (CROSS_GABLE_OVERHANG) poza szerokość głównej bryły (HOUSE_WIDTH), więc
  // ten pasek okapu wisiał w powietrzu bez ściany pod spodem. Dobudowujemy
  // wąskie "płetwy" ścienne dokładnie pod całym zasięgiem tej kalenicy
  // (nie ruszając samej lukarny/dachu).
  const overhangFinWidth = CROSS_GABLE_OVERHANG / 2;
  const overhangSpanZ = crossGableWidthParam; // pełny zasięg kalenicy poprzecznej wzdłuż Z
  [-1, 1].forEach((side) => {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(overhangFinWidth, HOUSE_WALL_HEIGHT, overhangSpanZ),
      toonMat(HOUSE_WALL_COLOR)
    );
    fin.position.set(side * (HOUSE_WIDTH / 2 + overhangFinWidth / 2), HOUSE_WALL_HEIGHT / 2, CROSS_RIDGE_Z);
    fin.castShadow = true;
    fin.receiveShadow = true;
    houseBody.add(fin);
  });

  // Schodki przy wejściu — usunięte na życzenie (portyk niżej ma własne).

  // ---------- Portyk przy wejściu: dach dwuspadowy, szare słupy, żółta
  // ścianka szczytowa (jak dom), szare schody na 3 otwartych bokach ----------
  (function buildPorch() {
    const pWidth = 3.6;   // rozstaw słupów / szerokość dachu (lokalnie oś X)
    const pDepth = 2.6;   // jak daleko portyk wystaje od ściany (lokalnie oś Z)
    const pEaveH = 3.1;
    const pPitchDeg = 26;
    const halfW = pWidth / 2;
    const pitchRad = pPitchDeg * Math.PI / 180;
    const rise = halfW * Math.tan(pitchRad);
    const slopeLen = Math.sqrt(halfW * halfW + rise * rise);

    const postMat = toonMat(0x9A9A94);
    const stepMat = toonMat(0xB7B6B0);
    const roofMat = toonMat(HOUSE_ROOF_COLOR);
    const gableMat = new THREE.MeshToonMaterial({ color: HOUSE_WALL_COLOR, gradientMap: toonGradient, side: THREE.DoubleSide });

    const porch = new THREE.Group();

    // Słupy — tylko 2, na zewnętrznym końcu (tam gdzie zaczynają się schody)
    const postGeo = new THREE.CylinderGeometry(0.13, 0.13, pEaveH, 10);
    const outerPz = pDepth / 2 - 0.3;
    [-1, 1].forEach((xs) => {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(xs * (halfW - 0.2), pEaveH / 2, outerPz);
      post.castShadow = true;
      porch.add(post);
    });

    // Dach dwuspadowy — ta sama matematyka co przy głównym dachu (createGableWing)
    const roofGeo = new THREE.BoxGeometry(slopeLen, 0.08, pDepth + 0.5);
    const roofLeft = new THREE.Mesh(roofGeo, roofMat);
    roofLeft.position.set(-halfW / 2, pEaveH + rise / 2, 0);
    roofLeft.rotation.z = pitchRad;
    roofLeft.castShadow = true;
    porch.add(roofLeft);
    const roofRight = new THREE.Mesh(roofGeo, roofMat);
    roofRight.position.set(halfW / 2, pEaveH + rise / 2, 0);
    roofRight.rotation.z = -pitchRad;
    roofRight.castShadow = true;
    porch.add(roofRight);

    // Szczytowa ścianka (żółta, jak dom) na zewnętrznym, widocznym końcu
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-halfW, 0);
    gableShape.lineTo(halfW, 0);
    gableShape.lineTo(0, rise);
    gableShape.lineTo(-halfW, 0);
    const gableFront = new THREE.Mesh(new THREE.ShapeGeometry(gableShape), gableMat);
    gableFront.position.set(0, pEaveH, pDepth / 2);
    gableFront.castShadow = true;
    porch.add(gableFront);

    // Schodki (szare) na 3 otwartych bokach — od gruntu (lokalnie
    // y = -HOUSE_FOUNDATION_H) do poziomu podłogi portyku (y=0)
    const stepCount = 3, stepDepth = 0.4, stepH = HOUSE_FOUNDATION_H / stepCount;
    function addStepRow(getPos, getGeo) {
      for (let i = 0; i < stepCount; i++) {
        const step = new THREE.Mesh(getGeo(), stepMat);
        step.position.copy(getPos(i));
        step.castShadow = true;
        step.receiveShadow = true;
        porch.add(step);
      }
    }
    // Przód (zewnętrzny, otwarty koniec)
    addStepRow(
      (i) => new THREE.Vector3(0, -HOUSE_FOUNDATION_H + stepH * (i + 0.5), pDepth / 2 + 0.2 + (stepCount - i - 0.5) * stepDepth),
      () => new THREE.BoxGeometry(pWidth - 0.4, stepH, stepDepth)
    );
    // Lewy bok
    addStepRow(
      (i) => new THREE.Vector3(-halfW - 0.2 - (stepCount - i - 0.5) * stepDepth, -HOUSE_FOUNDATION_H + stepH * (i + 0.5), 0),
      () => new THREE.BoxGeometry(stepDepth, stepH, pDepth - 0.4)
    );
    // Prawy bok
    addStepRow(
      (i) => new THREE.Vector3(halfW + 0.2 + (stepCount - i - 0.5) * stepDepth, -HOUSE_FOUNDATION_H + stepH * (i + 0.5), 0),
      () => new THREE.BoxGeometry(stepDepth, stepH, pDepth - 0.4)
    );

    // Płaski, szary spocznik łączący wszystkie 3 schody w jedną całość
    const sideReach = stepCount * stepDepth + 0.2;
    const landingW = pWidth + 2 * sideReach;
    const landingD = pDepth + sideReach + 0.2;
    const landing = new THREE.Mesh(new THREE.BoxGeometry(landingW, 0.1, landingD), stepMat);
    landing.position.set(0, -HOUSE_FOUNDATION_H + 0.05, -pDepth / 2 + landingD / 2);
    landing.receiveShadow = true;
    landing.castShadow = true;
    porch.add(landing);

    // Rzutuje portyk na zewnątrz ściany (lokalny Z -> światowy X po tej rotacji).
    // Wewnętrzny koniec (przy ścianie) ląduje dokładnie na linii ściany domu.
    porch.rotation.y = Math.PI / 2;
    porch.position.set(HOUSE_WIDTH / 2 + pDepth / 2 + 0.3, 0, 4.4);
    houseBody.add(porch);
  })();

  // ---------- Drzwi wejściowe — brązowe, pojedyncze, na środku ściany pod
  // portykiem. Pełna bryła 3D (nie płaszczyzna) + jasna rama + klamka —
  // maksymalnie odporne na jakiekolwiek problemy z widocznością/normalną. ----------
  const doorFrameMat = toonMat(0xEDE6D6);
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.25, 1.05), doorFrameMat);
  doorFrame.position.set(HOUSE_WIDTH / 2 + 0.58, 1.13, 4.4);
  doorFrame.castShadow = true;
  houseBody.add(doorFrame);

  const doorMat = toonMat(0x6B4A2F);
  const frontDoor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.05, 0.9), doorMat);
  frontDoor.position.set(HOUSE_WIDTH / 2 + 0.67, 1.05, 4.4);
  frontDoor.castShadow = true;
  houseBody.add(frontDoor);

  const doorHandleMat = toonMat(0xD9C24A);
  const doorHandle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), doorHandleMat);
  doorHandle.position.set(HOUSE_WIDTH / 2 + 0.73, 1.0, 4.4 + 0.32);
  houseBody.add(doorHandle);

  // ---------- Pomocnicza funkcja: standardowe okno wprost na ścianie
  // (brązowa rama + błękitna szyba, DoubleSide — widoczne z obu stron) ----------
  function addWallWindow(px, pz, w, h, y) {
    const frameMat = new THREE.MeshToonMaterial({ color: 0x6B4A2F, gradientMap: toonGradient, side: THREE.DoubleSide });
    const glassMat = new THREE.MeshToonMaterial({ color: 0x9FD3E8, gradientMap: toonGradient, side: THREE.DoubleSide });
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(w, h), frameMat);
    frame.rotation.y = Math.PI / 2;
    frame.position.set(px, y, pz);
    houseBody.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, h * 0.8), glassMat);
    glass.rotation.y = Math.PI / 2;
    glass.position.set(px + (px > 0 ? 0.01 : -0.01), y, pz);
    houseBody.add(glass);
  }

  // Dwa okna na ścianie frontowej (ta dobudowana pod dużą lukarną) — po
  // jednym na każdej z dwóch długich ścian, na wysokości parteru
  addWallWindow(HOUSE_WIDTH / 2 + 0.55, CROSS_RIDGE_Z + frontFillLen / 2, 1.4, 1.7, 1.7);
  const bigLukarnaWallStart = CROSS_RIDGE_Z;
  const winGap = (frontFillLen - 2 * 1.4) / 3;
  const win2Z = bigLukarnaWallStart + frontFillLen - winGap - 0.7; // przy narożniku (front) — zostaje bez zmian
  const win1Z = win2Z - 1.4 - winGap * 9;                           // odstęp zwiększony o połowę obecnej odległości
  addWallWindow(-(HOUSE_WIDTH / 2 + 0.55), win1Z, 1.4, 1.7, 1.7);
  addWallWindow(-(HOUSE_WIDTH / 2 + 0.55), win2Z, 1.4, 1.7, 1.7);

  // Dwa okna centralnie pod małymi lukarnami (na wysokości parteru, ta sama
  // ściana co portyk/drzwi)
  SMALL_DORMER_Z_POSITIONS.forEach((z0) => {
    addWallWindow(HOUSE_WIDTH / 2 + 0.02, z0, 1.4, 1.7, 1.7);
  });

  // Dodatkowe okno na dużej lukarnie (ta sama ściana frontowa, inne miejsce
  // wzdłuż niej niż istniejące dwa okna)
  addWallWindow(HOUSE_WIDTH / 2 + 0.55, HOUSE_LENGTH / 2 - 2.0, 1.4, 1.7, 1.7);

  // Dwa symetryczne okna na krótkiej ścianie od strony drogi (front budynku,
  // z=HOUSE_LENGTH/2 — czołowa ściana frontFillWall), te same wymiary co
  // pozostałe okna. Ta ściana "patrzy" wprost w Z, więc bez obrotu 90°.
  function addFrontFacingWindow(px, pz, w, h, y) {
    const frameMat = new THREE.MeshToonMaterial({ color: 0x6B4A2F, gradientMap: toonGradient, side: THREE.DoubleSide });
    const glassMat = new THREE.MeshToonMaterial({ color: 0x9FD3E8, gradientMap: toonGradient, side: THREE.DoubleSide });
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(w, h), frameMat);
    frame.position.set(px, y, pz);
    houseBody.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, h * 0.8), glassMat);
    glass.position.set(px, y, pz + 0.01);
    houseBody.add(glass);
  }
  [-1, 1].forEach((side) => {
    addFrontFacingWindow(side * (HOUSE_WIDTH / 4), HOUSE_LENGTH / 2 + 0.02, 1.4, 1.7, 1.7);
  });

  // Okno na ścianie od strony drabiny, pod skrajną (od strony parkingu,
  // czyli bliższą frontowi) małą lukarną — SMALL_DORMER_Z_POSITIONS[0] = -2.0
  addWallWindow(-(HOUSE_WIDTH / 2 + 0.02), SMALL_DORMER_Z_POSITIONS[0], 1.4, 1.7, 1.7);
  // Identyczne okno przy DRUGIEJ skrajnej (dalszej, bliżej tyłu) małej
  // lukarnie — SMALL_DORMER_Z_POSITIONS[1] = -6.5, ta sama, długa ściana
  addWallWindow(-(HOUSE_WIDTH / 2 + 0.02), SMALL_DORMER_Z_POSITIONS[1], 1.4, 1.7, 1.7);

  // ---------- Drabina — ciemnoszara, oparta ukośnie o DŁUGĄ ścianę (tę
  // PRZECIWNĄ do portyku), prowadząca do środkowej z małych lukarn ----------
  const ladderMat = toonMat(0x4A4A4A);
  const longWallX = -(HOUSE_WIDTH / 2); // przeciwna strona niż portyk (który jest na +HOUSE_WIDTH/2)
  const ladderTargetZ = -2.0;           // pozycja "środkowej" małej lukarny (SMALL_DORMER_Z_POSITIONS[0])
  const ladderTopY = eaveY * 0.85;
  const ladderBaseX = longWallX - 1.6;  // podstawa drabiny wysunięta na zewnątrz od ściany
  const ladderBottomLeft = new THREE.Vector3(ladderBaseX, -HOUSE_FOUNDATION_H, ladderTargetZ - 0.25);
  const ladderBottomRight = new THREE.Vector3(ladderBaseX, -HOUSE_FOUNDATION_H, ladderTargetZ + 0.25);
  const ladderTopLeft = new THREE.Vector3(longWallX - 0.05, ladderTopY, ladderTargetZ - 0.2);
  const ladderTopRight = new THREE.Vector3(longWallX - 0.05, ladderTopY, ladderTargetZ + 0.2);
  houseBody.add(strutBetween(ladderBottomLeft, ladderTopLeft, 0.05, ladderMat));
  houseBody.add(strutBetween(ladderBottomRight, ladderTopRight, 0.05, ladderMat));
  const ladderRungs = 7;
  for (let i = 1; i < ladderRungs; i++) {
    const t = i / ladderRungs;
    const rungL = new THREE.Vector3().lerpVectors(ladderBottomLeft, ladderTopLeft, t);
    const rungR = new THREE.Vector3().lerpVectors(ladderBottomRight, ladderTopRight, t);
    houseBody.add(strutBetween(rungL, rungR, 0.03, ladderMat));
  }

  // ---------- Taras — niski, szary podest, na TEJ SAMEJ (długiej) ścianie co
  // drabina, ale rozciągnięty wzdłuż DUŻEJ, poprzecznej lukarny (nie małych) ----------
  const deckHeight = 0.35;
  const deckMat = toonMat(0xB7B6B0);
  const deckMargin = 0.5;
  const deckZMin = ladderTargetZ + 0.8; // wydłużony w stronę drabiny — kończy się tuż przed nią
  const deckZMax = HOUSE_LENGTH / 2 - deckMargin;             // front budynku
  const deckLen = deckZMax - deckZMin;
  const deckCenterZ = (deckZMin + deckZMax) / 2;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4, deckHeight, deckLen), deckMat);
  deck.position.set(longWallX - 2.5, -HOUSE_FOUNDATION_H + deckHeight / 2, deckCenterZ);
  deck.castShadow = true;
  deck.receiveShadow = true;
  houseBody.add(deck);

  // ---------- Drzwi tarasowe — podwójne, przeszklone, blisko jednego końca
  // tarasu, w długiej ścianie, wychodzące na taras ----------
  const patioDoorMat = toonMat(0x6B4A2F);
  const patioGlassMat = new THREE.MeshToonMaterial({ color: 0x9FD3E8, gradientMap: toonGradient, side: THREE.DoubleSide });
  const patioDoorZ = deckZMin + 1.4;
  [-1, 1].forEach((leaf) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 0.85), patioDoorMat);
    frame.position.set(longWallX - 0.08, 1.05, patioDoorZ + leaf * 0.44);
    houseBody.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 1.8), patioGlassMat);
    glass.rotation.y = Math.PI / 2;
    glass.position.set(longWallX - 0.19, 1.15, patioDoorZ + leaf * 0.44);
    houseBody.add(glass);
  });

  // ---------- Grill gazowy — stojący na tarasie, równolegle do długiej ściany ----------
  const grillBodyMat = toonMat(0x3A3A3A);
  const grillLidMat = toonMat(0x555555);
  const grillLegMat = toonMat(0x222222);
  const grillZ = patioDoorZ; // naprzeciw drzwi tarasowych
  const grillX = longWallX - 3.3;
  const grillGroup = new THREE.Group();
  const grillBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 1.1), grillBodyMat);
  grillBody.position.set(0, 0.75, 0);
  grillGroup.add(grillBody);
  const grillLid = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 12, 1, false, 0, Math.PI), grillLidMat);
  grillLid.rotation.z = Math.PI / 2;
  grillLid.position.set(0, 1.02, 0);
  grillGroup.add(grillLid);
  const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.72, 6);
  [[-0.22, -0.45], [-0.22, 0.45], [0.22, -0.45], [0.22, 0.45]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(legGeo, grillLegMat);
    leg.position.set(lx, 0.36, lz);
    grillGroup.add(leg);
  });
  const sideTable = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 1.0), grillLidMat);
  sideTable.position.set(0.42, 0.78, 0);
  grillGroup.add(sideTable);
  grillGroup.position.set(grillX, deckHeight, grillZ);
  // Bez dodatkowego obrotu: dłuższy bok grilla (1.1, lokalna oś Z) jest już
  // równoległy do długiej ściany domu (ona też biegnie wzdłuż osi Z).
  houseBody.add(grillGroup);

  // ---------- Napis "GARAŻ" na ślepej, tylnej ścianie (bez okien) — tam,
  // gdzie ma się docelowo połączyć garaż z istniejącej gry ----------
  function makeGarageSignTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#3B2E22';
    ctx.font = 'bold 96px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GARAŻ', c.width / 2, c.height / 2 + 6);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }
  const garageSignTex = makeGarageSignTexture();
  const garageSignMat = new THREE.MeshBasicMaterial({ map: garageSignTex, transparent: true, side: THREE.DoubleSide });
  const garageSign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.4), garageSignMat);
  garageSign.rotation.y = Math.PI; // ściana tylna (z = -HOUSE_LENGTH/2) patrzy w -Z
  garageSign.position.set(0, HOUSE_WALL_HEIGHT * 0.55, -HOUSE_LENGTH / 2 - 0.02);
  houseBody.add(garageSign);

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // ---------- Pozycja na planszy 6 ----------
  // Budynek obrócony dodatkowo o 90° (na życzenie) — po tym obrocie to
  // HOUSE_WIDTH (a nie HOUSE_LENGTH) biegnie wzdłuż osi Z, czyli to ona
  // decyduje o odległości od drogi. Dalej blisko drogi, ale z tym samym
  // odstępem trawy co wcześniej (nie "przy samej", jak na zdjęciu satelitarnym).
  const HOUSE_EXTRA_ROTATION = Math.PI / 2;

  const houseUsesStripB = PLOT6_GRASS_STRIP_B_WIDTH < PLOT6_GRASS_STRIP_A_WIDTH; // plac zabaw jest w tym pasie...
  const grassGapFromRoad = 2.5;
  const houseNearRoadZ = houseUsesStripB
    ? PLOT6_ROAD_Z_MIN - grassGapFromRoad
    : PLOT6_ROAD_Z_MAX + grassGapFromRoad;
  const houseCenterZ = houseUsesStripB
    ? houseNearRoadZ - HOUSE_WIDTH / 2
    : houseNearRoadZ + HOUSE_WIDTH / 2;

  const houseMarginFromParkingEdge = 12;
  const houseCenterX = PLOT6_X_MAX - houseMarginFromParkingEdge;

  group.position.set(houseCenterX, 0, houseCenterZ);
  group.rotation.y = (houseUsesStripB ? 0 : Math.PI) + HOUSE_EXTRA_ROTATION + Math.PI;
  scene.add(group);

  // ---------- Czerwona linia połączenia — dziecko houseBody (ta sama
  // lokalna współrzędna Z co ściana = zero przerwy między linią a ścianą).
  // KLUCZOWE: pozycja wzdłuż lokalnego X przesunięta o (PLAY_Z_CENTER -
  // houseCenterZ) — to jedyny sposób, żeby środek linii, po przeliczeniu
  // przez obrót domu, wypadł DOKŁADNIE na środku CAŁEJ planszy (a nie na
  // środku samego domu, jak poprzednio — stąd offset względem żywopłotów
  // widoczny na screenie). Dom, jego pozycja i wszystko inne — bez zmian. ----------
  const connectionLineLen = PLAY_Z_MAX - PLAY_Z_MIN;
  const connectionLine = new THREE.Mesh(
    new THREE.BoxGeometry(connectionLineLen, 0.25, 0.15),
    toonMat(0xE01E1E)
  );
  connectionLine.position.set(PLAY_Z_CENTER - houseCenterZ, 0.15 - HOUSE_FOUNDATION_H, -HOUSE_LENGTH / 2 - 0.03);
  connectionLine.castShadow = true;
  houseBody.add(connectionLine);

  // Mała odnoga drogi/dojście do domu — usunięta na życzenie.

  // ---------- Kolizja: główna bryła — po obrocie o 90° osie X/Z się
  // zamieniają (HOUSE_LENGTH biegnie teraz wzdłuż X, HOUSE_WIDTH wzdłuż Z) ----------
  const bx = houseCenterX, bz = houseCenterZ;
  FARM_BLOCKERS.push({
    x1: bx - HOUSE_LENGTH / 2,
    x2: bx + HOUSE_LENGTH / 2,
    z1: bz - HOUSE_WIDTH / 2 - 1.2,
    z2: bz + HOUSE_WIDTH / 2 + 1.2,
  });
}


// ============================================================================
// DRZEWA LIŚCIASTE — generyczny budowniczy: pień + kilka nakładających się
// kul korony (dla bogatszego, mniej "kulkowego" wyglądu niż pojedyncza sfera).
// ============================================================================
function buildDeciduousTree(x, z, trunkHeight, trunkRadius, canopyDefs) {
  const group = new THREE.Group();
  const trunkMat = toonMat(0x6B4A2F);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkRadius * 0.68, trunkRadius, trunkHeight, 8), trunkMat);
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const canopyMatDark = toonMat(0x3E7A28);
  const canopyMatLight = toonMat(0x5FAE3E);
  canopyDefs.forEach((c, i) => {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(c.r, 10, 8),
      i % 2 === 0 ? canopyMatDark : canopyMatLight
    );
    sphere.position.set(c.x || 0, trunkHeight + (c.y || 0), c.z || 0);
    sphere.castShadow = true;
    group.add(sphere);
  });

  group.position.set(x, 0, z);
  scene.add(group);

  FARM_BLOCKERS.push({
    x1: x - trunkRadius * 1.6, x2: x + trunkRadius * 1.6,
    z1: z - trunkRadius * 1.6, z2: z + trunkRadius * 1.6,
  });
}

function addPlot6Trees() {
  // Środki dwóch pasów trawy (te same, których używają dom i plac zabaw) —
  // dom siedzi w pasie "A" (bliżej PLAY_Z_MIN), plac zabaw w pasie "B"
  // (bliżej PLAY_Z_MAX) — patrz buildYellowHouse / addPlot6Playground.
  const stripZ_houseSide = (PLAY_Z_MIN + PLOT6_ROAD_Z_MIN) / 2;
  const stripZ_playgroundSide = (PLOT6_ROAD_Z_MAX + PLAY_Z_MAX) / 2;

  // Duże, rozłożyste drzewo z bogatą koroną — po stronie domu, między domem
  // a samochodem (czerwony prostokąt na mapce)
  buildDeciduousTree(
    PLOT6_X_MAX - 0.89 * PLOT6_WIDTH, stripZ_houseSide,
    5.0, 0.45,
    [
      { r: 3.4, y: 1.0, x: 0, z: 0 },
      { r: 2.6, y: 1.8, x: 1.8, z: 1.0 },
      { r: 2.6, y: 1.6, x: -1.8, z: -0.8 },
      { r: 2.3, y: 2.6, x: 0.4, z: -1.6 },
      { r: 2.3, y: 2.4, x: -1.2, z: 1.6 },
    ]
  );

  // Trzy niewielkie, ogrodowe drzewka z okrągłą koroną — po stronie placu
  // zabaw (niebieskie prostokąty na mapce)
  [0.62, 0.87].forEach((frac) => {
    buildDeciduousTree(
      PLOT6_X_MAX - frac * PLOT6_WIDTH, stripZ_playgroundSide,
      2.0, 0.18,
      [{ r: 1.3, y: 0.3 }]
    );
  });

  // Spore, ale nie ogromne drzewo ogrodowe — po stronie placu zabaw (żółty
  // prostokąt na mapce, między dwoma górnymi niebieskimi)
  buildDeciduousTree(
    PLOT6_X_MAX - 0.43 * PLOT6_WIDTH, stripZ_playgroundSide,
    3.2, 0.3,
    [
      { r: 2.1, y: 0.6, x: 0, z: 0 },
      { r: 1.5, y: 1.3, x: 1.0, z: 0.5 },
      { r: 1.5, y: 1.2, x: -0.9, z: -0.4 },
    ]
  );
}


// ============================================================================
// WYWOŁANIA
// ============================================================================
addPlot6Ground();
addPlot6Road();
addPlot6Hedges();
buildLexusUX();
addPlot6Playground();
buildYellowHouse();
addPlot6Trees();
// ==================== KONIEC PLANSZA 6 ====================

WORLD_X_MIN = PLOT6_X_MIN;
addHills();

// ---------- Dirt road: runs the FULL width of the game world ----------
// Od wschodniej ściany łąki (x = FIELD) po zachodnią ścianę ujeżdżalni
// (x = PLOT2_X_MIN) — jedna, ciągła, ubita droga ziemna nad wszystkimi trzema planszami.
function makeDirtRoadTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8A6A45';
  ctx.fillRect(0, 0, size, size);
  // nieregularne, ciemniejsze i jaśniejsze plamy ubitej ziemi
  for (let i = 0; i < 260; i++) {
    const shade = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade * 0.8},${shade * 0.55},${0.05 + Math.random() * 0.06})`;
    const r = 8 + Math.random() * 22;
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, r, r * 0.6, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(40,28,15,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 2);
  return tex;
}

function makeRoadTransitionTexture() {
  const w = 256, h = 32;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#B7B6B0'); // szary (parking), zachód
  grad.addColorStop(1, '#8A6A45'); // ziemny brąz, wschód
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(c);
}

function addRoadStrip() {
  const roadDepth = ROAD_Z_MAX - ROAD_Z_MIN;
  const zC = (ROAD_Z_MIN + ROAD_Z_MAX) / 2;
  const transitionHalf = 10; // szerokość (połowa) strefy płynnego przejścia

  // odcinek ziemny — od wschodniej ściany łąki po strefę przejścia przy plansza-4/5
  const dirtWidth = FIELD - (PLOT4_X_MIN + transitionHalf);
  const dirtMat = new THREE.MeshToonMaterial({ map: makeDirtRoadTexture(), gradientMap: toonGradient });
  const dirtRoad = new THREE.Mesh(new THREE.PlaneGeometry(dirtWidth, roadDepth), dirtMat);
  dirtRoad.rotation.x = -Math.PI / 2;
  dirtRoad.position.set(FIELD - dirtWidth / 2, 0.015, zC);
  dirtRoad.receiveShadow = true;
  scene.add(dirtRoad);

  // strefa płynnego przejścia (gradient: szary -> ziemny brąz)
  const transitionMat = new THREE.MeshToonMaterial({ map: makeRoadTransitionTexture(), gradientMap: toonGradient });
  const transitionRoad = new THREE.Mesh(new THREE.PlaneGeometry(transitionHalf * 2, roadDepth), transitionMat);
  transitionRoad.rotation.x = -Math.PI / 2;
  transitionRoad.position.set(PLOT4_X_MIN, 0.015, zC);
  transitionRoad.receiveShadow = true;
  scene.add(transitionRoad);

  // odcinek szary — nad plansza-5, ten sam kolor co jej podłoże
  const grayWidth = (PLOT4_X_MIN - transitionHalf) - WORLD_X_MIN;
  const grayMat = toonMat(0xB7B6B0);
  const grayRoad = new THREE.Mesh(new THREE.PlaneGeometry(grayWidth, roadDepth), grayMat);
  grayRoad.rotation.x = -Math.PI / 2;
  grayRoad.position.set(WORLD_X_MIN + grayWidth / 2, 0.015, zC);
  grayRoad.receiveShadow = true;
  scene.add(grayRoad);
}
addRoadStrip();

// Subtelne koleiny od kół (dwa ciemniejsze pasy) — tylko na odcinku ziemnym
// (pasują do ubitej drogi, nie do szarego parkingu).
function addRoadWheelRuts() {
  const rutMat = toonMat(0x6B4F30);
  const zC = (ROAD_Z_MIN + ROAD_Z_MAX) / 2;
  const rutWidth = 0.35;
  const rutSpanWidth = FIELD - PLOT4_X_MIN - 4;
  const rutCenterX = (PLOT4_X_MIN + FIELD) / 2;
  [-1.4, 1.4].forEach((offset) => {
    const rut = new THREE.Mesh(
      new THREE.PlaneGeometry(rutSpanWidth, rutWidth),
      rutMat
    );
    rut.rotation.x = -Math.PI / 2;
    rut.position.set(rutCenterX, 0.02, zC + offset);
    scene.add(rut);
  });
}
addRoadWheelRuts();

// ---------- Fencing: outer walls + internal dividers + gated north edge ----------
function addAllFencing() {
  // Zewnętrzne ściany pionowe — pełna wysokość świata (plansze + droga), bez bram.
  buildFenceSegment(FIELD, PLAY_Z_MIN, FIELD, ROAD_Z_MAX);                // wschód (x = +30)
  buildFenceSegment(WORLD_X_MIN, PLAY_Z_MIN, WORLD_X_MIN, ROAD_Z_MAX);    // zachód (x = -120)

  // Południowa krawędź (front wszystkich 4 plansz), bez bram.
  buildFenceSegment(WORLD_X_MIN, PLAY_Z_MIN, FIELD, PLAY_Z_MIN);

  // Zewnętrzna, północna krawędź drogi (prawdziwa granica świata), bez bram.
  buildFenceSegment(WORLD_X_MIN, ROAD_Z_MAX, FIELD, ROAD_Z_MAX);

  // Wewnętrzne działki (łąka|hala, hala|ujeżdżalnia, ujeżdżalnia|plansza-4) —
  // tylko na wysokości plansz (nie wchodzą na drogę), bez bram.
  buildFenceSegment(PLOT2_X_MAX, PLAY_Z_MIN, PLOT2_X_MAX, PLAY_Z_MAX);     // x = -30
  buildFenceSegment(PLOT2_DIVIDER_X, PLAY_Z_MIN, PLOT2_DIVIDER_X, PLAY_Z_MAX); // x = -60
  buildFenceSegment(PLOT4_X_MAX, PLAY_Z_MIN, PLOT4_X_MAX, PLAY_Z_MAX);     // x = -90

  // Granica plansze <-> droga (z = PLAY_Z_MAX):
  // - solidny odcinek na łące (od wschodu do bramy 1)
  // - brama 1, w rogu z halą (x = -30)
  // - CAŁY odcinek nad planszą-2 (halą) BEZ ogrodzenia — trwale otwarty
  // - brama 2, w rogu z halą (x = -60)
  // - solidny odcinek na ujeżdżalni i plansza-4 (na razie bez bramy — tylko wizualnie)
  buildFenceSegment(GATE1_X_MAX, PLAY_Z_MAX, FIELD, PLAY_Z_MAX);                 // -20..30 solidny
  buildFenceSegment(GATE1_X_MIN, PLAY_Z_MAX, GATE1_X_MAX, PLAY_Z_MAX, { from: 0, to: 1 }); // brama 1 (-30..-20)
  // (-60..-30 celowo bez ogrodzenia — hala ma stały, otwarty dostęp z drogi)
  buildFenceSegment(GATE2_X_MIN, PLAY_Z_MAX, GATE2_X_MAX, PLAY_Z_MAX, { from: 0, to: 1 }); // brama 2 (-70..-60)
  // (-120..-90 celowo bez ogrodzenia — plansza-4 ma stały, otwarty dostęp z drogi)
  buildFenceSegment(PLOT4_X_MAX, PLAY_Z_MAX, GATE2_X_MIN, PLAY_Z_MAX);            // -90..-70 solidny
}
addAllFencing();

// ---------- Red arch hall ("hala łukowa") ----------
function createArchHall(length, width, wallHeight, color) {
  const group = new THREE.Group();
  const r = width / 2;

  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  shape.lineTo(-r, wallHeight);
  shape.absarc(0, wallHeight, r, Math.PI, 0, true);
  shape.lineTo(r, 0);
  shape.lineTo(-r, 0);

  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 20 });
  const body = new THREE.Mesh(geo, toonMat(color));
  body.position.z = -length / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // big closed doors on the two short (end) sides
  const doorMat = toonMat(0x33312F);
  const lineMat = toonMat(0x201F1D);
  const doorW = width * 0.62;
  const doorH = wallHeight * 0.92;
  [-1, 1].forEach((side) => {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), doorMat);
    door.position.set(0, doorH / 2, side * (length / 2 + 0.05));
    if (side < 0) door.rotation.y = Math.PI;
    group.add(door);
    for (let li = 1; li <= 2; li++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(doorW * 0.94, 0.04, 0.02), lineMat);
      line.position.set(0, (doorH / 3) * li, side * (length / 2 + 0.06));
      group.add(line);
    }
  });

  return group;
}

function addHall() {
  const plotLen = PLOT2_X_MAX - PLOT2_X_MIN; // 60
  const plotWidth = PLOT2_Z_MAX - PLOT2_Z_MIN; // 50 (po przycięciu pod drogę)
  const hallLength = plotLen / 3;
  const hallWidth = (plotWidth / 3) * 0.72; // delikatnie węższa niż wcześniej
  const gapX = 1.5;  // odstęp od granicy z łąką
  const gapZ = 2.5;  // bazowy odstęp od południowego ogrodzenia
  const shiftTowardRoad = 11.5; // przesunięcie w stronę drogi (dalej od okólnika, zostawia przejazd)

  const hall = createArchHall(hallLength, hallWidth, 3.2, 0xB3352A);
  // Obrócona o 90° względem poprzedniej wersji — bez rotacji Y oś długości
  // biegnie teraz wzdłuż Z (równolegle do ogrodzenia łąki), zamiast wgłąb działki.
  const hallCenterX = PLOT2_X_MAX - hallWidth / 2 - gapX;
  const hallCenterZ = -FIELD + hallLength / 2 + gapZ + shiftTowardRoad;
  hall.position.set(hallCenterX, 0, hallCenterZ);
  scene.add(hall);

  HALL_BOUNDS.xMin = hallCenterX - hallWidth / 2;
  HALL_BOUNDS.xMax = hallCenterX + hallWidth / 2;
  HALL_BOUNDS.zMin = hallCenterZ - hallLength / 2;
  HALL_BOUNDS.zMax = hallCenterZ + hallLength / 2;
}
const HALL_BOUNDS = { xMin: 0, xMax: 0, zMin: 0, zMax: 0 };
addHall();

// ---------- Okólnik: okrągły wybieg za halą, od strony ujeżdżalni ----------
function buildCircularFence(cx, cz, radius) {
  const postCount = Math.max(12, Math.round((2 * Math.PI * radius) / FENCE_SPACING));
  const pts = [];
  for (let i = 0; i < postCount; i++) {
    const angle = (i / postCount) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius });
  }
  pts.forEach((p) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.7, 8), postMat);
    post.position.set(p.x, 0.85, p.z);
    post.castShadow = true;
    scene.add(post);
  });
  for (let i = 0; i < postCount; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % postCount];
    const dx = p2.x - p1.x, dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    [0.55, 1.15].forEach((y) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), railMat);
      rail.position.set((p1.x + p2.x) / 2, y, (p1.z + p2.z) / 2);
      rail.rotation.y = -angle;
      rail.castShadow = true;
      scene.add(rail);
    });
  }
}

function addOkolnik() {
  const radius = 6;
  // za halą (mniejsze x niż jej lewa krawędź), w rogu od strony ujeżdżalni
  // (blisko dzielnika hala|ujeżdżalnia i frontowego ogrodzenia); odsunięty
  // od hali nieco bardziej, żeby traktor mógł swobodnie przejechać między nimi.
  const cx = HALL_BOUNDS.xMin - radius - 3;
  const cz = PLAY_Z_MIN + radius + 1.5;

  const dirtTex = makeDirtRoadTexture();
  dirtTex.repeat.set(3, 3);
  const mat = new THREE.MeshToonMaterial({ map: dirtTex, gradientMap: toonGradient });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0.012, cz);
  ground.receiveShadow = true;
  scene.add(ground);

  buildCircularFence(cx, cz, radius);

  OKOLNIK_BOUNDS.cx = cx;
  OKOLNIK_BOUNDS.cz = cz;
  OKOLNIK_BOUNDS.r = radius;
}
const OKOLNIK_BOUNDS = { cx: 0, cz: 0, r: 0 };
addOkolnik();

// ---------- Płyta obornikowa: mniejsza, kwadratowa powierzchnia w narożniku
// plansza-2 przy ogrodzeniu z łąką, tuż za halą ----------
function addManureSlab() {
  const size = 7; // kwadrat
  // bliżej ogrodzenia z łąką (x = -30) i dalej od hali niż poprzednio
  const cx = -33.8;
  const cz = -23;

  const border = new THREE.Mesh(new THREE.PlaneGeometry(size + 0.5, size + 0.5), toonMat(0x2E2C29));
  border.rotation.x = -Math.PI / 2;
  border.position.set(cx, 0.012, cz);
  scene.add(border);

  const slab = new THREE.Mesh(new THREE.PlaneGeometry(size, size), toonMat(0x4A4A46));
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(cx, 0.013, cz);
  slab.receiveShadow = true;
  scene.add(slab);

  MANURE_SLAB_CENTER.x = cx;
  MANURE_SLAB_CENTER.z = cz;
}
const MANURE_SLAB_CENTER = { x: 0, z: 0 };
addManureSlab();

// ---------- Miejsce na ognisko: niewielki, płytki, okrągły dołek w ziemi ----------
// Między płytą obornikową a okólnikiem, trochę bliżej płyty.
function createGarbageBag() {
  const g = new THREE.Group();
  const bagMat = toonMat(0x2A2E2A);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), bagMat);
  body.scale.set(1, 0.8, 1.1);
  body.castShadow = true;
  g.add(body);
  // skręcony węzeł u góry worka
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6), bagMat);
  knot.position.set(0.04, 0.28, -0.04);
  knot.rotation.z = 0.35;
  knot.rotation.x = -0.2;
  g.add(knot);
  return g;
}

// Duży worek na śmieci — pojawia się dynamicznie w trakcie gry (patrz
// mechanika "płyty obornikowej" w sekcji stanu gry, niżej).
const CAMPFIRE_PIT_CENTER = { x: 0, z: 0 };
function createBigGarbageBag() {
  const g = new THREE.Group();
  const bagMat = toonMat(0x24272A);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 10), bagMat);
  body.scale.set(1, 0.82, 1.15);
  body.castShadow = true;
  g.add(body);
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.38, 8), bagMat);
  knot.position.set(0.08, 0.58, -0.08);
  knot.rotation.z = 0.35;
  knot.rotation.x = -0.2;
  g.add(knot);
  return g;
}

function addCampfirePit() {
  const t = 0.35; // 0 = przy płycie, 1 = przy okólniku — bliżej płyty
  const cx = MANURE_SLAB_CENTER.x + (OKOLNIK_BOUNDS.cx - MANURE_SLAB_CENTER.x) * t;
  const cz = MANURE_SLAB_CENTER.z + (OKOLNIK_BOUNDS.cz - MANURE_SLAB_CENTER.z) * t;
  const radius = 1.3;
  const depth = 0.55; // wyraźnie zagłębiony, ale wciąż niezbyt głęboki
  CAMPFIRE_PIT_CENTER.x = cx;
  CAMPFIRE_PIT_CENTER.z = cz;

  // zagłębiona, okrągła niecka (Lathe — profil obrócony wokół osi Y)
  const profile = [
    new THREE.Vector2(0, -depth),
    new THREE.Vector2(radius * 0.55, -depth * 0.92),
    new THREE.Vector2(radius * 0.9, -depth * 0.35),
    new THREE.Vector2(radius, 0)
  ];
  const pitGeo = new THREE.LatheGeometry(profile, 20);
  const pitMat = toonMat(0x2B2620);
  const pit = new THREE.Mesh(pitGeo, pitMat);
  pit.position.set(cx, 0, cz);
  pit.receiveShadow = true;
  scene.add(pit);

  // krąg małych kamieni wokół krawędzi
  const stoneMat = toonMat(0x8C8A85);
  const stoneCount = 10;
  for (let i = 0; i < stoneCount; i++) {
    const angle = (i / stoneCount) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.14 + Math.random() * 0.06, 8, 6), stoneMat);
    stone.position.set(
      cx + Math.cos(angle) * (radius + 0.12),
      0.08,
      cz + Math.sin(angle) * (radius + 0.12)
    );
    stone.scale.y = 0.7;
    stone.castShadow = true;
    scene.add(stone);
  }

  // 2 worki na śmieci leżące na dnie zagłębienia
  [
    { dx: -0.35, dz: 0.15, rotY: 0.4 },
    { dx: 0.3, dz: -0.25, rotY: -0.6 }
  ].forEach((o) => {
    const bag = createGarbageBag();
    bag.position.set(cx + o.dx, -depth + 0.32, cz + o.dz);
    bag.rotation.y = o.rotY;
    scene.add(bag);
  });
}
addCampfirePit();

// ---------- Plansza 4: trójskrzydłowy budynek gospodarczy (żółty, dach dwuspadowy + kontynuacje jednospadowe) ----------
// Czysto wizualne — bez kolizji i bez możliwości wjazdu do środka (na razie).
function createGableWing(width, length, wallHeight, pitchDeg, wallColor, roofColor, doorSize) {
  const g = new THREE.Group();
  const halfW = width / 2;
  const pitchRad = THREE.Math.degToRad(pitchDeg);
  const rise = halfW * Math.tan(pitchRad);
  const slopeLength = Math.sqrt(halfW * halfW + rise * rise);

  const wallMat = toonMat(wallColor);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, length), wallMat);
  walls.position.y = wallHeight / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);

  // trójkątne szczyty (wypełnienie pod dachem na obu krótszych bokach)
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-halfW, 0);
  gableShape.lineTo(halfW, 0);
  gableShape.lineTo(0, rise);
  gableShape.lineTo(-halfW, 0);
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  const gableMat = new THREE.MeshToonMaterial({ color: wallColor, gradientMap: toonGradient, side: THREE.DoubleSide });
  const gableFront = new THREE.Mesh(gableGeo, gableMat);
  gableFront.position.set(0, wallHeight, length / 2);
  gableFront.castShadow = true;
  g.add(gableFront);
  const gableBack = new THREE.Mesh(gableGeo, gableMat);
  gableBack.position.set(0, wallHeight, -length / 2);
  gableBack.castShadow = true;
  g.add(gableBack);

  // dwuspadowy dach (dwie połacie)
  const roofMat = toonMat(roofColor);
  const roofGeo = new THREE.BoxGeometry(slopeLength, 0.12, length + 0.6);
  const roofLeft = new THREE.Mesh(roofGeo, roofMat);
  roofLeft.position.set(-halfW / 2, wallHeight + rise / 2, 0);
  roofLeft.rotation.z = pitchRad;
  roofLeft.castShadow = true;
  g.add(roofLeft);
  const roofRight = new THREE.Mesh(roofGeo, roofMat);
  roofRight.position.set(halfW / 2, wallHeight + rise / 2, 0);
  roofRight.rotation.z = -pitchRad;
  roofRight.castShadow = true;
  g.add(roofRight);

  // prostokątne drzwi na ścianie od strony drogi (stały, bezwzględny rozmiar —
  // niezależny od wysokości ściany, żeby jej podniesienie ich nie zmieniało)
  if (doorSize) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(doorSize.w, doorSize.h), toonMat(0x3B2E22));
    door.position.set(0, doorSize.h / 2, length / 2 + 0.03);
    g.add(door);
  }

  return g;
}

// Wariant środkowej części z PRAWDZIWYM otworem drzwiowym (bez drzwi) i pustym
// wnętrzem — "hala 2". Ściany budowane jako osobne, cienkie panele (nie jedna
// pełna bryła), więc w miejscu drzwi zostaje faktyczny, przejezdny otwór.
function createMiddleWingOpen(width, length, wallHeight, pitchDeg, wallColor, roofColor, doorW, doorH) {
  const g = new THREE.Group();
  const halfW = width / 2;
  const halfL = length / 2;
  const pitchRad = THREE.Math.degToRad(pitchDeg);
  const rise = halfW * Math.tan(pitchRad);
  const slopeLength = Math.sqrt(halfW * halfW + rise * rise);
  const wallMat = toonMat(wallColor);
  const T = 0.18; // grubość ścian zewnętrznych

  // tylna ściana (pełna)
  const back = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, T), wallMat);
  back.position.set(0, wallHeight / 2, -halfL + T / 2);
  back.castShadow = true;
  back.receiveShadow = true;
  g.add(back);

  // ściany boczne (pełne, na całej długości)
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(T, wallHeight, length), wallMat);
  sideL.position.set(-halfW + T / 2, wallHeight / 2, 0);
  sideL.castShadow = true;
  sideL.receiveShadow = true;
  g.add(sideL);
  const sideR = new THREE.Mesh(new THREE.BoxGeometry(T, wallHeight, length), wallMat);
  sideR.position.set(halfW - T / 2, wallHeight / 2, 0);
  sideR.castShadow = true;
  sideR.receiveShadow = true;
  g.add(sideR);

  // przednia ściana z PRAWDZIWYM otworem drzwiowym: lewy fragment, prawy
  // fragment, nadproże nad otworem — sam otwór zostaje pusty (przejezdny)
  const segW = (width - doorW) / 2;
  if (segW > 0.05) {
    const frontL = new THREE.Mesh(new THREE.BoxGeometry(segW, wallHeight, T), wallMat);
    frontL.position.set(-halfW + segW / 2, wallHeight / 2, halfL - T / 2);
    frontL.castShadow = true;
    g.add(frontL);
    const frontR = new THREE.Mesh(new THREE.BoxGeometry(segW, wallHeight, T), wallMat);
    frontR.position.set(halfW - segW / 2, wallHeight / 2, halfL - T / 2);
    frontR.castShadow = true;
    g.add(frontR);
  }
  const lintelH = wallHeight - doorH;
  if (lintelH > 0.05) {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW, lintelH, T), wallMat);
    lintel.position.set(0, doorH + lintelH / 2, halfL - T / 2);
    lintel.castShadow = true;
    g.add(lintel);
  }

  // trójkątne szczyty
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-halfW, 0);
  gableShape.lineTo(halfW, 0);
  gableShape.lineTo(0, rise);
  gableShape.lineTo(-halfW, 0);
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  const gableMat = new THREE.MeshToonMaterial({ color: wallColor, gradientMap: toonGradient, side: THREE.DoubleSide });
  const gableFront = new THREE.Mesh(gableGeo, gableMat);
  gableFront.position.set(0, wallHeight, halfL);
  g.add(gableFront);
  const gableBack = new THREE.Mesh(gableGeo, gableMat);
  gableBack.position.set(0, wallHeight, -halfL);
  g.add(gableBack);

  // dwuspadowy dach (dwie połacie) — bez zmian
  const roofMat = toonMat(roofColor);
  const roofGeo = new THREE.BoxGeometry(slopeLength, 0.12, length + 0.6);
  const roofLeft = new THREE.Mesh(roofGeo, roofMat);
  roofLeft.position.set(-halfW / 2, wallHeight + rise / 2, 0);
  roofLeft.rotation.z = pitchRad;
  roofLeft.castShadow = true;
  g.add(roofLeft);
  const roofRight = new THREE.Mesh(roofGeo, roofMat);
  roofRight.position.set(halfW / 2, wallHeight + rise / 2, 0);
  roofRight.rotation.z = -pitchRad;
  roofRight.castShadow = true;
  g.add(roofRight);

  // ---------- Wnętrze: "hala 2" ----------
  const wainscotH = 1.4; // ok. połowa wysokości traktora
  const innerHalfW = halfW - T;
  const innerHalfL = halfL - T;

  // podłoga — piasek, jak na ujeżdżalni
  const sandTex = makeSandTexture();
  sandTex.repeat.set(2, 3);
  const floorMat = new THREE.MeshToonMaterial({ map: sandTex, gradientMap: toonGradient });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(innerHalfW * 2, innerHalfL * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.03, 0);
  floor.receiveShadow = true;
  g.add(floor);

  // ściany wewnątrz: czerwone, z drewnianą "obudową" z pionowych deseczek
  // do wysokości ok. połowy traktora
  const plankTex = makePlankTexture();
  const redMat = new THREE.MeshToonMaterial({ color: 0xB3352A, gradientMap: toonGradient, side: THREE.DoubleSide });

  function addInteriorBand(segLength, rotY, posX, posZ) {
    const tex = plankTex.clone();
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, Math.round(segLength / 0.7)), 1);
    const plankMat = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient, side: THREE.DoubleSide });

    const wood = new THREE.Mesh(new THREE.PlaneGeometry(segLength, wainscotH), plankMat);
    wood.position.set(posX, wainscotH / 2, posZ);
    wood.rotation.y = rotY;
    g.add(wood);

    const red = new THREE.Mesh(new THREE.PlaneGeometry(segLength, wallHeight - wainscotH), redMat);
    red.position.set(posX, wainscotH + (wallHeight - wainscotH) / 2, posZ);
    red.rotation.y = rotY;
    g.add(red);
  }

  addInteriorBand(innerHalfW * 2, 0, 0, -innerHalfL + 0.04);          // tylna ściana
  addInteriorBand(innerHalfL * 2, Math.PI / 2, -innerHalfW + 0.04, 0); // lewa ściana
  addInteriorBand(innerHalfL * 2, Math.PI / 2, innerHalfW - 0.04, 0);  // prawa ściana

  // "Niby-drzwi" — tylko wizualne (bez kolizji/przejścia), po jednych na
  // każdej bocznej ścianie wnętrza, w tylnej części hali, naprzeciwko siebie —
  // symbolicznie prowadzą do bocznych skrzydeł budynku.
  function addFakeSideDoor(side) {
    const doorW = 1.1, doorH = 2.3;
    const doorZ = -innerHalfL + 3;
    const panelMat = toonMat(0x3B2E22);
    const frameMat2 = toonMat(0x5C4326);

    const grp = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), panelMat);
    grp.add(panel);
    // pionowe boki ramy
    [-1, 1].forEach((fx) => {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.08, doorH + 0.1, 0.05), frameMat2);
      fr.position.set(fx * (doorW / 2 + 0.03), 0, -0.02);
      grp.add(fr);
    });
    // nadproże
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.2, 0.08, 0.05), frameMat2);
    frameTop.position.set(0, doorH / 2 + 0.03, -0.02);
    grp.add(frameTop);
    // klamka
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), toonMat(0xC9C9C0));
    handle.position.set(side > 0 ? -doorW * 0.35 : doorW * 0.35, 0, 0.03);
    grp.add(handle);

    grp.position.set(side * (innerHalfW - 0.1), doorH / 2, doorZ);
    grp.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(grp);
  }
  addFakeSideDoor(-1); // lewa ściana — w stronę lewego skrzydła
  addFakeSideDoor(1);  // prawa ściana — w stronę prawego skrzydła (naprzeciwko)

  // Drewniany kozioł do skakania — jeden koniec ma nogi ok. 2x wyższe niż
  // drugi, przez co "grzbiet" jest pochylony. Ustawiony niedaleko wejścia,
  // po lewej stronie, ale bliżej środka (nie przy samej ścianie).
  function createVaultingHorse(lowLegH, highLegH, benchLen, benchW) {
    const vg = new THREE.Group();
    const woodMat = toonMat(0x8B5A2B);
    const padMat = toonMat(0x6B3E23);
    const legMat = toonMat(0x5C3A1E);
    const halfBenchL = benchLen / 2;

    function addLegPair(zPos, legH) {
      [-1, 1].forEach((side) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, legH, 8), legMat);
        leg.position.set(side * (benchW / 2 - 0.1), legH / 2, zPos);
        leg.castShadow = true;
        vg.add(leg);
      });
      const brace = new THREE.Mesh(new THREE.BoxGeometry(benchW - 0.2, 0.05, 0.05), legMat);
      brace.position.set(0, legH * 0.35, zPos);
      vg.add(brace);
    }
    addLegPair(-halfBenchL + 0.15, lowLegH);
    addLegPair(halfBenchL - 0.15, highLegH);

    // pochylona, WALCOWATA belka (grzbiet kozła) — łączy oba końce na różnych
    // wysokościach; kolor granatowy, nieco grubsza niż wcześniejsza (płaska) wersja
    const navyMat = toonMat(0x1F3864);
    const dy = highLegH - lowLegH;
    const dz = benchLen;
    const beamLen = Math.hypot(dy, dz);
    const beamRadius = 0.4;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(beamRadius, beamRadius, beamLen, 14), navyMat);
    beam.position.set(0, (lowLegH + highLegH) / 2, 0);
    beam.rotation.x = Math.atan2(dz, dy);
    beam.castShadow = true;
    vg.add(beam);

    return vg;
  }

  const vaultingHorse = createVaultingHorse(1.6 * 0.8, 3.2 * 0.8, 3.2, 0.7);
  vaultingHorse.position.set(-halfW * 0.4, 0, halfL - 5);
  vaultingHorse.rotation.y = -0.35; // lekki kąt — niższy koniec kieruje się w stronę środka hali
  g.add(vaultingHorse);

  // Stalowa kratownica dachowa — standardowy kształt jak w halach
  // przemysłowych: dwa pasy górne (pod kątem połaci dachu), pas dolny (poziomy,
  // na wysokości okapu) i skratowanie w zygzak pomiędzy nimi.
  function createRoofTruss(spanHalfW, riseH, thickness) {
    const truss = new THREE.Group();
    const steelMat = toonMat(0x8A8F94);
    const barR = 0.05;
    const braceR = barR * 0.7;

    // Łączy dwa punkty (x0,y0)-(x1,y1) prętem stalowym — jednoznaczna,
    // poprawna rotacja niezależnie od kierunku, więc nic nie "ucieka" w złą stronę.
    function addBar(x0, y0, x1, y1, radius) {
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) return;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), steelMat);
      bar.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      bar.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
      bar.castShadow = true;
      truss.add(bar);
    }

    // pas dolny (poziomy) — dokładnie na wysokości okapu (y = 0); wszystkie
    // pozostałe pręty leżą WYŁĄCZNIE powyżej (y >= 0), nic nie wystaje poniżej.
    addBar(-spanHalfW, 0, spanHalfW, 0, barR);

    // dwa pasy górne (pod kątem połaci, od okapu do kalenicy)
    addBar(-spanHalfW, 0, 0, riseH, barR);
    addBar(0, riseH, spanHalfW, 0, barR);

    // słupek na kalenicy (środek, łączy pas dolny ze szczytem)
    addBar(0, 0, 0, riseH, barR);

    // skratowanie: słupki pionowe + skosy do dachu — standardowy układ,
    // wyłącznie w przestrzeni powyżej pasa dolnego.
    const segments = 3;
    [-1, 1].forEach((side) => {
      for (let i = 1; i < segments; i++) {
        const s = i / segments;
        const x = side * spanHalfW * (1 - s);
        const yTop = riseH * s;
        addBar(x, 0, x, yTop, braceR); // słupek pionowy
      }
      for (let i = 0; i < segments; i++) {
        const s0 = i / segments, s1 = (i + 1) / segments;
        const xBottom = side * spanHalfW * (1 - s0);
        const xTopNext = side * spanHalfW * (1 - s1);
        const yTopNext = riseH * s1;
        addBar(xBottom, 0, xTopNext, yTopNext, braceR); // skos
      }
    });

    truss.scale.z = thickness;
    return truss;
  }

  function addRoofTrusses() {
    const trussCount = 4;
    const margin = length * 0.12;
    const usable = length - margin * 2;
    for (let i = 0; i < trussCount; i++) {
      const t = trussCount === 1 ? 0.5 : i / (trussCount - 1);
      const z = -usable / 2 + t * usable;
      const truss = createRoofTruss(innerHalfW, rise - 0.05, 0.12);
      truss.position.set(0, wallHeight, z);
      g.add(truss);
    }
  }
  addRoofTrusses();

  g.userData.footprint = { halfW, halfL, T };
  return g;
}

// Boczne skrzydło z dachem JEDNOSPADOWYM będącym dosłowną kontynuacją połaci
// głównego (dwuspadowego) dachu — ta sama linia i kąt nachylenia, opadająca
// od wysokiej krawędzi (przy środkowej części) do niższej krawędzi zewnętrznej.
function createLeanToWing(width, length, innerHeight, pitchDeg, wallColor, roofColor, innerSide, doorSize) {
  const g = new THREE.Group();
  const halfW = width / 2;
  const pitchRad = THREE.Math.degToRad(pitchDeg);
  const outerHeight = innerHeight - width * Math.tan(pitchRad);
  const innerX = innerSide * halfW;
  const outerX = -innerSide * halfW;

  const wallMat = toonMat(wallColor);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, outerHeight, length), wallMat);
  walls.position.y = outerHeight / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);

  // trójkątne wypełnienie od strony środkowej części (od outerHeight do innerHeight)
  const fillShape = new THREE.Shape();
  fillShape.moveTo(outerX, 0);
  fillShape.lineTo(innerX, 0);
  fillShape.lineTo(innerX, innerHeight - outerHeight);
  fillShape.lineTo(outerX, 0);
  const fillGeo = new THREE.ShapeGeometry(fillShape);
  const fillMat = new THREE.MeshToonMaterial({ color: wallColor, gradientMap: toonGradient, side: THREE.DoubleSide });
  const fillFront = new THREE.Mesh(fillGeo, fillMat);
  fillFront.position.set(0, outerHeight, length / 2);
  fillFront.castShadow = true;
  g.add(fillFront);
  // UWAGA: BEZ rotation.y=PI — dla tego asymetrycznego trójkąta taka rotacja
  // odwracała stronę z wysoką krawędzią (ta sama geometria + DoubleSide daje
  // poprawny, niemylony profil po obu stronach).
  const fillBack = new THREE.Mesh(fillGeo, fillMat);
  fillBack.position.set(0, outerHeight, -length / 2);
  fillBack.castShadow = true;
  g.add(fillBack);

  // jednospadowy dach — pojedyncza połać, kontynuacja tego samego kąta
  const dx = innerX - outerX;
  const dy = innerHeight - outerHeight;
  const slopeLen = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.12, length + 0.6), toonMat(roofColor));
  roof.position.set((innerX + outerX) / 2, (innerHeight + outerHeight) / 2, 0);
  roof.rotation.z = angle;
  roof.castShadow = true;
  g.add(roof);

  if (doorSize) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(doorSize.w, doorSize.h), toonMat(0x3B2E22));
    door.position.set(0, doorSize.h / 2, length / 2 + 0.03);
    g.add(door);
  }

  g.userData.outerHeight = outerHeight;
  return g;
}

// Prosta, stylizowana głowa konia (skierowana lokalnie w +Z), "wystająca" z okienka.
function createHorseHead() {
  const g = new THREE.Group();
  const skinMat = toonMat(0x8B5A2B);
  const darkMat = toonMat(0x241B12);
  const maneMat = toonMat(0x3B2A1A);
  const noseMat = toonMat(0x5C4033);

  const neckAngle = Math.PI / 4; // ok. 45° w górę od ściany
  const neckLength = 1.15;
  const neckDropAngle = 0.4;     // o tyle głowa "opada" w dół względem kierunku szyi

  // szyja — grupa obrócona pod kątem ok. 45° w górę; walec i grzywa są jej
  // dziećmi, więc grzywa poprawnie "jedzie" po wierzchu szyi niezależnie od kąta
  const neckGroup = new THREE.Group();
  neckGroup.rotation.x = neckAngle;
  g.add(neckGroup);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.33, neckLength, 10), skinMat);
  neck.position.y = neckLength / 2;
  neck.castShadow = true;
  neckGroup.add(neck);

  // grzywa — cienki, ciągły pasek WYŁĄCZNIE na wierzchu szyi
  const neckMane = new THREE.Mesh(new THREE.BoxGeometry(0.07, neckLength * 0.92, 0.05), maneMat);
  neckMane.position.set(0, neckLength / 2, -0.29);
  neckGroup.add(neckMane);

  // głowa — osobna grupa zaczepiona na końcu szyi, opadająca naturalnie w dół
  const head = new THREE.Group();
  head.position.set(0, Math.sin(neckAngle) * neckLength, Math.cos(neckAngle) * neckLength);
  head.rotation.x = neckDropAngle;
  g.add(head);

  // czaszka — wydłużona, spłaszczona z boków (bardziej koński kształt niż kula)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), skinMat);
  skull.scale.set(0.85, 0.92, 1.15);
  skull.position.set(0, 0.1, 0.28);
  skull.castShadow = true;
  head.add(skull);

  // pysk — zwężający się w stronę nozdrzy
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.19, 0.6, 10), skinMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, -0.05, 0.72);
  muzzle.castShadow = true;
  head.add(muzzle);

  // koniec pyska (nieco ciemniejszy, zaokrąglony)
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), noseMat);
  noseTip.position.set(0, -0.08, 1.02);
  head.add(noseTip);

  // chrapy
  const nostrilGeo = new THREE.SphereGeometry(0.028, 6, 6);
  const nostrilL = new THREE.Mesh(nostrilGeo, darkMat);
  nostrilL.position.set(-0.055, -0.08, 1.09);
  head.add(nostrilL);
  const nostrilR = new THREE.Mesh(nostrilGeo, darkMat);
  nostrilR.position.set(0.055, -0.08, 1.09);
  head.add(nostrilR);

  // oczy
  const eyeGeo = new THREE.SphereGeometry(0.042, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, darkMat);
  eyeL.position.set(-0.26, 0.16, 0.35);
  head.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, darkMat);
  eyeR.position.set(0.26, 0.16, 0.35);
  head.add(eyeR);

  // uszy — postawione, lekko odchylone na boki
  const earGeo = new THREE.ConeGeometry(0.09, 0.3, 6);
  const earL = new THREE.Mesh(earGeo, skinMat);
  earL.position.set(-0.15, 0.46, -0.02);
  earL.rotation.set(-0.15, 0, 0.3);
  head.add(earL);
  const earR = new THREE.Mesh(earGeo, skinMat);
  earR.position.set(0.15, 0.46, -0.02);
  earR.rotation.set(-0.15, 0, -0.3);
  head.add(earR);

  // grzywa na głowie (kontynuacja grzywy z szyi)
  const headMane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.27, 0.5), maneMat);
  headMane.position.set(0, 0.28, -0.08);
  head.add(headMane);

  return g;
}

// Dodaje 6 niewielkich, WYRAŹNIE widocznych okienek (bryłowa rama + ciemny
// otwór) z wystającymi głowami koni na zewnętrznej, dłuższej ścianie
// skrzydła (skierowanej lokalnie w +X).
function addStableWindows(wingGroup, width, length, wallH) {
  const halfW = width / 2;
  const winY = wallH * 0.58;
  const count = 6;
  const usableLen = length * 0.72;
  const winW = 0.85, winH = 0.95; // delikatnie powiększone (mieszczą kątowo wystającą szyję)
  const frameMat = toonMat(0xB3352A); // czerwona rama
  const holeMat = toonMat(0x0A0A0A);  // czarny otwór

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const z = -usableLen / 2 + t * usableLen;

    // rama okienna — bryła lekko wystająca ze ściany, dobrze widoczna z każdej strony
    const frameThickness = 0.22;
    const frameOuterX = halfW + 0.08 + frameThickness / 2; // najbardziej wysunięta na zewnątrz ściana ramy
    const frame = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, winH + 0.16, winW + 0.16), frameMat);
    frame.position.set(halfW + 0.08, winY, z);
    frame.castShadow = true;
    wingGroup.add(frame);

    // ciemny otwór osadzony w ramie — celowo COFNIĘTY względem zewnętrznej
    // ściany ramy (inaczej ich powierzchnie pokrywałyby się dokładnie,
    // powodując migotanie / z-fighting)
    const holeThickness = 0.1;
    const holeOuterX = frameOuterX - 0.04; // margines, żeby nie stykać się z zewnętrzną ścianą ramy
    const hole = new THREE.Mesh(new THREE.BoxGeometry(holeThickness, winH, winW), holeMat);
    hole.position.set(holeOuterX - holeThickness / 2, winY, z);
    wingGroup.add(hole);

    // głowa konia wystająca z okna — nasada szyi zaczyna się w otworze,
    // cała szyja i łeb wystają wyraźnie na zewnątrz ściany
    const head = createHorseHead();
    head.rotation.y = Math.PI / 2;
    head.position.set(holeOuterX - holeThickness / 2, winY, z);
    head.scale.set(0.95, 0.95, 0.95);
    wingGroup.add(head);
  }
}

// Okna i pojedyncze drzwi na ścianie od strony plansza-5 (lewe skrzydło):
// 5 okien (licząc od strony wejścia do hali 2) + 1 drzwi + 2 okna. Okna są
// szerokie i niskie (pozioma linia dłuższa niż pionowa), umieszczone wyżej
// niż okna z końmi po drugiej stronie budynku.
function addOfficeWindowsAndDoor(wingGroup, width, length, wallH, realOuterHeight) {
  const halfW = width / 2;
  const stableWinY = wallH * 0.58; // wysokość okien z końmi (punkt odniesienia)
  const winY = Math.min(stableWinY * (5 / 3), wallH - 0.2 - 0.25); // "o 2/3 wyżej", z zapasem od dachu
  const winW = 1.1, winH = 0.45;
  const doorW = 1.3, doorH = 2.2;
  const frameMat = toonMat(0x3A3A3A);
  const paneMat = toonMat(0x9DBAC7);
  const doorFrameMat = toonMat(0x5C4326);
  const doorMat = toonMat(0x3B2E22);

  const usableLen = length * 0.78;
  const count = 8; // 5 okien + 1 drzwi + 2 okna
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const z = usableLen / 2 - t * usableLen; // start od frontu (strona wejścia do hali 2)
    const isDoor = i === 5;

    if (isDoor) {
      const frameThickness = 0.22;
      const dFrame = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, doorH + 0.14, doorW + 0.14), doorFrameMat);
      dFrame.position.set(-(halfW + 0.08), doorH / 2, z);
      dFrame.castShadow = true;
      wingGroup.add(dFrame);
      const holeThickness = 0.1;
      const dHole = new THREE.Mesh(new THREE.BoxGeometry(holeThickness, doorH, doorW), doorMat);
      dHole.position.set(-(halfW + 0.08) + 0.04 + holeThickness / 2, doorH / 2, z);
      wingGroup.add(dHole);

      // Czerwone zadaszenie na brązowych słupkach — TERAZ z DOKŁADNIE takim
      // samym nachyleniem jak główny dach (10°) i osadzone równo na
      // wysokości okapu, więc jest prawdziwym, płynnym przedłużeniem
      // połaci dachu głównego skrzydła, a nie osobną konstrukcją pod innym kątem.
      const roofPitchRad = THREE.Math.degToRad(10);
      const canopyDepth = 1.15 * 3;
      const innerX = -(halfW + 0.08);
      const outerX = innerX - canopyDepth;
      const topY = realOuterHeight; // dokładnie linia okapu PRAWDZIWEGO, aktualnego dachu
      const outerY = topY - canopyDepth * Math.tan(roofPitchRad);
      const canopyPostMat = toonMat(0x6B4226);
      const canopyRoofMat = toonMat(0xB3352A);
      const canopyWidth = (doorW + 0.3) * 1.8;
      const postRadius = 0.1; // 2x grubsze niż wcześniej

      [-1, 1].forEach((s) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(postRadius, postRadius, outerY, 6), canopyPostMat);
        post.position.set(outerX + 0.2, outerY / 2, z + s * (canopyWidth / 2 - 0.15));
        post.castShadow = true;
        wingGroup.add(post);
      });

      const dxp = outerX - innerX;
      const dyp = outerY - topY;
      const canopyLen = Math.hypot(dxp, dyp);
      const canopyAngle = Math.atan2(dyp, dxp);
      const canopyRoof = new THREE.Mesh(new THREE.BoxGeometry(canopyLen, 0.09, canopyWidth), canopyRoofMat);
      canopyRoof.position.set((innerX + outerX) / 2, (topY + outerY) / 2, z);
      canopyRoof.rotation.z = canopyAngle;
      canopyRoof.castShadow = true;
      wingGroup.add(canopyRoof);
      // fragment "wypełniający" łączący zadaszenie z dachem głównego
      // skrzydła — DOTYKAJĄ SIĘ fizycznie, żeby zadaszenie sprawiało
      // wrażenie ciągłego przedłużenia dachu, a nie osobnej konstrukcji
      const filler = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, canopyWidth), canopyRoofMat);
      filler.position.set(innerX + 0.45, topY - 0.02, z);
      wingGroup.add(filler);
    } else {
      const frameThickness = 0.2;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, winH + 0.14, winW + 0.14), frameMat);
      frame.position.set(-(halfW + 0.08), winY, z);
      frame.castShadow = true;
      wingGroup.add(frame);
      const holeThickness = 0.08;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(holeThickness, winH, winW), paneMat);
      pane.position.set(-(halfW + 0.08) + 0.04 + holeThickness / 2, winY, z);
      wingGroup.add(pane);
    }
  }
}

const HALA2_BOUNDS = { xMin: 0, xMax: 0, zMin: 0, zMax: 0 };
function addFarmBuilding() {
  const hallLengthRef = (PLOT2_X_MAX - PLOT2_X_MIN) / 3; // 20 — punkt odniesienia (oryginalna długość hali z plansza-2)
  const hallWidthRef = ((PLAY_Z_MAX - PLAY_Z_MIN) / 3) * 0.72; // aktualna szerokość hali (12)

  const sideWidth = 8; // boczne skrzydła poszerzone (z 6 do 8 — bezpieczny margines od ogrodzeń działki)
  const midWidth = hallWidthRef;        // 12 — środkowe, szersze skrzydło
  const pitchDeg = 10;
  const prevWallHeight = 4 * 1.5;        // poprzednia wysokość (6) — punkt odniesienia dla drzwi/okien
  const wallHeight = prevWallHeight * 1.25; // o kolejne 25% wyższe (7.5)
  const wallColor = 0xE3B23C;   // żółty
  const roofColor = 0xB3352A;   // czerwony
  const T = 0.18;

  // Budynek wydłużony "z tyłu" (od południa) — front (drzwi/okna, strona
  // drogi) zostaje na miejscu, tył sięga niemal do ogrodzenia.
  const frontZ = PLAY_Z_CENTER + hallLengthRef / 2; // niezmieniony front
  const backZ = PLAY_Z_MIN + 2;                     // prawie do ogrodzenia (mały zapas)
  const length = frontZ - backZ;
  const buildingCenterZ = (frontZ + backZ) / 2;

  // Drzwi i okna liczone od POPRZEDNIEJ wysokości/długości oraz NOWEJ
  // (poszerzonej) szerokości skrzydeł bocznych — drzwi boczne skalują się
  // razem z poszerzeniem.
  const prevSideOuterHeight = prevWallHeight - sideWidth * Math.tan(THREE.Math.degToRad(pitchDeg));
  // PRAWDZIWA (aktualna) wysokość okapu bocznych skrzydeł — inna niż
  // prevSideOuterHeight, bo ta ostatnia celowo bazuje na starej wysokości
  // ściany (tylko po to, by drzwi/okna nie rosły). Zadaszenie musi znać
  // realną wysokość dachu, żeby się z nim naprawdę stykać.
  const realSideOuterHeight = wallHeight - sideWidth * Math.tan(THREE.Math.degToRad(pitchDeg));
  const middleDoor = { w: midWidth * 0.82, h: prevWallHeight * 0.92 };
  const sideDoor = { w: sideWidth * 0.5, h: prevSideOuterHeight * 0.75 };

  const building = new THREE.Group();

  // lewe skrzydło — jednospadowy dach, kontynuacja lewej połaci środkowej części;
  // od strony plansza-5: 5 okien + drzwi + 2 okna (patrz addOfficeWindowsAndDoor)
  const leftX = -(midWidth / 2 + sideWidth / 2);
  const left = createLeanToWing(sideWidth, length, wallHeight, pitchDeg, wallColor, roofColor, 1, sideDoor);
  left.position.x = leftX;
  addOfficeWindowsAndDoor(left, sideWidth, length, prevSideOuterHeight, realSideOuterHeight);
  building.add(left);

  // środkowa część — dwuspadowy dach, PRAWDZIWY otwór drzwiowy (tych samych
  // wymiarów co dawne drzwi) zamiast drzwi — to teraz wjezdna "hala 2"
  // (teraz też dłuższa, razem z całym budynkiem)
  const middle = createMiddleWingOpen(midWidth, length, wallHeight, pitchDeg, wallColor, roofColor, middleDoor.w, middleDoor.h);
  building.add(middle);

  const midFootprint = middle.userData.footprint;
  const midInnerHalfW = midFootprint.halfW - midFootprint.T;
  const midInnerHalfL = midFootprint.halfL - midFootprint.T;
  HALA2_BOUNDS.xMin = PLOT4_CENTER_X - midInnerHalfW;
  HALA2_BOUNDS.xMax = PLOT4_CENTER_X + midInnerHalfW;
  HALA2_BOUNDS.zMin = buildingCenterZ - midInnerHalfL;
  HALA2_BOUNDS.zMax = buildingCenterZ + midInnerHalfL;

  // prawe skrzydło (od strony ujeżdżalni) — jednospadowy dach + okienka z końmi (bez zmian)
  const rightX = midWidth / 2 + sideWidth / 2;
  const right = createLeanToWing(sideWidth, length, wallHeight, pitchDeg, wallColor, roofColor, -1, sideDoor);
  right.position.x = rightX;
  addStableWindows(right, sideWidth, length, prevSideOuterHeight);
  building.add(right);

  building.position.set(PLOT4_CENTER_X, 0, buildingCenterZ);
  scene.add(building);

  // ---------- Kolizja ----------
  const bx = PLOT4_CENTER_X, bz = buildingCenterZ;
  const halfL = length / 2;
  // boczne skrzydła — w pełni solidne bryły (bez zmian, nadal niedostępne)
  FARM_BLOCKERS.push({ x1: bx + leftX - sideWidth / 2, x2: bx + leftX + sideWidth / 2, z1: bz - halfL, z2: bz + halfL });
  FARM_BLOCKERS.push({ x1: bx + rightX - sideWidth / 2, x2: bx + rightX + sideWidth / 2, z1: bz - halfL, z2: bz + halfL });
  // środkowa część — tylko ściany (bez otworu drzwiowego), żeby dało się wjechać do środka
  const mHalfW = midWidth / 2;
  FARM_BLOCKERS.push({ x1: bx - mHalfW, x2: bx + mHalfW, z1: bz - halfL, z2: bz - halfL + T }); // tylna ściana
  FARM_BLOCKERS.push({ x1: bx - mHalfW, x2: bx - mHalfW + T, z1: bz - halfL, z2: bz + halfL });  // lewa ściana
  FARM_BLOCKERS.push({ x1: bx + mHalfW - T, x2: bx + mHalfW, z1: bz - halfL, z2: bz + halfL });  // prawa ściana
}
addFarmBuilding();

// ---------- Garaże na plansza-5 ----------
// Dach dwuspadowy — jeden spadek od strony drogi, drugi od strony końca
// planszy. Ściana szczytowa z wizualnymi (nieprzejezdnymi) drzwiami garażowymi.
function addGarageDoorDetail(wingGroup, doorW, doorH, halfLength) {
  const doorMat = toonMat(0x6B4226); // brązowe drzwi
  const door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), doorMat);
  door.position.set(0, doorH / 2, halfLength + 0.03);
  wingGroup.add(door);
  const lineMat = toonMat(0x4A2E19);
  const lines = 4;
  for (let i = 1; i <= lines; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(doorW * 0.96, 0.04, 0.02), lineMat);
    line.position.set(0, (doorH / (lines + 1)) * i, halfLength + 0.045);
    wingGroup.add(line);
  }
  // rama
  const frameMat = toonMat(0x4A4A46);
  [-1, 1].forEach((fx) => {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.1, doorH + 0.12, 0.06), frameMat);
    fr.position.set(fx * (doorW / 2 + 0.03), doorH / 2, halfLength + 0.02);
    wingGroup.add(fr);
  });
}

function createNumberPlate(number) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#F7F5EF';
  roundRect(ctx, 10, 10, size - 20, size - 20, 26);
  ctx.fill();
  ctx.strokeStyle = '#2E2A20';
  ctx.lineWidth = 10;
  roundRect(ctx, 10, 10, size - 20, size - 20, 26);
  ctx.stroke();
  ctx.fillStyle = '#B3352A';
  ctx.font = 'bold 150px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), size / 2, size / 2 + 12);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  return new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), mat);
}

function addGarage(centerX, centerZ, rotationY, number) {
  const garageWidthX = 8;
  const garageDepthZ = 8;
  const wallHeight = 3.2;
  const pitchDeg = 20;
  const wallColor = 0xE3B23C; // żółty
  const roofColor = 0xB3352A; // czerwony

  const garage = createGableWing(garageDepthZ, garageWidthX, wallHeight, pitchDeg, wallColor, roofColor, null);
  addGarageDoorDetail(garage, garageDepthZ * 0.7, wallHeight * 0.75, garageWidthX / 2);

  // Numer na tylnej (bezdrzwiowej) ścianie — dokładnie naprzeciwko bramy garażowej.
  const plate = createNumberPlate(number);
  plate.position.set(0, wallHeight * 0.55, -garageWidthX / 2 - 0.03);
  plate.rotation.y = Math.PI; // odwrócona, żeby była widoczna od zewnątrz tylnej ściany
  garage.add(plate);

  garage.rotation.y = rotationY;
  garage.position.set(centerX, 0, centerZ);
  scene.add(garage);

  FARM_BLOCKERS.push({
    x1: centerX - garageWidthX / 2, x2: centerX + garageWidthX / 2,
    z1: centerZ - garageDepthZ / 2, z2: centerZ + garageDepthZ / 2
  });
}

// Garaż 1: zaczyna się kawałeczek za miejscem, w którym droga staje się w
// pełni szara (x = -130); brama garażowa zwrócona w stronę otwartego
// parkingu (na północ), tył budynku niemal przylega do południowego
// ogrodzenia planszy (z = -30).
// Garaż 1: przeniesiony na przeciwległy bok (obok hali 2, od strony gdzie
// kończy się brązowa droga gospodarcza) — obrócony o 180°, jego tylna
// (bezokienna) ściana leży na linii przedniej ściany hali 2, odsunięty od
// niej o 1,5 szerokości traktora.
addGarage(-130.5, 23.5, Math.PI, 1);

// Garaż 2: obrócony o 90° względem poprzedniej wersji — brama garażowa
// zwrócona w stronę otwartego parkingu (na północ), nie w stronę hali 2.
addGarage(-137, -23, 0, 2);

// ---------- 2 zaparkowane białe busy między halą 2 a garażem 2 ----------
function createVanBus() {
  const g = new THREE.Group();
  const bodyMat = toonMat(0xF2F2ED);
  const glassMat = toonMat(0x3A4A52);
  const wheelMat = toonMat(0x1A1A1A);
  const rimMat = toonMat(0xB8B8B0);
  const trimMat = toonMat(0xC9C9C0);
  const darkMat = toonMat(0x2A2A28);
  const lightMat = toonMat(0xFFE9A8);

  // Kabina (przód) — nieco niższa i krótsza niż skrzynia ładunkowa
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 1.6), bodyMat);
  cab.position.set(0, 0.95, 1.9);
  cab.castShadow = true;
  g.add(cab);

  // Skrzynia ładunkowa (tył) — wyższa, bez okien bocznych, typowa dla vana
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.15, 3.6), bodyMat);
  box.position.set(0, 1.17, -0.6);
  box.castShadow = true;
  g.add(box);

  // maska/przód pod szybą
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.35, 0.5), bodyMat);
  hood.position.set(0, 0.55, 2.65);
  g.add(hood);

  // przednia szyba (lekko pochylona)
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 0.08), glassMat);
  windshield.position.set(0, 1.55, 2.62);
  windshield.rotation.x = -0.18;
  g.add(windshield);

  // boczne szyby kabiny (tylko z przodu — skrzynia bez okien)
  [-1.11, 1.11].forEach((x) => {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 1.1), glassMat);
    win.position.set(x, 1.35, 1.9);
    g.add(win);
  });

  // grill i reflektory
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.06), darkMat);
  grille.position.set(0, 0.55, 2.91);
  g.add(grille);
  [-0.85, 0.85].forEach((x) => {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.05), lightMat);
    light.position.set(x, 0.6, 2.92);
    g.add(light);
  });

  // lusterka boczne
  [-1.15, 1.15].forEach((x) => {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.22), darkMat);
    mirror.position.set(x, 1.35, 2.35);
    g.add(mirror);
  });

  // linia podziału tylnych drzwi skrzyni ładunkowej + klamki
  const doorSeam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.9, 0.03), darkMat);
  doorSeam.position.set(0, 1.15, -2.41);
  g.add(doorSeam);
  [-0.15, 0.15].forEach((x) => {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), darkMat);
    handle.position.set(x, 1.15, -2.43);
    g.add(handle);
  });

  // dolna listwa/zderzaki
  const trim = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.15, 5.24), trimMat);
  trim.position.y = 0.32;
  g.add(trim);

  // koła z felgami
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 14);
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 10);
  [[-1.05, 1.7], [1.05, 1.7], [-1.05, -1.55], [1.05, -1.55]].forEach(([x, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.42, z);
    wheel.castShadow = true;
    g.add(wheel);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(x, 0.42, z);
    g.add(rim);
  });

  return g;
}

function addParkedVan(centerX, centerZ, rotationY, scale) {
  const van = createVanBus();
  van.position.set(centerX, 0, centerZ);
  van.rotation.y = rotationY;
  van.scale.setScalar(scale);
  scene.add(van);
  const halfX = 1.15 * scale, halfZ = 2.65 * scale;
  FARM_BLOCKERS.push({ x1: centerX - halfX, x2: centerX + halfX, z1: centerZ - halfZ, z2: centerZ + halfZ });
}
// Jeden van (2x większy), stojący między garażem-2 a dużym budynkiem, blisko
// ogrodzenia, przodem skierowany w jego stronę (na południe).
addParkedVan(-127, -24.2, Math.PI, 2);

// ---------- Show-jumping obstacles on plansza-3 (ujeżdżalnia) ----------
// obstacles: lista prostokątnych "twardych" stref (AABB) blokujących traktor,
// tak jak ogrodzenie — traktor może je jedynie omijać.
const obstacles = [];
function registerObstacle(x, z, halfW, halfD) {
  obstacles.push({ x, z, halfW, halfD });
}

function createStandard(height, color) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, height, 0.16), toonMat(0xF7F5EF));
  post.position.y = height / 2;
  post.castShadow = true;
  g.add(post);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.26), toonMat(color));
  cap.position.y = height;
  g.add(cap);
  return g;
}

function createPole(length, color) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, length, 10), toonMat(color));
  pole.rotation.z = Math.PI / 2;
  pole.castShadow = true;
  return pole;
}

// Pojedyncza stacjonata: dwa słupki + jedna pozioma żerdź.
function createVertical(width, height, color) {
  const g = new THREE.Group();
  const left = createStandard(height + 0.25, color);
  left.position.x = -width / 2;
  g.add(left);
  const right = createStandard(height + 0.25, color);
  right.position.x = width / 2;
  g.add(right);
  const pole = createPole(width + 0.3, color);
  pole.position.y = height;
  g.add(pole);
  return g;
}

// Okser: dwie równoległe żerdzie (przód niżej, tył wyżej) tworzące przeszkodę szerokościową.
function createOxer(width, height, spread, color1, color2) {
  const g = new THREE.Group();
  const front = createVertical(width, height * 0.82, color1);
  front.position.z = -spread / 2;
  g.add(front);
  const back = createVertical(width, height, color2);
  back.position.z = spread / 2;
  g.add(back);
  return g;
}

function placeVertical(x, z, width, height, color) {
  const obj = createVertical(width, height, color);
  obj.position.set(x, 0, z);
  scene.add(obj);
  registerObstacle(x, z, width / 2 + 0.4, 0.7);
}

function placeOxer(x, z, width, height, spread, color1, color2) {
  const obj = createOxer(width, height, spread, color1, color2);
  obj.position.set(x, 0, z);
  scene.add(obj);
  registerObstacle(x, z, width / 2 + 0.4, spread / 2 + 0.7);
}

function placeDoubleVertical(x, z, width, height, gap, color1, color2) {
  const g = new THREE.Group();
  const a = createVertical(width, height, color1);
  a.position.z = -gap / 2;
  g.add(a);
  const b = createVertical(width, height, color2);
  b.position.z = gap / 2;
  g.add(b);
  g.position.set(x, 0, z);
  scene.add(g);
  registerObstacle(x, z - gap / 2, width / 2 + 0.4, 0.7);
  registerObstacle(x, z + gap / 2, width / 2 + 0.4, 0.7);
}

function addJumpingObstacles() {
  const JW = 5; // szerokość pojedynczej przeszkody
  // rozstawione wzdłuż ujeżdżalni w paśmie z ∈ [-16,16], z dala od granicy z drogą
  placeVertical(PLOT3_CENTER_X + 6, -16, JW, 1.0, 0xE4572E);
  placeOxer(PLOT3_CENTER_X - 6, -8, JW, 1.0, 1.0, 0xE4572E, 0xFFC145);
  placeDoubleVertical(PLOT3_CENTER_X + 4, 0, JW, 1.0, 7, 0xE4572E, 0x2E7D32);
  placeOxer(PLOT3_CENTER_X - 6, 8, JW, 1.0, 1.0, 0xFFC145, 0xE4572E);
  placeVertical(PLOT3_CENTER_X + 6, 16, JW, 1.0, 0x2E7D32);
}
addJumpingObstacles();

function resolveObstacleCollision(x, z) {
  const R = 1.5; // efektywny promień kolizji traktora
  let px = x, pz = z;
  obstacles.forEach((o) => {
    const closestX = THREE.Math.clamp(px, o.x - o.halfW, o.x + o.halfW);
    const closestZ = THREE.Math.clamp(pz, o.z - o.halfD, o.z + o.halfD);
    const dx = px - closestX, dz = pz - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < R * R) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const overlap = R - dist;
      px += (dx / dist) * overlap;
      pz += (dz / dist) * overlap;
    }
  });

  // Hala — pełnowymiarowa, prostokątna bryła blokująca traktor (jak płot).
  if (HALL_BOUNDS.xMax > HALL_BOUNDS.xMin) {
    const closestX = THREE.Math.clamp(px, HALL_BOUNDS.xMin, HALL_BOUNDS.xMax);
    const closestZ = THREE.Math.clamp(pz, HALL_BOUNDS.zMin, HALL_BOUNDS.zMax);
    const dx = px - closestX, dz = pz - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < R * R) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const overlap = R - dist;
      px += (dx / dist) * overlap;
      pz += (dz / dist) * overlap;
    }
  }

  // Okólnik — okrągłe ogrodzenie blokujące traktor.
  if (OKOLNIK_BOUNDS.r > 0) {
    const dx = px - OKOLNIK_BOUNDS.cx, dz = pz - OKOLNIK_BOUNDS.cz;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const minDist = OKOLNIK_BOUNDS.r + R;
    if (dist < minDist) {
      const overlap = minDist - dist;
      px += (dx / dist) * overlap;
      pz += (dz / dist) * overlap;
    }
  }

  // Budynek na plansza-4 — boczne skrzydła w pełni solidne, środek solidny
  // poza otworem drzwiowym (dzięki temu można wjechać do "hali 2").
  FARM_BLOCKERS.forEach((o) => {
    const closestX = THREE.Math.clamp(px, o.x1, o.x2);
    const closestZ = THREE.Math.clamp(pz, o.z1, o.z2);
    const dx = px - closestX, dz = pz - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < R * R) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const overlap = R - dist;
      px += (dx / dist) * overlap;
      pz += (dz / dist) * overlap;
    }
  });

  return { x: px, z: pz };
}

// ---------- Pan Janusz (character) ----------
function createJanusz() {
  const p = new THREE.Group();
  const skinMat = toonMat(0xE8B792);
  const hairMat = toonMat(0x585858);
  const shirtMat = toonMat(0xC0392B);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.38), shirtMat);
  torso.position.y = 0.33;
  torso.castShadow = true;
  p.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 20), skinMat);
  head.position.y = 0.9;
  head.castShadow = true;
  p.add(head);

  // grey hair as a band around the sides/back only, well below the crown —
  // added BEFORE the bald cap so the bald cap always renders on top and wins
  const hairSide = new THREE.Mesh(
    new THREE.SphereGeometry(0.278, 20, 20, 0, Math.PI * 2, Math.PI * 0.38, Math.PI * 0.42),
    hairMat
  );
  hairSide.position.y = 0.9;
  hairSide.castShadow = true;
  p.add(hairSide);

  // shiny bald patch right on top of the crown (clearly visible skin),
  // deliberately drawn last / slightly larger radius so it is never hidden
  const bald = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.4),
    skinMat
  );
  bald.position.y = 0.9;
  p.add(bald);

  // short full grey beard
  const beard = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), hairMat);
  beard.position.set(0, 0.75, 0.19);
  beard.scale.set(1, 0.65, 0.75);
  p.add(beard);

  // arms
  const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8);
  const armL = new THREE.Mesh(armGeo, shirtMat);
  armL.position.set(-0.32, 0.38, 0.12);
  armL.rotation.z = 0.35;
  p.add(armL);
  const armR = new THREE.Mesh(armGeo, shirtMat);
  armR.position.set(0.32, 0.38, 0.12);
  armR.rotation.z = -0.35;
  p.add(armR);

  return p;
}

// ---------- Tractor ----------
// NOTE: the movement code treats local +Z as "forward" and drives the
// *outer* group's rotation.y for steering. All the visual meshes below are
// modeled with the hood at -Z (that used to be treated as forward, which
// is why the tractor appeared to drive backwards). To fix that without
// touching every coordinate, everything is built inside an inner "visual"
// group that is rotated 180° — so the hood ends up pointing towards +Z,
// matching the actual direction of travel.
function createTractor() {
  const g = new THREE.Group();
  const visual = new THREE.Group();
  visual.rotation.y = Math.PI;
  g.add(visual);

  const bodyMat = toonMat(0x2E7D32);
  const bodyMat2 = toonMat(0x43A047);
  const blackMat = toonMat(0x252525);
  const yellowMat = toonMat(0xFFC145);

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.0, 3.2), bodyMat);
  body.position.y = 1.0;
  body.castShadow = true;
  visual.add(body);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 1.3), bodyMat2);
  hood.position.set(0, 1.05, -2.0);
  hood.castShadow = true;
  visual.add(hood);

  const grill = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.1), blackMat);
  grill.position.set(0, 0.9, -2.66);
  visual.add(grill);

  // cabin roof — raised well above head height (head top sits around y=2.66)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 1.7), blackMat);
  roof.position.set(0, 3.05, 0.55);
  roof.castShadow = true;
  visual.add(roof);

  const pillarGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.98, 6);
  [[-0.85, -0.15], [0.85, -0.15], [-0.85, 1.25], [0.85, 1.25]].forEach(([x, z]) => {
    const pillar = new THREE.Mesh(pillarGeo, blackMat);
    pillar.position.set(x, 2.01, z);
    visual.add(pillar);
  });

  const wheelGeoBig = new THREE.CylinderGeometry(0.85, 0.85, 0.5, 16);
  const wheelGeoSmall = new THREE.CylinderGeometry(0.52, 0.52, 0.38, 16);
  const rimMat = yellowMat;

  function makeWheel(geo, x, z) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(geo, blackMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    w.add(tire);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(geo.parameters.radiusTop * 0.45, geo.parameters.radiusTop * 0.45, geo.parameters.height + 0.03, 10),
      rimMat
    );
    rim.rotation.z = Math.PI / 2;
    w.add(rim);
    w.position.set(x, geo.parameters.radiusTop, z);
    return w;
  }

  const wheelRL = makeWheel(wheelGeoBig, -1.2, 1.0);
  const wheelRR = makeWheel(wheelGeoBig, 1.2, 1.0);
  const wheelFL = makeWheel(wheelGeoSmall, -1.05, -1.9);
  const wheelFR = makeWheel(wheelGeoSmall, 1.05, -1.9);
  visual.add(wheelRL, wheelRR, wheelFL, wheelFR);

  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8), blackMat);
  pipe.position.set(0.65, 2.1, -1.85);
  visual.add(pipe);

  const janusz = createJanusz();
  janusz.position.set(-0.32, 1.5, 0.5);
  visual.add(janusz);

  g.userData.spinWheels = [wheelFL, wheelFR, wheelRL, wheelRR];
  g.userData.steerWheels = [wheelFL, wheelFR];
  return g;
}

const tractor = createTractor();
tractor.position.set(0, 0, 10);
scene.add(tractor);

// ---------- Input: keyboard ----------
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// ---------- Input: virtual joystick (mobile / touch) ----------
// x, y są znormalizowane do zakresu -1..1 względem środka bazy joysticka.
// y < 0 = gałka pchnięta w górę (do przodu), x > 0 = w prawo.
const joystick = { active: false, x: 0, y: 0 };
const joyBase = document.getElementById('joystick-base');
const joyKnob = document.getElementById('joystick-knob');
let joyPointerId = null;

function setJoystickFromClient(clientX, clientY) {
  const rect = joyBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxR = rect.width / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxR) {
    dx = (dx / dist) * maxR;
    dy = (dy / dist) * maxR;
  }
  joystick.x = dx / maxR;
  joystick.y = dy / maxR;
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}

function resetJoystick() {
  joystick.active = false;
  joystick.x = 0;
  joystick.y = 0;
  joyKnob.style.transform = 'translate(0px, 0px)';
}

if (joyBase) {
  joyBase.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    joystick.active = true;
    joyPointerId = e.pointerId;
    if (joyBase.setPointerCapture) joyBase.setPointerCapture(e.pointerId);
    setJoystickFromClient(e.clientX, e.clientY);
  });
  joyBase.addEventListener('pointermove', (e) => {
    if (!joystick.active || e.pointerId !== joyPointerId) return;
    e.preventDefault();
    setJoystickFromClient(e.clientX, e.clientY);
  });
  const endJoy = (e) => {
    if (e.pointerId !== joyPointerId) return;
    resetJoystick();
    joyPointerId = null;
  };
  joyBase.addEventListener('pointerup', endJoy);
  joyBase.addEventListener('pointercancel', endJoy);
}

// ---------- Tractor movement ----------
let speed = 0;
const maxSpeed = 9.5;
const accel = 15;
const friction = 11;
const turnSpeed = 2.2;
const DEADZONE = 0.14;

function updateTractor(dt) {
  let throttle = 0;
  if (keys['w'] || keys['arrowup']) {
    throttle = 1;
  } else if (keys['s'] || keys['arrowdown']) {
    throttle = -0.6;
  } else if (joystick.active) {
    const push = -joystick.y; // gałka w górę = jazda do przodu
    if (push > DEADZONE) throttle = Math.min(1, push);
    else if (push < -DEADZONE) throttle = Math.max(-0.6, push);
  }

  if (throttle !== 0) {
    speed += throttle * accel * dt;
  } else {
    speed -= Math.sign(speed) * friction * dt;
    if (Math.abs(speed) < 0.05) speed = 0;
  }
  speed = THREE.Math.clamp(speed, -maxSpeed * 0.5, maxSpeed);

  let turn = 0;
  if (keys['a'] || keys['arrowleft']) {
    turn = 1;
  } else if (keys['d'] || keys['arrowright']) {
    turn = -1;
  } else if (joystick.active && Math.abs(joystick.x) > DEADZONE) {
    turn = THREE.Math.clamp(-joystick.x * 1.3, -1, 1);
  }

  if (Math.abs(speed) > 0.15) {
    tractor.rotation.y += turn * turnSpeed * dt * (speed > 0 ? 1 : -1);
  }

  const dir = new THREE.Vector3(Math.sin(tractor.rotation.y), 0, Math.cos(tractor.rotation.y));
  let newX = tractor.position.x + dir.x * speed * dt;
  let newZ = tractor.position.z + dir.z * speed * dt;

  const M = 2.2; // margines ~ promień traktora

  // Absolutna zewnętrzna granica całego świata gry (plansze + droga).
  newX = THREE.Math.clamp(newX, WORLD_X_MIN + M, FIELD - M);
  newZ = THREE.Math.clamp(newZ, PLAY_Z_MIN + M, ROAD_Z_MAX - M);

  // Wewnętrzne działki (łąka|hala, hala|ujeżdżalnia) — solidne, ale TYLKO na
  // wysokości plansz (z ∈ [PLAY_Z_MIN, PLAY_Z_MAX]); nad drogą znikają, więc
  // jazda wzdłuż drogi jest zawsze swobodna.
  newX = applyWallCollisionZRanged(tractor.position.x, newX, PLOT2_X_MAX, M, newZ, PLAY_Z_MIN, PLAY_Z_MAX);
  newX = applyWallCollisionZRanged(tractor.position.x, newX, PLOT2_DIVIDER_X, M, newZ, PLAY_Z_MIN, PLAY_Z_MAX);
  newX = applyWallCollisionZRanged(tractor.position.x, newX, PLOT4_X_MAX, M, newZ, PLAY_Z_MIN, PLAY_Z_MAX);

  // Granica plansze <-> droga (z = PLAY_Z_MAX): odcinek nad halą jest trwale
  // otwarty (bez ogrodzenia), a bramy 1/2 tylko gdy gracz je otworzył.
  const gateWindows = [
    { from: PLOT2_DIVIDER_X, to: PLOT2_X_MAX }, // hala <-> droga, zawsze
    { from: WORLD_X_MIN, to: PLOT4_X_MAX }      // plansza-4 i plansza-5 <-> droga, zawsze
  ];
  if (gateOpen) {
    gateWindows.push({ from: GATE1_X_MIN, to: GATE1_X_MAX });
    gateWindows.push({ from: GATE2_X_MIN, to: GATE2_X_MAX });
  }
  newZ = applyGatedHorizontalWall(tractor.position.z, newZ, PLAY_Z_MAX, M, newX, gateWindows);

  const resolved = resolveObstacleCollision(newX, newZ);
  tractor.position.x = resolved.x;
  tractor.position.z = resolved.z;

  tractor.userData.spinWheels.forEach((w) => { w.rotation.x -= speed * dt * 1.8; });
  tractor.userData.steerWheels.forEach((w) => { w.rotation.y = turn * 0.35; });
}

// ---------- Camera follow ----------
function updateCamera() {
  const dir = new THREE.Vector3(Math.sin(tractor.rotation.y), 0, Math.cos(tractor.rotation.y));
  const behind = tractor.position.clone()
    .sub(dir.clone().multiplyScalar(7.6))
    .add(new THREE.Vector3(0, 4.4, 0));
  camera.position.lerp(behind, 0.09);
  const lookTarget = tractor.position.clone()
    .add(dir.clone().multiplyScalar(3))
    .add(new THREE.Vector3(0, 1.3, 0));
  camera.lookAt(lookTarget);
}

// ---------- Items ----------
const ITEM_TYPES = [
  { id: 'cat', bad: true, emoji: '🐱', text: 'Pan Janusz: O nieee! Na płycie obornikowej nie ma już miejsca na kolejne truchło kota!' },
  { id: 'yogurt', bad: false, emoji: '🥛', text: 'Pan Janusz: Jogurt proteinowy? Co za wymysł!' },
  { id: 'cheesecake', bad: false, emoji: '🍰', text: 'Pan Janusz: Tfu! Serniczek od razu na gnój!' },
  { id: 'keys', bad: false, emoji: '🔑', text: 'Pan Janusz: Oo kluczyki do tego durnego auta' },
  { id: 'pizza', bad: false, emoji: '🍕', text: 'Pan Janusz: Mmm moja pizza z Anglii!' },
  { id: 'shakshuka', bad: false, emoji: '🍳', text: 'Pan Janusz: Szakszuka? Przecież to nie niedziela...' },
  { id: 'paper', bad: false, emoji: '📄', text: 'Pan Janusz: I kolejna legitymacja martwej duszy ze Student Serwisu' },
  { id: 'eggs', bad: false, emoji: '🥚', text: 'Pan Janusz: Skąd tu się wzięły jajka od jajcarza z Sielca?' },
  { id: 'scarf', bad: false, emoji: '🧣', text: 'Pan Janusz: Oo chustka jakiejś baby ze wsi' },
  { id: 'wood', bad: false, emoji: '🪵', text: 'Pan Janusz: Drewno? Tadek stolarz się ucieszy' },
  { id: 'swimsuit', bad: false, emoji: '👙', text: 'Pan Janusz: Strój kąpielowy? Ktoś tu chyba ćwiczył do triathlonu' },
  { id: 'book', bad: false, emoji: '📖', text: 'Pan Janusz: Niemiecka książka o jeździectwie? Jak uczyć się to od najlepszych!' }
];
const GOOD_TYPES = ITEM_TYPES.filter(t => !t.bad);
const BAD_TYPES = ITEM_TYPES.filter(t => t.bad);
const WIN_TARGET_PER_ITEM = 2;

// Plansza ma zawsze tyle samo miejsc na dobre, co na złe przedmioty —
// dzięki temu nigdy nie zdarzy się plansza "same koty".
const GOOD_SLOTS = 3;
const BAD_SLOTS = 3;
const MAX_ITEMS = GOOD_SLOTS + BAD_SLOTS;

// ---------- Plansza 3 (ujeżdżalnia) — zupełnie nowe dobre przedmioty ----------
// Złe przedmioty pozostają te same co na planszy 1 (koty z BAD_TYPES).
const ARENA_GOOD_TYPES = [
  { id: 'bone', bad: false, emoji: '🦴', text: 'Pan Janusz: Kostkę damy Madzi, niech weźmie do schronu' },
  { id: 'icecream', bad: false, emoji: '🍦', text: 'Pan Janusz: Mmm lody w sam raz na wieczór hawajski' },
  { id: 'chain', bad: false, emoji: '⛓️', text: 'Pan Janusz: Łańcuch przyda się jak znowu zerwą huśtawkę' },
  { id: 'bull', bad: false, emoji: '🐂', text: 'Pan Janusz: Zaabiłeem byyyka... Cóż to dla mnie byk! Lalala' },
  { id: 'creamcake', bad: false, emoji: '🎂', text: 'Pan Janusz: Ciasto z masą! Od razu do buzi!' }
];
const ARENA_GOOD_SLOTS = 3;
const ARENA_BAD_SLOTS = 3;
const ARENA_MAX_ITEMS = ARENA_GOOD_SLOTS + ARENA_BAD_SLOTS;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Kolejka dobrych przedmiotów na całą grę: DOKŁADNIE po 2 sztuki z każdego
// typu (tyle, ile trzeba do wygranej) — żaden dobry przedmiot nie pojawi
// się więcej razy niż gracz faktycznie potrzebuje.
let goodQueue = [];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeItemSprite(type) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  // Celowo TAKIE SAME tło i obramowanie dla dobrych i złych przedmiotów —
  // gracz musi rozpoznać ikonę, a nie kolor karty, żeby zwiększyć ryzyko pomyłki.
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(ctx, 8, 8, size - 16, size - 16, 26); ctx.fill();
  ctx.strokeStyle = '#FFC145';
  ctx.lineWidth = 7;
  roundRect(ctx, 8, 8, size - 16, size - 16, 26); ctx.stroke();
  ctx.font = '66px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(type.emoji, size / 2, size / 2 + 6);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.3, 2.3, 1);
  return sprite;
}

const activeItems = [];

function randomFieldPos() {
  const margin = 4;
  return new THREE.Vector3(
    (Math.random() * 2 - 1) * (FIELD - margin),
    1.3,
    PLAY_Z_CENTER + (Math.random() * 2 - 1) * (PLAY_Z_HALF - margin)
  );
}

function pickNextType() {
  const activeGood = activeItems.filter((it) => !it.userData.type.bad).length;
  const activeBad = activeItems.length - activeGood;

  // Utrzymuj równowagę: jeśli dobrych na planszy nie jest więcej niż
  // złych i w kolejce zostały jeszcze jakieś dobre przedmioty — dawaj dobry.
  if (activeGood <= activeBad && goodQueue.length > 0) {
    return goodQueue.shift();
  }
  // W przeciwnym razie zły (kot) — utrzymuje parytet dobre/złe.
  return BAD_TYPES[Math.floor(Math.random() * BAD_TYPES.length)];
}

function spawnItem() {
  if (!gameActive || activeItems.length >= MAX_ITEMS) return;
  const type = pickNextType();
  if (!type) return;

  const sprite = makeItemSprite(type);

  let pos, tries = 0;
  do { pos = randomFieldPos(); tries++; } while (pos.distanceTo(tractor.position) < 6 && tries < 12);

  sprite.position.copy(pos);
  sprite.userData = { type, baseY: pos.y };
  scene.add(sprite);
  activeItems.push(sprite);
}

function clearItems() {
  activeItems.forEach((it) => scene.remove(it));
  activeItems.length = 0;
}

function updateItems(dt, t) {
  for (let i = activeItems.length - 1; i >= 0; i--) {
    const it = activeItems[i];
    it.position.y = it.userData.baseY + Math.sin(t * 2 + i * 1.3) * 0.15;
    it.material.rotation += dt * 0.4;

    const dist = it.position.distanceTo(tractor.position);
    if (dist < 2.3) {
      handleCollect(it.userData.type);
      scene.remove(it);
      activeItems.splice(i, 1);
      setTimeout(spawnItem, 500 + Math.random() * 1300);
    }
  }
}

// ---------- Plansza 3 (ujeżdżalnia) — osobna pula aktywnych przedmiotów ----------
const arenaActiveItems = [];
let arenaGoodQueue = [];
let arenaStarted = false; // czy gracz już wjechał na planszę 3 i przedmioty zaczęły się pojawiać

function randomArenaPos() {
  const margin = 4;
  let pos, tries = 0;
  do {
    pos = new THREE.Vector3(
      PLOT2_X_MIN + margin + Math.random() * (PLOT2_DIVIDER_X - PLOT2_X_MIN - margin * 2),
      1.3,
      PLOT2_Z_MIN + margin + Math.random() * (PLOT2_Z_MAX - PLOT2_Z_MIN - margin * 2)
    );
    tries++;
  } while (
    tries < 20 &&
    obstacles.some((o) => Math.abs(pos.x - o.x) < o.halfW + 2 && Math.abs(pos.z - o.z) < o.halfD + 2)
  );
  return pos;
}

function pickNextArenaType() {
  const activeGood = arenaActiveItems.filter((it) => !it.userData.type.bad).length;
  const activeBad = arenaActiveItems.length - activeGood;
  if (activeGood <= activeBad && arenaGoodQueue.length > 0) {
    return arenaGoodQueue.shift();
  }
  return BAD_TYPES[Math.floor(Math.random() * BAD_TYPES.length)];
}

function spawnArenaItem() {
  if (!gameActive || arenaActiveItems.length >= ARENA_MAX_ITEMS) return;
  const type = pickNextArenaType();
  if (!type) return;

  const sprite = makeItemSprite(type);

  let pos, tries = 0;
  do { pos = randomArenaPos(); tries++; } while (pos.distanceTo(tractor.position) < 6 && tries < 12);

  sprite.position.copy(pos);
  sprite.userData = { type, baseY: pos.y };
  scene.add(sprite);
  arenaActiveItems.push(sprite);
}

function clearArenaItems() {
  arenaActiveItems.forEach((it) => scene.remove(it));
  arenaActiveItems.length = 0;
}

function startArenaItems() {
  arenaStarted = true;
  arenaGoodQueue = shuffle(ARENA_GOOD_TYPES.flatMap((t) => [t, t]));
  for (let i = 0; i < ARENA_MAX_ITEMS; i++) spawnArenaItem();
}

function updateArenaItems(dt, t) {
  for (let i = arenaActiveItems.length - 1; i >= 0; i--) {
    const it = arenaActiveItems[i];
    it.position.y = it.userData.baseY + Math.sin(t * 2 + i * 1.3) * 0.15;
    it.material.rotation += dt * 0.4;

    const dist = it.position.distanceTo(tractor.position);
    if (dist < 2.3) {
      handleCollect(it.userData.type);
      scene.remove(it);
      arenaActiveItems.splice(i, 1);
      setTimeout(spawnArenaItem, 500 + Math.random() * 1300);
    }
  }
}

function checkArenaEntry() {
  if (!gameActive || arenaStarted) return;
  // "Pełne" wjechanie na planszę 3 — kawałek za wewnętrzną bramą, żeby
  // przedmioty nie zaczęły się pojawiać dosłownie w progu bramy.
  if (tractor.position.x < PLOT2_DIVIDER_X - 3) {
    startArenaItems();
  }
}

function checkArenaWin() {
  return ARENA_GOOD_TYPES.every((t) => (itemCounts[t.id] || 0) >= WIN_TARGET_PER_ITEM);
}

// ---------- Poziom 3: kuna w hali 2 ----------
function createMarten() {
  const g = new THREE.Group();
  const furMat = toonMat(0x5A3A22);
  const darkFurMat = toonMat(0x2E1F14);
  const throatMat = toonMat(0xE8C88A);
  const eyeMat = toonMat(0x0A0A0A);
  const noseMat = toonMat(0x1A1A1A);

  // tułów — wydłużona, gibka sylwetka typowa dla łasicowatych
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), furMat);
  body.scale.set(1, 0.85, 2.1);
  body.position.set(0, 0.22, 0);
  body.castShadow = true;
  g.add(body);

  // głowa i spiczasty pyszczek
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), furMat);
  head.scale.set(0.9, 0.85, 1.05);
  head.position.set(0, 0.27, 0.42);
  head.castShadow = true;
  g.add(head);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), furMat);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, 0.23, 0.55);
  g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), noseMat);
  nose.position.set(0, 0.22, 0.62);
  g.add(nose);

  // uszy — małe, zaokrąglone
  const earGeo = new THREE.ConeGeometry(0.035, 0.07, 6);
  [-1, 1].forEach((s) => {
    const ear = new THREE.Mesh(earGeo, furMat);
    ear.position.set(s * 0.08, 0.36, 0.4);
    g.add(ear);
  });

  // charakterystyczna jasna plama na gardle
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), throatMat);
  throat.scale.set(1, 0.6, 1.3);
  throat.position.set(0, 0.14, 0.32);
  g.add(throat);

  // oczy
  const eyeGeo = new THREE.SphereGeometry(0.018, 6, 6);
  [-1, 1].forEach((s) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(s * 0.06, 0.29, 0.5);
    g.add(eye);
  });

  // 4 krótkie nogi
  const legGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.16, 6);
  [[-0.09, 0.22], [0.09, 0.22], [-0.09, -0.2], [0.09, -0.2]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, darkFurMat);
    leg.position.set(x, 0.08, z);
    leg.castShadow = true;
    g.add(leg);
  });

  // długi, puszysty ogon
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.6, 8), furMat);
  tail.rotation.x = Math.PI / 2 + 0.35;
  tail.position.set(0, 0.25, -0.58);
  tail.castShadow = true;
  g.add(tail);

  return g;
}

let martenActive = false;
let martenMesh = null;
let martenWanderAngle = 0;
let martenWanderTimer = 0;
let martenState = 'hala'; // 'hala' | 'escaping' | 'parking'
let martenEscapeWaypoints = [];
let martenEscapeIndex = 0;
const MARTEN_MARGIN = 1.3;

function martenBoundsFor(state) {
  if (state === 'parking') {
    return {
      xMin: PLOT5_X_MIN + MARTEN_MARGIN,
      xMax: PLOT4_X_MIN - MARTEN_MARGIN,
      zMin: PLAY_Z_MIN + MARTEN_MARGIN,
      zMax: PLAY_Z_MAX - MARTEN_MARGIN
    };
  }
  return {
    xMin: HALA2_BOUNDS.xMin + MARTEN_MARGIN,
    xMax: HALA2_BOUNDS.xMax - MARTEN_MARGIN,
    zMin: HALA2_BOUNDS.zMin + MARTEN_MARGIN,
    zMax: HALA2_BOUNDS.zMax - MARTEN_MARGIN
  };
}

function spawnMarten() {
  martenMesh = createMarten();
  martenState = 'hala';
  const cx = (HALA2_BOUNDS.xMin + HALA2_BOUNDS.xMax) / 2;
  const cz = (HALA2_BOUNDS.zMin + HALA2_BOUNDS.zMax) / 2;
  martenMesh.position.set(cx, 0, cz);
  scene.add(martenMesh);
  martenActive = true;
  martenWanderTimer = 0;
}

function removeMarten() {
  if (martenMesh) scene.remove(martenMesh);
  martenMesh = null;
  martenActive = false;
  martenState = 'hala';
  martenEscapeWaypoints = [];
  martenEscapeIndex = 0;
}

// Rozpoczyna widoczny, ciągły sprint przez otwór wyjściowy hali, aż na
// otwarty parking — kuna NIGDY nie znika/teleportuje się, gracz cały czas
// ją widzi i może za nią jechać.
function beginMartenEscape() {
  martenState = 'escaping';
  martenEscapeWaypoints = [
    { x: PLOT4_CENTER_X, z: HALA2_BOUNDS.zMax + 4 },       // przez otwór wyjściowy hali
    { x: PLOT4_X_MIN - 3, z: PLAY_Z_MAX - 5 }               // dalej, aż na otwarty parking
  ];
  martenEscapeIndex = 0;
}

function updateMarten(dt) {
  if (!martenActive || !martenMesh) return;

  if (martenState === 'escaping') {
    const target = martenEscapeWaypoints[martenEscapeIndex];
    const tdx = target.x - martenMesh.position.x;
    const tdz = target.z - martenMesh.position.z;
    const tdist = Math.hypot(tdx, tdz);
    const escapeSpeed = 8.5; // wyraźny, szybki, ale w pełni widoczny sprint
    if (tdist < 0.6) {
      martenEscapeIndex++;
      if (martenEscapeIndex >= martenEscapeWaypoints.length) {
        martenState = 'parking';
      }
    } else {
      let dirX = tdx / tdist, dirZ = tdz / tdist;
      // Unik traktora — jeśli jest zbyt blisko, kuna skręca, żeby go
      // ominąć, zamiast biec na wprost przez niego.
      const adx = martenMesh.position.x - tractor.position.x;
      const adz = martenMesh.position.z - tractor.position.z;
      const adist = Math.hypot(adx, adz);
      const avoidRadius = 5;
      if (adist < avoidRadius && adist > 0.001) {
        const avoidX = adx / adist, avoidZ = adz / adist;
        const avoidWeight = (avoidRadius - adist) / avoidRadius;
        dirX = dirX * (1 - avoidWeight) + avoidX * avoidWeight;
        dirZ = dirZ * (1 - avoidWeight) + avoidZ * avoidWeight;
        const dlen = Math.hypot(dirX, dirZ) || 1;
        dirX /= dlen; dirZ /= dlen;
      }
      martenMesh.position.x += dirX * escapeSpeed * dt;
      martenMesh.position.z += dirZ * escapeSpeed * dt;
      martenMesh.rotation.y = Math.atan2(dirX, dirZ);
    }
    applyMartenNoTouchGuard();
    return;
  }

  const dx0 = martenMesh.position.x - tractor.position.x;
  const dz0 = martenMesh.position.z - tractor.position.z;
  const distToTractor = Math.hypot(dx0, dz0);

  const catchRadius = 2.2;
  const nearMissRadius = 4.5; // próg, przy którym kuna zaczyna sprintem uciekać zamiast dać się złapać

  if (martenState === 'hala') {
    // W hali złapanie jest fizycznie niemożliwe — gdy traktor się zbliży
    // na tyle, że złapanie byłoby możliwe, kuna zawsze zdąży wybiec na
    // otwarty parking widocznym sprintem (bez znikania/teleportacji).
    if (distToTractor < nearMissRadius) {
      beginMartenEscape();
      return;
    }
  } else if (martenState === 'parking' && distToTractor < catchRadius) {
    catchMarten();
    return;
  }

  const bounds = martenBoundsFor(martenState);
  const martenSpeed = 5.6; // wyraźnie szybsza niż wcześniej
  const fleeRadius = 10;
  let dirX, dirZ;
  if (distToTractor < fleeRadius) {
    // ucieka od traktora
    dirX = dx0 / distToTractor;
    dirZ = dz0 / distToTractor;
  } else {
    // losowe błądzenie, ze zmianą kierunku co jakiś czas
    martenWanderTimer -= dt;
    if (martenWanderTimer <= 0) {
      martenWanderAngle = Math.random() * Math.PI * 2;
      martenWanderTimer = 1.5 + Math.random() * 2;
    }
    dirX = Math.sin(martenWanderAngle);
    dirZ = Math.cos(martenWanderAngle);
  }

  let nx = martenMesh.position.x + dirX * martenSpeed * dt;
  let nz = martenMesh.position.z + dirZ * martenSpeed * dt;
  nx = THREE.Math.clamp(nx, bounds.xMin, bounds.xMax);
  nz = THREE.Math.clamp(nz, bounds.zMin, bounds.zMax);
  martenMesh.position.x = nx;
  martenMesh.position.z = nz;
  martenMesh.rotation.y = Math.atan2(dirX, dirZ);

  if (martenState === 'hala') applyMartenNoTouchGuard();
}

// Twarda gwarancja: poza parkingiem traktor NIGDY nie może faktycznie
// dotknąć kuny — jeśli mimo unikania i sprintu dystans spadnie za nisko,
// kuna zostaje natychmiast odepchnięta na bezpieczną odległość.
function applyMartenNoTouchGuard() {
  if (martenState === 'parking' || !martenMesh) return;
  const gdx = martenMesh.position.x - tractor.position.x;
  const gdz = martenMesh.position.z - tractor.position.z;
  const gdist = Math.hypot(gdx, gdz);
  const hardMin = 2.3;
  if (gdist < hardMin && gdist > 0.001) {
    const push = hardMin - gdist;
    martenMesh.position.x += (gdx / gdist) * push;
    martenMesh.position.z += (gdz / gdist) * push;
  }
}

const MARTEN_INTRO_LINE = ['Pan Janusz: Ojej, kuna wlazła do hali! Jest strasznie sprytna, na pewno wymknie się na parking - będziesz musiał ją tam dogonić!'];
const MARTEN_CAUGHT_LINE = ['Pan Janusz: Złapana! Nareszcie spokój.'];

function catchMarten() {
  removeMarten();
  gameActive = false;
  showDialogueModal(MARTEN_CAUGHT_LINE, () => {
    setTimeout(triggerVictory, 600);
  });
}

// ---------- Game state ----------
let score = 0;
let lives = 3;
let gameActive = false;
let speechTimer = null;
let itemCounts = {};
let plot2Unlocked = false;
let arenaCompleted = false;
let awaitingSlab1 = false;
let awaitingSlab2 = false;
let spawnedBigBags = [];

const livesIcons = document.querySelectorAll('#lives .life-icon');
const scoreValueEl = document.getElementById('score-value');
const speechEl = document.getElementById('speech-bubble');
const dangerFlashEl = document.getElementById('danger-flash');
const hudEl = document.getElementById('hud');

function updateLivesUI() {
  livesIcons.forEach((icon, idx) => icon.classList.toggle('lost', idx >= lives));
}
function updateScoreUI() {
  scoreValueEl.textContent = score;
}
function showSpeech(text) {
  speechEl.textContent = text;
  speechEl.classList.add('visible');
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => speechEl.classList.remove('visible'), 3600);
}
function flashDanger() {
  dangerFlashEl.classList.add('active');
  setTimeout(() => dangerFlashEl.classList.remove('active'), 350);
}

const INTRO_LINES = [
  'Pan Janusz: Dziś sobota, a więc to czas na przydomowe robótki. Do pracy rodacy!',
  'Pan Janusz: Dzisiaj pokażę Ci jak posprzątać łąkę',
  'Pan Janusz: Dzięki temu będziesz później mogła sama posprzątać drogę gospodarczą',
  'Pan Janusz: Wtedy Rafał nie będzie tego robił, a on lubi pieniążki'
];

function playIntro() {
  showDialogueModal(INTRO_LINES);
}

function checkWin() {
  return GOOD_TYPES.every((t) => (itemCounts[t.id] || 0) >= WIN_TARGET_PER_ITEM);
}

function openGate() {
  gateGroup.visible = false;
  gateOpen = true;
}

// ---------- Mechanika "wywózki na płytę obornikową" ----------
const MEADOW_DONE_LINE = ['Pan Janusz: Czas wywieźć te śmieci na płytę obornikową.'];
const SLAB1_LINE = ['Pan Janusz: Spakuję wszystko w worek i zrobimy później ognisko.'];
const FIRE_LINE = ['Pan Janusz: I cyk zaraz potraktujemy to zapalniczką. Płonieee ogniiiisko w leeesieee lalala...'];
const ARENA_DONE_LINE = ['Pan Janusz: Kurna chata, to też trzeba wywieźć na płytę obornikową.'];
const MANURE_SLAB_HALF = 3.5; // płyta jest kwadratem 7x7

function isTractorOnManureSlab() {
  return Math.abs(tractor.position.x - MANURE_SLAB_CENTER.x) < MANURE_SLAB_HALF &&
         Math.abs(tractor.position.z - MANURE_SLAB_CENTER.z) < MANURE_SLAB_HALF;
}

function spawnBigGarbageBag(index) {
  const bag = createBigGarbageBag();
  const offsetX = index === 1 ? -0.95 : 0.95;
  bag.position.set(CAMPFIRE_PIT_CENTER.x + offsetX, 0.55, CAMPFIRE_PIT_CENTER.z);
  bag.rotation.y = index === 1 ? 0.3 : -0.5;
  scene.add(bag);
  spawnedBigBags.push(bag);
}

// ---------- Animowany "niby-ogień" na workach po podpaleniu ----------
let fireActive = false;
let fireGroup = null;

function fireMat(color) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient,
    transparent: true,
    opacity: 0.62,
    depthWrite: false
  });
}

function createFlameTongue(baseColor, tipColor, scale) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.24 * scale, 8, 6), fireMat(baseColor));
  base.scale.set(1, 1.5, 1);
  base.position.y = 0.24 * scale;
  g.add(base);
  const mid = new THREE.Mesh(new THREE.ConeGeometry(0.17 * scale, 0.55 * scale, 8), fireMat(baseColor));
  mid.position.y = 0.55 * scale;
  g.add(mid);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09 * scale, 0.4 * scale, 8), fireMat(tipColor));
  tip.position.y = 0.98 * scale;
  g.add(tip);
  g.userData.parts = [base, mid, tip];
  g.userData.scale = scale;
  return g;
}

function createFireEffect() {
  const g = new THREE.Group();
  const palette = [
    { base: 0xB3352A, tip: 0xFFC145 },
    { base: 0x8B2E1F, tip: 0xE4572E },
    { base: 0xE4572E, tip: 0xFFD166 }
  ];
  // kilka niezależnych języków ognia w różnych miejscach — nie jeden
  // wspólny stożek — dla bardziej naturalnego, "żywego" wyglądu
  const spots = [
    { x: 0, z: 0, scale: 1.5 },
    { x: 0.5, z: 0.3, scale: 1.05 },
    { x: -0.52, z: 0.22, scale: 1.15 },
    { x: 0.2, z: -0.5, scale: 0.95 },
    { x: -0.32, z: -0.45, scale: 1.0 },
    { x: 0.05, z: 0.55, scale: 0.85 }
  ];
  const tongues = [];
  spots.forEach((sp, i) => {
    const c = palette[i % palette.length];
    const tongue = createFlameTongue(c.base, c.tip, sp.scale);
    tongue.position.set(sp.x, 0, sp.z);
    tongue.userData.phase = Math.random() * 10;
    tongue.userData.baseRotY = Math.random() * Math.PI * 2;
    g.add(tongue);
    tongues.push(tongue);
  });
  g.userData.tongues = tongues;

  // unoszące się iskry — wyraźnie podkreślają, że ogień "żyje" i się unosi
  const sparkMat = toonMat(0xFFD166);
  const sparks = [];
  for (let i = 0; i < 10; i++) {
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), sparkMat);
    spark.userData.seed = Math.random() * 10;
    spark.userData.xOff = (Math.random() * 2 - 1) * 0.85;
    spark.userData.zOff = (Math.random() * 2 - 1) * 0.85;
    g.add(spark);
    sparks.push(spark);
  }
  g.userData.sparks = sparks;
  return g;
}

function igniteBags() {
  fireGroup = createFireEffect();
  // znacznie większy, żeby wyraźnie i realistycznie obejmować oba worki
  fireGroup.scale.set(1.9, 1.7, 1.9);
  // baza ognia zaczyna się od samej ziemi (nie od szczytu worka) — worki
  // "wystają" z płomieni, częściowo się z nimi przenikając
  fireGroup.position.set(CAMPFIRE_PIT_CENTER.x, 0.03, CAMPFIRE_PIT_CENTER.z);
  scene.add(fireGroup);
  fireActive = true;
}

function updateFire(dt, t) {
  if (!fireActive || !fireGroup) return;
  fireGroup.userData.tongues.forEach((tongue, i) => {
    const ph = tongue.userData.phase;
    const flick = Math.sin(t * 8 + ph);
    const flick2 = Math.sin(t * 5.3 + ph * 1.7);
    tongue.userData.parts.forEach((part, pi) => {
      part.scale.y = 1 + flick * (0.22 - pi * 0.04) + flick2 * 0.08;
      part.scale.x = part.scale.z = 1 + flick2 * 0.1;
    });
    // delikatne, niezależne kołysanie każdego języka ognia (nie synchroniczne)
    tongue.rotation.y = tongue.userData.baseRotY + Math.sin(t * 2.2 + ph) * 0.25;
    tongue.rotation.z = Math.sin(t * 3.1 + ph * 0.6) * 0.08;
    tongue.rotation.x = Math.cos(t * 2.7 + ph * 0.8) * 0.06;
  });
  fireGroup.userData.sparks.forEach((s) => {
    const cycle = ((t + s.userData.seed) % 2.4) / 2.4; // 0..1, pętla unoszenia
    s.position.set(
      s.userData.xOff * (1 - cycle * 0.4),
      0.4 + cycle * 2.6,
      s.userData.zOff * (1 - cycle * 0.4)
    );
    const fade = 1 - cycle;
    s.scale.setScalar(0.4 + fade * 0.8);
  });
}

function playMeadowDoneDialogue() {
  showDialogueModal(MEADOW_DONE_LINE, () => {
    openGate();
    awaitingSlab1 = true;
  });
}

function playArenaDoneDialogue() {
  showDialogueModal(ARENA_DONE_LINE, () => {
    awaitingSlab2 = true;
  });
}

function checkSlabDelivery() {
  if (!gameActive) return;
  if (awaitingSlab1 && isTractorOnManureSlab()) {
    awaitingSlab1 = false;
    showDialogueModal(SLAB1_LINE, () => {
      spawnBigGarbageBag(1);
    });
  } else if (awaitingSlab2 && isTractorOnManureSlab()) {
    awaitingSlab2 = false;
    spawnBigGarbageBag(2);
    setTimeout(() => {
      showDialogueModal(FIRE_LINE, () => {
        igniteBags();
        setTimeout(() => {
          showDialogueModal(MARTEN_INTRO_LINE, spawnMarten);
        }, 1600);
      });
    }, 1000);
  }
}

// ---------- Big centered dialogue modal (pauses the game) ----------
let dialogueQueue = [];
let dialogueActive = false;
let dialogueOnComplete = null;
const dialogueModalEl = document.getElementById('dialogue-modal');
const dialogueTextEl = document.getElementById('dialogue-text');

function advanceDialogue() {
  if (!dialogueActive) return;
  if (dialogueQueue.length === 0) {
    dialogueModalEl.classList.add('hidden');
    dialogueActive = false;
    gameActive = true;
    const cb = dialogueOnComplete;
    dialogueOnComplete = null;
    if (cb) cb();
    return;
  }
  dialogueTextEl.textContent = dialogueQueue.shift();
  dialogueModalEl.classList.remove('hidden');
}

function showDialogueModal(lines, onComplete) {
  dialogueQueue = lines.slice();
  dialogueOnComplete = onComplete || null;
  dialogueActive = true;
  gameActive = false; // pauza — traktor i przedmioty zamrożone, dopóki gracz nie przeklika
  advanceDialogue();
}

window.addEventListener('keydown', (e) => {
  if (dialogueActive && (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar')) {
    e.preventDefault();
    advanceDialogue();
  }
});
dialogueModalEl.addEventListener('click', () => { if (dialogueActive) advanceDialogue(); });
dialogueModalEl.addEventListener('touchstart', (e) => {
  if (dialogueActive) { e.preventDefault(); advanceDialogue(); }
}, { passive: false });

function handleCollect(type) {
  if (type.bad) {
    lives = Math.max(0, lives - 1);
    updateLivesUI();
    flashDanger();
  } else {
    score++;
    itemCounts[type.id] = (itemCounts[type.id] || 0) + 1;
    updateScoreUI();
  }
  showSpeech(type.text);

  if (lives <= 0 && gameActive) {
    gameActive = false;
    setTimeout(triggerGameOver, 1500);
  } else if (!type.bad && !plot2Unlocked && checkWin() && gameActive) {
    plot2Unlocked = true;
    // poczekaj aż dymek zebranego przedmiotu zniknie, dopiero potem kwestia Janusza
    setTimeout(playMeadowDoneDialogue, 1800);
  } else if (!type.bad && arenaStarted && !arenaCompleted && checkArenaWin() && gameActive) {
    arenaCompleted = true;
    setTimeout(playArenaDoneDialogue, 1800);
  }
}

function triggerGameOver() {
  document.getElementById('final-score').textContent = score;
  document.getElementById('gameover-screen').classList.remove('hidden');
  hudEl.classList.add('hidden');
}

function triggerVictory() {
  document.getElementById('victory-score').textContent = score;
  document.getElementById('victory-screen').classList.remove('hidden');
  hudEl.classList.add('hidden');
}

function startGame() {
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('victory-screen').classList.add('hidden');
  hudEl.classList.remove('hidden');

  score = 0;
  lives = 3;
  itemCounts = {};
  plot2Unlocked = false;
  arenaStarted = false;
  arenaCompleted = false;
  arenaGoodQueue = [];
  awaitingSlab1 = false;
  awaitingSlab2 = false;
  spawnedBigBags.forEach((b) => scene.remove(b));
  spawnedBigBags = [];
  if (fireGroup) scene.remove(fireGroup);
  fireGroup = null;
  fireActive = false;
  removeMarten();
  gateOpen = false;
  gateGroup.visible = true;
  dialogueActive = false;
  dialogueQueue = [];
  dialogueOnComplete = null;
  dialogueModalEl.classList.add('hidden');
  updateScoreUI();
  updateLivesUI();

  tractor.position.set(0, 0, 10);
  tractor.rotation.y = 0;
  speed = 0;

  clearItems();
  clearArenaItems();
  goodQueue = shuffle(
    GOOD_TYPES.flatMap((t) => [t, t])
  );
  gameActive = true;
  for (let i = 0; i < MAX_ITEMS; i++) spawnItem();

  playIntro();
}

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
document.getElementById('victory-restart-btn').addEventListener('click', startGame);

// ---------- Sekretny kod: wpisanie "janusz" w dowolnym momencie przenosi
// natychmiast na ujeżdżalnię (drugi poziom sprzątania) ----------
let secretBuffer = '';
window.addEventListener('keydown', (e) => {
  if (e.key.length !== 1) return;
  secretBuffer = (secretBuffer + e.key.toLowerCase()).slice(-6);
  if (secretBuffer === 'janusz') {
    secretBuffer = '';
    triggerSecretSkipToArena();
  }
});

function triggerSecretSkipToArena() {
  if (!gameActive) return;
  plot2Unlocked = true;
  gateOpen = true;
  gateGroup.visible = false;
  tractor.position.set(PLOT3_CENTER_X, 0, PLAY_Z_MIN + 4);
  tractor.rotation.y = 0;
  speed = 0;
  if (!arenaStarted) startArenaItems();
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (gameActive) {
    updateTractor(dt);
    updateItems(dt, t);
    checkArenaEntry();
    updateArenaItems(dt, t);
    checkSlabDelivery();
    updateMarten(dt);
    updateFire(dt, t);
  }
  updateCamera();
  renderer.render(scene, camera);
}
animate();
