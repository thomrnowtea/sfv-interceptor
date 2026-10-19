import assert from "node:assert/strict";

export async function checkXhrLifecycle({
  page,
  open,
  makeRule,
  probe,
  corsOrigin,
  corsRequests,
}) {
  const modes = ["native", "request-only", "static", "dynamic"];
  for (const mode of modes) {
    await probe(
      "XHR exposes progress and upload lifecycle for " + mode,
      async () => {
        const response =
          mode === "static"
            ? { type: "static", body: "changed" }
            : {
                type: "dynamic",
                body:
                  mode === "dynamic"
                    ? 'function modifyResponse() { return "changed"; }'
                    : "",
              };
        await open(
          makeRule({
            pairs: [
              {
                id: "pair",
                urlPattern: "/api/lifecycle/",
                urlOperator: "Contains",
              },
            ],
            response,
          }),
        );
        const result = await page.evaluate(
          (mode) =>
            new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              const download = [];
              const upload = [];
              const states = [];
              let progressProperty = 0;
              const guard = setTimeout(
                () => reject(new Error("XHR lifecycle timed out")),
                2000,
              );
              xhr.open(
                "POST",
                mode === "native"
                  ? "/api/native/stream"
                  : "/api/lifecycle/stream",
              );
              for (const [target, output] of [
                [xhr, download],
                [xhr.upload, upload],
              ]) {
                for (const type of [
                  "loadstart",
                  "progress",
                  "load",
                  "error",
                  "abort",
                  "timeout",
                  "loadend",
                ]) {
                  target.addEventListener(type, (event) =>
                    output.push({
                      type,
                      loaded: event.loaded,
                      total: event.total,
                      computable: event.lengthComputable,
                      target:
                        event.target === target &&
                        event.currentTarget === target,
                    }),
                  );
                }
              }
              xhr.onprogress = () => progressProperty++;
              xhr.onreadystatechange = () =>
                states.push({
                  state: xhr.readyState,
                  length: xhr.responseText.length,
                });
              xhr.onloadend = () => {
                clearTimeout(guard);
                resolve({
                  download,
                  upload,
                  states,
                  progressProperty,
                  text: xhr.responseText,
                });
              };
              xhr.send("upload-body");
            }),
          mode,
        );
        for (const events of [result.download, result.upload]) {
          assert.equal(events[0]?.type, "loadstart");
          assert.equal(
            events.filter((event) => event.type === "loadstart").length,
            1,
          );
          assert.deepEqual(
            events.slice(-2).map((event) => event.type),
            ["load", "loadend"],
          );
          assert.ok(events.every((event) => event.target));
          const progress = events.filter((event) => event.type === "progress");
          assert.ok(progress.length > 0, "Progress is missing");
          assert.ok(
            progress.every(
              (event, index) =>
                index === 0 || event.loaded >= progress[index - 1].loaded,
            ),
          );
          assert.equal(progress.at(-1).loaded, events.at(-1).loaded);
        }
        assert.equal(
          result.progressProperty,
          result.download.filter((event) => event.type === "progress").length,
        );
        assert.equal(result.upload.at(-1).loaded, 11);
        const bytes = mode === "native" || mode === "request-only" ? 65536 : 7;
        assert.equal(result.download.at(-1).loaded, bytes);
        assert.equal(result.download.at(-1).total, bytes);
        assert.equal(result.text.length, bytes);
        assert.ok(
          [2, 3, 4].every((state) =>
            result.states.some((item) => item.state === state),
          ),
        );
        assert.equal(result.states.find((item) => item.state === 2).length, 0);
        if (["static", "dynamic"].includes(mode))
          assert.ok(
            result.states.every((item) => item.length <= bytes),
            "Original body leaked into replacement progress",
          );
      },
    );
  }
  const timeoutCases = [
    { name: "enable", initial: 0, changed: 70, at: 15, terminal: "timeout" },
    { name: "disable", initial: 90, changed: 0, at: 15, terminal: "load" },
    { name: "extend", initial: 90, changed: 800, at: 15, terminal: "load" },
    { name: "shorten", initial: 800, changed: 70, at: 15, terminal: "timeout" },
    {
      name: "expire from original send",
      initial: 0,
      changed: 50,
      at: 100,
      terminal: "timeout",
    },
    {
      name: "use the maximum unsigned timeout",
      initial: 0,
      changed: 4294967295,
      at: 15,
      terminal: "load",
    },
  ];
  for (const native of [true, false])
    for (const fixture of timeoutCases) {
      await probe(
        "XHR " +
          (native ? "native control " : "") +
          "can " +
          fixture.name +
          " timeout after send",
        async () => {
          await open(
            makeRule({
              pairs: [
                {
                  id: "pair",
                  urlPattern: "/api/lifecycle/",
                  urlOperator: "Contains",
                },
              ],
              response: { type: "dynamic", body: "" },
            }),
          );
          const result = await page.evaluate(
            ({ fixture, native }) =>
              new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const events = [];
                const started = performance.now();
                let changedAt;
                const guard = setTimeout(
                  () => reject(new Error("Mutable XHR timeout did not finish")),
                  2000,
                );
                xhr.open(
                  "GET",
                  native ? "/api/native/slow" : "/api/lifecycle/slow",
                );
                xhr.timeout = fixture.initial;
                for (const type of [
                  "load",
                  "timeout",
                  "error",
                  "abort",
                  "loadend",
                ])
                  xhr.addEventListener(type, () => events.push(type));
                xhr.onloadend = () => {
                  clearTimeout(guard);
                  resolve({
                    events,
                    status: xhr.status,
                    elapsed: performance.now() - started,
                    changedAt,
                  });
                };
                xhr.send();
                setTimeout(() => {
                  changedAt = performance.now() - started;
                  xhr.timeout = fixture.changed;
                }, fixture.at);
              }),
            { fixture, native },
          );
          assert.deepEqual(result.events, [fixture.terminal, "loadend"]);
          assert.equal(result.status, fixture.terminal === "load" ? 200 : 0);
          if (fixture.name === "expire from original send")
            assert.ok(
              result.elapsed - result.changedAt < 40,
              "Changing an expired timeout must not restart its clock",
            );
        },
      );
    }
  for (const field of ["request", "response", "delay"]) {
    await probe("XHR updates timeout during " + field + " work", async () => {
      const code =
        "async function " +
        (field === "request" ? "modifyRequest" : "modifyResponse") +
        '() { await new Promise(resolve => setTimeout(resolve, 250)); return "changed"; }';
      await open(
        makeRule({
          pairs: [
            {
              id: "pair",
              urlPattern: "/api/lifecycle/",
              urlOperator: "Contains",
            },
          ],
          ...(field === "request"
            ? { request: { type: "dynamic", body: code } }
            : {}),
          response:
            field === "response"
              ? { type: "dynamic", body: code }
              : {
                  type: "static",
                  body: "changed",
                  delay: field === "delay" ? 250 : 0,
                },
        }),
      );
      const result = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const events = [];
            let applied = 0;
            const guard = setTimeout(
              () => reject(new Error("Timeout during modifier work hung")),
              1500,
            );
            window.addEventListener("__sfvi_applied__", () => applied++);
            xhr.open("POST", "/api/lifecycle/target");
            for (const type of ["load", "timeout", "error", "loadend"])
              xhr.addEventListener(type, () => events.push(type));
            xhr.onloadend = () => {
              clearTimeout(guard);
              setTimeout(() => resolve({ events, applied }), 350);
            };
            xhr.send("original");
            setTimeout(() => {
              xhr.timeout = 60;
            }, 15);
          }),
      );
      assert.deepEqual(result, { events: ["timeout", "loadend"], applied: 0 });
    });
  }
  for (const native of [true, false])
    for (const mode of [
      "none",
      "getter",
      "property",
      "removed",
      "signal-aborted",
      "signal-stopped",
      "signal-reregister",
      "signal-reentrant",
      "once",
    ]) {
      await probe(
        "XHR " +
          (native ? "native control " : "") +
          "preserves upload CORS behavior for " +
          mode,
        async () => {
          await open(
            makeRule({
              pairs: [
                {
                  id: "pair",
                  urlPattern: corsOrigin + "/matched/",
                  urlOperator: "Contains",
                },
              ],
              response: { type: "dynamic", body: "" },
            }),
          );
          const path = "/" + (native ? "native/" : "matched/") + mode + "/";
          const result = await page.evaluate(
            ({ mode, url }) =>
              new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                let progress = 0;
                const responses = [];
                const guard = setTimeout(
                  () => reject(new Error("Upload CORS probe timed out")),
                  3000,
                );
                const listener = () => progress++;
                let abortToSend;
                if (mode === "getter") void xhr.upload;
                if (mode === "property") xhr.upload.onprogress = listener;
                if (mode === "removed") {
                  xhr.upload.addEventListener("progress", listener);
                  xhr.upload.removeEventListener("progress", listener);
                }
                if (mode.startsWith("signal-")) {
                  const controller = new AbortController();
                  if (mode === "signal-reentrant") {
                    controller.signal.addEventListener("abort", () =>
                      send("first"),
                    );
                    abortToSend = () => controller.abort();
                  } else if (mode !== "signal-aborted") {
                    controller.signal.addEventListener("abort", (event) =>
                      event.stopImmediatePropagation(),
                    );
                  }
                  xhr.upload.addEventListener("progress", listener, {
                    signal: controller.signal,
                    once: mode === "signal-reregister",
                  });
                  if (!abortToSend) controller.abort();
                  if (mode === "signal-reregister")
                    xhr.upload.addEventListener("progress", listener);
                }
                if (mode === "once")
                  xhr.upload.addEventListener("progress", listener, {
                    once: true,
                  });
                xhr.onerror = () => {
                  clearTimeout(guard);
                  reject(new Error("Upload CORS request failed"));
                };
                const send = (part) => {
                  xhr.open("POST", url + part);
                  xhr.send("cors-body");
                };
                xhr.onloadend = () => {
                  try {
                    responses.push(JSON.parse(xhr.responseText));
                  } catch (error) {
                    clearTimeout(guard);
                    reject(error);
                    return;
                  }
                  if (
                    ["once", "signal-reregister"].includes(mode) &&
                    responses.length === 1
                  )
                    send("second");
                  else {
                    clearTimeout(guard);
                    resolve({ responses, progress });
                  }
                };
                if (abortToSend) abortToSend();
                else send("first");
              }),
            { mode, url: corsOrigin + path },
          );
          assert.ok(
            result.responses.every((response) => response.body === "cors-body"),
          );
          const options = corsRequests.filter(
            (request) =>
              request.method === "OPTIONS" && request.path.startsWith(path),
          );
          assert.equal(
            options.length,
            mode === "signal-reregister"
              ? 2
              : ["once", "property"].includes(mode)
                ? 1
                : 0,
          );
          if (mode === "once") assert.equal(result.progress, 1);
          if (mode === "property") assert.ok(result.progress > 0);
          if (mode === "signal-reregister") assert.equal(result.progress, 2);
          if (["signal-stopped", "signal-reentrant"].includes(mode))
            assert.equal(result.progress, 0);
        },
      );
    }
  for (const native of [true, false])
    for (const point of ["loadstart", "upload", "headers", "progress"]) {
      await probe(
        "XHR " +
          (native ? "native control " : "") +
          "can abort inside " +
          point +
          " callbacks",
        async () => {
          await open(
            makeRule({
              pairs: [
                {
                  id: "pair",
                  urlPattern: "/api/lifecycle/",
                  urlOperator: "Contains",
                },
              ],
              response: { type: "dynamic", body: "" },
            }),
          );
          const result = await page.evaluate(
            ({ point, native }) =>
              new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const events = [];
                const upload = [];
                let applied = 0;
                let aborted = false;
                const guard = setTimeout(
                  () => reject(new Error("Reentrant abort did not complete")),
                  2000,
                );
                const abort = () => {
                  if (!aborted) {
                    aborted = true;
                    xhr.abort();
                  }
                };
                window.addEventListener("__sfvi_applied__", () => applied++);
                xhr.open(
                  "POST",
                  native ? "/api/native/stream" : "/api/lifecycle/stream",
                );
                for (const type of [
                  "loadstart",
                  "progress",
                  "load",
                  "abort",
                  "error",
                  "loadend",
                ]) {
                  xhr.addEventListener(type, () => {
                    events.push(type);
                    if (point === type) abort();
                  });
                  xhr.upload.addEventListener(type, () => {
                    upload.push(type);
                    if (point === "upload" && type === "loadstart") abort();
                  });
                }
                xhr.onreadystatechange = () => {
                  if (point === "headers" && xhr.readyState === 2) abort();
                };
                xhr.onloadend = () => {
                  clearTimeout(guard);
                  setTimeout(
                    () =>
                      resolve({
                        events,
                        upload,
                        applied,
                        state: xhr.readyState,
                      }),
                    250,
                  );
                };
                xhr.send("upload-body");
              }),
            { point, native },
          );
          assert.deepEqual(result.events.slice(-2), ["abort", "loadend"]);
          assert.equal(
            result.events.filter((type) => type === "abort").length,
            1,
          );
          assert.equal(result.events.includes("load"), false);
          assert.equal(result.applied, 0);
          assert.equal(result.state, 0);
          if (["upload", "loadstart"].includes(point))
            assert.deepEqual(result.upload.slice(-2), ["abort", "loadend"]);
        },
      );
    }
}
