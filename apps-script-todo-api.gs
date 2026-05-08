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

    if (action !== "list") {
      lock.waitLock(8000);
    }

    try {
      if (action === "add") {
        addTodo(params.text);
      } else if (action === "toggle") {
        toggleTodo(params.id, params.done === "true");
      } else if (action === "delete") {
        deleteTodo(params.id);
      } else if (action !== "list") {
        throw new Error("unknown action");
      }

      return respond(e, {
        ok: true,
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
    .map(function (row) {
      return {
        id: String(row[0]),
        text: String(row[1]),
        done: row[2] === true || row[2] === "TRUE" || row[2] === "true",
        createdAt: row[3],
        updatedAt: row[4]
      };
    })
    .sort(function (a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function addTodo(text) {
  const value = String(text || "").trim();
  if (!value) {
    throw new Error("empty todo");
  }

  const now = new Date().toISOString();
  getSheet().appendRow([Utilities.getUuid(), value, false, now, now]);
}

function toggleTodo(id, done) {
  const location = findTodoRow(id);
  location.sheet.getRange(location.row, 3).setValue(done);
  location.sheet.getRange(location.row, 5).setValue(new Date().toISOString());
}

function deleteTodo(id) {
  const location = findTodoRow(id);
  location.sheet.deleteRow(location.row);
}

function findTodoRow(id) {
  const sheet = getSheet();
  const values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
  const target = String(id || "");

  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0]) === target) {
      return {
        sheet: sheet,
        row: index + 1
      };
    }
  }

  throw new Error("todo not found");
}
