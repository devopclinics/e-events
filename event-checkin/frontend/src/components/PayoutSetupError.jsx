import { useEffect, useRef } from 'react'

export default function PayoutSetupError({ message, platformAdmin = false }) {
  const panel = useRef(null)
  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [message])
  const needsConnect = /signed up for Connect|account_create_activation_required/i.test(message)
  return <div className="tk-payout-error" role="alert" tabIndex={-1} ref={panel}>
    <span className="tk-payout-error-icon" aria-hidden="true">!</span>
    <div className="tk-payout-error-content">
      <span className="tk-payout-error-eyebrow">Payout setup needs attention</span>
      <h3>{needsConnect ? 'One more step for Festio Payments' : 'We couldn’t finish connecting your payout account'}</h3>
      <p>{needsConnect
        ? 'Festio’s payment platform needs to finish its Stripe Connect setup before your payout account can be created.'
        : 'Your payout account isn’t connected yet. Review the details below, then try again using the payout controls.'}</p>
      <div className="tk-payout-error-next"><strong>{needsConnect ? 'What happens next' : 'Next step'}</strong>
        <p>{needsConnect
          ? platformAdmin ? 'Complete Connect registration in Festio’s Stripe account, then return here and continue onboarding.' : 'Contact the Festio team to complete the platform setup. Once it’s ready, you can return here to connect your bank account.'
          : 'Check the provider’s explanation for any information that needs updating. If it keeps failing, share the reference below with the Festio team.'}</p>
        {needsConnect && platformAdmin && <a href="https://dashboard.stripe.com/connect" target="_blank" rel="noopener noreferrer">Open Stripe Connect <span aria-hidden="true">↗</span></a>}
      </div>
      <details><summary>Technical details &amp; support reference</summary><p>{message}</p></details>
    </div>
  </div>
}
