import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Button, Card, Input, Modal } from '@/components/ui'
import { customers as customersRepo, DataError, orders as ordersRepo, type Customer } from '@/data'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import { StatusBadge } from '@/features/orders/StatusBadge'
import styles from './CustomersPage.module.css'

export function CustomersPage() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [creating, setCreating] = useState(false)

  const results = useQuery({
    queryKey: ['customers', query],
    queryFn: () => customersRepo.searchCustomers(query, 50),
    enabled: query.trim().length >= 2,
  })

  const list = results.data ?? []
  const searching = query.trim().length >= 2

  return (
    <Page
      title="Clientes"
      subtitle="Busca por nombre o teléfono."
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Cliente nuevo
        </Button>
      }
    >
      <div className={styles.search}>
        <Input
          placeholder="Escribe al menos dos letras o dígitos…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar cliente"
        />
      </div>

      {!searching ? (
        <div className={styles.hint}>
          <span className={styles.hintIcon} aria-hidden>
            ◉
          </span>
          <p>Escribe un nombre o un teléfono para buscar.</p>
        </div>
      ) : list.length === 0 ? (
        <div className={styles.hint}>
          <p>Ningún cliente coincide con «{query.trim()}».</p>
          <Button onClick={() => setCreating(true)}>Crear cliente nuevo</Button>
        </div>
      ) : (
        <div className={styles.grid}>
          {list.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className={styles.card}
              onClick={() => setSelected(customer)}
            >
              <div className={styles.name}>{customer.fullName}</div>
              {customer.phone && (
                <div className={styles.phone} data-numeric>
                  {customer.phone}
                </div>
              )}
              <div className={styles.since}>Cliente desde {formatDate(customer.createdAt)}</div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <CustomerDetailModal customer={selected} onClose={() => setSelected(null)} />
      )}

      <CustomerFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(customer) => {
          setCreating(false)
          setQuery(customer.fullName)
        }}
      />
    </Page>
  )
}

/* -------------------------------------------------------------------------- */

/** Ficha del cliente con su historial: qué ha traído y si dejó algo a deber. */
function CustomerDetailModal({
  customer,
  onClose,
}: {
  customer: Customer
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)

  const history = useQuery({
    queryKey: ['customer-orders', customer.id],
    queryFn: async () => {
      // No hay filtro por cliente en listOrders: se traen las últimas y se
      // filtran aquí. Con el volumen de un local es de sobra; si el histórico
      // crece, el filtro se baja al repositorio y a la base.
      const all = await ordersRepo.listOrders({ limit: 200 })
      return all.filter((order) => order.customerPhone === customer.phone && customer.phone)
    },
    enabled: Boolean(customer.phone),
  })

  const orders = history.data ?? []

  return (
    <>
      <Modal
        open={!editing}
        onClose={onClose}
        wide
        title={customer.fullName}
        description={customer.phone ?? 'Sin teléfono registrado'}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
            <Button onClick={() => setEditing(true)}>Editar</Button>
          </>
        }
      >
        {customer.notes && <p className={styles.notes}>{customer.notes}</p>}

        <h3 className="vm-eyebrow" style={{ marginBottom: 'var(--vm-space-3)' }}>
          Historial
        </h3>

        {orders.length === 0 ? (
          <p className={styles.emptyHistory}>Todavía no ha traído nada.</p>
        ) : (
          <Card flush>
            {orders.map((order) => (
              <button
                key={order.id}
                type="button"
                className={styles.historyRow}
                onClick={() => {
                  onClose()
                  void navigate(`/ordenes/${order.id}`)
                }}
              >
                <span className={styles.historyFolio} data-numeric>
                  {order.folio}
                </span>
                <StatusBadge status={order.status} />
                <span className={styles.historyDate}>{formatDate(order.receivedAt)}</span>
                <span className={styles.historyTotal} data-numeric>
                  {formatCents(order.total)}
                </span>
                {order.balance > 0 && (
                  <span className={styles.historyDebt}>Debe {formatCents(order.balance)}</span>
                )}
              </button>
            ))}
          </Card>
        )}
      </Modal>

      <CustomerFormModal
        open={editing}
        customer={customer}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          onClose()
        }}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */

function CustomerFormModal({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean
  customer?: Customer
  onClose: () => void
  onSaved: (customer: Customer) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(customer?.fullName ?? '')
    setPhone(customer?.phone ?? '')
    setEmail(customer?.email ?? '')
    setNotes(customer?.notes ?? '')
    setError(null)
  }, [open, customer])

  async function submit() {
    if (name.trim() === '') {
      setError('El nombre es obligatorio.')
      return
    }

    setBusy(true)
    setError(null)

    const input = { fullName: name, phone, email, notes }

    try {
      const saved = customer
        ? await customersRepo.updateCustomer(customer.id, input)
        : await customersRepo.createCustomer(input)
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? 'Editar cliente' : 'Cliente nuevo'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <Input label="Nombre" value={name} onChange={(event) => setName(event.target.value)} />
        <Input
          label="Teléfono"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <Input
          label="Correo"
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Notas"
          placeholder="Ej. prefiere que le llamen por la tarde"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  )
}
