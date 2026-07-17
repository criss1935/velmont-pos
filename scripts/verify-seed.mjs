#!/usr/bin/env node
/**
 * Chequeo rápido de que el Docker local tiene el catálogo base — no bloquea
 * nada, solo avisa. Pensado para correr después de un `supabase db reset`,
 * un `stop`+`start`, o simplemente como sanity check antes de una sesión de
 * pruebas: es fácil que el catálogo se quede vacío en silencio (ver
 * `seed-local.mjs` para el porqué) y ningún error de la app lo delata de
 * entrada — la pantalla de Recibir simplemente se ve vacía.
 */
import { execFileSync } from 'node:child_process'

const TABLES = ['service_categories', 'services', 'item_types', 'condition_options', 'supplies']

function findDbContainer() {
  const out = execFileSync('docker', ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  }).trim()
  const [name] = out.split('\n').filter(Boolean)
  return name ?? null
}

const container = findDbContainer()
if (!container) {
  console.log('⚠ No encontré un contenedor de Postgres local corriendo (supabase_db_*). ¿Corriste `supabase start`?')
  process.exit(0)
}

let anyEmpty = false

for (const table of TABLES) {
  const out = execFileSync(
    'docker',
    ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-c', `select count(*) from ${table};`],
    { encoding: 'utf8' },
  )
  const count = Number(out.trim())
  const empty = !Number.isFinite(count) || count === 0
  if (empty) anyEmpty = true
  console.log(`${empty ? '✗' : '✓'} ${table}: ${count}`)
}

if (anyEmpty) {
  console.log('\n⚠ El catálogo base está incompleto. Corre `npm run db:seed` para restaurarlo.')
  process.exit(0)
}

console.log('\n✓ Catálogo base completo.')
