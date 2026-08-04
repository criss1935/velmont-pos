# Velmont · Agente de impresión

Proceso Node que corre en la PC del mostrador. Escucha la tabla `print_jobs` por
Realtime, arma el ticket ESC/POS y lo manda por TCP crudo al puerto 9100 de la
impresora térmica (POS-8360, 80 mm, 203 DPI, monocromo).

No es parte del bundle del frontend: la tablet no puede abrir un socket TCP, y
un ticket perdido porque el WiFi parpadeó es una orden sin comprobante. La tabla
en medio convierte cada impresión en un job con estado, reintentos y rastro.

## Puesta en marcha

```bash
npm install
cp .env.example .env      # rellenar: service_role, STATION_ID, PRINTER_HOST
npm run make-logo         # una sola vez, o cuando cambie el logo
npm start
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Levanta el agente. |
| `npm run make-logo` | Regenera `assets/logo-thermal-80mm.png` desde el arte original. |
| `npm test` | Pruebas del rasterizado, el wrap y los templates. Sin impresora. |
| `node scripts/preview.mjs` | Pinta el ticket en consola para revisar el layout sin gastar papel. |

## El logo

`assets/logo-thermal-80mm.png` se genera **una vez** y se commitea. El agente
solo lo lee del disco y cachea el raster en memoria al primer job.

Dos cosas no obvias sobre esa conversión:

- **Se invierte.** La identidad de Velmont es dorado y blanco sobre carbón
  (`#040606`). Un cabezal térmico solo sabe quemar, así que "fondo negro"
  significa quemar los 384×223 dots enteros: sale una plancha negra, lenta, y el
  logo aparece calado en blanco. `make-logo` detecta el fondo oscuro por brillo
  medio y lo invierte (`--invert` / `--no-invert` para forzarlo).
- **Se recortan niveles antes del dithering.** Tras invertir, el fondo queda en
  ~250, no en blanco puro, y el JPEG le mete ruido encima. Floyd–Steinberg es
  honesto y ditheriza esa diferencia: el fondo entero sale rayado en diagonal y
  el logo se pierde. El recorte (`--black=170 --white=235`) manda el "casi
  fondo" a blanco y el dorado a negro sólido, y deja que el dithering trabaje
  donde sí aporta: los degradados del monograma y los bordes de las letras.

El script avisa si el resultado supera el 45% de cobertura de tinta. El logo
actual va en 5.3%.

## Ancho de línea

`TICKET_COLS` está en **32** por especificación. Es el ancho típico de una 58 mm;
una 80 mm con Font A entra a 48 caracteres. A 32 el ticket se lee bien pero deja
un margen derecho ancho. Subirlo a 48 es un cambio de una variable: el wrap, los
separadores y las filas etiqueta–valor lo leen de ahí.

## Estados de un job

```
pending ──► printing ──► done
   ▲            │
   └────────────┘  (falla, y quedan intentos)
                │
                └──► error  (agotó MAX_ATTEMPTS)
```

El agente reclama cada job con un `UPDATE ... WHERE status = 'pending'`. Es lo
que impide que Realtime y el barrido periódico impriman el mismo ticket dos
veces: solo uno gana el UPDATE.

Además de Realtime hay un `drainPending()` cada 15 s. Realtime se cae en
silencio (WiFi del local, suspensión de la PC) y un POS no puede permitirse un
comprobante que nunca se imprimió porque el websocket estaba muerto.

## Lo que estas pruebas NO cubren

`npm test` verifica los bytes que se generan, no lo que sale en papel. Falta
—y solo se puede hacer con la impresora física conectada—:

- Que la POS-8360 respete `ESC a 1` para centrar el raster `GS v 0`. Casi todas
  lo hacen; algunas ignoran la justificación en imágenes y sacan el logo pegado
  a la izquierda. Si pasa eso, la solución es rellenar el raster con blanco
  hasta los 576 dots en vez de centrarlo por comando.
- Que CP437 sea la página de códigos de fábrica de esta unidad. Si los acentos
  salen mal, es cambiar el `ESC t n` de `escpos.js`.
- El calibrado de densidad del cabezal y la posición real del corte parcial.
