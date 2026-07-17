import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { catalog as catalogRepo, DataError, type Service, type ServiceCategory } from '@/data'
import { cn } from '@/lib/cn'
import { centsToPesos, parseAmount, type Cents } from '@/lib/money'
import styles from './CatalogPage.module.css'

const SIN_CATEGORIA = '__sin_categoria__'

export function ServiceFormModal({
  service,
  categories,
  onClose,
  onSaved,
}: {
  /** `null` = alta. */
  service: Service | null
  categories: ServiceCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const editing = service !== null

  const [categoryId, setCategoryId] = useState(service?.categoryId ?? SIN_CATEGORIA)
  const [name, setName] = useState(service?.name ?? '')
  const [description, setDescription] = useState(service?.description ?? '')
  const [priceText, setPriceText] = useState(service ? centsToPesos(service.price).toFixed(2) : '')
  const [daysText, setDaysText] = useState(service ? String(service.estimatedDays) : '2')
  const [active, setActive] = useState(service?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const price: Cents | null = parseAmount(priceText)
  const days = Number(daysText)

  const nameValid = name.trim().length > 0
  const priceValid = price !== null
  const daysValid = Number.isFinite(days) && days >= 0
  const valid = nameValid && priceValid && daysValid

  async function submit() {
    if (!priceValid) return

    setBusy(true)
    setError(null)

    try {
      const payload = {
        categoryId: categoryId === SIN_CATEGORIA ? null : categoryId,
        name,
        description: description.trim() || null,
        price,
        estimatedDays: days,
      }

      if (editing) {
        await catalogRepo.updateService(service.id, { ...payload, active })
      } else {
        await catalogRepo.createService(payload)
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo guardar el servicio.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? service.name : 'Nuevo servicio'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid || busy} loading={busy} onClick={() => void submit()}>
            {editing ? 'Guardar' : 'Crear servicio'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <div>
          <span className={styles.fieldLabel}>Categoría</span>
          <div className={styles.pills}>
            <button
              type="button"
              className={cn(styles.pill, categoryId === SIN_CATEGORIA && styles.pillActive)}
              onClick={() => setCategoryId(SIN_CATEGORIA)}
            >
              Sin categoría
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={cn(styles.pill, categoryId === category.id && styles.pillActive)}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        <Input label="Nombre" placeholder="Limpieza básica" autoFocus value={name} onChange={(e) => setName(e.target.value)} />

        <Input
          label="Descripción"
          placeholder="Opcional"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <Input
          label="Precio"
          prefix="$"
          numeric
          inputMode="decimal"
          placeholder="0.00"
          value={priceText}
          {...(!priceValid && priceText.trim() ? { error: 'Importe inválido.' } : {})}
          onChange={(e) => setPriceText(e.target.value)}
        />

        <Input
          label="Días estimados de entrega"
          numeric
          inputMode="numeric"
          placeholder="2"
          value={daysText}
          hint="0 = mismo día"
          {...(!daysValid ? { error: 'Debe ser un número mayor o igual a 0.' } : {})}
          onChange={(e) => setDaysText(e.target.value)}
        />

        {editing && (
          <div>
            <span className={styles.fieldLabel}>Estatus</span>
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
            <p className={styles.hint}>
              Un servicio inactivo desaparece de la rejilla de venta. Las órdenes ya creadas con
              este servicio no cambian: guardan su propio nombre y precio.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
