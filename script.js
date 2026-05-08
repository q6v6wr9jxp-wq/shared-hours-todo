const TODO_API_URL = "https://script.google.com/macros/s/AKfycbwzASgjqK7xkMaTiBAFrIEOkU-j9rmhSEP6QqTk-iJ0Yg74mYo4E7cDkMu2SB8eUiYopQ/exec";
const TODO_API_TOKEN = "";

const PEOPLE = [
  {
    name: "Simpletom",
    place: "イギリス / London",
    timeZone: "Europe/London"
  },
  {
    name: "Craz",
    place: "アメリカ / New York",
    timeZone: "America/New_York"
  },
  {
    name: "sushi_dizasta",
    place: "日本 / Tokyo",
    timeZone: "Asia/Tokyo"
  }
];

const LOCAL_TODOS_KEY = "shared-hours-local-todos-v2";

const els = {
  peopleGrid: document.querySelector("#peopleGrid"),
  todoForm: document.querySelector("#todoForm"),
  todoInput: document.querySelector("#todoInput"),
  todoList: document.querySelector("#todoList"),
  todoStatus: document.querySelector("#todoStatus")
};

let todos = [];
let pendingCount = 0;

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
    const time = new Intl.DateTimeFormat("ja-JP", {
      timeZone: person.timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(now);

    return `
      <article class="person-card">
        <div>
          <h2>${escapeHtml(person.name)}</h2>
          <p>${escapeHtml(person.place)}</p>
        </div>
        <strong class="person-time">${time}</strong>
      </article>
    `;
  }).join("");
}

function setStatus(text) {
  els.todoStatus.textContent = text;
}

function beginPending() {
  pendingCount += 1;
  setStatus("Saving");
}

function endPending(success = true) {
  pendingCount = Math.max(0, pendingCount - 1);
  if (success && pendingCount === 0 && hasRemoteApi()) {
    setStatus("Google Sheets");
  }
}

function hasRemoteApi() {
  return TODO_API_URL.startsWith("https://script.google.com/");
}

function loadLocalTodos() {
  todos = JSON.parse(localStorage.getItem(LOCAL_TODOS_KEY) || "[]").map(normalizeTodo);
  sortTodos();
}

function saveLocalTodos() {
  localStorage.setItem(LOCAL_TODOS_KEY, JSON.stringify(todos));
}

function normalizeTodo(todo) {
  const createdAt = todo.createdAt || new Date().toISOString();

  return {
    id: String(todo.id),
    text: String(todo.text || ""),
    done: todo.done === true || todo.done === "true" || todo.done === "TRUE",
    createdAt,
    updatedAt: todo.updatedAt || createdAt,
    pending: Boolean(todo.pending)
  };
}

function isRealTodo(todo) {
  return todo.id && todo.text && !(todo.id === "id" && todo.text === "text");
}

function sortTodos() {
  todos.sort((a, b) => {
    const createdA = Date.parse(a.createdAt) || 0;
    const createdB = Date.parse(b.createdAt) || 0;
    return createdB - createdA;
  });
}

function createLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function findTodoIndex(id) {
  return todos.findIndex((todo) => todo.id === id);
}

function replaceTodos(nextTodos) {
  todos = nextTodos.map(normalizeTodo).filter(isRealTodo);
  sortTodos();
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
      url.searchParams.set(key, value);
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

async function refreshTodos({ silent = false } = {}) {
  if (!hasRemoteApi()) {
    loadLocalTodos();
    setStatus("Local");
    renderTodos();
    return;
  }

  if (!silent && pendingCount === 0) {
    setStatus("Syncing");
  }

  try {
    const payload = await jsonp("list");
    const pendingTodos = todos.filter((todo) => todo.pending);
    const pendingById = new Map(pendingTodos.map((todo) => [todo.id, todo]));
    const remoteTodos = (payload.todos || []).map(normalizeTodo);
    const mergedTodos = remoteTodos.map((todo) => pendingById.get(todo.id) || todo);

    pendingTodos.forEach((todo) => {
      if (!remoteTodos.some((remoteTodo) => remoteTodo.id === todo.id)) {
        mergedTodos.push(todo);
      }
    });

    replaceTodos(mergedTodos);
    if (pendingCount === 0) {
      setStatus("Google Sheets");
    }
  } catch {
    if (pendingCount === 0) {
      setStatus("Offline");
    }
  }
}

async function addTodo(text) {
  const now = new Date().toISOString();
  const optimisticTodo = {
    id: createLocalId(),
    text,
    done: false,
    createdAt: now,
    updatedAt: now,
    pending: hasRemoteApi()
  };

  todos.unshift(optimisticTodo);
  sortTodos();
  renderTodos();

  if (!hasRemoteApi()) {
    saveLocalTodos();
    return;
  }

  beginPending();
  let saved = false;
  try {
    const payload = await jsonp("add", { text });
    replaceTodos(payload.todos || []);
    saved = true;
  } catch {
    todos = todos.filter((todo) => todo.id !== optimisticTodo.id);
    renderTodos();
    setStatus("Error");
  } finally {
    endPending(saved);
  }
}

async function toggleTodo(id, done) {
  const index = findTodoIndex(id);
  if (index === -1 || todos[index].pending) {
    return;
  }

  const previous = todos[index].done;
  todos[index] = {
    ...todos[index],
    done,
    updatedAt: new Date().toISOString(),
    pending: hasRemoteApi()
  };
  renderTodos();

  if (!hasRemoteApi()) {
    saveLocalTodos();
    return;
  }

  beginPending();
  let saved = false;
  try {
    const payload = await jsonp("toggle", { id, done: String(done) });
    replaceTodos(payload.todos || []);
    saved = true;
  } catch {
    const nextIndex = findTodoIndex(id);
    if (nextIndex !== -1) {
      todos[nextIndex] = {
        ...todos[nextIndex],
        done: previous,
        pending: false
      };
      renderTodos();
    }
    setStatus("Error");
  } finally {
    endPending(saved);
  }
}

async function deleteTodo(id) {
  const index = findTodoIndex(id);
  if (index === -1) {
    return;
  }

  const removedTodo = todos[index];
  todos = todos.filter((todo) => todo.id !== id);
  renderTodos();

  if (!hasRemoteApi()) {
    saveLocalTodos();
    return;
  }

  if (removedTodo.pending) {
    return;
  }

  beginPending();
  let saved = false;
  try {
    const payload = await jsonp("delete", { id });
    replaceTodos(payload.todos || []);
    saved = true;
  } catch {
    todos.splice(Math.min(index, todos.length), 0, {
      ...removedTodo,
      pending: false
    });
    sortTodos();
    renderTodos();
    setStatus("Error");
  } finally {
    endPending(saved);
  }
}

function renderTodos() {
  if (!todos.length) {
    els.todoList.innerHTML = `<li class="empty-state">No todos</li>`;
    return;
  }

  els.todoList.innerHTML = todos.map((todo) => `
    <li class="todo-item ${todo.done ? "is-done" : ""} ${todo.pending ? "is-pending" : ""}" data-id="${escapeHtml(todo.id)}">
      <input class="todo-check" type="checkbox" ${todo.done ? "checked" : ""} ${todo.pending ? "disabled" : ""} aria-label="Complete todo" />
      <span class="todo-text">${escapeHtml(todo.text)}</span>
      <button class="todo-delete" type="button" ${todo.pending ? "disabled" : ""} aria-label="Delete todo">x</button>
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
refreshTodos();
window.setInterval(renderClocks, 1000);
window.setInterval(() => refreshTodos({ silent: true }), 30000);
