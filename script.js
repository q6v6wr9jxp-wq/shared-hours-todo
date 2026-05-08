const TODO_API_URL = "https://script.google.com/macros/s/AKfycbwzASgjqK7xkMaTiBAFrIEOkU-j9rmhSEP6QqTk-iJ0Yg74mYo4E7cDkMu2SB8eUiYopQ/exec";
const TODO_API_TOKEN = "";

const PEOPLE = [
  {
    name: "sushi_dizasta",
    city: "Tokyo",
    place: "Japan",
    timeZone: "Asia/Tokyo"
  },
  {
    name: "Craz",
    city: "New York",
    place: "United States",
    timeZone: "America/New_York"
  },
  {
    name: "Simpletom",
    city: "London",
    place: "United Kingdom",
    timeZone: "Europe/London"
  }
];

const LOCAL_STATE_KEY = "shared-hours-todo-state-v4";
const LEGACY_LOCAL_TODOS_KEY = "shared-hours-local-todos-v2";
const SYNC_DEBOUNCE_MS = 350;
const RETRY_DELAY_MS = 2200;

const els = {
  peopleGrid: document.querySelector("#peopleGrid"),
  todoForm: document.querySelector("#todoForm"),
  todoInput: document.querySelector("#todoInput"),
  todoList: document.querySelector("#todoList"),
  todoStatus: document.querySelector("#todoStatus")
};

let todos = [];
let tombstones = {};
let syncTimer = null;
let syncInProgress = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

function renderClocks() {
  const now = new Date();
  els.peopleGrid.innerHTML = PEOPLE.map((person) => {
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: person.timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit"
    }).format(now);
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: person.timeZone,
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(now);
    const localHour = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: person.timeZone,
      hourCycle: "h23",
      hour: "2-digit"
    }).format(now));
    const isDay = localHour >= 6 && localHour < 18;

    return `
      <article class="person-card">
        <div class="clock-top">
          <div>
            <h2>${escapeHtml(person.city)}</h2>
            <p>${escapeHtml(person.name)} / ${escapeHtml(person.place)}</p>
          </div>
          <span class="clock-date">${escapeHtml(date)}</span>
        </div>
        <div class="clock-bottom">
          <strong class="person-time">${time}</strong>
          <span class="clock-period">${isDay ? "Day" : "Night"}</span>
        </div>
      </article>
    `;
  }).join("");
}

function hasRemoteApi() {
  return TODO_API_URL.startsWith("https://script.google.com/");
}

function setStableStatus() {
  els.todoStatus.textContent = hasRemoteApi() ? "Google Sheets" : "Local";
}

function normalizeTodo(todo) {
  const createdAt = todo.createdAt || new Date().toISOString();

  return {
    id: String(todo.id || createLocalId()),
    text: String(todo.text || ""),
    done: todo.done === true || todo.done === "true" || todo.done === "TRUE",
    createdAt,
    updatedAt: todo.updatedAt || createdAt,
    dirty: Boolean(todo.dirty)
  };
}

function isRealTodo(todo) {
  return todo.id && todo.text && !(todo.id === "id" && todo.text === "text");
}

function isLocalId(id) {
  return String(id).startsWith("local-");
}

function createLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sortTodos() {
  todos.sort((a, b) => {
    const createdA = Date.parse(a.createdAt) || 0;
    const createdB = Date.parse(b.createdAt) || 0;
    return createdB - createdA;
  });
}

function dedupeTodos(nextTodos) {
  const byId = new Map();

  nextTodos.forEach((todo) => {
    if (!isRealTodo(todo)) {
      return;
    }

    const previous = byId.get(todo.id);
    if (!previous || (Date.parse(todo.updatedAt) || 0) >= (Date.parse(previous.updatedAt) || 0)) {
      byId.set(todo.id, todo);
    }
  });

  return Array.from(byId.values());
}

function saveLocalState() {
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify({ todos, tombstones }));
}

function loadLocalState() {
  const saved = JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || "null");

  if (saved && Array.isArray(saved.todos)) {
    todos = saved.todos.map(normalizeTodo).filter(isRealTodo);
    tombstones = saved.tombstones || {};
  } else {
    todos = JSON.parse(localStorage.getItem(LEGACY_LOCAL_TODOS_KEY) || "[]")
      .map(normalizeTodo)
      .filter(isRealTodo);
    tombstones = {};
  }

  sortTodos();
}

