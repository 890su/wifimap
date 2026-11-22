import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  testId,
}: {
  open: boolean
  title: string
  description: string
  onClose: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-card" data-testid={testId} aria-describedby={undefined}>
          <Dialog.Title className="modal-title">{title}</Dialog.Title>
          <Dialog.Description className="modal-desc">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
