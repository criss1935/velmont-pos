import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { customers, DataError, type Customer } from '@/data'
import styles from './CustomerPicker.module.css'

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function CustomerPicker({
  value,
  onChange,
}: {
  value: Customer | null
  onChange: (customer: Customer | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)

  // Debounce: el operador teclea rápido y cada pulsación no puede ser un viaje a
  // la base. 250 ms es el punto donde la búsqueda se siente instantánea sin
  // disparar una consulta por letra.
  useEffect(() => {
    const term = query.trim()

    if (term.length < 2) {
      setResults([])
      return
    }

    setSearching(true)
    const timer = window.setTimeout(() => {
      let cancelled = false

      void customers
        .searchCustomers(term)
        .then((found) => {
          if (!cancelled) setResults(found)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })

      return () => {
        cancelled = true
      }
    }, 250)

    return () => window.clearTimeout(timer)
  }, [query])

  function select(customer: Customer) {
    onChange(customer)
    setQuery('')
    setResults([])
  }

  if (value) {
    return (
      <div className={styles.selected}>
        <span className={styles.avatar}>{initials(value.fullName)}</span>
        <div className={styles.selectedInfo}>
          <div className={styles.selectedName}>{value.fullName}</div>
          {value.phone && (
            <div className={styles.selectedPhone} data-numeric>
              {value.phone}
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.clear}
          onClick={() => onChange(null)}
          aria-label="Quitar cliente"
        >
          ✕
        </button>
      </div>
    )
  }

  const term = query.trim()
  const showResults = term.length >= 2

  return (
    <div className={styles.picker}>
      <Input
        placeholder="Buscar por nombre o teléfono…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Buscar cliente"
      />

      {showResults && (
        <div className={styles.results}>
          {results.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className={styles.result}
              onClick={() => select(customer)}
            >
              <span className={styles.avatar}>{initials(customer.fullName)}</span>
              <span className={styles.resultName}>{customer.fullName}</span>
              {customer.phone && (
                <span className={styles.resultPhone} data-numeric>
                  {customer.phone}
                </span>
              )}
            </button>
          ))}

          {!searching && results.length === 0 && (
            <p className={styles.empty}>Sin coincidencias para «{term}»</p>
          )}

          <div className={styles.createRow}>
            <Button block onClick={() => setCreating(true)}>
              + Cliente nuevo
            </Button>
          </div>
        </div>
      )}

      <NewCustomerModal
        open={creating}
        initialQuery={term}
        onClose={() => setCreating(false)}
        onCreated={(customer) => {
          setCreating(false)
          select(customer)
        }}
      />
    </div>
  )
}

/**
 * Alta rápida de cliente.
 *
 * Solo pide nombre y teléfono: en el mostrador, con el cliente esperando, un
 * formulario largo es un formulario que nadie llena. El resto de datos se
 * completa después desde la pantalla de Clientes.
 */
function NewCustomerModal({
  open,
  initialQuery,
  onClose,
  onCreated,
}: {
  open: boolean
  initialQuery: string
  onClose: () => void
  onCreated: (customer: Customer) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Lo que el operador ya tecleó en la búsqueda se aprovecha: si escribió un
  // número, es el teléfono; si escribió letras, es el nombre.
  useEffect(() => {
    if (!open) return

    const looksLikePhone = /^[\d\s+()-]+$/.test(initialQuery)
    setName(looksLikePhone ? '' : initialQuery)
    setPhone(looksLikePhone ? initialQuery : '')
    setError(null)
  }, [open, initialQuery])

  async function create() {
    if (name.trim() === '') {
      setError('El nombre es obligatorio.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      onCreated(await customers.createCustomer({ fullName: name, phone }))
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo crear el cliente.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cliente nuevo"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void create()} loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Input
          label="Nombre"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          {...(error && name.trim() === '' ? { error } : {})}
        />
        <Input
          label="Teléfono"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          hint="Para avisarle cuando su calzado esté listo."
          {...(error && name.trim() !== '' ? { error } : {})}
        />
      </div>
    </Modal>
  )
}
