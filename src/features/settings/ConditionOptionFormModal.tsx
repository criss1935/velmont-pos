import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { DataError, settings as settingsRepo, type ConditionOption } from '@/data'
import { cn } from '@/lib/cn'
import styles from './SettingsPage.module.css'

export function ConditionOptionFormModal({
  option,
  onClose,
  onSaved,
}: {
  /** `null` = alta. */
  option: ConditionOption | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = option !== null

  const [label, setLabel] = useState(option?.label ?? '')
  const [active, setActive] = useState(option?.active ?? true)
  const [sortOrderText, setSortOrderText] = useState(option ? String(option.sortOrder) : '0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const sortOrder = Number(sortOrderText)
  const sortOrderValid = Number.isFinite(sortOrder)
  const labelValid = label.trim().length > 0
  const valid = labelValid && sortOrderValid

  async function submit() {
    if (!valid) return

    setBusy(true)
    setError(null)

    try {
      if (editing) {
        await settingsRepo.updateConditionOption(option.id, { label, active, sortOrder })
      } else {
        await settingsRepo.createConditionOption({ label, sortOrder })
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
      await settingsRepo.deleteConditionOption(option.id, option.label)
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
      title={editing ? 'Editar condición' : 'Nueva condición'}
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

        <Input
          label="Nombre visible"
          placeholder="Rayones"
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />

        <Input
          label="Orden de aparición"
          numeric
          inputMode="numeric"
          value={sortOrderText}
          {...(!sortOrderValid ? { error: 'Debe ser un número.' } : {})}
          onChange={(e) => setSortOrderText(e.target.value)}
        />

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
            Si ya se usó en alguna recepción, la base rechazará el borrado — desactívala en ese
            caso.
          </p>
        )}
      </div>
    </Modal>
  )
}
