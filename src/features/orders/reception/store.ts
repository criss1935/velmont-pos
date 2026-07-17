import { create } from 'zustand'
import { addCents, cents, multiplyCents, subtractCents, type Cents } from '@/lib/money'
import { promisedDate } from '@/lib/dates'
import type { Customer, DiagramMark, PaymentMethod, Service } from '@/data'

/** Un servicio aplicado a un artículo dentro del borrador. */
export interface DraftService {
  serviceId: string
  serviceName: string
  unitPrice: Cents
  quantity: number
  estimatedDays: number
}

/** Una foto en memoria: aún no se sube, se muestra con un object URL. */
export interface DraftPhoto {
  key: string
  file: File
  url: string
  classification: string | null
}

/** Un artículo en construcción. */
export interface DraftArticle {
  key: string
  itemType: string
  brand: string
  model: string
  color: string
  declaredValue: Cents | null
  conditionTags: string[]
  conditionNotes: string
  services: DraftService[]
  diagramMarks: DiagramMark[]
  photos: DraftPhoto[]
}

export interface DraftPayment {
  method: PaymentMethod
  amount: Cents
  tendered: Cents | null
  reference: string
}

let seq = 0
const nextKey = (prefix: string) => `${prefix}-${(seq += 1)}`

function blankArticle(): DraftArticle {
  return {
    key: nextKey('art'),
    itemType: '',
    brand: '',
    model: '',
    color: '',
    declaredValue: null,
    conditionTags: [],
    conditionNotes: '',
    services: [],
    diagramMarks: [],
    photos: [],
  }
}

interface ReceptionState {
  customer: Customer | null
  articles: DraftArticle[]
  notes: string
  discount: Cents
  /** null = usar la fecha estimada automática. */
  promisedAtOverride: Date | null
  responsivaAccepted: boolean
  signature: { blob: Blob; url: string } | null
  payment: DraftPayment | null

  setCustomer: (customer: Customer | null) => void

  addArticle: () => string
  removeArticle: (key: string) => void
  updateArticle: (key: string, patch: Partial<Omit<DraftArticle, 'key'>>) => void

  addService: (articleKey: string, service: Service) => void
  setServiceQty: (articleKey: string, serviceId: string, quantity: number) => void
  removeService: (articleKey: string, serviceId: string) => void

  setDiagramMarks: (articleKey: string, marks: DiagramMark[]) => void

  addPhotos: (articleKey: string, files: File[]) => void
  updatePhoto: (articleKey: string, photoKey: string, patch: Partial<Pick<DraftPhoto, 'classification'>>) => void
  removePhoto: (articleKey: string, photoKey: string) => void

  setNotes: (notes: string) => void
  setDiscount: (discount: Cents) => void
  setPromisedAtOverride: (date: Date | null) => void
  setResponsiva: (accepted: boolean) => void
  setSignature: (signature: { blob: Blob; url: string } | null) => void
  setPayment: (payment: DraftPayment | null) => void

  reset: () => void
}

