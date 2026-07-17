#!/usr/bin/env node
/**
 * Corre supabase/seed.sql contra el Docker local, sin pasar por `supabase db
 * reset` (que solo siembra dentro de un reset exitoso — si el reset falla o
 * se recupera vía `migration up`/`stop`+`start`, el catálogo base se queda
 * vacío en silencio; así se descubrió en sesión).
 *
 * Usa `psql` DENTRO del contenedor de Postgres (vía `docker exec`), porque
 * `supabase db query --local` no acepta archivos multi-statement. Descubre
 * el contenedor por filtro de nombre en vez de hardcodearlo, para no
 * romperse si el proyecto se clona o renombra.
 *
 * seed.sql ya es idempotente (`on conflict do nothing` / `where not
 * exists`), así que correr esto de más nunca duplica filas.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const seedPath = path.join(projectRoot, 'supabase', 'seed.sql')

function findDbContainer() {
  const out = execFileSync('docker', ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  }).trim()
  const [name] = out.split('\n').filter(Boolean)
  return name ?? null
}

const container = findDbContainer()
if (!container) {
  console.error('No encontré un contenedor de Postgres local corriendo (supabase_db_*).')
  console.error('Corre `supabase start` primero.')
  process.exit(1)
}

const sql = readFileSync(seedPath, 'utf8')

console.log(`Sembrando contra el contenedor "${container}"…`)
const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres'], {
  input: sql,
  stdio: ['pipe', 'inherit', 'inherit'],
})

if (result.status !== 0) {
  console.error('El seed falló. Revisa el error de psql arriba.')
  process.exit(result.status ?? 1)
}

console.log('Listo — supabase/seed.sql aplicado (o ya estaba aplicado, es idempotente).')
