import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, type BadgeTone } from '@/components/ui'
import {
  audit as auditRepo,
  DataError,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  photos as photosRepo,
  type AuditAction,
  type AuditEntry,
  type OrderStatus,
  type PaymentMethod,
} from '@/data'
import { cents, formatCents } from '@/lib/money'
import styles from './AuditLogCard.module.css'

const TABLE_LABEL: Record<string, string> = {
  session: 'Sesión',
  orders: 'Orden',
  order_items: 'Servicio de orden',
  order_articles: 'Artículo',
  order_photos: 'Foto',
  order_diagram_marks: 'Marca en diagrama',
  payments: 'Pago',
  customers: 'Cliente',
  cash_sessions: 'Caja',
  cash_movements: 'Movimiento de caja',
  petty_cash_movements: 'Caja chica',
  supplies: 'Insumo',
  supply_movements: 'Movimiento de inventario',
  services: 'Servicio (catálogo)',
  service_categories: 'Categoría (catálogo)',
  business_settings: 'Configuración',
  item_types: 'Tipo de artículo',
  condition_options: 'Condición de recepción',
  profiles: 'Usuario',
}

const ACTION_LABEL: Record<AuditAction, string> = {
  insert: 'Alta',
  update: 'Cambio',
  delete: 'Eliminación',
  login: 'Entrada',
  logout: 'Salida',
}

const ACTION_TONE: Record<AuditAction, BadgeTone> = {
  insert: 'success',
  update: 'info',
  delete: 'danger',
  login: 'gold',
  logout: 'neutral',
}

// Campos que no aportan nada a quien revisa (ids internos, marcas de tiempo
// técnicas) y solo hacen ruido en el detalle.
const HIDDEN_FIELDS = new Set(['id', 'order_id', 'article_id', 'created_at', 'updated_at', 'cash_session_id'])

const timestampFormat = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
})

/**
 * Bitácora completa de movimientos, al final de Configuración (solo admin).
 * Todo lo que cambia en la base — órdenes, fotos, cobros, caja, inventario,
 * catálogo, configuración — más entradas y salidas de sesión.
 */
