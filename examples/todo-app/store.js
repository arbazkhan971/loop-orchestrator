let todos = [];
let nextId = 1;

export function list() {
  return todos.slice();
}

export function add(title) {
  const todo = { id: nextId++, title, completed: false };
  todos.push(todo);
  return todo;
}

export function toggle(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return null;
  todo.completed = !todo.completed;
  return { ...todo };
}

export { remove as delete };
function remove(id) {
  const index = todos.findIndex(t => t.id === id);
  if (index === -1) return false;
  todos.splice(index, 1);
  return true;
}

export function _reset() {
  todos = [];
  nextId = 1;
}
