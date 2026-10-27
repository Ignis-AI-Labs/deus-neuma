// SealFundingHost — the Ethereum seal's cost and funding walkthrough (seal-funding.js, the ceremony's
// module) hosted in React: one copy of the walkthrough for the ceremony and the desk.
import { useEffect, useRef } from 'react';
import { mountSealFunding, FOUNDING } from '../../components/BirthCeremony/seal-funding.js';

/** `founding` switches the walkthrough to a house's founding: its own title, words and cost. */
export const SealFundingHost = ({ name, funding, onSeal, onSkip, founding = false }) => {
  const host = useRef(null);
  const hands = useRef({ onSeal, onSkip });
  hands.current = { onSeal, onSkip };
  useEffect(() => {
    const mounted = mountSealFunding(host.current, {
      name, funding, onSeal: () => hands.current.onSeal(), onSkip: () => hands.current.onSkip(),
      ...(founding ? { kind: FOUNDING, go: 'FOUND ON ETHEREUM' } : {}),
    });
    return () => mounted.stop();
  }, [name, funding, founding]);
  return <div ref={host} className="seal-funding" data-testid="seal-funding" />;
};
