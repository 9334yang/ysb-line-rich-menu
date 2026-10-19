// 暫時加到舊 Apps Script 專案，使用擁有者帳號手動執行。
// 只匯出草稿與圖片，不匯出 LINE token、使用者資料或自動發布。
function ysbExportMigrationFile() {
  ysbRequireAuth_();
  const images = {};
  ['about', 'member'].forEach(function(tab) {
    images[tab] = ysbGetMenuImageDataInternal_(tab);
  });
  const backup = { version: 1, draft: getMenuDraftInternal_(), images: images };
  const file = DriveApp.createFile('ysb-migration.json', JSON.stringify(backup), MimeType.PLAIN_TEXT);
  Logger.log('請從自己的 Google Drive 下載匯出檔：' + file.getUrl());
}
