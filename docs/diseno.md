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

- La decisión estratégica: cuántos aldeanos formas como albañiles (economía) y cuántos como soldados (ejército). Reentrenar a alguien en otro rol lo reinicia a nivel 1.
- Cada obra ocupa a un albañil (se elige al de más nivel). Los albañiles libres reparan solos los edificios dañados. En la barra superior: 🔨 albañiles libres / total y 🧑 aldeanos sin formar.
- Aspecto: sin formar = pícaro sencillo; albañil = bárbaro con hacha (gorro y capa con el nivel); guerrero = caballero; arquero = pícaro encapuchado; sanador = mago.

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

### 3. Batallas (fases 2 y 3)

- **Vista táctica**: selección por caja, órdenes de mover/atacar y formaciones.
- **Primera persona**: el jugador "posee" la entidad de un soldado; su IA se sustituye por el input del jugador. Al morir, el control pasa automáticamente a otro soldado vivo al azar.
- Ambas vistas son dos cámaras y dos esquemas de control sobre **la misma simulación**.

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
| 2 | Batalla RTS: simulación de combate en `shared`, IA de unidades y defensas, selección y órdenes, pathfinding | Pendiente |
| 2.5 | Servidor autoritativo de batalla (Node + WebSocket), ataques asíncronos contra la IA | Pendiente |
| 3 | Primera persona: poseer soldados, cambio táctica ↔ FPS, relevo al morir | Pendiente |
| 4 | Backend completo: cuentas, base de datos, emparejamiento, notificaciones, PvP en vivo del defensor | Pendiente |
| 5 | Empaquetado de escritorio con Electron (Windows / Linux) | Pendiente |

## Decisiones técnicas

- **Vite en lugar de Astro**: el juego es una sola página con un bucle de render; Astro encaja mejor para una futura web pública.
- **Three.js WebGPURenderer**: WebGPU cuando está disponible y WebGL 2 como red de seguridad. Si WebGPU falla en el primer frame (implementaciones antiguas o incompletas), se cambia solo a WebGL 2.
- **Electron en lugar de Tauri** para escritorio: Electron incluye su propio Chromium, así que WebGPU se comporta igual en Windows y Linux (Tauri usa WebKitGTK en Linux, con soporte WebGPU limitado).
- **pnpm workspaces** para el monorepo.
