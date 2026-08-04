import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Badge, Button, Card, Input, Modal } from '@/components/ui'
import { DataError, supplies as suppliesRepo, type Supply, type SupplyMovementType } from '@/data'
import { useIsAdmin } from '@/app/session'
import { cn } from '@/lib/cn'
import { SupplyDetailModal } from './SupplyDetailModal'
import { SupplyFormModal } from './SupplyFormModal'
import styles from './InventoryPage.module.css'

const TYPE_LABEL: Record<SupplyMovementType, string> = {
  compra: 'Compra',
  consumo: 'Consumo',
  ajuste: 'Ajuste',
  merma: 'Merma',
}

/** Compra y ajuste cambian el valor del inventario: la base solo deja a admin. */
const ADMIN_TYPES: SupplyMovementType[] = ['compra', 'ajuste']

/** Referencia estable para "aún sin datos" (ver el useMemo de `visible`). */
const NO_SUPPLIES: Supply[] = []

type Filter = 'todos' | 'activos' | 'bajo' | 'sinStock'

const FILTER_LABEL: Record<Filter, string> = {
  todos: 'Todos',
  activos: 'Activos',
  bajo: 'Bajo stock',
  sinStock: 'Sin stock',
}

function matchesFilter(supply: Supply, filter: Filter): boolean {
  switch (filter) {
    case 'todos':
      return true
    case 'activos':
      return supply.active
    case 'bajo':
      return supply.active && supply.low && supply.stock > 0
    case 'sinStock':
      return supply.active && supply.stock <= 0
  }
}

