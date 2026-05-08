const SPREADSHEET_ID = "1dRjpQPCWd-ZWmqAfl9EW2nF9WXVMrWdNOWMfus1fYP0";
const SHEET_NAME = "Todos";
const API_TOKEN = "";
const HEADERS = ["id", "text", "done", "createdAt", "updatedAt"];

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const params = parseParams(e);
    if (API_TOKEN && params.token !== API_TOKEN) {
      throw new Error("unauthorized");
    }

    const action = (params.action || "list").toLowerCase();
    const lock = LockService.getScriptLock();
    let todo = null;

    if (action !== "list") {
      lock.waitLock(8000);
    }

    try {
      if (action === "add") {
        todo = upsertTodo(params);
      } else if (action === "toggle") {
        todo = toggleTodo(params);
      } else if (action === "delete") {
        deleteTodo(params);
      } else if (action !== "list") {
        throw new Error("unknown action");
      }

      return respond(e, {
        ok: true,
        todo: todo,
        todos: listTodos()
      });
    } finally {
      if (action !== "list") {
        lock.releaseLock();
      }
    }
  } catch (error) {
    return respond(e, {
      ok: false,
      error: error.message
    });
  }
}

function parseParams(e) {
  const params = Object.assign({}, e.parameter || {});
  const body = e.postData && e.postData.contents;

  if (body) {
    try {
      Object.assign(params, JSON.parse(body));
    } catch (error) {
      body.split("&").forEach(function (pair) {
        const parts = pair.split("=");
        if (parts[0]) {
          params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || "");
        }
      });
    }
  }

  return params;
}

function respond(e, payload) {
  const callback = e.parameter && e.parameter.callback;
  const json = JSON.stringify(payload);

  if (callback) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "bad callback" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  } else {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }

  return sheet;
}

function listTodos() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return sheet
    .getRange(2, 1, lastRow - 1, HEADERS.length)
    .getValues()
    .filter(function (row) {
      return row[0] && row[1] && !(row[0] === "id" && row[1] === "text");
    })
    .map(rowToTodo)
    .sort(function (a, b) {
      return dateValue(b.createdAt) - dateValue(a.createdAt);
    });
}

function upsertTodo(params) {
  const text = String(params.text || "").trim();
  if (!text) {
    throw new Error("empty todo");
  }

  const now = new Date().toISOString();
  const id = String(params.id || Utilities.getUuid());
  const createdAt = String(params.createdAt || now);
  const updatedAt = String(params.updatedAt || now);
  const done = parseBoolean(params.done);
  const sheet = getSheet();
  const location = findTodoRow(id, sheet);

  if (!location) {
    sheet.appendRow([id, text, done, createdAt, updatedAt]);
    return {
      id: id,
      text: text,
      done: done,
      createdAt: createdAt,
      updatedAt: updatedAt
    };
  }

  const existing = rowToTodo(sheet.getRange(location.row, 1, 1, HEADERS.length).getValues()[0]);
  if (dateValue(updatedAt) < dateValue(existing.updatedAt)) {
    return existing;
  }

  sheet.getRange(location.row, 1, 1, HEADERS.length).setValues([[id, text, done, existing.createdAt || createdAt, updatedAt]]);
  return {
    id: id,
    text: text,
    done: done,
    createdAt: existing.createdAt || createdAt,
    updatedAt: updatedAt
  };
}

function toggleTodo(params) {
  const id = String(params.id || "");
  const sheet = getSheet();
  const location = findTodoRow(id, sheet);

  if (!location) {
    return null;
  }

  const existing = rowToTodo(sheet.getRange(location.row, 1, 1, HEADERS.length).getValues()[0]);
  const updatedAt = String(params.updatedAt || new Date().toISOString());

  if (dateValue(updatedAt) < dateValue(existing.updatedAt)) {
    return existing;
  }

  const done = parseBoolean(params.done);
  sheet.getRange(location.row, 3).setValue(done);
  sheet.getRange(location.row, 5).setValue(updatedAt);

  return {
    id: existing.id,
    text: existing.text,
    done: done,
    createdAt: existing.createdAt,
    updatedAt: updatedAt
  };
}

function deleteTodo(params) {
  const id = String(params.id || "");
  const sheet = getSheet();
  const location = findTodoRow(id, sheet);

  if (!location) {
    return;
  }

  const deletedAt = params.deletedAt;
  if (deletedAt) {
    const existing = rowToTodo(sheet.getRange(location.row, 1, 1, HEADERS.length).getValues()[0]);
    if (dateValue(deletedAt) < dateValue(existing.updatedAt)) {
      return;
    }
  }

  sheet.deleteRow(location.row);
}

function findTodoRow(id, sheet) {
  const targetSheet = sheet || getSheet();
  const values = targetSheet.getRange(1, 1, Math.max(targetSheet.getLastRow(), 1), 1).getValues();
  const target = String(id || "");

  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0]) === target) {
      return {
        sheet: targetSheet,
        row: index + 1
      };
    }
  }

  return null;
}

function rowToTodo(row) {
  return {
    id: String(row[0]),
    text: String(row[1]),
    done: row[2] === true || row[2] === "TRUE" || row[2] === "true",
    createdAt: String(row[3] || ""),
    updatedAt: String(row[4] || row[3] || "")
  };
}

function parseBoolean(value) {
  return value === true || value === "true" || value === "TRUE";
}

function dateValue(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
