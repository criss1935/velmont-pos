import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Badge, Button, Card } from '@/components/ui'
import { catalog as catalogRepo, type Service, type ServiceCategory } from '@/data'
import { formatCents } from '@/lib/money'
import { CategoryFormModal } from './CategoryFormModal'
import { ServiceFormModal } from './ServiceFormModal'
import styles from './CatalogPage.module.css'

const SIN_CATEGORIA = '__sin_categoria__'

/**
 * Referencias estables para el caso "todavía no hay datos".
 *
 * Un `?? []` escrito en el cuerpo del componente crea un array NUEVO en cada
 * render, así que las dependencias del useMemo de abajo cambian siempre y el
 * memo no memoiza nada: reagrupa el catálogo completo en cada pintada. Con una
 * constante de módulo la referencia es la misma y el memo vuelve a servir.
 */
const NO_CATEGORIES: ServiceCategory[] = []
const NO_SERVICES: Service[] = []

export function CatalogPage() {
  const queryClient = useQueryClient()
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null)
  const [creatingService, setCreatingService] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: catalogRepo.listCategories })
  const servicesQuery = useQuery({ queryKey: ['services-all'], queryFn: catalogRepo.listAllServices })

  const categories = categoriesQuery.data ?? NO_CATEGORIES
  const services = servicesQuery.data ?? NO_SERVICES

  const groups = useMemo(() => {
    const byCategory = new Map<string, Service[]>()
    for (const service of services) {
      const key = service.categoryId ?? SIN_CATEGORIA
      const bucket = byCategory.get(key) ?? []
      bucket.push(service)
      byCategory.set(key, bucket)
    }

    const ordered: { category: ServiceCategory | null; services: Service[] }[] = [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => ({ category, services: byCategory.get(category.id) ?? [] }))

    const orphans = byCategory.get(SIN_CATEGORIA) ?? []
    if (orphans.length > 0) {
      ordered.push({ category: null, services: orphans })
    }

    return ordered
  }, [categories, services])

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['categories'] })
    void queryClient.invalidateQueries({ queryKey: ['services-all'] })
  }

  return (
    <Page
      title="Catálogo"
      subtitle="Servicios y precios que ve el mostrador al recibir."
      actions={
        <>
          <Button onClick={() => setCreatingCategory(true)}>Nueva categoría</Button>
          <Button variant="primary" onClick={() => setCreatingService(true)}>
            Nuevo servicio
          </Button>
        </>
      }
    >
      {groups.length === 0 ? (
        <p className={styles.empty}>Todavía no hay categorías ni servicios.</p>
      ) : (
        <div className={styles.groups}>
          {groups.map(({ category, services: items }) => (
            <section key={category?.id ?? SIN_CATEGORIA} className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className={styles.groupTitle}>{category?.name ?? 'Sin categoría'}</h2>
                {category && (
                  <Button size="sm" onClick={() => setEditingCategory(category)}>
                    Editar categoría
                  </Button>
                )}
              </div>

              {items.length === 0 ? (
                <p className={styles.emptyGroup}>Sin servicios en esta categoría.</p>
              ) : (
                <div className={styles.grid}>
                  {items.map((service) => (
                    <Card
                      key={service.id}
                      className={!service.active ? styles.inactive : undefined}
                    >
                      <div className={styles.head}>
                        <span className={styles.name}>{service.name}</span>
                        {!service.active && <Badge tone="neutral">Inactivo</Badge>}
                      </div>

                      {service.description && (
                        <p className={styles.description}>{service.description}</p>
                      )}

                      <div className={styles.price} data-numeric>
                        {formatCents(service.price)}
                      </div>

                      <div className={styles.days}>
                        {service.estimatedDays === 0
                          ? 'Mismo día'
                          : `${service.estimatedDays} día${service.estimatedDays === 1 ? '' : 's'}`}
                      </div>

                      <Button block onClick={() => setEditingService(service)}>
                        Editar
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {creatingCategory && (
        <CategoryFormModal
          category={null}
          onClose={() => setCreatingCategory(false)}
          onSaved={() => {
            setCreatingCategory(false)
            invalidate()
          }}
        />
      )}

      {editingCategory && (
        <CategoryFormModal
          category={editingCategory}
          servicesInCategory={services.filter((s) => s.categoryId === editingCategory.id).length}
          onClose={() => setEditingCategory(null)}
          onSaved={() => {
            setEditingCategory(null)
            invalidate()
          }}
          onDeleted={() => {
            setEditingCategory(null)
            invalidate()
          }}
        />
      )}

      {creatingService && (
        <ServiceFormModal
          service={null}
          categories={categories}
          onClose={() => setCreatingService(false)}
          onSaved={() => {
            setCreatingService(false)
            invalidate()
          }}
        />
      )}

      {editingService && (
        <ServiceFormModal
          service={editingService}
          categories={categories}
          onClose={() => setEditingService(null)}
          onSaved={() => {
            setEditingService(null)
            invalidate()
          }}
        />
      )}
    </Page>
  )
}