export function AuditLogCard() {
  const [tableName, setTableName] = useState('')
  const [actorId, setActorId] = useState('')
  const [folioInput, setFolioInput] = useState('')
  const [folio, setFolio] = useState('')

  const actorsQuery = useQuery({ queryKey: ['audit-actors'], queryFn: auditRepo.listAuditActors })

  const query = useInfiniteQuery({
    queryKey: ['audit-log', tableName, actorId, folio],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      auditRepo.listAuditLog({
        beforeId: pageParam,
        tableName: tableName || null,
        actorId: actorId || null,
        folio: folio || null,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.length < auditRepo.AUDIT_PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]!.id,
  })

  const entries = query.data?.pages.flat() ?? []

  return (
    <Card
      title="Auditoría"
      subtitle="Cada movimiento del sistema: quién, qué y a qué hora. No se puede editar ni borrar."
      actions={
        <Button size="sm" loading={query.isRefetching} onClick={() => void query.refetch()}>
          Actualizar
        </Button>
      }
    >
      <div className={styles.filters}>
        <select className={styles.select} value={tableName} onChange={(e) => setTableName(e.target.value)}>
          <option value="">Todo</option>
          {Object.entries(TABLE_LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <select className={styles.select} value={actorId} onChange={(e) => setActorId(e.target.value)}>
          <option value="">Todos los usuarios</option>
          {(actorsQuery.data ?? []).map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>

        <form
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault()
            setFolio(folioInput.trim())
          }}
        >
          <input
            className={styles.input}
            placeholder="Folio (ej. V-00012)"
            value={folioInput}
            onChange={(e) => {
              setFolioInput(e.target.value)
              if (e.target.value === '') setFolio('')
            }}
          />
        </form>
      </div>

      {query.isLoading ? (
        <p className={styles.empty}>Cargando…</p>
      ) : query.error ? (
        <p className={styles.error}>
          {query.error instanceof DataError ? query.error.message : 'No se pudo cargar la bitácora.'}
        </p>
      ) : entries.length === 0 ? (
        <p className={styles.empty}>Sin movimientos registrados.</p>
      ) : (
        <ol className={styles.list}>
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ol>
      )}

      {query.hasNextPage && (
        <div className={styles.more}>
          <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Cargar más
          </Button>
        </div>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false)
  const details = detailLines(entry)
  const photoPath =
    entry.tableName === 'order_photos' && entry.action === 'insert'
      ? (entry.newData?.storage_path as string | undefined)
      : undefined

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <time className={styles.time} dateTime={entry.occurredAt}>
          {timestampFormat.format(new Date(entry.occurredAt))}
        </time>
        <Badge tone={ACTION_TONE[entry.action] ?? 'neutral'}>{ACTION_LABEL[entry.action] ?? entry.action}</Badge>
      </div>

      <div className={styles.summary}>
        <strong className={styles.actor}>{entry.actorName ?? 'Sistema'}</strong> {summarize(entry)}
        {entry.orderFolio && entry.orderId && (
          <>
            {' · '}
            <Link to={`/ordenes/${entry.orderId}`} className={styles.folio}>
              {entry.orderFolio}
            </Link>
          </>
        )}
      </div>

      {(details.length > 0 || photoPath) && (
        <button type="button" className={styles.toggle} onClick={() => setOpen((v) => !v)}>
          {open ? 'Ocultar detalle' : 'Ver detalle'}
        </button>
      )}

      {open && (
        <div className={styles.details}>
          {photoPath && (
            <a href={photosRepo.publicUrl(photoPath)} target="_blank" rel="noreferrer">
              <img src={photosRepo.publicUrl(photoPath)} alt="Foto subida" className={styles.photo} loading="lazy" />
            </a>
          )}
          {details.length > 0 && (
            <dl className={styles.fields}>
              {details.map((line) => (
                <div key={line.field} className={styles.field}>
                  <dt>{fieldLabel(line.field)}</dt>
                  <dd>
                    {line.before !== undefined && (
                      <>
                        <span className={styles.before}>{formatValue(line.field, line.before)}</span>
                        {' → '}
                      </>
                    )}
                    <span>{formatValue(line.field, line.after)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */

function summarize(entry: AuditEntry): string {
  const label = TABLE_LABEL[entry.tableName] ?? entry.tableName
  const n = entry.newData ?? {}
  const o = entry.oldData ?? {}

  switch (entry.action) {
    case 'login':
      return 'inició sesión'
    case 'logout':
      return 'cerró sesión'
  }

  if (entry.tableName === 'order_photos') {
    if (entry.action === 'insert') return 'subió una foto'
    if (entry.action === 'delete') return 'eliminó una foto'
  }

  if (entry.tableName === 'orders') {
    if (entry.action === 'insert') return 'creó la orden'
    if (entry.changedFields.includes('status')) {
      const from = ORDER_STATUS_LABEL[o.status as OrderStatus] ?? formatValue('status', o.status)
      const to = ORDER_STATUS_LABEL[n.status as OrderStatus] ?? formatValue('status', n.status)
      return `cambió el estado de la orden: ${from} → ${to}`
    }
  }

  if (entry.tableName === 'payments' && entry.action === 'insert') {
    const method = PAYMENT_METHOD_LABEL[n.method as PaymentMethod] ?? formatValue('method', n.method)
    return `registró un cobro de ${formatCents(cents(Number(n.amount_cents ?? 0)))} (${method})`
  }

  const verb = entry.action === 'insert' ? 'agregó' : entry.action === 'delete' ? 'eliminó' : 'modificó'
  const name =
    (n.full_name ?? o.full_name ?? n.name ?? o.name ?? n.label ?? o.label ?? n.service_name ?? o.service_name) as
      | string
      | undefined
  const fields =
    entry.action === 'update' && entry.changedFields.length > 0
      ? ` (${entry.changedFields.map(fieldLabel).join(', ')})`
      : ''

  return `${verb} ${label.toLowerCase()}${name ? ` “${name}”` : ''}${fields}`
}

interface DetailLine {
  field: string
  before?: unknown
  after: unknown
}

function detailLines(entry: AuditEntry): DetailLine[] {
  if (entry.action === 'update') {
    return entry.changedFields
      .filter((f) => f !== 'updated_at')
      .map((field) => ({ field, before: entry.oldData?.[field], after: entry.newData?.[field] }))
  }

  const data = entry.action === 'delete' ? entry.oldData : entry.newData
  if (!data) return []

  return Object.entries(data)
    .filter(([field, value]) => !HIDDEN_FIELDS.has(field) && value !== null && value !== '' && !isEmptyArray(value))
    .map(([field, value]) => ({ field, after: value }))
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

function fieldLabel(field: string): string {
  const clean = field.replace(/_cents$/, '').replace(/_/g, ' ')
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.map((v) => formatValue(field, v)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'number') return field.endsWith('_cents') ? formatCents(cents(value)) : String(value)

  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (field === 'status') return ORDER_STATUS_LABEL[text as OrderStatus] ?? text
  if (field === 'method') return PAYMENT_METHOD_LABEL[text as PaymentMethod] ?? text
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return timestampFormat.format(new Date(text))
  return text
}