export function InventoryPage() {
  const queryClient = useQueryClient()
  const isAdmin = useIsAdmin()
  const [moving, setMoving] = useState<Supply | null>(null)
  const [editing, setEditing] = useState<Supply | null>(null)
  const [viewing, setViewing] = useState<Supply | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('todos')

  const query = useQuery({ queryKey: ['supplies'], queryFn: suppliesRepo.listSupplies })
  // NO_SUPPLIES y no `?? []`: un array nuevo en cada render cambiaría las
  // dependencias del useMemo de abajo y lo dejaría sin efecto.
  const list = query.data ?? NO_SUPPLIES
  const low = list.filter((supply) => supply.active && supply.low)

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return list.filter((supply) => {
      if (!matchesFilter(supply, filter)) return false
      if (!term) return true
      return (
        supply.name.toLowerCase().includes(term) ||
        (supply.description?.toLowerCase().includes(term) ?? false)
      )
    })
  }, [list, search, filter])

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['supplies'] })
  }

  return (
    <Page
      title="Inventario"
      subtitle={
        low.length > 0
          ? `${low.length} insumo${low.length === 1 ? '' : 's'} por debajo del mínimo.`
          : 'Todo por encima del mínimo.'
      }
      actions={
        isAdmin && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Nuevo insumo
          </Button>
        )
      }
    >
      <div className={styles.toolbar}>
        <Input
          className={styles.search}
          placeholder="Buscar insumo…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Buscar insumo"
        />

        <div className={styles.filters}>
          {(Object.keys(FILTER_LABEL) as Filter[]).map((option) => (
            <button
              key={option}
              type="button"
              className={cn(styles.filterChip, filter === option && styles.filterChipActive)}
              onClick={() => setFilter(option)}
            >
              {FILTER_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty}>
          {list.length === 0 ? 'Todavía no hay insumos registrados.' : 'Ningún insumo coincide con la búsqueda o el filtro.'}
        </p>
      ) : (
        <div className={styles.grid}>
          {visible.map((supply) => (
            <Card
              key={supply.id}
              accent={supply.low && supply.active}
              className={!supply.active ? styles.inactive : undefined}
            >
              <div className={styles.head}>
                <button type="button" className={styles.name} onClick={() => setViewing(supply)}>
                  {supply.name}
                </button>
                <div className={styles.badges}>
                  {!supply.active && <Badge tone="neutral">Inactivo</Badge>}
                  {supply.active && supply.low && <Badge tone="danger">Bajo</Badge>}
                </div>
              </div>

              {supply.description && <p className={styles.description}>{supply.description}</p>}

              <div className={styles.stock}>
                <span
                  className={cn(styles.stockValue, supply.active && supply.low && styles.stockLow)}
                  data-numeric
                >
                  {supply.stock}
                </span>
                <span className={styles.unit}>{supply.unit}</span>
              </div>

              <div className={styles.min}>
                Mínimo: <span data-numeric>{supply.minStock}</span> {supply.unit}
              </div>

              <div className={styles.cardActions}>
                {isAdmin && (
                  <Button block onClick={() => setEditing(supply)}>
                    Editar
                  </Button>
                )}
                <Button
                  block
                  variant="primary"
                  onClick={() => setMoving(supply)}
                  disabled={!supply.active}
                >
                  Registrar movimiento
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {moving && (
        <MovementModal
          supply={moving}
          isAdmin={isAdmin}
          onClose={() => setMoving(null)}
          onSaved={() => {
            setMoving(null)
            invalidate()
          }}
        />
      )}

      {creating && (
        <SupplyFormModal
          supply={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            invalidate()
          }}
        />
      )}

      {editing && (
        <SupplyFormModal
          supply={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            invalidate()
          }}
        />
      )}

      {viewing && <SupplyDetailModal supply={viewing} onClose={() => setViewing(null)} />}
    </Page>
  )
}

/* -------------------------------------------------------------------------- */

function MovementModal({
  supply,
  isAdmin,
  onClose,
  onSaved,
}: {
  supply: Supply
  isAdmin: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<SupplyMovementType>('consumo')
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const quantity = Number(text)
  const quantityValid = Number.isFinite(quantity) && quantity > 0
  // La base rechaza un ajuste sin nota (ver 0015) — se exige aquí también para
  // que el error aparezca antes de mandar la petición, no después.
  const noteRequired = type === 'ajuste'
  const noteValid = !noteRequired || note.trim().length > 0
  const valid = quantityValid && noteValid

  // El stock resultante se muestra ANTES de guardar. Es lo que evita el error
  // clásico de registrar una merma de 1000 creyendo que se estaba comprando.
  const resulting =
    quantityValid && (type === 'compra' || type === 'ajuste')
      ? supply.stock + quantity
      : quantityValid
        ? supply.stock - quantity
        : supply.stock

  async function submit() {
    setBusy(true)
    setError(null)

    try {
      await suppliesRepo.recordSupplyMovement({
        supplyId: supply.id,
        type,
        quantity,
        note,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo registrar.')
    } finally {
      setBusy(false)
    }
  }

  const types: SupplyMovementType[] = isAdmin
    ? ['consumo', 'compra', 'merma', 'ajuste']
    : ['consumo', 'merma']

  return (
    <Modal
      open
      onClose={onClose}
      title={supply.name}
      description={`Stock actual: ${supply.stock} ${supply.unit}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid || busy} loading={busy} onClick={() => void submit()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.types}>
          {types.map((option) => (
            <button
              key={option}
              type="button"
              className={cn(styles.type, type === option && styles.typeActive)}
              onClick={() => setType(option)}
            >
              {TYPE_LABEL[option]}
            </button>
          ))}
        </div>

        {!isAdmin && (
          <p className={styles.adminNote}>
            Comprar y ajustar inventario mueve el valor del almacén: solo un administrador puede
            hacerlo.
          </p>
        )}

        <Input
          label={`Cantidad (${supply.unit})`}
          numeric
          inputMode="decimal"
          placeholder="0"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          hint={
            ADMIN_TYPES.includes(type)
              ? 'Se suma al stock.'
              : 'Se resta del stock.'
          }
        />

        {quantityValid && (
          <div className={cn(styles.preview, resulting < 0 && styles.previewNegative)}>
            <span>Stock resultante</span>
            <span data-numeric>
              {resulting} {supply.unit}
            </span>
          </div>
        )}

        {resulting < 0 && (
          <p className={styles.error}>
            El resultado sería negativo. Revisa la cantidad: probablemente falte registrar una
            compra antes.
          </p>
        )}

        <Input
          label={noteRequired ? 'Motivo (obligatorio en ajustes)' : 'Nota'}
          placeholder={noteRequired ? 'Por qué se ajusta el stock' : 'Opcional'}
          value={note}
          {...(noteRequired && !noteValid ? { error: 'El motivo es obligatorio en un ajuste.' } : {})}
          onChange={(event) => setNote(event.target.value)}
        />

        <Input
          label="Referencia"
          placeholder="Opcional — folio de compra, orden, etc."
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </div>
    </Modal>
  )
}
