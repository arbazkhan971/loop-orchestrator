import { test, beforeEach } from "node:test";
import assert from "node:assert";
import * as store from "./store.js";

beforeEach(() => store._reset());

test("add returns a todo with an id and incomplete state", () => {
  const todo = store.add("buy milk");
  assert.equal(todo.title ?? todo.text, "buy milk");
  assert.equal(todo.completed, false);
  assert.ok(todo.id > 0);
});

test("list returns all added todos", () => {
  store.add("a");
  store.add("b");
  assert.equal(store.list().length, 2);
});

test("toggle flips completion", () => {
  const t = store.add("task");
  const toggled = store.toggle(t.id);
  assert.equal(toggled.completed, true);
  assert.equal(store.toggle(t.id).completed, false);
});

test("toggle of a missing id returns null", () => {
  assert.equal(store.toggle(999), null);
});

test("delete removes the todo", () => {
  const t = store.add("gone");
  assert.equal(store.delete(t.id), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.delete(t.id), false);
});

test("list returns a copy, not the internal array", () => {
  store.add("x");
  const a = store.list();
  a.push({ id: 123, title: "injected" });
  assert.equal(store.list().length, 1);
});
