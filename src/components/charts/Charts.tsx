import type { ReactElement } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui'
import { colorAt, COLOR_VENTAS, money, pct } from './palette'
import styles from './Charts.module.css'

/**
 * Gráficas (mismo set que el POS de Tori Hana): barras, barras múltiples con
 * línea, tendencia y dona. Reciben PESOS ya convertidos — es solo pintura; los
 * importes de verdad siguen siendo centavos en datos.
 *
 * Ojo: recharts 2.x con React 19 NO aplana Fragments. Cada eje va como hijo
 * directo de la gráfica, nunca dentro de <>…</>, o la gráfica sale sin ejes.
 */

/** Eje: $850, $1.2k, $12k. */
const fmtCompact = (v: number) => {
  const n = Math.abs(v)
  if (n >= 10000) return `$${Math.round(v / 1000)}k`
  if (n >= 1000) return `$${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `$${Math.round(v)}`
}
const fmtCount = (v: number) => String(Math.round(v))
const fmtCountLabel = (v: unknown) => (Number(v) === 0 ? '' : String(Number(v)))
const fmtLabel = (v: unknown) => (Number(v) === 0 ? '' : fmtCompact(Number(v)))
const tip = (v: unknown) => money(Number(v))

const axis = { fontSize: 12, fill: '#6b6b6b' } as const
const axisTitle = { fontSize: 12, fontWeight: 600, fill: '#3a3a3a' } as const
const barLabel = { fontSize: 11, fontWeight: 600, fill: '#545454' } as const
/** Con muchas barras los montos se encimarían: ahí quedan solo en el tooltip. */
const MAX_LABELED = 10

export type Datum = { name: string; value: number; color?: string }
type Series = { key: string; label: string; color?: string }
export type LegendItem = { label: string; color: string; detail?: string }


function ChartLegend({ items }: { items: LegendItem[] }) {
  if (!items.length) return null
  return (
    <ul className={styles.legend}>
      {items.map((i) => (
        <li key={i.label}>
          <i style={{ background: i.color }} aria-hidden="true" />
          <span>{i.label}</span>
          {i.detail && <em>{i.detail}</em>}
        </li>
      ))}
    </ul>
  )
}

function Frame({
  title,
  hint,
  legend,
  empty,
  height = 260,
  children,
}: {
  title: string
  hint?: string | undefined
  legend?: LegendItem[] | undefined
  empty: boolean
  height?: number | undefined
  children: ReactElement
}) {
  return (
    <Card title={title}>
      {hint && <p className={styles.hint}>{hint}</p>}
      {empty ? (
        <p className={styles.empty}>Sin datos en el periodo.</p>
      ) : (
        <>
          {legend && <ChartLegend items={legend} />}
          <div className={styles.chart} style={{ height }} role="img" aria-label={hint ? `${title}. ${hint}` : title}>
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  )
}

function axisProps(
  horizontal: boolean,
  catLabel: string | undefined,
  valLabel: string | undefined,
  many: boolean,
  nCats: number,
  catWidth = 110,
  tickFmt: (v: number) => string = fmtCompact,
) {
  const cat = catLabel
    ? {
        value: catLabel,
        ...(horizontal
          ? { angle: -90, position: 'insideLeft' as const, offset: 8 }
          : { position: 'insideBottom' as const, offset: -2 }),
        style: axisTitle,
      }
    : undefined
  const val = valLabel
    ? {
        value: valLabel,
        ...(horizontal
          ? { position: 'insideBottom' as const, offset: -2 }
          : { angle: -90, position: 'insideLeft' as const, offset: 8 }),
        style: axisTitle,
      }
    : undefined
  const axisInterval: 0 | 'preserveStartEnd' = many || nCats > 7 ? 'preserveStartEnd' : 0
  const valL = val ? { label: val } : {}
  const catL = cat ? { label: cat } : {}
  const x = horizontal
    ? { type: 'number' as const, tick: axis, tickFormatter: tickFmt, ...valL, height: val ? 42 : 24 }
    : {
        dataKey: 'name',
        tick: axis,
        interval: axisInterval,
        minTickGap: many ? 24 : 14,
        ...catL,
        height: cat ? 42 : 24,
      }
  const y = horizontal
    ? { type: 'category' as const, dataKey: 'name', tick: axis, interval: 0, width: catWidth + (cat ? 22 : 0), ...catL }
    : { type: 'number' as const, tick: axis, tickFormatter: tickFmt, width: val ? 70 : 54, ...valL }
  return { x, y }
}

/** Barras de una serie. `colorful` pinta cada categoría distinto; `Datum.color` manda sobre todo. */
export function BarsCard({
  title,
  hint,
  data,
  horizontal = false,
  height,
  format = tip,
  catLabel,
  valLabel,
  colorful = false,
  legend,
  color = COLOR_VENTAS,
  count = false,
}: {
  title: string
  hint?: string | undefined
  data: Datum[]
  horizontal?: boolean | undefined
  height?: number | undefined
  format?: ((v: unknown) => string) | undefined
  catLabel?: string | undefined
  valLabel?: string | undefined
  colorful?: boolean | undefined
  legend?: LegendItem[] | undefined
  color?: string | undefined
  /** Cantidades (órdenes, piezas) en vez de pesos: sin "$" en ejes ni etiquetas. */
  count?: boolean | undefined
}) {
  const h = height ?? (horizontal ? Math.max(240, data.length * 32 + 80) : 300)
  const labeled = data.length <= MAX_LABELED
  const { x, y } = axisProps(
    horizontal,
    catLabel,
    valLabel,
    data.length > MAX_LABELED,
    data.length,
    110,
    count ? fmtCount : fmtCompact,
  )
  return (
    <Frame title={title} hint={hint} legend={legend} empty={!data.length} height={h}>
      <ComposedChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 22, right: horizontal ? 48 : 12, left: 4, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" opacity={0.4} horizontal={!horizontal} vertical={horizontal} />
        <XAxis {...x} />
        <YAxis {...y} />
        <Tooltip formatter={(v) => [format(v), valLabel ?? 'Monto']} cursor={{ opacity: 0.12 }} />
        <Bar
          dataKey="value"
          name={valLabel ?? title}
          fill={color}
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          maxBarSize={56}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? (colorful ? colorAt(i) : color)} />
          ))}
          {labeled && (
            <LabelList
              dataKey="value"
              position={horizontal ? 'right' : 'top'}
              formatter={count ? fmtCountLabel : fmtLabel}
              style={barLabel}
            />
          )}
        </Bar>
      </ComposedChart>
    </Frame>
  )
}

/** Barras agrupadas / apiladas con varias series y línea opcional. */
export function MultiBarsCard({
  title,
  hint,
  data,
  series,
  line,
  stacked = false,
  height,
  catLabel,
  valLabel,
}: {
  title: string
  hint?: string | undefined
  data: Record<string, string | number>[]
  series: Series[]
  line?: Series | undefined
  stacked?: boolean | undefined
  height?: number | undefined
  catLabel?: string | undefined
  valLabel?: string | undefined
}) {
  const h = height ?? 320
  const labeled = series.length === 1 && !line && data.length <= MAX_LABELED
  const { x, y } = axisProps(false, catLabel, valLabel, data.length > MAX_LABELED, data.length, 120)
  const all = [...series, ...(line ? [line] : [])]
  const legend =
    all.length > 1
      ? all.map((s, i) => ({ label: s.label, color: s.color ?? colorAt(i) }))
      : undefined
  return (
    <Frame title={title} hint={hint} legend={legend} empty={!data.length} height={h}>
      <ComposedChart data={data} margin={{ top: 22, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.4} vertical={false} />
        <XAxis {...x} />
        <YAxis {...y} />
        <Tooltip formatter={tip} cursor={{ opacity: 0.12 }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            {...(stacked ? { stackId: 'a' } : {})}
            fill={s.color ?? colorAt(i)}
            radius={stacked ? 0 : [4, 4, 0, 0]}
            maxBarSize={48}
          >
            {labeled && <LabelList dataKey={s.key} position="top" formatter={fmtLabel} style={barLabel} />}
          </Bar>
        ))}
        {line && (
          <Line
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color ?? colorAt(2)}
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
        )}
      </ComposedChart>
    </Frame>
  )
}

/** Tendencia en el tiempo (acumulados, flujo). */
export function TrendCard({
  title,
  hint,
  data,
  series,
  height = 300,
  catLabel,
  valLabel,
}: {
  title: string
  hint?: string | undefined
  data: Record<string, string | number>[]
  series: Series[]
  height?: number | undefined
  catLabel?: string | undefined
  valLabel?: string | undefined
}) {
  const { x, y } = axisProps(false, catLabel, valLabel, true, data.length)
  const legend =
    series.length > 1
      ? series.map((s, i) => ({ label: s.label, color: s.color ?? colorAt(i) }))
      : undefined
  return (
    <Frame title={title} hint={hint} legend={legend} empty={!data.length} height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.4} vertical={false} />
        <XAxis {...x} minTickGap={24} />
        <YAxis {...y} />
        <Tooltip formatter={tip} />
        {series.map((s, i) => {
          const c = s.color ?? colorAt(i)
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={c}
              fill={c}
              fillOpacity={0.2}
              strokeWidth={2.5}
            />
          )
        })}
      </AreaChart>
    </Frame>
  )
}

/** Dona de participación con leyenda "nombre · monto · %". Agrupa la cola en "Otros". */
export function DonutCard({
  title,
  hint,
  data,
  max = 7,
  height = 230,
}: {
  title: string
  hint?: string | undefined
  data: Datum[]
  max?: number | undefined
  height?: number | undefined
}) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
  const rows =
    sorted.length > max
      ? [...sorted.slice(0, max), { name: 'Otros', value: sorted.slice(max).reduce((n, d) => n + d.value, 0) }]
      : sorted
  const total = rows.reduce((n, d) => n + d.value, 0)
  const legend = rows.map((d, i) => ({
    label: d.name,
    color: colorAt(i),
    detail: `${money(d.value)} · ${pct(d.value, total)}%`,
  }))
  return (
    <Frame title={title} hint={hint} legend={legend} empty={!rows.length} height={height}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
          {rows.map((_, i) => (
            <Cell key={i} fill={colorAt(i)} />
          ))}
        </Pie>
        <Tooltip formatter={tip} />
      </PieChart>
    </Frame>
  )
}