export const useReception = create<ReceptionState>((set, get) => ({
  customer: null,
  articles: [blankArticle()],
  notes: '',
  discount: cents(0),
  promisedAtOverride: null,
  responsivaAccepted: false,
  signature: null,
  payment: null,

  setCustomer: (customer) => set({ customer }),

  addArticle: () => {
    const article = blankArticle()
    set((state) => ({ articles: [...state.articles, article] }))
    return article.key
  },

  removeArticle: (key) =>
    set((state) => {
      // Al quitar un artículo se liberan los object URLs de sus fotos.
      const removed = state.articles.find((a) => a.key === key)
      removed?.photos.forEach((p) => URL.revokeObjectURL(p.url))
      const articles = state.articles.filter((a) => a.key !== key)
      const subtotal = subtotalOf(articles)
      return {
        articles: articles.length > 0 ? articles : [blankArticle()],
        discount: state.discount > subtotal ? subtotal : state.discount,
      }
    }),

  updateArticle: (key, patch) =>
    set((state) => ({
      articles: state.articles.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    })),

  addService: (articleKey, service) =>
    set((state) => ({
      articles: state.articles.map((a) => {
        if (a.key !== articleKey) return a
        const existing = a.services.find((s) => s.serviceId === service.id)
        if (existing) {
          return {
            ...a,
            services: a.services.map((s) =>
              s.serviceId === service.id ? { ...s, quantity: s.quantity + 1 } : s,
            ),
          }
        }
        return {
          ...a,
          services: [
            ...a.services,
            {
              serviceId: service.id,
              serviceName: service.name,
              unitPrice: service.price,
              quantity: 1,
              estimatedDays: service.estimatedDays,
            },
          ],
        }
      }),
    })),

  setServiceQty: (articleKey, serviceId, quantity) =>
    set((state) => ({
      articles: state.articles.map((a) =>
        a.key === articleKey
          ? {
              ...a,
              services: a.services.map((s) =>
                s.serviceId === serviceId ? { ...s, quantity: Math.max(1, quantity) } : s,
              ),
            }
          : a,
      ),
    })),

  removeService: (articleKey, serviceId) =>
    set((state) => ({
      articles: state.articles.map((a) =>
        a.key === articleKey
          ? { ...a, services: a.services.filter((s) => s.serviceId !== serviceId) }
          : a,
      ),
    })),

  setDiagramMarks: (articleKey, marks) =>
    set((state) => ({
      articles: state.articles.map((a) => (a.key === articleKey ? { ...a, diagramMarks: marks } : a)),
    })),

  addPhotos: (articleKey, files) =>
    set((state) => ({
      articles: state.articles.map((a) => {
        if (a.key !== articleKey) return a
        const room = Math.max(0, 10 - a.photos.length)
        const nuevas = files.slice(0, room).map((file) => ({
          key: nextKey('photo'),
          file,
          url: URL.createObjectURL(file),
          classification: null as string | null,
        }))
        return { ...a, photos: [...a.photos, ...nuevas] }
      }),
    })),

  updatePhoto: (articleKey, photoKey, patch) =>
    set((state) => ({
      articles: state.articles.map((a) =>
        a.key === articleKey
          ? {
              ...a,
              photos: a.photos.map((p) => (p.key === photoKey ? { ...p, ...patch } : p)),
            }
          : a,
      ),
    })),

  removePhoto: (articleKey, photoKey) =>
    set((state) => ({
      articles: state.articles.map((a) => {
        if (a.key !== articleKey) return a
        const photo = a.photos.find((p) => p.key === photoKey)
        if (photo) URL.revokeObjectURL(photo.url)
        return { ...a, photos: a.photos.filter((p) => p.key !== photoKey) }
      }),
    })),

  setNotes: (notes) => set({ notes }),
  setDiscount: (discount) => set({ discount }),
  setPromisedAtOverride: (promisedAtOverride) => set({ promisedAtOverride }),
  setResponsiva: (responsivaAccepted) => set({ responsivaAccepted }),

  setSignature: (signature) => {
    const prev = get().signature
    if (prev) URL.revokeObjectURL(prev.url)
    set({ signature })
  },

  setPayment: (payment) => set({ payment }),

  reset: () => {
    get().articles.forEach((a) => a.photos.forEach((p) => URL.revokeObjectURL(p.url)))
    const prevSig = get().signature
    if (prevSig) URL.revokeObjectURL(prevSig.url)
    set({
      customer: null,
      articles: [blankArticle()],
      notes: '',
      discount: cents(0),
      promisedAtOverride: null,
      responsivaAccepted: false,
      signature: null,
      payment: null,
    })
  },
}))

// -----------------------------------------------------------------------------
// Selectores derivados (dinero y fechas)
// -----------------------------------------------------------------------------

export function articleSubtotal(article: DraftArticle): Cents {
  return addCents(...article.services.map((s) => multiplyCents(s.unitPrice, s.quantity)))
}

export function subtotalOf(articles: DraftArticle[]): Cents {
  return addCents(...articles.map(articleSubtotal))
}

export function totalOf(articles: DraftArticle[], discount: Cents): Cents {
  const subtotal = subtotalOf(articles)
  return subtractCents(subtotal, discount > subtotal ? subtotal : discount)
}

/** Días de entrega = el servicio más lento de toda la recepción. */
export function estimatedDaysOf(articles: DraftArticle[]): number {
  return articles.reduce(
    (max, a) => a.services.reduce((m, s) => Math.max(m, s.estimatedDays), max),
    0,
  )
}

/** Fecha estimada efectiva: el override manual, o la calculada por los servicios. */
export function effectivePromisedDate(articles: DraftArticle[], override: Date | null): Date | null {
  if (override) return override
  const anyService = articles.some((a) => a.services.length > 0)
  if (!anyService) return null
  return promisedDate(estimatedDaysOf(articles))
}

/** ¿Algún artículo supera el umbral de alto valor? */
export function hasHighValue(articles: DraftArticle[], threshold: Cents): boolean {
  return articles.some((a) => a.declaredValue !== null && a.declaredValue >= threshold)
}
