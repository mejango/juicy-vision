import FundAccessModal, { type FundAccessModalProps } from './FundAccessModal'

export type SendPayoutsModalProps = Omit<FundAccessModalProps, 'kind'>

export default function SendPayoutsModal(props: SendPayoutsModalProps) {
  return <FundAccessModal {...props} kind="payout" />
}
