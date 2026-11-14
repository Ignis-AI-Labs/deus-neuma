// TitlingProgress — a running batch titling job on the desk (deus-neuma #28): how far it has got,
// as a bar a screen reader reads too, and the way to stop it. Nothing while no job runs.
import './TitlingProgress.css';

export const TitlingProgress = ({ titling, label = 'Naming chats' }) => {
  if (!titling.running) return null;
  const { done, total } = titling.job;
  const share = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="titling-progress">
      <div className="titling-progress-bar" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total}`}>
        <span className="titling-progress-fill" style={{ width: `${share}%` }} />
      </div>
      <button type="button" className="chats-new" onClick={titling.cancel}>CANCEL</button>
    </div>
  );
};
