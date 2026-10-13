import fs from 'node:fs';

const key = fs.readFileSync('.env.dev.local', 'utf8')
  .match(/^HUBSPOT_DEV_SERVICE_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('HUBSPOT_DEV_SERVICE_KEY is missing');

const baseEmail = 'melwyn';
const domain = 'refuelcreative.com.au';
const tiers = [
  ['individual', 'Individual'],
  ['associate-individual', 'Associate Individual'],
  ['reciprocal', 'Reciprocal'],
  ['tafe-rto', 'TAFE or Government RTO'],
  ['student', 'Student'],
  ['apprentice', 'Apprentice'],
];

const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const existing = [];
for (const [alias] of tiers) {
  const email = `${baseEmail}+${alias}@${domain}`;
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST', headers,
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], properties: ['email'], limit: 1 }),
    });
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  if (!response?.ok) throw new Error(`Search failed: ${response?.status}`);
  existing.push((await response.json()).total > 0);
  await new Promise((resolve) => setTimeout(resolve, 400));
}

const inputs = tiers.flatMap(([alias, tier], index) => existing[index] ? [] : [{ properties: {
  firstname: 'Melwyn',
  lastname: `DEV TEST — ${tier}`,
  email: `${baseEmail}+${alias}@${domain}`,
  individual_membership_status: 'Current',
  individual_membership_type_2: tier,
} }]);

if (inputs.length) {
  const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/create', {
    method: 'POST', headers, body: JSON.stringify({ inputs }),
  });
  if (!response.ok) throw new Error(`Create failed: ${response.status} ${await response.text()}`);
}

console.log(JSON.stringify({ created: inputs.length, alreadyPresent: tiers.length - inputs.length, tiers: tiers.map(([, tier]) => tier) }));
