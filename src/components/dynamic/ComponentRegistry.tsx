import { ParsedComponent } from '../../utils/messageParser'
import ConnectWalletButton from './ConnectWalletButton'
import ProjectCard from './ProjectCard'
import PaymentForm from './PaymentForm'
import TransactionStatus from './TransactionStatus'

interface ComponentRegistryProps {
  component: ParsedComponent
}

export default function ComponentRegistry({ component }: ComponentRegistryProps) {
  const { type, props } = component

  switch (type) {
    case 'connect-wallet':
      return <ConnectWalletButton />

    case 'project-card':
      return (
        <ProjectCard
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'payment-form':
      return (
        <PaymentForm
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'transaction-status':
      return <TransactionStatus txId={props.txId} />

    default:
      return (
        <div className="glass  p-3 text-gray-400 text-sm">
          Unknown component: {type}
        </div>
      )
  }
}