function findTodoIndex(id) {
  return todos.findIndex((todo) => todo.id === id);
}

function updateTodoId(oldId, newTodo) {
  const index = findTodoIndex(oldId);
  if (index === -1) {
    return;
  }

  todos[index] = {
    ...todos[index],
    id: newTodo.id,
    createdAt: newTodo.createdAt || todos[index].createdAt,
    dirty: todos[index].dirty || todos[index].done !== newTodo.done
  };

  if (tombstones[oldId]) {
    tombstones[newTodo.id] = tombstones[oldId];
    delete tombstones[oldId];
  }
}

function mergeRemoteTodos(remoteTodos) {
  const localById = new Map(todos.map((todo) => [todo.id, todo]));
  const remoteIds = new Set();
  const merged = [];

  remoteTodos.map(normalizeTodo).filter(isRealTodo).forEach((remoteTodo) => {
    remoteIds.add(remoteTodo.id);

    if (tombstones[remoteTodo.id]) {
      return;
    }

    const localTodo = localById.get(remoteTodo.id);
    merged.push(localTodo?.dirty ? localTodo : remoteTodo);
  });

  todos.forEach((localTodo) => {
    if (localTodo.dirty && !remoteIds.has(localTodo.id) && !tombstones[localTodo.id]) {
      merged.push(localTodo);
    }
  });

  todos = dedupeTodos(merged);
  sortTodos();
  saveLocalState();
  renderTodos();
}

function jsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `sharedHoursTodo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = new URL(TODO_API_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);

    if (TODO_API_TOKEN) {
      url.searchParams.set("token", TODO_API_TOKEN);
    }

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });

    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 12000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload?.ok) {
        reject(new Error(payload?.error || "request failed"));
        return;
      }
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("network error"));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

async function refreshTodos() {
  if (!hasRemoteApi()) {
    return;
  }

  try {
    const payload = await jsonp("list");
    mergeRemoteTodos(payload.todos || []);
  } catch {
    scheduleSync(RETRY_DELAY_MS);
  }
}

function hasPendingSync() {
  return todos.some((todo) => todo.dirty) || Object.keys(tombstones).length > 0;
}

function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!hasRemoteApi()) {
    saveLocalState();
    return;
  }

  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(flushSync, delay);
}

async function flushSync() {
  if (!hasRemoteApi() || syncInProgress) {
    return;
  }

  syncInProgress = true;

  try {
    const dirtyTodos = todos.filter((todo) => todo.dirty);
    for (const todo of dirtyTodos) {
      await syncTodo(todo);
    }

    const deletes = Object.entries(tombstones);
    for (const [id, deletedAt] of deletes) {
      await syncDelete(id, deletedAt);
    }
  } finally {
    syncInProgress = false;

    if (hasPendingSync()) {
      scheduleSync(RETRY_DELAY_MS);
    } else {
      refreshTodos();
    }
  }
}

function addTodo(text) {
  const now = new Date().toISOString();
  const todo = {
    id: createLocalId(),
    text,
    done: false,
    createdAt: now,
    updatedAt: now,
    dirty: true
  };

  todos.unshift(todo);
  sortTodos();
  saveLocalState();
  renderTodos();
  scheduleSync();
}

function toggleTodo(id, done) {
  const index = findTodoIndex(id);
  if (index === -1) {
    return;
  }

  todos[index] = {
    ...todos[index],
    done,
    updatedAt: new Date().toISOString(),
    dirty: true
  };

  saveLocalState();
  renderTodos();
  scheduleSync();
}

function deleteTodo(id) {
  const index = findTodoIndex(id);
  if (index === -1) {
    return;
  }

  const deletedAt = new Date().toISOString();
  todos = todos.filter((todo) => todo.id !== id);
  tombstones[id] = deletedAt;

  saveLocalState();
  renderTodos();
  scheduleSync();
}

async function syncTodo(sentTodo) {
  if (tombstones[sentTodo.id]) {
    return;
  }

  const index = findTodoIndex(sentTodo.id);
  if (index === -1) {
    return;
  }

  const snapshot = { ...todos[index] };

  try {
    if (isLocalId(snapshot.id)) {
      const payload = await jsonp("add", snapshot);
      handleAddResponse(snapshot, payload);
      return;
    }

    await jsonp("toggle", {
      id: snapshot.id,
      done: String(snapshot.done),
      updatedAt: snapshot.updatedAt
    });

    markCleanIfUnchanged(snapshot.id, snapshot.updatedAt);
  } catch {
    scheduleSync(RETRY_DELAY_MS);
  }
}

function handleAddResponse(sentTodo, payload) {
  const remoteTodo = findRemoteAddedTodo(sentTodo, payload);
  const currentIndex = findTodoIndex(sentTodo.id);

  if (remoteTodo && remoteTodo.id !== sentTodo.id) {
    updateTodoId(sentTodo.id, remoteTodo);
  }

  const currentId = remoteTodo?.id || sentTodo.id;
  const nextIndex = findTodoIndex(currentId);

  if (nextIndex === -1) {
    if (remoteTodo && tombstones[sentTodo.id]) {
      tombstones[remoteTodo.id] = tombstones[sentTodo.id];
      delete tombstones[sentTodo.id];
    }
    return;
  }

  const currentTodo = todos[nextIndex];
  const remoteDone = remoteTodo ? remoteTodo.done : sentTodo.done;

  if (currentIndex !== -1 && currentTodo.updatedAt === sentTodo.updatedAt && currentTodo.done === remoteDone) {
    todos[nextIndex] = {
      ...currentTodo,
      dirty: false
    };
  } else {
    todos[nextIndex] = {
      ...currentTodo,
      dirty: true
    };
  }

  saveLocalState();
  renderTodos();
}

function findRemoteAddedTodo(sentTodo, payload) {
  if (payload.todo) {
    return normalizeTodo(payload.todo);
  }

  const localIds = new Set(todos.map((todo) => todo.id));
  const remoteTodos = (payload.todos || [])
    .map(normalizeTodo)
    .filter(isRealTodo)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

  return remoteTodos.find((todo) => todo.id === sentTodo.id)
    || remoteTodos.find((todo) => todo.text === sentTodo.text && !localIds.has(todo.id))
    || null;
}

function markCleanIfUnchanged(id, sentUpdatedAt) {
  const index = findTodoIndex(id);
  if (index === -1) {
    return;
  }

  if (todos[index].updatedAt === sentUpdatedAt) {
    todos[index] = {
      ...todos[index],
      dirty: false
    };
    saveLocalState();
    renderTodos();
  }
}

async function syncDelete(id, deletedAt) {
  if (isLocalId(id)) {
    delete tombstones[id];
    saveLocalState();
    return;
  }

  try {
    await jsonp("delete", { id, deletedAt });
    if (tombstones[id] === deletedAt) {
      delete tombstones[id];
      saveLocalState();
    }
  } catch {
    scheduleSync(RETRY_DELAY_MS);
  }
}

function renderTodos() {
  if (!todos.length) {
    els.todoList.innerHTML = `<li class="empty-state">No todos</li>`;
    return;
  }

  els.todoList.innerHTML = todos.map((todo) => `
    <li class="todo-item ${todo.done ? "is-done" : ""}" data-id="${escapeHtml(todo.id)}">
      <input class="todo-check" type="checkbox" ${todo.done ? "checked" : ""} aria-label="Complete todo" />
      <span class="todo-text">${escapeHtml(todo.text)}</span>
      <button class="todo-delete" type="button" aria-label="Delete todo">x</button>
    </li>
  `).join("");
}

els.todoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = els.todoInput.value.trim();
  if (!text) {
    return;
  }

  els.todoInput.value = "";
  addTodo(text);
  els.todoInput.focus();
});

els.todoList.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains("todo-check")) {
    return;
  }

  const item = target.closest(".todo-item");
  if (!item) {
    return;
  }

  toggleTodo(item.dataset.id, target.checked);
});

els.todoList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains("todo-delete")) {
    return;
  }

  const item = target.closest(".todo-item");
  if (!item) {
    return;
  }

  deleteTodo(item.dataset.id);
});

renderClocks();
loadLocalState();
setStableStatus();
renderTodos();
refreshTodos();
scheduleSync(1200);
window.setInterval(renderClocks, 1000);
window.setInterval(refreshTodos, 30000);
