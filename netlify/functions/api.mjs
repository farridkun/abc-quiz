import { createHandler } from '../../lib/app.mjs';
import { stores } from '../../lib/netlify-stores.mjs';

let handle;
export default async (request, context) => {
  handle ||= createHandler(stores());
  return handle(request, { ip: context.ip });
};

export const config = { path: ['/api/*', '/health'] };
