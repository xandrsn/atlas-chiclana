// Interface language: the Spanish strings in the code are the keys; English comes from this table. t() for text written while playing,
// translate(root) for DOM already built (text nodes, title and aria-label found in the table, both ways). Names of places and the F3 panel stay in Spanish.
const EN = {
  // loading
  'Leyendo configuración…': 'Reading settings…', 'Cargando índice de celdas…': 'Loading the cell index…', 'Preparando el render…': 'Preparing the renderer…', 'Viajando…': 'Travelling…', 'Arrancando…': 'Starting…',
  'Cargando celdas… {0} listas · {1} en camino': 'Loading cells… {0} ready · {1} on the way', 'Progreso de carga': 'Loading progress', 'Consejo': 'Tip',
  'En las salinas el suelo es blando y el viento sopla de lado: entra en las curvas con suavidad.': 'On the salt pans the ground is soft and the wind blows sideways: take the bends gently.',
  'W y S para acelerar y frenar, A y D para girar, Espacio para el freno de mano.': 'W and S to accelerate and brake, A and D to steer, Space for the handbrake.',
  'Pulsa V para subir a la cámara aérea y ver la ciudad desde arriba.': 'Press V for the aerial camera and see the town from above.',
  'Con la marea baja, el castillo de Sancti Petri parece estar al alcance de la mano. No lo está.': 'At low tide, Sancti Petri castle looks within reach. It is not.',
  'Las casas encaladas reflejan el sol del mediodía: a esa hora, mejor buscar la sombra.': 'Whitewashed houses reflect the midday sun: at that hour, look for shade.',
  'Al anochecer se encienden las farolas y las ventanas; la niebla se acerca y la ciudad se encoge.': 'At dusk the street lamps and windows light up; the mist closes in and the town shrinks.',
  'F3 abre el panel de rendimiento: fotogramas, celdas cargadas y tiempo de cada sistema.': 'F3 opens the performance panel: frames, loaded cells and the time each system takes.',
  'Los atardeceres en La Barrosa son largos: buena hora para un paseo por la orilla.': 'Sunsets at La Barrosa are long: a good time for a walk along the shore.',
  'Si el juego va lento, baja la calidad con ?q=bajo en la dirección.': 'If the game runs slowly, lower the quality with ?q=bajo in the address.',
  // HUD
  'Fuera del mapa': 'Outside the map', 'Hora del juego': 'Game time', 'Vehículo en uso': 'Vehicle in use', 'Clic para capturar el ratón · Esc pausa': 'Click to capture the mouse · Esc pause',
  'WASD mover/conducir · Mayús correr · Espacio saltar/freno · F entrar/salir · ratón cámara · Esc pausa (controles) · V aérea · T +1 hora · F3 rendimiento': 'WASD move/drive · Shift run · Space jump/brake · F enter/exit · mouse camera · Esc pause (controls) · V aerial · T +1 hour · F3 performance',
  'noche': 'night', 'amanecer': 'dawn', 'mañana': 'morning', 'mediodía': 'midday', 'tarde': 'afternoon', 'atardecer': 'sunset',
  'Autobús': 'Bus', 'Camión': 'Lorry', 'Camión de basura': 'Bin lorry', 'Moto': 'Motorcycle', 'Escúter': 'Scooter', 'Helicóptero': 'Helicopter', 'Topadora': 'Bulldozer', 'Tranvía': 'Tram',
  ' · F bajar': ' · F get off', 'F · subir al tranvía': 'F · board the tram',
  // pause menu
  'Pausa': 'Paused', 'Reanudar': 'Resume', 'Mapa (M)': 'Map (M)', 'Controles': 'Controls', 'Cómo jugar': 'How to play', 'Calidad': 'Quality', 'Bajo': 'Low', 'Medio': 'Medium', 'Alto': 'High', 'Ultra (mucha RAM)': 'Ultra (lots of RAM)',
  'Idioma': 'Language', 'Sensibilidad del ratón': 'Mouse sensitivity', 'Invertir eje Y': 'Invert Y axis', 'Volumen (reservado)': 'Volume (reserved)', 'Eventos': 'Events',
  'Mapa': 'Map', 'Aparecer en': 'Start at', 'Ir': 'Go', '(no disponible)': '(not available)',
  'Espacio': 'Space', 'Intro': 'Enter', 'Mayús': 'Shift', 'Mayús dcha.': 'Right Shift', 'Mayús / Mayús dcha.': 'Shift / Right Shift', 'Ratón': 'Mouse', 'Rueda': 'Wheel', 'Mando': 'Gamepad', 'Trucos de prueba': 'Test cheats', 'Escribe': 'Type', 'Panel de rendimiento': 'Performance panel',
  'Girar la cámara (clic en la pantalla para capturarlo)': 'Turn the camera (click the screen to capture it)', 'Acercar / alejar la cámara': 'Zoom the camera in / out',
  'Stick izq. mover · stick der. cámara · A saltar/freno de mano · B correr · Y entrar/salir · RT/LT acelerar/frenar · Start pausa': 'Left stick move · right stick camera · A jump/handbrake · B run · Y enter/exit · RT/LT accelerate/brake · Start pause',
  'Avanzar / acelerar': 'Forward / accelerate', 'Retroceder / frenar y marcha atrás': 'Back / brake and reverse', 'Izquierda / girar': 'Left / steer', 'Derecha / girar': 'Right / steer', 'Correr (a pie) · bajar (helicóptero)': 'Run (on foot) · descend (helicopter)',
  'Saltar (a pie) · freno de mano (en vehículo) · subir (helicóptero)': 'Jump (on foot) · handbrake (vehicle) · climb (helicopter)', 'Entrar / salir del vehículo (helicóptero: solo posado)': 'Enter / leave the vehicle (helicopter: only when landed)',
  'Cámara aérea (pruebas)': 'Aerial camera (testing)', 'Volver a poner el vehículo sobre sus ruedas (si ha volcado)': 'Put the vehicle back on its wheels (if it rolled over)', 'Topadora: subir la cuchilla': 'Bulldozer: raise the blade', 'Topadora: bajar la cuchilla': 'Bulldozer: lower the blade', 'Pausa y soltar el ratón': 'Pause and release the mouse',
  'pone el mediodía': 'sets midday', 'pone la noche': 'sets night', 'cambia tu coche al siguiente modelo del catálogo (también tecla N)': 'changes your car to the next model in the catalogue (also the N key)',
  'trae el helicóptero delante de ti': 'brings the helicopter in front of you', 'trae la supertopadora Hornaza Derribo Titan delante de ti': 'brings the giant bulldozer Hornaza Derribo Titan in front of you', 'trae el helicóptero delante de ti (atajo)': 'brings the helicopter in front of you (shortcut)',
  // map, metro, tram
  'Rueda: zoom · arrastrar: mover · M o Esc: volver': 'Wheel: zoom · drag: move · M or Esc: back', '■ sitio ·': '■ place ·', 'metro ·': 'metro ·', 'tren/tranvía ·': 'train/tram ·', 'helicóptero ·': 'helicopter ·', 'tu coche': 'your car', 'Volver': 'Back',
  'Tu helicóptero': 'Your helicopter', 'Tu coche': 'Your car',
  'Parada': 'Stop', 'Destinos': 'Destinations', 'Larga distancia': 'Long distance', 'Cerrar (Esc)': 'Close (Esc)', ' · aquí': ' · here', 'Plano de la línea: haz clic en una parada para viajar': 'Line map: click a stop to travel',
  'Arrastra para mover · rueda: zoom · clic en una parada para viajar': 'Drag to move · wheel: zoom · click a stop to travel', 'Arrastra para mover · rueda: zoom · clic en una estación para viajar': 'Drag to move · wheel: zoom · click a station to travel',
  'Plano de la red de metro: haz clic en una estación para viajar': 'Metro map: click a station to travel', 'Estás en': 'You are at', 'Líneas': 'Lines', 'Subir a la calle': 'Up to the street', 'Salir por otra boca': 'Leave by another entrance',
  'Estaciones de la línea {0}': 'Stations on line {0}', '{0} boca': '{0} entrance', '{0} bocas': '{0} entrances', 'Metro {0}: baja la escalera': 'Metro {0}: go down the stairs',
  // how to play (ui/tutorial.js)
  'Te damos la bienvenida': 'Welcome', 'Chiclana de la Frontera en 3D, hecha con datos públicos. Muévete a tu aire: a pie, en coche o en helicóptero.': 'Chiclana de la Frontera in 3D, built from public data. Go wherever you like: on foot, by car or by helicopter.',
  'A pie': 'On foot', 'Al volante': 'Driving', 'En helicóptero': 'Flying', 'Y además': 'And also', 'caminar': 'walk', 'correr': 'run', 'saltar': 'jump', 'mirar alrededor (antes, clic en la pantalla)': 'look around (click the screen first)',
  'subir al vehículo más cercano, y bajar': 'get into the nearest vehicle, and out', 'acelerar, frenar y girar': 'accelerate, brake and steer', 'freno de mano': 'handbrake', 'ponerlo derecho si ha volcado': 'set it upright if it rolled over',
  'escríbelo y aparece uno delante': 'type it and one appears in front of you', 'ganar altura': 'climb', 'perder altura': 'descend', 'avanzar, frenar y girar': 'fly forward, slow down and turn',
  'mapa': 'map', 'una hora más: cambian el sol y las sombras': 'one hour later: the sun and the shadows change', 'cambiar el modelo de tu coche': 'change the model of your car', 'pausa: calidad, idioma, eventos, controles y esta ayuda': 'pause: quality, language, events, controls and this help', 'Empezar': 'Start',
};
const ES = Object.fromEntries(Object.entries(EN).map(([a, b]) => [b, a])), KEY = 'v2.lang', subs = [];
let saved = null; try { saved = localStorage.getItem(KEY); } catch {}
export let lang = saved === 'en' || saved === 'es' ? saved : /^(es|ca|gl|eu)\b/.test(globalThis.document && navigator.language || 'es') ? 'es' : 'en';

