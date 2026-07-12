import FundAccessModal, { type FundAccessModalProps } from './FundAccessModal'

export type UseSurplusAllowanceModalProps = Omit<FundAccessModalProps, 'kind' | 'splits'>

export default function UseSurplusAllowanceModal(props: UseSurplusAllowanceModalProps) {
  return <FundAccessModal {...props} kind="allowance" />
}
