import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import {
  DataError,
  expenses as expensesRepo,
  type BusinessExpense,
  type BusinessExpenseCategory,
  type BusinessExpenseKind,
} from '@/data'
import { centsToPesos, parseAmount } from '@/lib/money'
import { CATEGORIES, KINDS } from './categories'
import styles from './ExpensesPage.module.css'

export function ExpenseFormModal({
  expense,
  onClose,
  onSaved,
}: {
  /** `null` = alta. */
  expense: BusinessExpense | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = expense !== null

  const [kind, setKind] = useState<BusinessExpenseKind>(expense?.kind ?? 'gasto')
  const [category, setCategory] = useState<BusinessExpenseCategory>(expense?.category ?? 'otros')
  const [concept, setConcept] = useState(expense?.concept ?? '')
  const [amount, setAmount] = useState(expense ? String(centsToPesos(expense.amount)) : '')
  const [amountPending, setAmountPending] = useState(expense?.amountPending ?? false)
  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? '')
  const [validUntil, setValidUntil] = useState(expense?.validUntil ?? '')
  const [paidTo, setPaidTo] = useState(expense?.paidTo ?? '')
  const [notes, setNotes] = useState(expense?.notes ?? '')

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const parsed = parseAmount(amount)
  const valid = concept.trim() !== '' && parsed !== null

  async function submit() {
    if (parsed === null) return
    setBusy(true)
    setError(null)

    const input = {
      kind,
      category,
      concept,
      amount: parsed,
      amountPending,
      expenseDate: expenseDate || null,
      validUntil: validUntil || null,
      paidTo,
      notes,
    }

    try {
      if (editing) await expensesRepo.update(expense.id, input)
      else await expensesRepo.create(input)
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo guardar el gasto.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      await expensesRepo.remove(expense.id)
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo borrar el gasto.')
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar gasto' : 'Nuevo gasto'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          {editing && (
            <Button
              variant="danger"
              disabled={busy}
              loading={busy && confirmingDelete}
              onClick={() => (confirmingDelete ? void remove() : setConfirmingDelete(true))}
            >
              {confirmingDelete ? 'Confirmar borrado' : 'Borrar'}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!valid || busy}
            loading={busy && !confirmingDelete}
            onClick={() => void submit()}
          >
            {editing ? 'Guardar' : 'Agregar gasto'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Tipo</span>
          <div className={styles.pills}>
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                className={kind === k.value ? `${styles.pill} ${styles.pillActive}` : styles.pill}
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Categoría</span>
          <select
            className={styles.select}
            value={category}
            onChange={(e) => setCategory(e.target.value as BusinessExpenseCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <Input
          label="Concepto"
          placeholder="Plomero, licencia de funcionamiento…"
          autoFocus={!editing}
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
        />

        <Input
          label="Monto"
          numeric
          inputMode="decimal"
          prefix="$"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <label className={styles.check}>
          <input type="checkbox" checked={amountPending} onChange={(e) => setAmountPending(e.target.checked)} />
          Monto por confirmar
        </label>

        <div className={styles.row2}>
          <Input label="Fecha" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          <Input
            label="Vigencia hasta"
            type="date"
            hint="Permisos, pólizas, extintores"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>

        <Input label="Pagado a" placeholder="Opcional" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Notas</span>
          <textarea
            className={styles.textarea}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {confirmingDelete && <p className={styles.error}>Este gasto se borrará del histórico.</p>}
      </div>
    </Modal>
  )
}
