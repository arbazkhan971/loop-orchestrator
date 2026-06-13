import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { server } from "./server.js";
import * as store from "./store.js";

let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  base = `http://localhost:${port}`;
});

after(() => server.close());
beforeEach(() => store._reset());

test("GET /api/todos returns an empty list initially", async () => {
  const res = await fetch(`${base}/api/todos`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("POST /api/todos creates a todo", async () => {
  const res = await fetch(`${base}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "write tests" })
  });
  assert.equal(res.status, 201);
  const todo = await res.json();
  assert.equal(todo.title ?? todo.text, "write tests");
});

test("POST /api/todos rejects an empty title", async () => {
  const res = await fetch(`${base}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "" })
  });
  assert.equal(res.status, 400);
});

test("toggle and delete round-trip", async () => {
  const created = await (await fetch(`${base}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "round trip" })
  })).json();

  const toggled = await (await fetch(`${base}/api/todos/${created.id}/toggle`, { method: "POST" })).json();
  assert.equal(toggled.completed, true);

  const del = await fetch(`${base}/api/todos/${created.id}`, { method: "DELETE" });
  assert.equal(del.status, 204);

  const list = await (await fetch(`${base}/api/todos`)).json();
  assert.equal(list.length, 0);
});

test("unknown route returns 404", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});
