# Clash of War

Juego de estrategia en el navegador inspirado en Clash of Clans, con tres giros:

1. **Aldeanos como unidad base**: se entrenan en edificios específicos para aprender un rol (guerrero, arquero, sanador) y subirlo de nivel.
2. **Primera persona en batalla**: al atacar o defender puedes tomar el control de un soldado; si muere, pasas a otro al azar.
3. **Vista táctica ↔ primera persona**: cambia en cualquier momento entre mandar al ejército desde arriba (RTS) y luchar en persona.

Ahora mismo están implementadas la **fase 1: construcción de la aldea** (con arte 3D, animaciones, partículas y postprocesado) y la **fase 2: batallas RTS** contra aldeas generadas. Ver [docs/diseno.md](docs/diseno.md) para el diseño completo y la hoja de ruta.

## Cómo ejecutarlo

Requisitos: Node 20+ y [pnpm](https://pnpm.io) 10.

```bash
pnpm install
pnpm dev          # abre http://localhost:5173
```

Otros comandos:

```bash
pnpm test         # tests de la simulación (vitest)
pnpm typecheck    # comprobación de tipos de todo el monorepo
pnpm build        # build de producción del cliente
```

El render usa **WebGPU** y cae automáticamente a **WebGL 2** si el navegador no lo soporta, si su implementación falla en el primer frame o si el dispositivo se pierde durante la partida. Para forzar WebGL 2: `http://localhost:5173/?renderer=webgl`. El backend activo se muestra arriba a la derecha.

La calidad gráfica (Alta: oclusión ambiental + bloom + SMAA · Media: bloom + FXAA · Baja: sin postprocesado) se elige arriba a la derecha. Mientras no se elija, el juego la ajusta solo según los FPS.

### Probar con WebGPU real

```bash
tools/get-chrome.sh   # descarga Chrome for Testing en .chrome/
pnpm build
pnpm smoke            # arranca el build en Chrome con WebGPU y verifica que todo funciona
```

Sin GPU (servidores, CI) Chrome usa SwiftShader como Vulkan por software: funciona, pero a pocos FPS.

### Galería de assets

`http://localhost:5173/gallery.html` muestra todos los modelos y personajes empaquetados (`?filter=_blue`, `?filter=char`…).

### Regenerar los assets

Los `.glb` de `packages/client/public/assets/` ya están en el repo. Para regenerarlos desde los packs originales de KayKit:

```bash
git clone --depth 1 https://github.com/KayKit-Game-Assets/kaykit-medieval-hexagon-pack-1.0 ../kaykit/kaykit-medieval-hexagon-pack-1.0
git clone --depth 1 https://github.com/KayKit-Game-Assets/kaykit-character-pack-adventures-1.0 ../kaykit/kaykit-character-pack-adventures-1.0
KAYKIT_DIR=../kaykit pnpm assets
```

## Controles

| Acción | Control |
| --- | --- |
| Recolectar recursos | Pasar el ratón por la burbuja del edificio (o tocarla) |
| Seleccionar edificio | Clic |
| Desplazar cámara | Arrastrar con clic izquierdo · WASD |
| Rotar cámara | Arrastrar con clic derecho |
| Zoom | Rueda |
| Cancelar / deseleccionar | Esc · clic derecho |
| Colocar en cadena | Mayús + clic (los muros lo hacen siempre) |

### En batalla

| Acción | Control |
| --- | --- |
| Desplegar tropa | Elegirla abajo y clic (o arrastrar) fuera de la zona roja |
| Seleccionar unidades | Clic o arrastrar con el botón izquierdo (Mayús: añadir) |
| Mover / atacar | Clic derecho en el suelo / sobre un enemigo o edificio |
| Desplazar cámara | Botón central · WASD |
| Rotar cámara | Arrastrar con clic derecho |
| Dejar de desplegar / deseleccionar | Esc |

Los botones ×1 / ×5 / ×20 aceleran el tiempo para probar, y **💥 Simular ataque** daña edificios al azar para ver cómo los aldeanos los reparan. La partida se guarda sola en `localStorage`, y al volver la aldea avanza lo que haya pasado mientras estabas fuera (hasta 8 h).

## Estructura

```
packages/
  shared/   Simulación del juego en TypeScript puro: datos, estado, comandos, tick.
            Sin dependencias de navegador → la reutilizará el servidor autoritativo.
  client/   Vite + Three.js (WebGPURenderer + TSL) + Preact para la interfaz.
docs/       Documento de diseño y hoja de ruta.
tools/      Pipeline de assets (gltf-transform) y prueba de humo con WebGPU.
```

## Créditos

Modelos 3D y animaciones: **KayKit** Medieval Hexagon Pack y Character Pack Adventures, de [Kay Lousberg](https://www.kaylousberg.com) (licencia CC0).
