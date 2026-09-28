# Documento de diseño

## Visión

Constructor de aldeas asíncrono (estilo Clash of Clans) cuyo ejército está formado por **aldeanos entrenados**, y cuyas batallas se pueden vivir en **vista táctica (RTS)** o **en primera persona** poseyendo a cualquier soldado.

## Pilares

### 1. Aldeanos y roles

- Todo habitante es un aldeano. Los nuevos llegan a la **Posada**: se reclutan con comida y tardan un rato en llegar (más nivel = más plazas a la vez y menos espera). Necesitan alojamiento (ayuntamiento + casas), y los que vienen en camino ya lo ocupan.
- Un aldeano recién llegado está **sin formar** y no hace nada útil: hay que mandarlo a un edificio de formación.
- Cada rol se aprende en su edificio y el nivel del edificio limita el nivel del rol:

  | Edificio | Rol | Para qué sirve |
  | --- | --- | --- |
  | Taller | Albañil | Los **únicos** que construyen, mejoran y reparan. Más nivel = trabajan más rápido (×1 / ×1,35 / ×1,75). |
  | Cuartel | Guerrero | Cuerpo a cuerpo. |
  | Campo de tiro | Arquero | A distancia. |
  | Templo | Sanador | Cura a los aliados. |
  | Taller de asedio (ayto. 2) | Catapulta | Lanza rocas con daño en área por encima de las murallas; solo ataca edificios. Lenta y frágil. |

- La decisión estratégica: cuántos aldeanos formas como albañiles (economía) y cuántos como soldados (ejército). **El oficio es para siempre**: un aldeano formado solo puede subir de nivel en su rol, nunca cambiarlo.
- Cada obra ocupa a un albañil (se elige al de más nivel). Los albañiles libres reparan solos los edificios dañados. En la barra superior: 🔨 albañiles libres / total y 🧑 aldeanos sin formar.
- Aspecto: sin formar = pícaro sencillo; albañil = bárbaro con hacha (gorro y capa con el nivel); guerrero = caballero; arquero = pícaro encapuchado; sanador = mago; catapulta = pícaro con bomba que empuja su máquina.

### 2. Economía (como en Clash of Clans)

- Recursos: oro, madera y comida.
- **Granja, aserradero y mina producen solos** hacia su propio depósito, hasta una capacidad por nivel. Lleno, dejan de producir.
- Cuando hay algo acumulado aparece una **burbuja** sobre el edificio: **pasar el ratón** por encima (o tocarla) lo recolecta; los iconos vuelan hasta el contador. También hay un botón *Recolectar* en el panel del edificio.
- Lo recolectado va a los almacenes (ayuntamiento + almacenes). Si están llenos, solo se recoge lo que cabe y el resto se queda en el productor.
- Los edificios en mejora o destruidos no producen.
- El nivel del ayuntamiento limita cuántos edificios de cada tipo puedes tener y a qué nivel mejorarlos.

### 2b. Daño y reparación

- Cada edificio tiene vida. A 0 queda **destruido** (escombros) y deja de funcionar.
- Los albañiles libres acuden solos a repararlo (≈5 % de la vida por segundo, más rápido con más nivel). Un edificio dañado no se puede mejorar.
- Las batallas (fase 2) usarán `applyDamage` de la simulación; mientras tanto, el botón **💥 Simular ataque** daña edificios al azar para probarlo.

### 3. Batallas

**Fase 2 (hecha): batalla RTS contra aldeas generadas.**

