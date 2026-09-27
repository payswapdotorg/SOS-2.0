/* eslint-disable no-console */
import { createScriptedDogfoodWorld, defaultScriptedModelEntries } from './test/scripted-world.ts';

const world = createScriptedDogfoodWorld({
  journeyId: 'p19-dogfood-r1',
  repositorySlug: 'payswapdotorg/sos-dogfood-r1',
  vercelProjectName: 'sos-dogfood-r1',
  modelEntries: defaultScriptedModelEntries(),
});
const record = await world.harness.run();
console.log('STAGE:', record.finalState?.stage, 'STATUS:', record.finalState?.status);
console.log('TICKS:');
for (const tick of record.ticks) {
  console.log(' ', tick.tick, tick.stage, JSON.stringify(tick.action).slice(0, 220));
}
console.log('MODEL CALLS:', JSON.stringify(record.modelCalls, null, 1).slice(0, 800));
console.log('REPAIRS:', JSON.stringify(record.repairs));
console.log('ASKS:', JSON.stringify(record.asks));
console.log('NOTES:', JSON.stringify(record.honestNotes, null, 1));
console.log('STAGING COUNTS:', JSON.stringify(world.harness.staging.counts()));
console.log('INVOCATIONS:', JSON.stringify(world.harness.staging.invocationList()));
console.log('RECEIPTS:');
for (const receipt of world.harness.staging.observedReceiptList()) {
  console.log(' ', receipt.family, receipt.status, receipt.actionId, receipt.failure?.errorType ?? '', (receipt.failure?.message ?? '').slice(0, 160));
}
const nodes = await world.harness.graph.nodes();
console.log('NODES:', nodes.map((node) => `${node.task_id}:${node.state}:retries=${node.retries}`).join(' | '));
