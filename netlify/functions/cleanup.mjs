import { cleanup } from '../../lib/app.mjs';
import { stores } from '../../lib/netlify-stores.mjs';

export default async () => {
  const removed = await cleanup(stores());
  console.log(`Cleanup removed ${removed} expired entries`);
};

export const config = { schedule: '@hourly' };