- **Buscar oponente** (botón ⚔️ Atacar): se genera una aldea enemiga de tu nivel de ayuntamiento, con anillo de muros, torres de arqueros y almacenes dentro, economía y cuarteles fuera, y defensores que protegen su puesto. En la fase de *reconocimiento* ves su botín y puedes pasar a la siguiente o volver; el tiempo (3 min) empieza con el primer despliegue.
- **Tu ejército son tus aldeanos**: van a la batalla los soldados libres (guerreros, arqueros, sanadores) con su nivel. Los albañiles no combaten.
- **Despliegue** como en Clash of Clans: eliges tropa abajo y haces clic o arrastras fuera de la **zona roja** (1 celda alrededor de cualquier edificio en pie; se reduce al destruirlos).
- **Control RTS**: arrastrar con el botón izquierdo para seleccionar, clic derecho sobre el suelo para mover (en formación) o sobre un enemigo/edificio para atacarlo; «Ataque libre» los devuelve a su IA. Botón central/WASD para desplazar, derecho + arrastrar para rotar.
- **IA**: sin órdenes, los guerreros y arqueros atacan al enemigo cercano o al edificio más próximo; los sanadores curan al aliado más herido y siguen al grupo; los defensores salen a por quien se acerque a su puesto y vuelven; las torres disparan al atacante más cercano.
- **Caminos**: A* sobre la cuadrícula; los muros cuestan mucho pero se pueden atravesar rompiéndolos, así que las unidades rodean si hay hueco y abren brecha si no.
- **Catapultas**: buscan el edificio más cercano que no sea muralla (alcance 9–11) y disparan por encima de todo; la roca hace daño en área (la mitad alrededor del impacto).
- **Murallas**: se construyen como un edificio más (antes se llamaban «Muro»). En modo colocación, **arrastrar** traza una línea recta horizontal o vertical: se previsualiza en verde/rojo según hueco, límite del ayuntamiento y recursos, y al soltar se encarga un tramo por celda (las ocupadas se saltan).
- **Resultado**: 1★ por 50 % de destrucción, 1★ por el ayuntamiento, 1★ por el 100 %. El botín de cada edificio se consigue al destruirlo y se suma a tus almacenes (lo que no quepa se pierde).
- **Heridos y enfermería**: los soldados que caen vuelven **heridos** si queda cama libre en alguna **enfermería** (3 / 5 / 8 camas por nivel; se reparten primero a los de más nivel). **Si no hay camas, mueren** y desaparecen de la aldea. Los heridos **no se curan solos**: en el panel de la enfermería se paga la cura de todos los que esperan (40 🌾 + 25 🪙 por nivel de cada soldado) y tarda 30 s por nivel sumado, más rápido en enfermerías mejores (×1 / ×1,3 / ×1,7). Mientras, no pueden combatir.

**Campamentos de monstruos**

- En los claros del bosque que rodea la aldea aparecen **campamentos de esqueletos** (uno al empezar y otro cada 8 min, hasta 3). Su nivel ronda el de tu ayuntamiento (±1).
- Se atacan desde su etiqueta (o haciendo clic en ellos): tiendas y cofres con botín, tótems que lanzan magia y una guardia de esbirros, guerreros, ballesteros, nigromantes y, desde nivel 3, un **Señor de los huesos**.
- Cada monstruo suelta botín al morir; cofres y tiendas, al destruirlos. 2.ª estrella = todos los monstruos muertos. **Arrasar** el campamento lo hace desaparecer del mapa.
- Las reglas de heridos y enfermería son las mismas que en cualquier batalla.
- La simulación (`packages/shared/src/battle`) es determinista a 20 ticks/s y solo cambia con comandos (`deploy`, `order`, `surrender`): está lista para ejecutarse en el servidor.

**Fase 3 (pendiente)**: primera persona, poseyendo a una de tus unidades; al morir, el control pasa a otra al azar.

### 4. Modelo de defensa híbrido

Cuando alguien ataca tu aldea:

1. El defensor recibe una **notificación** (push/email/escritorio).
2. **Si no se conecta**, defiende la IA (torres, muros y soldados en guardia), como en Clash of Clans.
3. **Si se conecta**, la batalla pasa a ser **PvP en tiempo real**: el defensor puede mandar a sus tropas en vista táctica o poseer a un defensor en primera persona.

Implicaciones técnicas:
- La batalla siempre corre en un **servidor autoritativo** (aunque solo juegue la IA), para que el defensor se pueda unir a mitad de combate.
- Netcode: simulación a tick fijo en el servidor, predicción del lado del cliente para la unidad poseída e interpolación para el resto.
- La lógica de batalla vive en `packages/shared` para que cliente y servidor ejecuten exactamente el mismo código.

## Arquitectura

- **`packages/shared`**: simulación determinista en TypeScript puro.
  - `data.ts`: todo el balance (costes, tiempos, estadísticas).
  - `state.ts`: `GameState` plano y serializable.
  - `commands.ts`: la **única** forma de modificar el estado. Cada comando se valida y, si falla, no modifica nada. Mañana el cliente enviará estos mismos comandos al servidor.
  - `sim.ts`: `tick()` a 10 Hz (producción, obras, entrenamiento) y `advance()` para el progreso offline.
  - PRNG con semilla guardada en el estado → resultados reproducibles.
