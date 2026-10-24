// Barn 2 Sign-In: nightly backup into Google Drive.
//
// This runs in Google Apps Script (script.google.com), not in the app. The
// nightly job POSTs the day's CSVs here, and this writes them into a Drive
// folder owned by whoever deployed it. Setup steps are in Design.md §8.
//
// Each night makes a folder named by date (2026-10-23) holding all the CSVs,
// and replaces "Hours (latest).csv" at the top of the folder so the current
// totals are always one click away.

// The ID from the Drive folder's URL: drive.google.com/drive/folders/<THIS PART>
const FOLDER_ID = "PASTE_FOLDER_ID_HERE";
// Must match DRIVE_BACKUP_SECRET in Vercel. Any long random string.
const SECRET = "PASTE_SECRET_HERE";

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return reply({ ok: false, error: "wrong secret" });

  const root = DriveApp.getFolderById(FOLDER_ID);
  const day = folderNamed(root, body.day);
  for (const [name, csv] of Object.entries(body.files)) {
    replaceFile(day, name, csv);
    if (name === "hours.csv") replaceFile(root, "Hours (latest).csv", csv);
  }
  return reply({ ok: true });
}

function folderNamed(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

// Re-running the same night replaces that night's files instead of adding copies.
function replaceFile(folder, name, csv) {
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  folder.createFile(name, csv, MimeType.CSV);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
