import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { DataError, supplies as suppliesRepo, type Supply } from '@/data'
import { cn } from '@/lib/cn'
import { centsToPesos, parseAmount, type Cents } from '@/lib/money'
import styles from './InventoryPage.module.css'

/**
 * Alta y edición de datos maestros. El stock NUNCA se toca desde aquí — no hay
 * campo para él a propósito, ver `MovementModal` en `InventoryPage.tsx` para lo
 * único que sí lo mueve.
 */
export function SupplyFormModal({
  supply,
  onClose,
  onSaved,
}: {
  /** `null` = alta. */
  supply: Supply | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = supply !== null

  const [name, setName] = useState(supply?.name ?? '')
  const [description, setDescription] = useState(supply?.description ?? '')
  const [unit, setUnit] = useState(supply?.unit ?? 'pieza')
  const [minStockText, setMinStockText] = useState(supply ? String(supply.minStock) : '0')
  const [costText, setCostText] = useState(
    supply?.cost !== null && supply?.cost !== undefined ? centsToPesos(supply.cost).toFixed(2) : '',
  )
  const [active, setActive] = useState(supply?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const minStock = Number(minStockText)
  const cost: Cents | null = costText.trim() === '' ? null : parseAmount(costText)

  const nameValid = name.trim().length > 0
  const unitValid = unit.trim().length > 0
  const minStockValid = Number.isFinite(minStock) && minStock >= 0
  const costValid = costText.trim() === '' || cost !== null
  const valid = nameValid && unitValid && minStockValid && costValid

  // Desactivar un insumo con existencia todavía en el almacén es fácil de
  // hacer sin querer — el motivo de compra ya no se verá al hacer pedidos,
  // pero el stock sigue ahí. La advertencia + el botón "Sí, desactivar" SON
  // la confirmación: un clic basta, no hace falta un segundo paso oculto.
  const deactivating = editing && supply.active && !active && supply.stock > 0

  async function submit() {
    setBusy(true)
    setError(null)

    try {
      if (editing) {
        await suppliesRepo.updateSupply(supply.id, {
          name,
          description: description.trim() || null,
          unit,
          minStock,
          cost,
          active,
        })
      } else {
        await suppliesRepo.createSupply({
          name,
          description: description.trim() || null,
          unit,
          minStock,
          cost,
        })
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo guardar el insumo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? supply.name : 'Nuevo insumo'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={deactivating ? 'danger' : 'primary'}
            disabled={!valid || busy}
            loading={busy}
            onClick={() => void submit()}
          >
            {deactivating ? 'Sí, desactivar' : editing ? 'Guardar' : 'Crear insumo'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <Input
          label="Nombre"
          placeholder="Solución limpiadora"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <Input
          label="Descripción"
          placeholder="Opcional"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <Input
          label="Unidad de medida"
          placeholder="ml, pieza, kg…"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
        />

        <Input
          label="Stock mínimo"
          numeric
          inputMode="decimal"
          placeholder="0"
          value={minStockText}
          {...(!minStockValid ? { error: 'Debe ser un número mayor o igual a 0.' } : {})}
          onChange={(event) => setMinStockText(event.target.value)}
        />

        <Input
          label="Costo unitario"
          prefix="$"
          numeric
          inputMode="decimal"
          placeholder="Opcional"
          value={costText}
          {...(!costValid ? { error: 'Importe inválido.' } : {})}
          onChange={(event) => setCostText(event.target.value)}
        />

        {editing && (
          <div>
            <span className={styles.statusLabel}>Estatus</span>
            <div className={styles.types}>
              <button
                type="button"
                className={cn(styles.type, active && styles.typeActive)}
                onClick={() => setActive(true)}
              >
                Activo
              </button>
              <button
                type="button"
                className={cn(styles.type, !active && styles.typeActive)}
                onClick={() => setActive(false)}
              >
                Inactivo
              </button>
            </div>
          </div>
        )}

        {deactivating && (
          <p className={styles.error}>
            Este insumo todavía tiene {supply.stock} {supply.unit} en existencia. Al desactivarlo
            deja de aparecer para nuevos movimientos, pero el stock no se toca.
          </p>
        )}
      </div>
    </Modal>
  )
}