- **`packages/client`**:
  - `game/GameController`: bucle de simulación a tick fijo, independiente de los FPS.
  - `render/`: Three.js `WebGPURenderer` (con fallback a WebGL 2), modelos low-poly procedurales provisionales, aldeanos animados y barras de progreso ancladas en 3D.
  - `ui/`: Preact para el HUD y los paneles.

## Dirección visual

Estética *low-poly* colorida y cálida, en la línea de los constructores de aldeas móviles.

- **Monstruos**: pack CC0 KayKit Skeletons (mismo rig que los aventureros) con sus armas colgadas de los huesos de las manos y animaciones propias (burlas, guardia, muerte desmoronándose, despertar del suelo).
- **Procedurales**: catapulta con brazo que golpea y se recarga y ruedas que giran al avanzar, cofre con monedas, tótem de calaveras con orbe brillante, hoguera, catres y estandarte de la enfermería.
- **Modelos**: packs CC0 de KayKit. Cada edificio usa un modelo por nivel (casa → casa grande → taberna; torre A → torre B → torre con catapulta; empalizada → muro de piedra → muralla) y añade *props* al subir de nivel (banderas, torres en el ayuntamiento, barriles, dianas…).
- **Obras**: cimientos → fase A → B → C con andamio; las mejoras muestran andamio alrededor del edificio.
- **Aldeanos**: personajes riggeados con 26 animaciones compartidas. Civil = bárbaro con hacha o jarra; guerrero = caballero (casco, capa y escudo mejor según nivel); arquero = pícaro con ballesta; sanador = mago con bastón. Animaciones según la tarea: talar, cosechar, construir, entrenar con espada, disparar, lanzar hechizos, descansar, celebrar el ascenso.
- **Animación procedural**: aparición con *squash & stretch*, salto al seleccionar, aspas de molino y sierras que giran solo si hay trabajadores, banderas ondeando, trigo, hierba y árboles con viento (shaders TSL).
- **Partículas** (sprites instanciados en GPU): polvo al construir y mover, humo de chimeneas, chispas al martillear, astillas, destellos de oro, magia, confeti al terminar una obra o ascender.
- **Entorno**: terreno con colinas y lago generado por ruido, agua animada con espuma en la orilla, bosque y montañas instanciados, nubes a la deriva, césped en damero dentro de la parcela y camino de tierra alrededor.
- **Postprocesado**: GTAO, bloom, SMAA/FXAA, viñeta y gradación de color, con tres niveles de calidad y ajuste automático por FPS.
- **Interfaz**: miniaturas 3D renderizadas en tiempo real para la tienda y los paneles, contadores animados, popups de producción ("+12 🌾"), anuncios de nivel y paneles con entradas elásticas.

## Hoja de ruta

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Construcción de la aldea: edificios, economía, aldeanos, entrenamiento de roles, guardado local | ✅ Hecha |
| 1.5 | Pulido: arte glTF, animaciones, partículas, postprocesado ✅ · sonido y balance pendientes | En curso |
| 2 | Batalla RTS: simulación de combate en `shared`, IA de unidades y defensas, selección y órdenes, pathfinding | ✅ Hecha |
| 2.2 | Catapultas y taller de asedio, murallas arrastrando, campamentos de monstruos, enfermería con cura de pago | ✅ Hecha |
| 2.5 | Servidor autoritativo de batalla (Node + WebSocket), ataques asíncronos contra la IA | Pendiente |
| 3 | Primera persona: poseer soldados, cambio táctica ↔ FPS, relevo al morir | Pendiente |
| 4 | Backend completo: cuentas, base de datos, emparejamiento, notificaciones, PvP en vivo del defensor | Pendiente |
| 5 | Empaquetado de escritorio con Electron (Windows / Linux) | Pendiente |

## Decisiones técnicas

- **Vite en lugar de Astro**: el juego es una sola página con un bucle de render; Astro encaja mejor para una futura web pública.
- **Three.js WebGPURenderer**: WebGPU cuando está disponible y WebGL 2 como red de seguridad. Si WebGPU falla en el primer frame (implementaciones antiguas o incompletas), se cambia solo a WebGL 2.
- **Electron en lugar de Tauri** para escritorio: Electron incluye su propio Chromium, así que WebGPU se comporta igual en Windows y Linux (Tauri usa WebKitGTK en Linux, con soporte WebGPU limitado).
- **pnpm workspaces** para el monorepo.
