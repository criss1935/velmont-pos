import { Card } from '@/components/ui'
import type { Article } from '@/data'
import { formatCents } from '@/lib/money'
import { SneakerDiagram } from '../reception/SneakerDiagram'
import { PhotoGallery } from './PhotoGallery'
import styles from './ArticleDetail.module.css'

/**
 * Un artículo recibido, en modo lectura: los mismos datos que se capturaron al
 * recibir (estado, fotos, diagrama), para consultarlos después sin tener que
 * ir a la base a mano. El diagrama reutiliza el mismo componente de la
 * recepción (`readOnly`) — es la misma silueta, no una reconstrucción aparte.
 */
export function ArticleDetail({ article, index }: { article: Article; index: number }) {
  const title =
    [article.itemType, article.brand, article.model].filter(Boolean).join(' · ') ||
    `Artículo ${index + 1}`

  return (
    <Card title={title} subtitle={article.color ?? undefined} className={styles.card}>
      {article.declaredValue !== null && (
        <div className={styles.declaredValue}>
          <span className={styles.declaredValueLabel}>Valor declarado</span>
          <span className={styles.declaredValueAmount} data-numeric>
            {formatCents(article.declaredValue)}
          </span>
        </div>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Estado al recibir</h3>
        {article.conditionTags.length === 0 && !article.conditionNotes ? (
          <p className={styles.emptyText}>Sin observaciones de estado registradas.</p>
        ) : (
          <>
            {article.conditionTags.length > 0 && (
              <div className={styles.tags}>
                {article.conditionTags.map((tag) => (
                  <span key={tag} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {article.conditionNotes && <p className={styles.notes}>{article.conditionNotes}</p>}
          </>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Evidencia fotográfica</h3>
        <PhotoGallery photos={article.photos} />
      </section>

      {/* Sin marcas, se omite la sección entera: mostrar la silueta vacía para
          un artículo sin diagrama (o que nunca tuvo observaciones) es ruido,
          no información. */}
      {article.diagramMarks.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Diagrama de observaciones</h3>
          <SneakerDiagram marks={article.diagramMarks} readOnly />
        </section>
      )}
    </Card>
  )
}
