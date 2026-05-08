# Shared Hours

## Google Sheets Todo Setup

1. Open the spreadsheet:
   https://docs.google.com/spreadsheets/d/1dRjpQPCWd-ZWmqAfl9EW2nF9WXVMrWdNOWMfus1fYP0/edit
2. Open `Extensions` -> `Apps Script`.
3. Paste the contents of `apps-script-todo-api.gs` into the Apps Script editor.
4. Save.
5. Click `Deploy` -> `New deployment`.
6. Select `Web app`.
7. Set `Execute as` to `Me`.
8. Set `Who has access` to `Anyone`.
9. Click `Deploy`, approve permissions, then copy the `/exec` Web app URL.
10. Open `script.js` and paste that URL into `TODO_API_URL`.

Current URL:

```txt
https://script.google.com/macros/s/AKfycbwzASgjqK7xkMaTiBAFrIEOkU-j9rmhSEP6QqTk-iJ0Yg74mYo4E7cDkMu2SB8eUiYopQ/exec
```

If the site shows `Offline`, open `Deploy` -> `Manage deployments`, edit the web app deployment, and make sure `Who has access` is set to `Anyone`.

The Apps Script creates and uses a `Todos` sheet tab automatically.
