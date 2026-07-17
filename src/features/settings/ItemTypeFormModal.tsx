import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { DataError, settings as settingsRepo, type ItemType } from '@/data'
import { cn } from '@/lib/cn'
import styles from './SettingsPage.module.css'

export function ItemTypeFormModal({
  itemType,
  onClose,
  onSaved,
}: {
  /** `null` = alta. */
  itemType: ItemType | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = itemType !== null

  const [name, setName] = useState(itemType?.name ?? '')
  const [hasDiagram, setHasDiagram] = useState(itemType?.hasDiagram ?? false)
  const [active, setActive] = useState(itemType?.active ?? true)
  const [sortOrderText, setSortOrderText] = useState(itemType ? String(itemType.sortOrder) : '0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const sortOrder = Number(sortOrderText)
  const sortOrderValid = Number.isFinite(sortOrder)
  const nameValid = name.trim().length > 0
  const valid = nameValid && sortOrderValid

  async function submit() {
    if (!valid) return

    setBusy(true)
    setError(null)

    try {
      if (editing) {
        await settingsRepo.updateItemType(itemType.id, { name, hasDiagram, active, sortOrder })
      } else {
        await settingsRepo.createItemType({ name, hasDiagram, sortOrder })
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!editing) return

    setBusy(true)
    setError(null)

    try {
      await settingsRepo.deleteItemType(itemType.id, itemType.name)
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo borrar.')
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar tipo de artículo' : 'Nuevo tipo de artículo'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          {editing && (
            <Button
              variant="danger"
              disabled={busy}
              loading={busy && confirmingDelete}
              onClick={() => (confirmingDelete ? void remove() : setConfirmingDelete(true))}
            >
              {confirmingDelete ? 'Confirmar borrado' : 'Borrar'}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!valid || busy}
            loading={busy && !confirmingDelete}
            onClick={() => void submit()}
          >
            {editing ? 'Guardar' : 'Crear'}
          </Button>
        </>
      }
    >
      <div className={styles.formStack}>
        {error && <div className={styles.error}>{error}</div>}

        <Input label="Nombre" placeholder="Tenis" autoFocus value={name} onChange={(e) => setName(e.target.value)} />

        <Input
          label="Orden de aparición"
          numeric
          inputMode="numeric"
          value={sortOrderText}
          {...(!sortOrderValid ? { error: 'Debe ser un número.' } : {})}
          onChange={(e) => setSortOrderText(e.target.value)}
        />

        <div>
          <span className={styles.pillLabel}>Diagrama de observaciones</span>
          <div className={styles.pills}>
            <button
              type="button"
              className={cn(styles.pill, hasDiagram && styles.pillActive)}
              onClick={() => setHasDiagram(true)}
            >
              Muestra silueta
            </button>
            <button
              type="button"
              className={cn(styles.pill, !hasDiagram && styles.pillActive)}
              onClick={() => setHasDiagram(false)}
            >
              Sin silueta
            </button>
          </div>
        </div>

        {editing && (
          <div>
            <span className={styles.pillLabel}>Estatus</span>
            <div className={styles.pills}>
              <button
                type="button"
                className={cn(styles.pill, active && styles.pillActive)}
                onClick={() => setActive(true)}
              >
                Activo
              </button>
              <button
                type="button"
                className={cn(styles.pill, !active && styles.pillActive)}
                onClick={() => setActive(false)}
              >
                Inactivo
              </button>
            </div>
          </div>
        )}

        {confirmingDelete && (
          <p className={styles.error}>
            Si ya se usó en alguna recepción, la base rechazará el borrado — desactívalo en ese
            caso.
          </p>
        )}
      </div>
    </Modal>
  )
}