/** Spanish text -> current language; {0}, {1}… are filled with the arguments */
export const t = (es, ...a) => (lang === 'en' ? EN[es] ?? es : es).replace(/\{(\d)\}/g, (_, i) => a[i]);
export const hasEN = es => es in EN;
/** whole string in either language -> current language, outer spaces kept */
const conv = s => { const k = s.trim(), v = k && (lang === 'en' ? EN : ES)[k]; return v ? s.replace(k, () => v) : s; };
export function translate(root) {
  const w = document.createTreeWalker(root, 4);   // 4 = text nodes
  while (w.nextNode()) { const n = w.currentNode, v = conv(n.data); if (v !== n.data) n.data = v; }
  for (const e of [root, ...root.querySelectorAll('[title], [aria-label]')]) for (const k of ['title', 'aria-label']) { const s = e.getAttribute(k); if (s) e.setAttribute(k, conv(s)); }
  return root;
}
/** fn(lang) after every change of language (texts with values inside) */
export const onLang = fn => subs.push(fn);
export function setLang(l) {
  lang = l; try { localStorage.setItem(KEY, l); } catch {}
  document.documentElement.lang = l; translate(document.body); subs.forEach(f => f(l));
}
/** ES | EN buttons; several may be on the page at once */
export function langSwitch() {
  const el = document.createElement('span'); el.className = 'v2-lang'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', t('Idioma'));
  for (const [l, name] of [['es', 'Español'], ['en', 'English']]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: l.toUpperCase(), lang: l, onclick: () => setLang(l) });
    b.dataset.lang = l; b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', l === lang); el.append(b);
  }
  return el;
}
onLang(l => document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === l)));
if (globalThis.document) document.documentElement.lang = lang;
