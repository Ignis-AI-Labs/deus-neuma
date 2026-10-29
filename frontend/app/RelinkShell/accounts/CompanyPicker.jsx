// CompanyPicker — the one company choice (campaign plan §2.6): the house's
// companies in tree order, a subsidiary indented under its core company, a
// client company on its own. `allLabel` adds the ALL choice a filter needs;
// `unsortedLabel` the honest "no company yet" an account may stand under.

import { Select } from '../Select.jsx';
import { companyOptions } from './account-words.js';

/**
 * @param {object} props
 * @param {string} props.value - a company id; '' for ALL / no company
 * @param {ReadonlyArray<object>} props.companies
 * @param {(companyId: string) => void} props.onChange
 * @param {string} [props.allLabel]
 * @param {string} [props.unsortedLabel]
 * @param {boolean} [props.disabled]
 * @param {string} [props.ariaLabel]
 */
export const CompanyPicker = ({ value, companies, onChange, allLabel, unsortedLabel, disabled = false, ariaLabel = 'company' }) => {
  const options = [
    ...(allLabel ? [{ value: '', label: allLabel }] : []),
    ...(unsortedLabel && !allLabel ? [{ value: '', label: unsortedLabel }] : []),
    ...companyOptions(companies),
  ];
  return <Select value={value || ''} options={options} onChange={onChange} disabled={disabled} ariaLabel={ariaLabel} className="account-company-picker" />;
};
