import { ContinuePlugin } from '../force-continue.server.js';
import assert from 'assert';

async function runValidation() {
  console.log('--- Starting Plugin Loading Validation ---');

  // 1. Verify Export Structure
  console.log('Checking export structure...');
  assert.strictEqual(typeof ContinuePlugin, 'function', 'ContinuePlugin should be a function');
  
  // 2. Simulate Plugin Initialization (Host calls the exported function)
  console.log('Simulating plugin initialization...');
  let promptPayload = null;
  const mockClient = {
    session: {
      messages: async () => ({ data: [{ role: 'assistant', content: [{ type: 'text', text: 'Working...' }] }] }),
      promptAsync: async (payload) => {
        console.log('      [Host] promptAsync called with:', JSON.stringify(payload));
        promptPayload = payload;
        return { ok: true };
      }
    }
  };
  
  const mockCtx = {
    client: mockClient,
    logger: {
      info: (msg) => console.log('      [Plugin Info]:', msg),
      error: (msg) => console.error('      [Plugin Error]:', msg)
    }
  };

  // The plugin creator returns the actual plugin instance (factory pattern)
  const pluginInstance = await ContinuePlugin(mockCtx);
  
  // 3. Verify Plugin Instance structure
  console.log('Verifying plugin instance handlers...');
  assert.ok(pluginInstance.tool, 'Plugin should export tools');
  assert.ok(pluginInstance.tool.completionSignal, 'Plugin should export completionSignal tool');
  assert.strictEqual(typeof pluginInstance.event, 'function', 'Plugin should export an event handler');
  assert.strictEqual(typeof pluginInstance['chat.message'], 'function', 'Plugin should export chat.message handler');
  assert.strictEqual(typeof pluginInstance['experimental.chat.system.transform'], 'function', 'Plugin should export system transform');

  // 4. Simulate Event Lifecycle
  const sessionID = 'sim-session-123';
  console.log(`Using sessionID: ${sessionID}`);

  // Session Created
  console.log('  -> Simulating: session.created');
  await pluginInstance.event({
    event: { type: 'session.created', properties: { info: { id: sessionID } } }
  });

  // User Message
  console.log('  -> Simulating: chat.message (Resetting completion state)');
  await pluginInstance['chat.message']({ sessionID });

  // System Transform
  console.log('  -> Simulating: experimental.chat.system.transform');
  const system = [];
  await pluginInstance['experimental.chat.system.transform']({ sessionID }, { system });
  assert.ok(system.some(s => s.includes('completionSignal')), 'System message should be injected');
  console.log('      [Success] System message found.');

  // AI Stops without signal (Session Idle)
  console.log('  -> Simulating: session.idle (Triggering Auto-Continue)');
  promptPayload = null;
  await pluginInstance.event({
    event: { type: 'session.idle', properties: { sessionID } }
  });
  assert.ok(promptPayload && promptPayload.parts[0].text === 'Continue', 'Should have triggered "Continue" prompt');
  console.log('      [Success] Auto-continue prompt triggered.');

  // Completion Signal Received
  console.log('  -> Simulating: message.part.updated (completionSignal: blocked)');
  await pluginInstance.event({
    event: {
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          tool: 'completionSignal',
          sessionID,
          state: { status: 'completed', args: { status: 'blocked', reason: 'out of memory' } }
        }
      }
    }
  });
  console.log('      [Info] Completion signal processed.');

  // Session Idle again (Should NOT trigger continue)
  console.log('  -> Simulating: session.idle (Checking for silence after signal)');
  promptPayload = null;
  await pluginInstance.event({
    event: { type: 'session.idle', properties: { sessionID } }
  });
  assert.strictEqual(promptPayload, null, 'Should not prompt after completion signal (blocked status)');
  console.log('      [Success] Plugin stayed silent as expected.');

  // Loop detection check
  console.log('  -> Simulating: Multiple idles for loop detection');
  await pluginInstance['chat.message']({ sessionID }); // Reset for new loop
  for (let i = 0; i < 3; i++) {
      console.log(`      Idle trigger #${i+1}`);
      await pluginInstance.event({ event: { type: 'session.idle', properties: { sessionID } } });
  }
  assert.ok(promptPayload && promptPayload.parts[0].text.includes('3 times'), 'Should trigger loop break-out prompt');
  console.log('      [Success] Loop detection triggered diagnostic prompt.');

  console.log('\n--- Validation Successful ---');
}

runValidation().catch(err => {
  console.error('\n--- Validation Failed ---');
  console.error(err);
  process.exit(1);
});
