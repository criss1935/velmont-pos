# Velmont POS

Punto de venta para **Velmont**, negocio de limpieza y cuidado de calzado (tenis;
después bolsas y gorras). Corre en una tablet Android en el mostrador, con
impresora térmica. Instalable como PWA.

## Stack

- **Vite + React 19 + TypeScript** (SPA, sin SSR — un POS no necesita SEO).
- **Supabase** (Postgres + Auth + RLS). Proyecto: `velmont-pos`, ref
  `zagpfcaizhteizqlserj`, región `us-east-2`.
- **CSS Modules + design tokens** en `src/styles/tokens.css`. Sin Tailwind ni
  Bootstrap: el look es un sistema propio.
- **TanStack Query** para datos de servidor, **Zustand** para estado de sesión y
  carrito.

## Reglas que no se rompen

1. **El dinero son centavos enteros.** Nunca float. El tipo `Cents`
   (`src/lib/money.ts`) impide mezclar pesos y centavos en compilación. Todo
   cálculo de importes pasa por ahí.

2. **La UI no toca Supabase.** El cliente vive encerrado en `src/data/client.ts`,
   y solo los repositorios de `src/data/repositories/*` lo importan. Las pantallas
   hablan con repositorios (`import { orders, cash, ... } from '@/data'`). Esa
   frontera es lo que permitirá añadir cola offline sin reescribir pantallas.

3. **La lógica de dinero vive en la base, no en el cliente.** Totales de la orden,
   saldo, stock y efectivo esperado los calculan triggers y vistas. Dos tablets
   no pueden descuadrar porque ninguna suma por su cuenta. Operaciones que deben
   ser atómicas (crear orden con líneas, cerrar caja) son funciones RPC — ver
   `supabase/migrations/0004` y `0005`.

4. **RLS es lo único que separa la base de internet.** La clave anon viaja en el
   bundle. Toda tabla tiene políticas (`supabase/migrations/0002`). Tras cualquier
   cambio de esquema: correr el advisor de seguridad de Supabase.

5. **Los tipos de la base son generados, no escritos.** `src/data/database.types.ts`
   sale de `supabase gen types`. No editar a mano; regenerar tras cada migración.
   No recortar los bloques `Relationships`: supabase-js los usa para los joins.

## Estructura

```
src/
  data/            Frontera de datos. Repositorios + tipos de dominio. Nadie
                   fuera de aquí importa supabase-js.
  components/ui/   Primitivos (Button, Card, Input, Modal, Badge) sobre tokens.
  features/
    auth/          Login.
    orders/        Recibir (ReceivePage), tablero (OrdersPage), detalle+cobro.
    customers/     CRUD + buscador reutilizable (CustomerPicker).
    cash/          Apertura, movimientos, caja chica y corte de caja.
    inventory/     Insumos y movimientos de stock.
    reports/       Reportes de venta (solo admin).
    printing/      Capa de impresión abstracta (ver abajo).
  app/             Shell: router, layout, store de sesión.
  lib/             money, dates, cn.
  styles/          tokens, reset, global.
supabase/
  migrations/      0001 esquema · 0002 RLS · 0003 endurecimiento ·
                   0004 create_order · 0005 close_cash_session ·
                   0020 caja chica (fondo fijo + fund_petty_cash)
  seed.sql         Catálogo inicial (PRECIOS A CONFIRMAR con el cliente).
                   Idempotente — correr de más no duplica.
scripts/
  seed-local.mjs     Aplica seed.sql al Docker local vía `docker exec` + psql
                     (evita la limitación multi-statement de `supabase db
                     query`). Usar `npm run db:seed`.
  verify-seed.mjs    Chequeo no bloqueante de que el catálogo base existe.
                     Usar `npm run db:verify-seed`.
```

**Ojo con `supabase db reset`**: si falla (pasó en Windows/Docker) y te recuperas con
`supabase migration up` o `supabase stop && supabase start`, `seed.sql` NO se
vuelve a correr solo — esos comandos no disparan el seed, solo un `db reset`
exitoso lo hace. El catálogo se queda vacío en silencio, sin ningún error que
lo delate (la pantalla de Recibir simplemente se ve vacía). Corre
`npm run db:seed` después de cualquier recuperación así, y `npm run
db:verify-seed` si tienes dudas de si el catálogo está completo.

