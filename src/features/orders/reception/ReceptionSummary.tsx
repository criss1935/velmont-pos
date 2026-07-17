import { formatCents, subtractCents, type Cents } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import {
  articleSubtotal,
  effectivePromisedDate,
  subtotalOf,
  totalOf,
  useReception,
} from './store'

/**
 * Resumen vivo de la recepción ("NUEVA RECEPCIÓN"). Se actualiza conforme el
 * operador avanza. Es puramente presentacional: lee el store del borrador.
 */
export function ReceptionSummary({ styles }: { styles: Record<string, string> }) {
  const customer = useReception((s) => s.customer)
  const articles = useReception((s) => s.articles)
  const discount = useReception((s) => s.discount)
  const promisedOverride = useReception((s) => s.promisedAtOverride)
  const payment = useReception((s) => s.payment)

  const subtotal = subtotalOf(articles)
  const total = totalOf(articles, discount)
  const promise = effectivePromisedDate(articles, promisedOverride)
  const advance: Cents = payment?.amount ?? (0 as Cents)
  const balance = subtractCents(total, advance > total ? total : advance)

  const withServices = articles.filter((a) => a.services.length > 0 || a.itemType)

  return (
    <div className={styles.summary}>
      <div className={styles.summaryHead}>Nueva recepción</div>

      <div className={styles.summaryBlock}>
        <span className={styles.summaryLabel}>Cliente</span>
        <span className={styles.summaryValue}>{customer?.fullName ?? 'Sin asignar'}</span>
      </div>

      <div className={styles.summaryBlock}>
        <span className={styles.summaryLabel}>
          {withServices.length === 1 ? 'Artículo' : `Artículos (${withServices.length})`}
        </span>
        {withServices.length === 0 ? (
          <span className={styles.summaryMuted}>Aún no hay artículos</span>
        ) : (
          <ul className={styles.summaryArticles}>
            {withServices.map((a) => (
              <li key={a.key} className={styles.summaryArticle}>
                <div className={styles.summaryArticleTop}>
                  <span className={styles.summaryArticleName}>
                    {[a.itemType, a.brand, a.model].filter(Boolean).join(' ') || 'Artículo'}
                  </span>
                  <span data-numeric>{formatCents(articleSubtotal(a))}</span>
                </div>
                <div className={styles.summaryArticleMeta}>
                  {a.services.length > 0 && (
                    <span>
                      {a.services.length} servicio{a.services.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {a.conditionTags.length + (a.conditionNotes ? 1 : 0) > 0 && (
                    <span>
                      {a.conditionTags.length + a.diagramMarks.length} observ.
                    </span>
                  )}
                  {a.photos.length > 0 && <span>{a.photos.length} fotos</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {promise && (
        <div className={styles.summaryBlock}>
          <span className={styles.summaryLabel}>Entrega estimada</span>
          <span className={styles.summaryValue}>{formatDate(promise.toISOString())}</span>
        </div>
      )}

      <div className={styles.summaryTotals}>
        <div className={styles.summaryRow}>
          <span>Subtotal</span>
          <span data-numeric>{formatCents(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className={styles.summaryRow}>
            <span>Descuento</span>
            <span data-numeric>−{formatCents(discount)}</span>
          </div>
        )}
        <div className={styles.summaryGrand}>
          <span>Total</span>
          <span data-numeric>{formatCents(total)}</span>
        </div>
        {advance > 0 && (
          <>
            <div className={styles.summaryRow}>
              <span>Anticipo</span>
              <span data-numeric>{formatCents(advance > total ? total : advance)}</span>
            </div>
            <div className={styles.summaryRow}>
              <span>Saldo pendiente</span>
              <span data-numeric>{formatCents(balance)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
