import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { defaultState, startHarness } from './harness.mjs';
// playwright.config.ts passes the ports and the build to serve.
const { values: options } = parseArgs({
  options: {
    port: { type: 'string', default: '4173' },
    'control-port': { type: 'string', default: '4174' },
    root: { type: 'string', default: '.' },
  },
});
const harness = await startHarness({ port: Number(options.port), root: options.root });
// Test control is a separate loopback-only Node server, NOT an Astro route or
// Worker binding. Neither this server nor any fake credentials enter dist/.
const control = createServer(async (request, response) => {
  if (request.method === 'GET') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ calls: harness.state.calls }));
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405).end();
    return;
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) {
      response.writeHead(413).end();
      return;
    }
  }
  try {
    const data = JSON.parse(body);
    if (data.reset) Object.assign(harness.state, defaultState());
    for (const key of ['rateCount', 'rateTtl', 'rate', 'turnstile', 'email', 'airtable', 'delay'])
      if (key in data) harness.state[key] = data[key];
    response.writeHead(204).end();
  } catch {
    response.writeHead(400).end();
  }
});
const controlPort = Number(options['control-port']);
await new Promise((resolve) => control.listen(controlPort, '127.0.0.1', resolve));
console.log(
  `Mocked workerd app (${options.root}): ${harness.url}; test-only control: http://127.0.0.1:${controlPort}`,
);
async function stop() {
  control.close();
  await harness.close();
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
