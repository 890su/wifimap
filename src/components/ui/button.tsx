import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'ghost' | 'primary' | 'danger'

export function Button({
  className,
  variant = 'ghost',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={cn('btn', `btn-${variant}`, className)} {...props} />
}
