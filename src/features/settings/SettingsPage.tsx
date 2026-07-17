import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Badge, Button, Card } from '@/components/ui'
import { DataError, settings as settingsRepo, type ConditionOption, type ItemType } from '@/data'
import { centsToPesos, parseAmount, type Cents } from '@/lib/money'
import { ConditionOptionFormModal } from './ConditionOptionFormModal'
import { ItemTypeFormModal } from './ItemTypeFormModal'
import styles from './SettingsPage.module.css'

/**
 * Configuración del negocio: fila única en `business_settings`, más los dos
 * catálogos que alimentan el wizard de recepción (`item_types`,
 * `condition_options`). Los tres eran de solo lectura hasta ahora — esta
 * pantalla es la única forma de cambiarlos sin tocar código ni base a mano.
 */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const businessQuery = useQuery({ queryKey: ['businessSettings'], queryFn: settingsRepo.getBusinessSettings })

  const [thresholdText, setThresholdText] = useState('')
  const [terms, setTerms] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!businessQuery.data) return
    setThresholdText(centsToPesos(businessQuery.data.highValueThreshold).toFixed(2))
    setTerms(businessQuery.data.receptionTerms)
  }, [businessQuery.data])

  const threshold: Cents | null = parseAmount(thresholdText)
  const thresholdValid = threshold !== null
  const termsValid = terms.trim().length > 0
  const valid = thresholdValid && termsValid

  async function submit() {
    if (!thresholdValid) return

    setBusy(true)
    setError(null)
    setSaved(false)

    try {
      await settingsRepo.updateBusinessSettings({ highValueThreshold: threshold, receptionTerms: terms })
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['businessSettings'] })
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo guardar la configuración.')
    } finally {
      setBusy(false)
    }
  }

  if (businessQuery.isLoading) {
    return (
      <Page title="Configuración">
        <p className={styles.loading}>Cargando…</p>
      </Page>
    )
  }

  return (
    <Page title="Configuración" subtitle="Parámetros del negocio y catálogos de recepción.">
      <div className={styles.stack}>
        <Card title="Recepción">
          <div className={styles.form}>
            {error && <div className={styles.error}>{error}</div>}
            {saved && !error && <div className={styles.saved}>Guardado.</div>}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="threshold">
                Umbral de valor alto
              </label>
              <div className={styles.inputWrap}>
                <span className={styles.prefix}>$</span>
                <input
                  id="threshold"
                  className={styles.input}
                  inputMode="decimal"
                  value={thresholdText}
                  onChange={(event) => {
                    setThresholdText(event.target.value)
                    setSaved(false)
                  }}
                />
              </div>
              {!thresholdValid && <span className={styles.fieldError}>Importe inválido.</span>}
              <p className={styles.hint}>
                A partir de este valor declarado, la recepción trata el artículo como de alto
                valor (más evidencia fotográfica recomendada).
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="terms">
                Términos de la responsiva
              </label>
              <textarea
                id="terms"
                className={styles.textarea}
                rows={8}
                value={terms}
                onChange={(event) => {
                  setTerms(event.target.value)
                  setSaved(false)
                }}
              />
              {!termsValid && <span className={styles.fieldError}>No puede quedar vacío.</span>}
              <p className={styles.hint}>
                Texto que el cliente acepta al recibir su calzado — se imprime en el comprobante y
                se muestra en la pantalla de firma.
              </p>
            </div>

            <Button variant="primary" disabled={!valid || busy} loading={busy} onClick={() => void submit()}>
              Guardar
            </Button>
          </div>
        </Card>

        <ItemTypesCard />
        <ConditionOptionsCard />
      </div>
    </Page>
  )
}

/* -------------------------------------------------------------------------- */

function ItemTypesCard() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['itemTypes-all'], queryFn: settingsRepo.listAllItemTypes })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ItemType | null>(null)

  const items = query.data ?? []

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['itemTypes-all'] })
    void queryClient.invalidateQueries({ queryKey: ['item-types'] })
  }

  return (
    <Card
      title="Tipos de artículo"
      subtitle="Lo que se elige al recibir (Tenis, Bolsa, Gorra…). Controla si aparece el diagrama."
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          Nuevo tipo
        </Button>
      }
    >
      {items.length === 0 ? (
        <p className={styles.emptyList}>Sin tipos de artículo.</p>
      ) : (
        <div className={styles.rows}>
          {items.map((item) => (
            <div key={item.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowName}>{item.name}</span>
                <div className={styles.rowBadges}>
                  {!item.active && <Badge tone="neutral">Inactivo</Badge>}
                  {item.hasDiagram && <Badge tone="info">Diagrama</Badge>}
                </div>
              </div>
              <Button size="sm" onClick={() => setEditing(item)}>
                Editar
              </Button>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <ItemTypeFormModal
          itemType={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            invalidate()
          }}
        />
      )}

      {editing && (
        <ItemTypeFormModal
          itemType={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            invalidate()
          }}
        />
      )}
    </Card>
  )
}

function ConditionOptionsCard() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['conditionOptions-all'], queryFn: settingsRepo.listAllConditionOptions })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ConditionOption | null>(null)

  const items = query.data ?? []

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['conditionOptions-all'] })
    void queryClient.invalidateQueries({ queryKey: ['condition-options'] })
  }

  return (
    <Card
      title="Condiciones de recepción"
      subtitle="Chips de estado que se ofrecen al recibir (Rayones, Manchas…)."
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          Nueva condición
        </Button>
      }
    >
      {items.length === 0 ? (
        <p className={styles.emptyList}>Sin condiciones registradas.</p>
      ) : (
        <div className={styles.rows}>
          {items.map((item) => (
            <div key={item.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowName}>{item.label}</span>
                {!item.active && <Badge tone="neutral">Inactiva</Badge>}
              </div>
              <Button size="sm" onClick={() => setEditing(item)}>
                Editar
              </Button>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <ConditionOptionFormModal
          option={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            invalidate()
          }}
        />
      )}

      {editing && (
        <ConditionOptionFormModal
          option={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            invalidate()
          }}
        />
      )}
    </Card>
  )
}
