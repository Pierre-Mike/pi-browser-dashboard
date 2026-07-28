import { Modal } from "../library/dialogs/Modal"
import { confirmRunCopy } from "./fleetFormat"

type Props = {
  readonly fleetName: string
  readonly projectName: string
  readonly totalSessions: number
  readonly waveCount: number
  readonly pending: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

// The one place a real run can be started from. Deliberately a second,
// separate step from the "Run" button that opens it — a misclick on that
// button lands here, not on a spawn. Styled with the same danger tone as a
// destructive confirm (btn-error) because a run IS consequential: it spawns
// real agents against the user's own account.
export const ConfirmRunDialog = ({
  fleetName,
  projectName,
  totalSessions,
  waveCount,
  pending,
  onConfirm,
  onCancel,
}: Props) => (
  <Modal open title={`Run "${fleetName}"?`} onClose={onCancel} testId="fleet-confirm-run">
    <p data-testid="fleet-confirm-copy" className="text-sm text-base-content/80">
      {confirmRunCopy({ fleetName, projectName, totalSessions, waveCount })}
    </p>
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        data-testid="fleet-confirm-cancel"
        className="btn btn-sm btn-ghost normal-case"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        data-testid="fleet-confirm-start"
        className="btn btn-sm btn-error normal-case"
        disabled={pending}
        onClick={onConfirm}
      >
        {pending ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          `Start ${totalSessions} session${totalSessions === 1 ? "" : "s"}`
        )}
      </button>
    </div>
  </Modal>
)
