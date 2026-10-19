function exportBackup() {
  backend.run.withSuccessHandler(data => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'ysb-migration.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).withFailureHandler(e => alert(e.message)).exportBackup();
}
async function importBackup(event) {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 3100000) throw new Error('匯入檔過大');
    const data = JSON.parse(await file.text());
    if (!confirm('匯入會覆蓋目前草稿和圖片，不會發布到 LINE。確定繼續？')) return;
    backend.run.withSuccessHandler(() => { location.reload(); })
      .withFailureHandler(e => alert(e.message)).importBackup(data);
  } catch (e) { alert('匯入失敗：' + e.message); }
  finally { event.target.value = ''; }
}
