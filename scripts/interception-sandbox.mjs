import assert from 'node:assert/strict';

export async function checkSandboxMessages({ page, open, makeRule, probe }) {
  await page.context().addInitScript(() => {
    window.rpcPeer = { mode: 'normal' };
    window.rpcAudit = { seen: [], applied: [], replies: [], unexpected: 0 };
    window.addEventListener(
      'message',
      (event) => {
        if (event.source === parent && parent !== window) {
          if (event.data?.type === '__sfvi_sandbox_ping__' && window.rpcPeer.mode === 'quiet')
            event.stopImmediatePropagation();
          if (['__sfvi_sandbox_exec__', '__sfvi_sandbox_exec_request__'].includes(event.data?.type)) {
            parent.postMessage({ type: '__audit_rpc_seen__', id: event.data.id, args: event.data.args }, '*');
            if (window.rpcPeer.mode !== 'normal') event.stopImmediatePropagation();
          }
        }
        if (
          event.source === document.getElementById('__sfvi_sandbox__')?.contentWindow &&
          event.data?.type === '__audit_rpc_seen__'
        )
          window.rpcAudit.seen.push(event.data);
        if (
          event.source === document.getElementById('__sfvi_sandbox__')?.contentWindow &&
          event.data?.type === '__sfvi_sandbox_result__'
        )
          window.rpcAudit.replies.push(event.data);
        if (event.data?.type === '__audit_unexpected_exec__') window.rpcAudit.unexpected++;
      },
      true,
    );
    window.addEventListener('__sfvi_applied__', (event) => window.rpcAudit.applied.push(event.detail));
  });
  async function setup(field, mode = 'hold') {
    const name = field === 'request' ? 'modifyRequest' : 'modifyResponse';
    const body = 'function ' + name + '() { return "real rule result"; }';
    await open(
      makeRule(
        field === 'request'
          ? { request: { type: 'dynamic', body }, response: { type: 'static', body: '' } }
          : { response: { type: 'dynamic', body } },
      ),
      true,
    );
    const frame = await (await page.locator('#__sfvi_sandbox__').elementHandle()).contentFrame();
    await frame.waitForFunction(() => Boolean(window.rpcPeer));
    await frame.evaluate((mode) => {
      window.rpcPeer.mode = mode;
    }, mode);
    return frame;
  }
  async function start(body = 'original') {
    await page.evaluate((body) => {
      window.rpcAudit.done = false;
      window.rpcAudit.started = performance.now();
      window.rpcAudit.pending = new Promise((resolve) => setTimeout(resolve, 0))
        .then(() => fetch('/api/target', { method: 'POST', body }))
        .then(async (response) => ({ text: await response.text(), status: response.status }))
        .then((value) => {
          window.rpcAudit.done = true;
          return value;
        });
    }, body);
  }
  async function seen(count = 1) {
    await page.waitForFunction((count) => window.rpcAudit.seen.length >= count, count, { timeout: 2500 });
    return page.evaluate(() => window.rpcAudit.seen);
  }
  const reply = (frame, data) => frame.evaluate((data) => parent.postMessage(data, '*'), data);
  async function outcome(timeout = 1800) {
    return page.evaluate(async (timeout) => {
      let timer;
      try {
        return await Promise.race([
          window.rpcAudit.pending,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Sandbox response did not settle')), timeout);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }, timeout);
  }
  const bodyValue = (field, result) => (field === 'request' ? JSON.parse(result.text).body : result.text);
  const diagnostic = (field, reason) =>
    '[SFV-I] ' + (field === 'request' ? 'Request' : 'Response') + ' modification failed: ' + reason;

  for (const field of ['request', 'response']) {
    await probe('sandbox ' + field + ' ignores forged sources and wrong IDs and types', async () => {
      const frame = await setup(field);
      await start();
      const [{ id }] = await seen();
      await page.evaluate(
        (id) => window.postMessage({ type: '__sfvi_sandbox_result__', id, result: 'forged' }, '*'),
        id,
      );
      await reply(frame, { type: '__sfvi_sandbox_result__', id: id + '-old', result: 'wrong' });
      await reply(frame, { type: '__other__', id, result: 'wrong' });
      const sibling = await page.evaluateHandle(() => {
        const element = document.createElement('iframe');
        document.body.append(element);
        return element;
      });
      const siblingFrame = await sibling.asElement().contentFrame();
      await siblingFrame.evaluate(
        (id) => parent.postMessage({ type: '__sfvi_sandbox_result__', id, result: 'forged sibling' }, '*'),
        id,
      );
      await page.waitForTimeout(60);
      assert.equal(await page.evaluate(() => window.rpcAudit.done), false);
      await reply(frame, { type: '__sfvi_sandbox_result__', id, result: 'valid' });
      await reply(frame, { type: '__sfvi_sandbox_result__', id, result: 'duplicate' });
      assert.equal(bodyValue(field, await outcome()), 'valid');
      assert.equal(await page.evaluate(() => window.rpcAudit.applied.length), 1);
    });
    await probe('sandbox ' + field + ' correlates reordered and stale replies', async () => {
      const frame = await setup(field);
      await page.evaluate(() => {
        window.rpcAudit.calls = ['a', 'b'].map((body) =>
          new Promise((resolve) => setTimeout(resolve, 0))
            .then(() => fetch('/api/target', { method: 'POST', body }))
            .then((response) => response.text()),
        );
      });
      const calls = await seen(2);
      assert.notEqual(calls[0].id, calls[1].id);
      for (const call of [...calls].reverse())
        await reply(frame, { type: '__sfvi_sandbox_result__', id: call.id, result: 'reply-' + call.args.requestData });
      const values = await page.evaluate(() => Promise.all(window.rpcAudit.calls));
      assert.deepEqual(
        values.map((text) => (field === 'request' ? JSON.parse(text).body : text)),
        ['reply-a', 'reply-b'],
      );
      await start('c');
      const third = (await seen(3))[2];
      await reply(frame, { type: '__sfvi_sandbox_result__', id: calls[0].id, result: 'stale' });
      await page.waitForTimeout(60);
      assert.equal(await page.evaluate(() => window.rpcAudit.done), false);
      await reply(frame, { type: '__sfvi_sandbox_result__', id: third.id, result: 'reply-c' });
      assert.equal(bodyValue(field, await outcome()), 'reply-c');
    });
    await probe('sandbox ' + field + ' requires readiness from its own peer', async () => {
      const frame = await setup(field, 'quiet');
      await start();
      await page.evaluate(() => window.postMessage({ type: '__sfvi_sandbox_ready__' }, '*'));
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.rpcAudit.seen.length), 0);
      await frame.evaluate(() => {
        window.rpcPeer.mode = 'hold';
      });
      const [{ id }] = await seen();
      await reply(frame, { type: '__sfvi_sandbox_result__', id, result: 'ready' });
      assert.equal(bodyValue(field, await outcome()), 'ready');
    });
    for (const envelope of [
      {},
      { result: null },
      { result: 17 },
      { result: 'ambiguous', error: 'failure' },
      { error: { toString: null } },
      { error: null },
    ]) {
      await probe(
        'sandbox ' + field + ' rejects malformed reply ' + JSON.stringify(envelope),
        async () => {
          const frame = await setup(field);
          await start();
          const [{ id }] = await seen();
          await reply(frame, { type: '__sfvi_sandbox_result__', id, ...envelope });
          const result = await outcome();
          if (field === 'request') assert.equal(JSON.parse(result.text).body, 'original');
          else assert.equal(JSON.parse(result.text).original, true);
          assert.equal(await page.evaluate(() => window.rpcAudit.applied.length), 0);
        },
        [diagnostic(field, 'Invalid sandbox response')],
      );
    }
    for (const change of ['removed', 'replaced']) {
      await probe(
        'sandbox ' + field + ' recovers within its deadline when peer is ' + change,
        async () => {
          await setup(field);
          await start();
          const [{ id }] = await seen();
          await page.evaluate((change) => {
            const old = document.getElementById('__sfvi_sandbox__');
            old.remove();
            if (change === 'replaced') {
              const replacement = document.createElement('iframe');
              replacement.id = '__sfvi_sandbox__';
              document.body.append(replacement);
            }
          }, change);
          if (change === 'replaced') {
            const frame = await (await page.locator('#__sfvi_sandbox__').elementHandle()).contentFrame();
            await reply(frame, { type: '__sfvi_sandbox_result__', id, result: 'replacement cannot answer old call' });
          }
          const result = await outcome(7000);
          if (field === 'request') assert.equal(JSON.parse(result.text).body, 'original');
          else assert.equal(JSON.parse(result.text).original, true);
          assert.equal(await page.evaluate(() => window.rpcAudit.applied.length), 0);
        },
        [diagnostic(field, (field === 'request' ? 'runModifyRequestRemote' : 'runModifyResponseRemote') + ' timeout')],
      );
    }
    for (const policy of ['MAIN', 'CSP'])
      for (const thrown of ['Object.create(null)', '{ get message() { throw Error("message getter"); } }']) {
        await probe(
          'sandbox normalizes unprintable ' + field + ' errors in ' + policy + ': ' + thrown,
          async () => {
            const name = field === 'request' ? 'modifyRequest' : 'modifyResponse';
            const body = 'function ' + name + '() { throw ' + thrown + '; }';
            await open(
              makeRule(
                field === 'request'
                  ? { request: { type: 'dynamic', body }, response: { type: 'static', body: '' } }
                  : { response: { type: 'dynamic', body } },
              ),
              policy === 'CSP',
            );
            await start();
            const result = await outcome();
            if (field === 'request') assert.equal(JSON.parse(result.text).body, 'original');
            else assert.equal(JSON.parse(result.text).original, true);
            assert.equal(await page.evaluate(() => window.rpcAudit.applied.length), 0);
          },
          [diagnostic(field, 'Modifier failed')],
        );
      }
  }
  for (const type of ['__sfvi_sandbox_exec__', '__sfvi_sandbox_exec_request__']) {
    for (const invalid of ['code', 'null arguments', 'array arguments']) {
      await probe('sandbox rejects invalid execution ' + invalid + ' for ' + type, async () => {
        await setup('response', 'normal');
        const id = 'invalid-protocol-' + invalid;
        const code = 'function modifyResponse() { return "executed"; } function modifyRequest() { return "executed"; }';
        await page.evaluate(
          (data) => document.getElementById('__sfvi_sandbox__').contentWindow.postMessage(data, '*'),
          {
            type,
            id,
            code: invalid === 'code' ? 42 : code,
            args: invalid === 'null arguments' ? null : invalid === 'array arguments' ? [] : {},
          },
        );
        await page.waitForFunction((id) => window.rpcAudit.replies.some((reply) => reply.id === id), id, {
          timeout: 2500,
        });
        const reply = await page.evaluate((id) => window.rpcAudit.replies.find((reply) => reply.id === id), id);
        assert.equal(reply.error, 'Invalid sandbox request');
        assert.equal(Object.hasOwn(reply, 'result'), false);
      });
    }
  }
  await probe('sandbox ignores invalid message types IDs and non-parent execution', async () => {
    await setup('response', 'normal');
    const code =
      'parent.postMessage({type:"__audit_unexpected_exec__"},"*"); function modifyResponse(){return "executed";}';
    await page.evaluate((code) => {
      const peer = document.getElementById('__sfvi_sandbox__').contentWindow;
      for (const envelope of [
        { type: { toString: null }, id: 'bad-type' },
        { type: '__sfvi_sandbox_exec__' },
        { type: '__sfvi_sandbox_exec__', id: '' },
        { type: '__sfvi_sandbox_exec__', id: 42 },
      ])
        peer.postMessage({ ...envelope, code, args: {} }, '*');
    }, code);
    const sibling = await page.evaluateHandle(() => {
      const element = document.createElement('iframe');
      document.body.append(element);
      return element;
    });
    const frame = await sibling.asElement().contentFrame();
    await frame.evaluate(
      (code) =>
        parent.document
          .getElementById('__sfvi_sandbox__')
          .contentWindow.postMessage({ type: '__sfvi_sandbox_exec__', id: 'not-parent', code, args: {} }, '*'),
      code,
    );
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.rpcAudit.unexpected), 0);
    assert.equal(await page.evaluate(() => window.rpcAudit.replies.length), 0);
  });
}
