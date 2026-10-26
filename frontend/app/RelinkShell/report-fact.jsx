// report-fact — one fact of an office's report (a threat, a matter): a label and its value, one row of the
// report's facts grid (SecurityApp.css .sec-facts). Pure rendering, shared by the SECURITY and LEGAL windows.

export const Fact = ({ label, children }) => (
  <>
    <dt className="label-data">{label}</dt>
    <dd>{children}</dd>
  </>
);
