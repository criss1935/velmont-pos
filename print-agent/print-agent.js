/**
 * Agente de impresión Velmont.
 *
 * Corre en la PC del mostrador (no en el navegador). Escucha la tabla
 * `print_jobs` por Realtime, arma el ticket ESC/POS y lo manda por TCP crudo al
 * puerto 9100 de la impresora térmica.
 *
 * Por qué una tabla en medio y no imprimir desde el navegador: la tablet no
 * puede abrir un socket TCP, y aunque pudiera, un ticket perdido porque el WiFi
 * parpadeó es una orden sin comprobante. Con la tabla, la recepción se guarda
 * primero y el ticket es un job con estado — si falla, se reintenta y queda el
 * rastro.
 *
 *     npm start
 */

import 'dotenv/config'
import net from 'node:net'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

import { buildRemisionTicket, buildTicket } from './tickets.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  stationId: process.env.STATION_ID,
  printerHost: process.env.PRINTER_HOST,
  printerPort: Number(process.env.PRINTER_PORT ?? 9100),
  logoPath: process.env.LOGO_PATH ?? resolve(HERE, 'assets/logo-thermal-80mm.png'),
  address: process.env.BUSINESS_ADDRESS ?? '',
  phone: process.env.BUSINESS_PHONE ?? '',
  /** Red rota o impresora apagada: reintentos antes de marcar el job en error. */
  maxAttempts: Number(process.env.MAX_ATTEMPTS ?? 3),
  socketTimeoutMs: Number(process.env.SOCKET_TIMEOUT_MS ?? 8000),
  /**
   * Realtime se cae en silencio (WiFi del local, suspensión de la PC). Un POS no
   * se puede permitir un ticket que nunca se imprimió porque el websocket estaba
   * muerto, así que además se barre la tabla cada tantos segundos.
   */
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
}

function requireConfig() {
  const missing = ['supabaseUrl', 'supabaseKey', 'stationId', 'printerHost'].filter(
    (k) => !CONFIG[k],
  )
  if (missing.length > 0) {
    const names = {
      supabaseUrl: 'SUPABASE_URL',
      supabaseKey: 'SUPABASE_SERVICE_ROLE_KEY',
      stationId: 'STATION_ID',
      printerHost: 'PRINTER_HOST',
    }
    console.error(`Faltan variables de entorno: ${missing.map((k) => names[k]).join(', ')}`)
    console.error('Copia .env.example a .env y rellénalo.')
    process.exit(1)
  }
}

const log = (...args) => console.log(new Date().toISOString(), ...args)

// --- Impresora --------------------------------------------------------------

/**
 * Manda bytes al puerto 9100.
 *
 * Una conexión por job, no un socket persistente: estas impresoras cierran la
 * conexión por su cuenta cuando llevan rato ociosas, y un socket que se cree
 * vivo pero no lo está se traga el ticket sin error.
 */
function sendToPrinter(buffer) {
  return new Promise((resolvePromise, reject) => {
    const socket = net.createConnection({
      host: CONFIG.printerHost,
      port: CONFIG.printerPort,
    })

    let settled = false
    const done = (err) => {
      if (settled) return
      settled = true
      socket.destroy()
      err ? reject(err) : resolvePromise()
    }

    socket.setTimeout(CONFIG.socketTimeoutMs)
    socket.on('timeout', () => done(new Error(`Timeout con ${CONFIG.printerHost}:${CONFIG.printerPort}`)))
    socket.on('error', done)
    socket.on('connect', () => {
      socket.write(buffer, (err) => {
        if (err) return done(err)
        // El drain no garantiza que el papel salió, pero sí que los bytes se
        // fueron por el cable. Es lo máximo que da 9100 crudo: no hay ACK.
        socket.end(() => done())
      })
    })
  })
}

// --- Jobs -------------------------------------------------------------------

const BUILDERS = {
  remision: buildRemisionTicket,
  venta: buildTicket,
  ticket: buildTicket,
}

async function renderJob(job) {
  const build = BUILDERS[job.kind] ?? BUILDERS.remision
  return build(job.payload, {
    logoPath: CONFIG.logoPath,
    address: CONFIG.address,
    phone: CONFIG.phone,
  })
}

const supabase = createClient(CONFIG.supabaseUrl ?? '', CONFIG.supabaseKey ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Jobs que ya se están procesando: Realtime y el poll pueden traer el mismo. */
const inFlight = new Set()

async function processJob(job) {
  if (inFlight.has(job.id)) return
  inFlight.add(job.id)

  try {
    // Reclamar el job de forma atómica. El `.eq('status', 'pending')` es lo que
    // impide que dos agentes (o el poll y el Realtime) impriman el mismo ticket
    // dos veces: solo uno gana el UPDATE, el otro recibe 0 filas.
    const { data: claimed, error: claimError } = await supabase
      .from('print_jobs')
      .update({ status: 'printing', attempts: (job.attempts ?? 0) + 1 })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select()

    if (claimError) throw claimError
    if (!claimed || claimed.length === 0) return // otro lo tomó

    const copies = Math.max(1, Math.min(5, job.copies ?? 1))
    const buffer = await renderJob(job)

    for (let i = 0; i < copies; i++) {
      await sendToPrinter(buffer)
    }

    await supabase
      .from('print_jobs')
      .update({ status: 'done', printed_at: new Date().toISOString(), error: null })
      .eq('id', job.id)

    log(`✓ job ${job.id} (${job.kind}, ${copies} copia${copies > 1 ? 's' : ''})`)
  } catch (err) {
    const attempts = (job.attempts ?? 0) + 1
    const giveUp = attempts >= CONFIG.maxAttempts

    await supabase
      .from('print_jobs')
      .update({
        status: giveUp ? 'error' : 'pending', // vuelve a la cola hasta agotar intentos
        error: String(err.message ?? err).slice(0, 500),
      })
      .eq('id', job.id)

    log(`✖ job ${job.id} intento ${attempts}/${CONFIG.maxAttempts}: ${err.message}`)
  } finally {
    inFlight.delete(job.id)
  }
}

async function drainPending() {
  const { data, error } = await supabase
    .from('print_jobs')
    .select('*')
    .eq('station_id', CONFIG.stationId)
    .eq('status', 'pending')
    .lt('attempts', CONFIG.maxAttempts)
    .order('created_at', { ascending: true })
    .limit(20)

  if (error) {
    log(`✖ no pude leer la cola: ${error.message}`)
    return
  }

  for (const job of data ?? []) {
    await processJob(job)
  }
}

// --- Arranque ---------------------------------------------------------------

async function main() {
  requireConfig()

  log(`estación   : ${CONFIG.stationId}`)
  log(`impresora  : ${CONFIG.printerHost}:${CONFIG.printerPort}`)
  log(`logo       : ${CONFIG.logoPath}`)

  supabase
    .channel(`print_jobs:${CONFIG.stationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'print_jobs',
        filter: `station_id=eq.${CONFIG.stationId}`,
      },
      (payload) => {
        void processJob(payload.new)
      },
    )
    .subscribe((status) => log(`realtime   : ${status}`))

  // Lo que quedó pendiente mientras el agente estaba apagado.
  await drainPending()
  setInterval(() => void drainPending(), CONFIG.pollIntervalMs)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
