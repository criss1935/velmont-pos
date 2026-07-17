import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import styles from './Input.module.css'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string
  hint?: string
  error?: string
  /** Cifras: mono, tabular, alineado a la derecha. */
  numeric?: boolean
  prefix?: ReactNode
  suffix?: ReactNode
}

export function Input({
  label,
  hint,
  error,
  numeric = false,
  prefix,
  suffix,
  id,
  className,
  ...rest
}: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined

  return (
    <div className={cn(styles.field, className)}>
      {label && (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      )}

      <div className={styles.wrap}>
        {prefix && <span className={cn(styles.affix, styles.prefix)}>{prefix}</span>}

        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            styles.input,
            numeric && styles.numeric,
            prefix && styles.hasPrefix,
            suffix && styles.hasSuffix,
            error && styles.invalid,
          )}
          {...rest}
        />

        {suffix && <span className={cn(styles.affix, styles.suffix)}>{suffix}</span>}
      </div>

      {error ? (
        <span id={`${inputId}-error`} className={styles.error} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={`${inputId}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}
