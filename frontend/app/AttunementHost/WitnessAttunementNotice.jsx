// Remia follows the signed-in wallet, not the selected desk participant.
import './witness-attunement-notice.css';

export const WitnessAttunementNotice = ({ name, onClose }) => (
  <section className={`witness-attunement-notice${onClose ? ' witness-attunement-notice--standalone' : ''}`} data-testid="witness-attunement-notice">
    <h3 className="label-data">ATTUNEMENT UNAVAILABLE FOR AI WITNESSES</h3>
    <p>{name || 'This participant'} is an AI witness. Attunement belongs to a born neuma. Remia opens the signed-in wallet's own record; selecting this witness does not change whose record opens.</p>
    <div className="witness-attunement-actions">
    <button type="button" className="refine-action" onClick={() => window.dispatchEvent(new CustomEvent('remia:attune'))}>OPEN YOUR REMIA</button>
    {onClose ? <button type="button" className="refine-action" onClick={onClose}>BACK TO DESK</button> : null}
    </div>
  </section>
);
