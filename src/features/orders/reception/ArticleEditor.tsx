import { useMemo, useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCents, multiplyCents, parseAmount } from '@/lib/money'
import type { ConditionOption, ItemType, Service } from '@/data'
import { articleSubtotal, useReception, type DraftArticle } from './store'
import { ConditionTags } from './ConditionTags'
import { PhotoCapture } from './PhotoCapture'
import { SneakerDiagram } from './SneakerDiagram'
import styles from './Reception.module.css'

/**
 * Editor de un artículo: datos, servicios, condición, evidencia y diagrama, todo
 * en un modal amplio pensado para tablet. Lee y escribe directo en el store del
 * borrador para no arrastrar props por cada sub-sección.
 */
export function ArticleEditor({
  article,
  itemTypes,
  services,
  conditionOptions,
  highValueThreshold,
  onClose,
}: {
  article: DraftArticle
  itemTypes: ItemType[]
  services: Service[]
  conditionOptions: ConditionOption[]
  highValueThreshold: number
  onClose: () => void
}) {
  const update = useReception((s) => s.updateArticle)
  const addService = useReception((s) => s.addService)
  const setServiceQty = useReception((s) => s.setServiceQty)
  const removeService = useReception((s) => s.removeService)
  const setDiagramMarks = useReception((s) => s.setDiagramMarks)
  const addPhotos = useReception((s) => s.addPhotos)
  const updatePhoto = useReception((s) => s.updatePhoto)
  const removePhoto = useReception((s) => s.removePhoto)

  const [category, setCategory] = useState<string | null>(null)
  const [valueText, setValueText] = useState(
    article.declaredValue === null ? '' : (article.declaredValue / 100).toString(),
  )

  const categories = useMemo(() => {
    const names = new Set<string>()
    for (const s of services) if (s.categoryName) names.add(s.categoryName)
    return [...names]
  }, [services])

  const visible = category ? services.filter((s) => s.categoryName === category) : services
  const typeMeta = itemTypes.find((t) => t.name === article.itemType)
  const showsDiagram = typeMeta?.hasDiagram ?? false
  const isHighValue = article.declaredValue !== null && article.declaredValue >= highValueThreshold

  function toggleCondition(label: string) {
    const next = article.conditionTags.includes(label)
      ? article.conditionTags.filter((t) => t !== label)
      : [...article.conditionTags, label]
    update(article.key, { conditionTags: next })
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={article.itemType ? `Artículo · ${article.itemType}` : 'Nuevo artículo'}
      description="Documenta el artículo, sus servicios y su estado al recibirlo."
      footer={
        <Button variant="primary" size="lg" onClick={onClose}>
          Listo
        </Button>
      }
    >
      <div className={styles.editor}>
        {/* --- Datos del artículo --- */}
        <section className={styles.editorSection}>
          <h3 className={styles.editorTitle}>Datos del artículo</h3>

          <div className={styles.typeChips}>
            {itemTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                className={cn(styles.typeChip, article.itemType === type.name && styles.typeChipActive)}
                onClick={() => update(article.key, { itemType: type.name })}
              >
                {type.name}
              </button>
            ))}
          </div>

          <div className={styles.fieldGrid}>
            <Input
              label="Marca"
              placeholder="Nike, Adidas…"
              value={article.brand}
              onChange={(e) => update(article.key, { brand: e.target.value })}
            />
            <Input
              label="Modelo"
              placeholder="Air Jordan 1…"
              value={article.model}
              onChange={(e) => update(article.key, { model: e.target.value })}
            />
            <Input
              label="Color"
              placeholder="Blanco / rojo…"
              value={article.color}
              onChange={(e) => update(article.key, { color: e.target.value })}
            />
            <Input
              label="Valor declarado"
              numeric
              prefix="$"
              inputMode="decimal"
              placeholder="0.00"
              value={valueText}
              onChange={(e) => {
                setValueText(e.target.value)
                const parsed = parseAmount(e.target.value)
                update(article.key, { declaredValue: parsed })
              }}
            />
          </div>

          {isHighValue && (
            <div className={styles.highValue}>
              <span className={styles.highValueTitle}>⚠ Artículo de alto valor</span>
              <span className={styles.highValueText}>
                Este artículo requiere documentación adicional y aceptación de la cláusula
                correspondiente. Registra bien su estado y evidencias.
              </span>
            </div>
          )}
        </section>

        {/* --- Servicios --- */}
        <section className={styles.editorSection}>
          <h3 className={styles.editorTitle}>Servicios</h3>

          <div className={styles.categories}>
            <button
              type="button"
              className={cn(styles.chip, category === null && styles.chipActive)}
              onClick={() => setCategory(null)}
            >
              Todo
            </button>
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                className={cn(styles.chip, category === name && styles.chipActive)}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>

          <div className={styles.serviceGrid}>
            {visible.map((service) => {
              const picked = article.services.some((s) => s.serviceId === service.id)
              return (
                <button
                  key={service.id}
                  type="button"
                  className={cn(styles.service, picked && styles.servicePicked)}
                  onClick={() => addService(article.key, service)}
                >
                  <span className={styles.serviceName}>{service.name}</span>
                  <span className={styles.servicePrice} data-numeric>
                    {formatCents(service.price)}
                  </span>
                  <span className={styles.serviceDays}>
                    {service.estimatedDays === 0
                      ? 'Mismo día'
                      : `${service.estimatedDays} día${service.estimatedDays === 1 ? '' : 's'}`}
                  </span>
                </button>
              )
            })}
          </div>

          {article.services.length > 0 && (
            <div className={styles.pickedList}>
              {article.services.map((s) => (
                <div key={s.serviceId} className={styles.pickedRow}>
                  <span className={styles.pickedName}>{s.serviceName}</span>
                  <div className={styles.qty}>
                    <button
                      type="button"
                      className={styles.qtyButton}
                      onClick={() => setServiceQty(article.key, s.serviceId, s.quantity - 1)}
                      aria-label="Menos"
                    >
                      −
                    </button>
                    <span className={styles.qtyValue} data-numeric>
                      {s.quantity}
                    </span>
                    <button
                      type="button"
                      className={styles.qtyButton}
                      onClick={() => setServiceQty(article.key, s.serviceId, s.quantity + 1)}
                      aria-label="Más"
                    >
                      +
                    </button>
                  </div>
                  <span className={styles.pickedAmount} data-numeric>
                    {formatCents(multiplyCents(s.unitPrice, s.quantity))}
                  </span>
                  <button
                    type="button"
                    className={styles.pickedRemove}
                    onClick={() => removeService(article.key, s.serviceId)}
                  >
                    Quitar
                  </button>
                </div>
              ))}
              <div className={styles.pickedTotal}>
                <span>Subtotal del artículo</span>
                <span data-numeric>{formatCents(articleSubtotal(article))}</span>
              </div>
            </div>
          )}
        </section>

        {/* --- Estado / condición --- */}
        <section className={styles.editorSection}>
          <h3 className={styles.editorTitle}>Estado en que se recibe</h3>
          <ConditionTags
            options={conditionOptions.map((c) => c.label)}
            selected={article.conditionTags}
            onToggle={toggleCondition}
            notes={article.conditionNotes}
            onNotesChange={(notes) => update(article.key, { conditionNotes: notes })}
          />
        </section>

        {/* --- Evidencia fotográfica --- */}
        <section className={styles.editorSection}>
          <h3 className={styles.editorTitle}>Evidencia fotográfica</h3>
          <PhotoCapture
            photos={article.photos}
            onAdd={(files) => addPhotos(article.key, files)}
            onUpdate={(key, classification) => updatePhoto(article.key, key, { classification })}
            onRemove={(key) => removePhoto(article.key, key)}
          />
        </section>

        {/* --- Diagrama (solo tipos con silueta: Tenis) --- */}
        {showsDiagram && (
          <section className={styles.editorSection}>
            <h3 className={styles.editorTitle}>Diagrama de observaciones</h3>
            <SneakerDiagram
              marks={article.diagramMarks}
              onChange={(marks) => setDiagramMarks(article.key, marks)}
            />
          </section>
        )}
      </div>
    </Modal>
  )
}