## Impresión

`src/features/printing`. El ticket **no es HTML**: es un `TicketDocument` (lista de
bloques con semántica) que cada driver renderiza a su manera. Hoy hay un solo
driver, `PreviewPrinter` (diálogo de impresión del navegador / impresora del
sistema Android), que ya permite operar. Cuando se defina el modelo de impresora
se agrega el driver (RawBT, ESC/POS Bluetooth o red) en `printers.ts` y ninguna
pantalla cambia — todas llaman a `getPrinter().print()` / `tryPrint()`.

## Caja chica

Fondo fijo aparte del cajón, para gastos menores del día (material, envíos,
papelería). Migración `0020`. Vive FUERA del turno: `cash_movements` cuelga de
una `cash_session` y muere con ella, mientras que el fondo persiste entre días —
por eso es una tabla propia (`petty_cash_movements`) y no una categoría de
movimiento.

Dos operaciones, y solo una de ellas toca el cajón:

- **Fondear** — el dinero pasa del cajón al sobre. Son dos asientos (una
  `salida` en `cash_movements` para que el corte cuadre, y un `fondeo` en
  `petty_cash_movements`) y tienen que ocurrir juntos: de ahí la RPC
  `fund_petty_cash`, con ids generados en el cliente para ser idempotente ante
  un reintento.
- **Gastar** — el dinero sale del sobre. Ya había salido del cajón al fondear,
  así que es un insert normal.

El saldo lo calcula la vista `petty_cash_balance`, no el cliente (regla 3).
A diferencia de las ventas, la caja chica **no se encola offline**: es una
operación ocasional y su saldo es un número que dos tablets tienen que ver
igual; enseñar un estimado que luego cambia confunde más de lo que ayuda. Sin
red, el repositorio lo dice claro.

⚠ La migración 0020 se escribió sin acceso al proyecto remoto, así que
`database.types.ts` todavía no la conoce. `src/data/database.pending.ts` es el
puente temporal — sus instrucciones de retiro están dentro del propio archivo.

## Configuración del negocio

`business_settings` (fila única, editable desde `/configuracion`, solo admin):
nombre, teléfono, dirección, términos de responsiva y umbral de alto valor. El
ticket (`src/features/printing/documents.ts`) ya NO lee `VITE_BUSINESS_*` —
esas variables se quitaron de los `.env*`. `receiptDocument`/`paymentDocument`/
`cashCloseDocument` reciben el `BusinessSettings` ya cargado como parámetro
(síncronas igual que antes); quien imprime (`OrderDetailPage`, `CashPage`) lo
carga con `settings.getBusinessSettings()` justo antes de armar el documento.

## Pendientes conocidos

- **Logo real**: `src/components/Brand.tsx` y `public/brand/` son PROVISIONALES
  (SVG dibujado a mano). `business_settings.logo_url` ya existe en el esquema,
  pero el ticket (`TicketDocument`/`Block` en `printing/types.ts`) todavía no
  tiene ningún tipo de bloque de imagen — hay que agregarlo cuando llegue el
  archivo real, no antes.
- **Precios del catálogo**: los de `seed.sql` son una propuesta. Confirmar con el
  cliente antes de operar.
- **Driver de impresora**: por definir según el modelo que compre el cliente.
- **Tipos de la 0020**: aplicar la migración, regenerar `database.types.ts` y
  borrar `src/data/database.pending.ts` (ver el TODO dentro del archivo).

## Comandos

```
npm run dev              # desarrollo (host: true, entra por IP de la LAN desde la tablet)
npm run build            # typecheck + build de producción
npm run typecheck        # solo tipos
npm run db:seed          # aplica supabase/seed.sql al Docker local (idempotente)
npm run db:verify-seed   # confirma que el catálogo base está completo
```

## Acceso de arranque

Usuario admin sembrado: `admin@velmont.mx` / `Velmont2026`.
**Cambiar la contraseña antes de producción.**
