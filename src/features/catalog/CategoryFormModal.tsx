import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { catalog as catalogRepo, DataError, type ServiceCategory } from '@/data'
import styles from './CatalogPage.module.css'

export function CategoryFormModal({
  category,
  servicesInCategory = 0,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** `null` = alta. */
  category: ServiceCategory | null
  servicesInCategory?: number
  onClose: () => void
  onSaved: () => void
  onDeleted?: () => void
}) {
  const editing = category !== null

  const [name, setName] = useState(category?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const valid = name.trim().length > 0

  async function submit() {
    setBusy(true)
    setError(null)

    try {
      if (editing) {
        await catalogRepo.updateCategory(category.id, { name })
      } else {
        await catalogRepo.createCategory({ name })
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo guardar la categoría.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!editing) return

    setBusy(true)
    setError(null)

    try {
      await catalogRepo.deleteCategory(category.id)
      onDeleted?.()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo borrar la categoría.')
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar categoría' : 'Nueva categoría'}
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
            {editing ? 'Guardar' : 'Crear categoría'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <Input label="Nombre" placeholder="Tenis" autoFocus value={name} onChange={(e) => setName(e.target.value)} />

        {editing && confirmingDelete && (
          <p className={styles.error}>
            {servicesInCategory > 0
              ? `No se puede borrar: hay ${servicesInCategory} servicio${servicesInCategory === 1 ? '' : 's'} en esta categoría.`
              : 'Esta categoría se borrará. Los servicios sin categoría no se ven afectados.'}
          </p>
        )}
      </div>
    </Modal>
  )
}
