import fs from 'node:fs';

const key = fs.readFileSync('.env.dev.local', 'utf8')
  .match(/^HUBSPOT_DEV_SERVICE_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('HUBSPOT_DEV_SERVICE_KEY is missing');

const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const fixtures = [
  ['corporate-gold', 'Corporate', 'Gold'],
  ['corporate-silver', 'Corporate', 'Silver'],
  ['corporate-bronze', 'Corporate', 'Bronze'],
  ['supplier-gold', 'Industry Supplier', 'Gold'],
  ['supplier-silver', 'Industry Supplier', 'Silver'],
  ['supplier-bronze', 'Industry Supplier', 'Bronze'],
];

async function request(path, options = {}) {
  const response = await fetch(`https://api.hubapi.com${path}`, { headers, ...options });
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function find(objectType, property, value) {
  const result = await request(`/crm/v3/objects/${objectType}/search`, {
    method: 'POST',
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: property, operator: 'EQ', value }] }], properties: [property], limit: 1 }),
  });
  return result.results[0] || null;
}

const result = [];
for (const [alias, category, tier] of fixtures) {
  const companyName = `DEV TEST — ${category} ${tier}`;
  const email = `melwyn+${alias}@refuelcreative.com.au`;
  let company = await find('companies', 'name', companyName);
  if (!company) {
    const properties = { name: companyName };
    if (category === 'Corporate') {
      properties.corporate_membership_status = 'Current';
      properties.corporate_membership_level = tier;
      properties.corporate_membership_level_2 = tier;
    } else {
      properties.industry_supplier_membership_status = 'Current';
      properties.industry_supplier_membership_level = tier;
      properties.industry_supplier_membership_level_2 = tier;
    }
    company = await request('/crm/v3/objects/companies', { method: 'POST', body: JSON.stringify({ properties }) });
  }
  let contact = await find('contacts', 'email', email);
  if (!contact) {
    contact = await request('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties: { firstname: 'Melwyn', lastname: `DEV TEST — ${category} ${tier}`, email } }),
    });
  }
  await request(`/crm/v4/objects/contacts/${contact.id}/associations/companies/${company.id}`, {
    method: 'PUT', body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]),
  });
  result.push({ category, tier, companyId: company.id, contactId: contact.id });
  await new Promise((resolve) => setTimeout(resolve, 350));
}

console.log(JSON.stringify({ createdOrVerified: result.length, fixtures: result.map(({ category, tier }) => `${category} ${tier}`) }));
