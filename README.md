# Clash of War

Juego de estrategia en el navegador inspirado en Clash of Clans, con tres giros:

1. **Aldeanos como unidad base**: se entrenan en edificios específicos para aprender un rol (guerrero, arquero, sanador) y subirlo de nivel.
2. **Primera persona en batalla**: al atacar o defender puedes tomar el control de un soldado; si muere, pasas a otro al azar.
3. **Vista táctica ↔ primera persona**: cambia en cualquier momento entre mandar al ejército desde arriba (RTS) y luchar en persona.

Ahora mismo está implementada la **fase 1: construcción de la aldea**. Ver [docs/diseno.md](docs/diseno.md) para el diseño completo y la hoja de ruta.

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

El render usa **WebGPU** y cae automáticamente a **WebGL 2** si el navegador no lo soporta o su implementación falla. Para forzar WebGL 2: `http://localhost:5173/?renderer=webgl`. El backend activo se muestra arriba a la derecha.

## Controles

| Acción | Control |
| --- | --- |
| Seleccionar edificio | Clic |
| Desplazar cámara | Arrastrar con clic izquierdo · WASD |
| Rotar cámara | Arrastrar con clic derecho |
| Zoom | Rueda |
| Cancelar / deseleccionar | Esc · clic derecho |
| Colocar en cadena | Mayús + clic (los muros lo hacen siempre) |

Los botones ×1 / ×5 / ×20 aceleran el tiempo para probar. La partida se guarda sola en `localStorage`, y al volver la aldea avanza lo que haya pasado mientras estabas fuera (hasta 8 h).

## Estructura

```
packages/
  shared/   Simulación del juego en TypeScript puro: datos, estado, comandos, tick.
            Sin dependencias de navegador → la reutilizará el servidor autoritativo.
  client/   Vite + Three.js (WebGPURenderer) + Preact para la interfaz.
docs/       Documento de diseño y hoja de ruta.
```
