/**
 * THE OFFICIAL REGISTERS, HELD ON THIS MACHINE — Design note, 2026-11-16: […]
 *
 * Rule 0: a real SQLite file on tmp disk, loaded by the real loader from files in the registers' own
 * shapes (the header rows are the ones the live files carry on 2026-11-16; the rows are real companies'
 * public records), searched by the real query and asked through the real act.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ukRow, leiRow, isoDate, entityLine, loadRegister, searchRegistry, registryStats, closeRegistry } from '../../backend/services/registry/registry-index.js';
import { registryLookupIntent } from '../../backend/services/intents/registry-lookup.js';
import { intentType } from '../../backend/services/intents/registry.js';
import { DATASETS } from '../../backend/services/sales/company-datasets.js';

const UK = `CompanyName, CompanyNumber,RegAddress.CareOf,RegAddress.POBox,RegAddress.AddressLine1, RegAddress.AddressLine2,RegAddress.PostTown,RegAddress.County,RegAddress.Country,RegAddress.PostCode,CompanyCategory,CompanyStatus,CountryOfOrigin,DissolutionDate,IncorporationDate,SICCode.SicText_1
"! LTD","08209948","","","9 PRINCES SQUARE","","HARROGATE","","ENGLAND","HG1 1ND","Private Limited Company","Active","United Kingdom","","11/09/2012","99999 - Dormant Company"
"WISE PAYMENTS LIMITED","07209813","","","6TH FLOOR","TEA BUILDING, 56 SHOREDITCH HIGH STREET","LONDON","","ENGLAND","E1 6JJ","Private Limited Company","Active","United Kingdom","","31/03/2010","64999 - Financial intermediation not elsewhere classified"
"NO NUMBER LTD","","","","1 STREET","","LEEDS","","ENGLAND","LS1 1AA","Private Limited Company","Active","United Kingdom","","01/01/2020",""
`;
const LEI = `LEI,Entity.LegalName,Entity.LegalName.xmllang,Entity.LegalAddress.FirstAddressLine,Entity.LegalAddress.AdditionalAddressLine.1,Entity.LegalAddress.City,Entity.LegalAddress.Region,Entity.LegalAddress.Country,Entity.LegalAddress.PostalCode,Entity.RegistrationAuthority.RegistrationAuthorityEntityID,Entity.LegalForm.EntityLegalFormCode,Entity.LegalForm.OtherLegalForm,Entity.EntityCategory,Entity.EntityStatus,Entity.EntityCreationDate
"001GPB6A9XPE8XJICC14","Fidelity Advisor Leveraged Company Stock Fund","en","245 SUMMER STREET","","BOSTON","US-MA","US","02210","S000005113","8888","FUND","FUND","ACTIVE","1988-10-21T00:00:00Z"
"213800WSGIIZCXF1P572","Wise Payments Limited","en","6th Floor","Tea Building","London","GB-LND","GB","E1 6JJ","07209813","H0PO","","GENERAL","ACTIVE","2010-03-31T00:00:00+01:00"
"not-an-lei","Broken Row","en","x","","y","","US","1","","","","","ACTIVE",""
`;

let dir; const PRIOR = process.env.NEUMA_REGISTRY_INDEX;
const run = async (payload) => { const checked = await registryLookupIntent.validate(payload); return checked.ok ? registryLookupIntent.execute(checked.value) : checked; };

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-registry-'));
  process.env.NEUMA_REGISTRY_INDEX = path.join(dir, 'registry.sqlite');
  await fs.writeFile(path.join(dir, 'uk.csv'), UK);
  await fs.writeFile(path.join(dir, 'lei.csv'), LEI);
});
afterAll(async () => {
  closeRegistry();
  if (PRIOR === undefined) delete process.env.NEUMA_REGISTRY_INDEX; else process.env.NEUMA_REGISTRY_INDEX = PRIOR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('the registers\' own rows (pure)', () => {
  test('a UK company and an LEI entity each become one row with its number, standing, address, date and public record', () => {
    expect(isoDate('11/09/2012')).toBe('2012-09-11');
    expect([isoDate('2010-03-31T00:00:00+01:00'), isoDate(''), isoDate('soon')]).toEqual(['2010-03-31', null, null]);
    expect(ukRow({ companyname: 'WISE PAYMENTS LIMITED', companynumber: '07209813', companystatus: 'Active', companycategory: 'Private Limited Company', 'regaddress.addressline1': '6TH FLOOR', 'regaddress.posttown': 'LONDON', 'regaddress.postcode': 'E1 6JJ', incorporationdate: '31/03/2010', 'siccode.sictext_1': '64999 - Financial intermediation not elsewhere classified' }))
      .toMatchObject({ source: 'uk-companies', number: '07209813', name: 'WISE PAYMENTS LIMITED', status: 'Active', country: 'GB', city: 'LONDON', founded: '2010-03-31', url: 'https://find-and-update.company-information.service.gov.uk/company/07209813' });
    expect(ukRow({ companyname: 'X', companynumber: '' })).toBe(null);
    expect(leiRow({ lei: 'not-an-lei', 'entity.legalname': 'Broken' })).toBe(null);
  });
});

describe('the registry index on disk', () => {
  test('nothing is loaded at first, and the act says how it gets loaded', async () => {
    expect(registryStats()).toEqual({ loaded: false, entities: 0, registers: {} });
    expect(await run({ name: 'Wise Payments' })).toMatchObject({ ok: false, status: 'denied', reason: expect.stringMatching(/no official register is loaded on this machine yet/) });
    expect(await run({})).toMatchObject({ ok: false, status: 'invalid' });
  });

  test('both registers load; a row with no number is left out; a second load replaces', async () => {
    expect(await loadRegister('uk-companies', path.join(dir, 'uk.csv'))).toEqual({ read: 3, kept: 2, skipped: 1 });
    expect(await loadRegister('lei', path.join(dir, 'lei.csv'))).toEqual({ read: 3, kept: 2, skipped: 1 });
    expect(await loadRegister('lei', path.join(dir, 'lei.csv'))).toMatchObject({ kept: 2 });
    expect(registryStats()).toMatchObject({ loaded: true, entities: 4, registers: { 'uk-companies': { entities: 2 }, lei: { entities: 2 } } });
    await expect(loadRegister('everything', path.join(dir, 'uk.csv'))).rejects.toThrow(/no such register/);
    await expect(loadRegister('lei', path.join(dir, 'uk.csv'))).rejects.toThrow(/no row of this file reads as a Global LEI register/);
  });

  test('a company is found by every word of its name, in both registers, by number, and by country', () => {
    expect(searchRegistry({ name: 'wise payments' }).map((e) => [e.source, e.number])).toEqual([['uk-companies', '07209813'], ['lei', '213800WSGIIZCXF1P572']]);
    expect(searchRegistry({ name: 'wise fidelity' })).toEqual([]);
    expect(searchRegistry({ number: '07209813' }).map((e) => e.name)).toEqual(['WISE PAYMENTS LIMITED']);
    expect(searchRegistry({ name: 'fund', country: 'united states' }).map((e) => e.country)).toEqual(['US']);
    expect(searchRegistry({ name: 'fund', country: 'GB' })).toEqual([]);
    expect(entityLine(searchRegistry({ number: '07209813' })[0])).toBe('WISE PAYMENTS LIMITED — UK Companies House no. 07209813 — Active, Private Limited Company — 6TH FLOOR, TEA BUILDING, 56 SHOREDITCH HIGH STREET, LONDON, E1 6JJ, GB — since 2010-03-31 — 64999 - Financial intermediation not elsewhere classified — https://find-and-update.company-information.service.gov.uk/company/07209813');
  });

  test('any member asks through one act; the answer cites the register, and "not found" never claims non-existence', async () => {
    expect(intentType('registry/lookup')).toBe(registryLookupIntent);
    // It is OFFERED to a member (the first run in a real house found it registered and never offered).
    expect(registryLookupIntent.availableFor({ laneId: 'anyone', connection: {} })).toEqual({});
    const found = await run({ name: 'Wise Payments', country: 'GB' });
    expect(found.detail).toMatch(/^2 entities:\n- WISE PAYMENTS LIMITED — UK Companies House no\. 07209813 — .*\n- Wise Payments Limited — Global LEI register \(GLEIF\) no\. 213800WSGIIZCXF1P572 — ACTIVE, H0PO — .* — registered locally as 07209813 — https:\/\/search\.gleif\.org\/#\/record\/213800WSGIIZCXF1P572\n/);
    expect(found.detail).toMatch(/Registers checked: .*UK Companies House \(2 entities, loaded \d{4}-\d{2}-\d{2}\)/);
    expect((await run({ name: 'Nonexistent Holdings' })).detail).toMatch(/^No entity named "Nonexistent Holdings" stands in the registers held here\. That is not proof it does not exist\. Registers checked:/);
  });

  test('both registers are among the datasets fetched in one step, each with its licence', () => {
    expect(Object.keys(DATASETS)).toEqual(['companies', 'traffic', 'uk-companies', 'lei']);
    expect(DATASETS.lei.licence).toBe('CC0 1.0 (no rights reserved)');
    expect(DATASETS['uk-companies'].url(new Date('2026-11-16T00:00:00Z'))).toBe('https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-2026-11-01.zip');
  });
});
