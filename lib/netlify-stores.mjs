import { getStore } from '@netlify/blobs';

// Production uses the global stores; previews and branch deploys get their own
// names so test data never mixes with live rooms.
export function stores() {
  const context = globalThis.Netlify?.context?.deploy?.context;
  const suffix = !context || context === 'production' ? '' : `-${context}`;
  return {
    sessions: getStore({ name: `abc-sessions${suffix}`, consistency: 'strong' }),
    rooms: getStore({ name: `abc-rooms${suffix}`, consistency: 'strong' })
  };
}
