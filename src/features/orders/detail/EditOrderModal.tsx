import { useState, type ComponentProps } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, Modal } from '@/components/ui'
import { CustomerPicker } from '@/features/customers/CustomerPicker'
import { PriceField } from '@/features/orders/reception/ArticleEditor'
import {
  catalog,
  DataError,
  orders as ordersRepo,
  settings as settingsRepo,
  type Article,
  type Order,
  type OrderItem,
  type Service,
} from '@/data'
import { cn } from '@/lib/cn'
import { cents, formatCents, multiplyCents, parseAmount, type Cents } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import reception from '../reception/Reception.module.css'
import styles from './EditOrderModal.module.css'

/**
 * Edición de una orden ya guardada (y todavía abierta): cliente, artículos,
 * servicios con su precio y cantidad, descuento, notas y fecha de entrega.
 *
 * Cada cambio se aplica al momento, como en "Editar fotos": no hay un botón de
 * guardar que se pueda olvidar. Los totales los recalcula la base (trigger), y
 * aquí solo se cuida una regla: el total nunca puede quedar por debajo de lo
 * que el cliente ya pagó — un saldo negativo es dinero que alguien tiene que
 * devolver, y eso se decide en caja, no editando un precio.
 */
export function EditOrderModal({
  order,
  open,
  onClose,
  onChanged,
}: {
  order: Order
  open: boolean
  onClose: () => void
  /** Debe esperar a que la orden se vuelva a leer: la siguiente validación usa los datos frescos. */
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sube cuando un cambio se rechaza: fuerza a los campos de precio a volver al valor real.
  const [nonce, setNonce] = useState(0)

  const servicesQuery = useQuery({ queryKey: ['services'], queryFn: catalog.listServices, staleTime: 5 * 60_000 })
  const itemTypesQuery = useQuery({ queryKey: ['item-types'], queryFn: settingsRepo.listItemTypes, staleTime: 5 * 60_000 })
  const services = servicesQuery.data ?? []
  const itemTypes = itemTypesQuery.data ?? []

  const orphanItems = order.items.filter((item) => item.articleId === null)

  async function run(task: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await task()
      await onChanged()
    } catch (cause) {
      setNonce((n) => n + 1)
      setError(
        cause instanceof DataError
          ? cause.message
          : 'No se pudo guardar el cambio. Revisa que haya internet e inténtalo de nuevo.',
      )
    } finally {
      setBusy(false)
    }
  }

  /** El total resultante no puede ser menor que lo ya cobrado. */
  function assertCovered(newSubtotal: number, newDiscount: number) {
    const discount = Math.min(newDiscount, newSubtotal)
    const total = newSubtotal - discount
    if (total < order.paid) {
      throw new DataError(
        `El total quedaría en ${formatCents(cents(total))} pero ya se cobraron ${formatCents(order.paid)}. ` +
          'Si hay que devolver dinero, regístralo como una salida de caja.',
      )
    }
  }

  const subtotalWith = (delta: number) => order.subtotal + delta

  function changePrice(item: OrderItem, price: Cents) {
    void run(async () => {
      assertCovered(subtotalWith(multiplyCents(price, item.quantity) - item.lineTotal), order.discount)
      await ordersRepo.updateOrderItem(item.id, { unitPrice: price })
    })
  }

  function changeQty(item: OrderItem, quantity: number) {
    if (quantity < 1) return
    void run(async () => {
      assertCovered(subtotalWith(multiplyCents(item.unitPrice, quantity) - item.lineTotal), order.discount)
      await ordersRepo.updateOrderItem(item.id, { quantity })
    })
  }

  function removeItem(item: OrderItem) {
    void run(async () => {
      if (order.items.length <= 1) {
        throw new DataError('La orden debe tener al menos un servicio. Para anularla, cancélala.')
      }
      assertCovered(subtotalWith(0 - item.lineTotal), order.discount)
      await ordersRepo.removeOrderItem(item.id)
    })
  }

  function addCatalogService(articleId: string | null, service: Service) {
    void run(async () => {
      await ordersRepo.addOrderItem({
        orderId: order.id,
        articleId,
        serviceId: service.id,
        serviceName: service.name,
        unitPrice: service.price,
      })
    })
  }

  function addCustomService(articleId: string | null, name: string, price: Cents) {
    void run(async () => {
      await ordersRepo.addOrderItem({
        orderId: order.id,
        articleId,
        serviceId: null,
        serviceName: name.trim(),
        unitPrice: price,
      })
    })
  }

  function addArticle() {
    void run(async () => {
      const next = order.articles.reduce((max, a) => Math.max(max, a.sortOrder), -1) + 1
      await ordersRepo.addOrderArticle({
        orderId: order.id,
        itemType: itemTypes[0]?.name ?? 'Tenis',
        sortOrder: next,
      })
    })
  }

  function setDiscount(discount: Cents) {
    void run(async () => {
      if (discount > order.subtotal) throw new DataError('El descuento no puede ser mayor que el subtotal.')
      assertCovered(order.subtotal, discount)
      await ordersRepo.setOrderDiscount(order.id, discount)
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Editar ${order.folio}`}
      description="Los cambios se guardan al momento. Solo se puede editar mientras la orden no esté entregada ni cancelada."
      footer={
        <Button variant="primary" size="lg" onClick={onClose}>
          Listo
        </Button>
      }
    >
      <fieldset className={styles.fieldset} disabled={busy}>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {/* --- Cliente --- */}
        <section className={reception.editorSection}>
          <h3 className={reception.editorTitle}>Cliente</h3>
          <CustomerPicker
            value={order.customer}
            onChange={(customer) => void run(() => ordersRepo.updateOrderDetails(order.id, { customerId: customer?.id ?? null }))}
          />
        </section>

        {/* --- Artículos y servicios --- */}
        {order.articles.map((article, index) => (
          <ArticleBox
            key={article.id}
            article={article}
            index={index}
            nonce={nonce}
            itemTypes={itemTypes.map((t) => t.name)}
            services={services}
            onType={(itemType) => void run(() => ordersRepo.updateOrderArticle(article.id, { itemType }))}
            onField={(field, text) =>
              void run(() => ordersRepo.updateOrderArticle(article.id, { [field]: text === '' ? null : text }))
            }
            onPrice={changePrice}
            onQty={changeQty}
            onRemove={removeItem}
            onAddCatalog={(service) => addCatalogService(article.id, service)}
            onAddCustom={(name, price) => addCustomService(article.id, name, price)}
          />
        ))}

        {orphanItems.length > 0 && (
          <section className={styles.articleBox}>
            <div className={styles.articleHead}>Servicios de la orden</div>
            <LineList
              items={orphanItems}
              nonce={nonce}
              onPrice={changePrice}
              onQty={changeQty}
              onRemove={removeItem}
            />
            <AddServices
              services={services}
              onAddCatalog={(service) => addCatalogService(null, service)}
              onAddCustom={(name, price) => addCustomService(null, name, price)}
            />
          </section>
        )}

        <Button variant="secondary" block onClick={addArticle}>
          + Agregar otro par o artículo a esta orden
        </Button>

        {/* --- Orden --- */}
        <section className={reception.editorSection}>
          <h3 className={reception.editorTitle}>Orden</h3>
          <div className={reception.fieldGrid}>
            <BlurInput
              key={`discount-${order.discount}-${nonce}`}
              label="Descuento"
              numeric
              prefix="$"
              inputMode="decimal"
              placeholder="0.00"
              value={order.discount === 0 ? '' : (order.discount / 100).toString()}
              onCommit={(text) => {
                const parsed = text === '' ? cents(0) : parseAmount(text)
                if (parsed !== null && parsed !== order.discount) setDiscount(parsed)
              }}
            />
            <label className={reception.dateField}>
              Entrega estimada
              <input
                type="date"
                className={reception.dateInput}
                value={order.promisedAt ? toDateInput(new Date(order.promisedAt)) : ''}
                onChange={(e) =>
                  void run(() =>
                    ordersRepo.updateOrderDetails(order.id, {
                      promisedAt: e.target.value ? fromDateInput(e.target.value) : null,
                    }),
                  )
                }
              />
              {order.promisedAt && <span className={reception.dateHint}>{formatDate(order.promisedAt)}</span>}
            </label>
          </div>

          <label className={reception.conditionNotesLabel}>
            Notas de la orden
            <textarea
              key={`notes-${order.notes ?? ''}`}
              className={reception.conditionNotes}
              rows={2}
              defaultValue={order.notes ?? ''}
              onBlur={(e) => {
                const text = e.target.value.trim()
                if (text !== (order.notes ?? '')) {
                  void run(() => ordersRepo.updateOrderDetails(order.id, { notes: text === '' ? null : text }))
                }
              }}
            />
          </label>
        </section>

        <div className={styles.totals}>
          <div className={styles.totalRow}>
            <span>Subtotal</span>
            <span data-numeric>{formatCents(order.subtotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className={styles.totalRow}>
              <span>Descuento</span>
              <span data-numeric>−{formatCents(order.discount)}</span>
            </div>
          )}
          <div className={styles.totalGrand}>
            <span>Total</span>
            <span data-numeric>{formatCents(order.total)}</span>
          </div>
          <div className={styles.totalRow}>
            <span>Cobrado</span>
            <span data-numeric>{formatCents(order.paid)}</span>
          </div>
          <div className={styles.totalRow}>
            <span>Saldo</span>
            <span data-numeric>{formatCents(order.balance)}</span>
          </div>
        </div>
      </fieldset>
    </Modal>
  )
}

// -----------------------------------------------------------------------------

function ArticleBox({
  article,
  index,
  nonce,
  itemTypes,
  services,
  onType,
  onField,
  onPrice,
  onQty,
  onRemove,
  onAddCatalog,
  onAddCustom,
}: {
  article: Article
  index: number
  nonce: number
  itemTypes: string[]
  services: Service[]
  onType: (itemType: string) => void
  onField: (field: 'brand' | 'model' | 'color', text: string) => void
  onPrice: (item: OrderItem, price: Cents) => void
  onQty: (item: OrderItem, quantity: number) => void
  onRemove: (item: OrderItem) => void
  onAddCatalog: (service: Service) => void
  onAddCustom: (name: string, price: Cents) => void
}) {
  // Un tipo que ya no está en el catálogo (se desactivó) se sigue mostrando: la orden conserva lo que se recibió.
  const types = itemTypes.includes(article.itemType) ? itemTypes : [article.itemType, ...itemTypes]

  return (
    <section className={styles.articleBox}>
      <div className={styles.articleHead}>
        Par {index + 1}
        {[article.brand, article.model].filter(Boolean).length > 0 &&
          ` · ${[article.brand, article.model].filter(Boolean).join(' ')}`}
      </div>

      <div className={reception.typeChips}>
        {types.map((name) => (
          <button
            key={name}
            type="button"
            className={cn(reception.typeChip, article.itemType === name && reception.typeChipActive)}
            onClick={() => article.itemType !== name && onType(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className={reception.fieldGrid}>
        <BlurInput
          key={`brand-${article.brand ?? ''}`}
          label="Marca"
          value={article.brand ?? ''}
          onCommit={(text) => onField('brand', text)}
        />
        <BlurInput
          key={`model-${article.model ?? ''}`}
          label="Modelo"
          value={article.model ?? ''}
          onCommit={(text) => onField('model', text)}
        />
        <BlurInput
          key={`color-${article.color ?? ''}`}
          label="Color"
          value={article.color ?? ''}
          onCommit={(text) => onField('color', text)}
        />
      </div>

      <LineList items={article.items} nonce={nonce} onPrice={onPrice} onQty={onQty} onRemove={onRemove} />
      <AddServices services={services} onAddCatalog={onAddCatalog} onAddCustom={onAddCustom} />
    </section>
  )
}

function LineList({
  items,
  nonce,
  onPrice,
  onQty,
  onRemove,
}: {
  items: OrderItem[]
  nonce: number
  onPrice: (item: OrderItem, price: Cents) => void
  onQty: (item: OrderItem, quantity: number) => void
  onRemove: (item: OrderItem) => void
}) {
  if (items.length === 0) {
    return <span className={reception.articleWarn}>Este par no tiene servicios todavía.</span>
  }

  return (
    <div className={reception.pickedList}>
      {items.map((item) => (
        <div key={item.id} className={reception.pickedRow}>
          <span className={reception.pickedName}>
            {item.serviceName}
            {item.serviceId === null && <span className={reception.pickedCustomTag}>otro</span>}
          </span>
          <div className={reception.qty}>
            <button type="button" className={reception.qtyButton} aria-label="Menos" onClick={() => onQty(item, item.quantity - 1)}>
              −
            </button>
            <span className={reception.qtyValue} data-numeric>
              {item.quantity}
            </span>
            <button type="button" className={reception.qtyButton} aria-label="Más" onClick={() => onQty(item, item.quantity + 1)}>
              +
            </button>
          </div>
          <PriceField
            key={`${item.id}-${item.unitPrice}-${nonce}`}
            value={item.unitPrice}
            onCommit={(price) => onPrice(item, price)}
          />
          <span className={reception.pickedAmount} data-numeric>
            {formatCents(item.lineTotal)}
          </span>
          <button type="button" className={reception.pickedRemove} onClick={() => onRemove(item)}>
            Quitar
          </button>
        </div>
      ))}
    </div>
  )
}

/** Agregar un servicio del catálogo (lista) o uno manual (nombre + precio). */
function AddServices({
  services,
  onAddCatalog,
  onAddCustom,
}: {
  services: Service[]
  onAddCatalog: (service: Service) => void
  onAddCustom: (name: string, price: Cents) => void
}) {
  const [custom, setCustom] = useState(false)
  const [name, setName] = useState('')
  const [priceText, setPriceText] = useState('')
  const price = parseAmount(priceText)
  const ready = name.trim() !== '' && price !== null && price > 0

  return (
    <div className={reception.editorSection}>
      <div className={styles.addRow}>
        <select
          className={styles.select}
          aria-label="Agregar servicio del catálogo"
          value=""
          onChange={(e) => {
            const service = services.find((s) => s.id === e.target.value)
            if (service) onAddCatalog(service)
          }}
        >
          <option value="">+ Agregar servicio del catálogo…</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {formatCents(s.price)}
            </option>
          ))}
        </select>
        {!custom && (
          <Button variant="secondary" onClick={() => setCustom(true)}>
            + Otro servicio (escribir precio)
          </Button>
        )}
      </div>

      {custom && (
        <div className={styles.customRow}>
          <Input label="¿Qué se le hizo?" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Precio"
            numeric
            prefix="$"
            inputMode="decimal"
            placeholder="0.00"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
          />
          <Button variant="ghost" onClick={() => setCustom(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              if (!ready || price === null) return
              onAddCustom(name, price)
              setName('')
              setPriceText('')
              setCustom(false)
            }}
          >
            Agregar
          </Button>
        </div>
      )}
    </div>
  )
}

/** Input que confirma al salir del campo (o con Enter), no en cada tecla. */
function BlurInput({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (text: string) => void
} & Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur'>) {
  const [text, setText] = useState(value)

  return (
    <Input
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const clean = text.trim()
        if (clean !== value) onCommit(clean)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function toDateInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fromDateInput(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1)
  date.setHours(18, 0, 0, 0)
  return date
}
