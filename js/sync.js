// sync.js — export/import progress to move between devices

(function () {
  const EXPORT_KEYS = [/^progress_/, /^np_daily_/, /^tm_attempts_v1$/];

  function pickItems(ls) {
    const out = [];
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (EXPORT_KEYS.some(rx => rx.test(key))) {
        out.push({ key, value: ls.getItem(key) });
      }
    }
    return out;
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function doExport() {
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      items: pickItems(localStorage)
    };
    const name = `flashcards-progress-${today()}.json`;
    download(name, JSON.stringify(payload, null, 2));
  }

  function doImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || '{}'));
        if (!data || !Array.isArray(data.items)) {
          alert('Invalid file.');
          return;
        }
        // Write keys
        data.items.forEach(({ key, value }) => {
          if (key && typeof value === 'string') {
            localStorage.setItem(key, value);
          }
        });
        alert('Import complete. The page will reload to apply progress.');
        location.reload();
      } catch (e) {
        console.error(e);
        alert('Import failed: ' + e.message);
      }
    };
    reader.readAsText(file);
  }

  function bind() {
    const btnExport = document.getElementById('fc-export');
    const btnImport = document.getElementById('fc-import');
    const inpFile = document.getElementById('fc-import-file');
    if (!btnExport || !btnImport || !inpFile) return;

    btnExport.addEventListener('click', doExport);
    btnImport.addEventListener('click', () => inpFile.click());
    inpFile.addEventListener('change', () => doImport(inpFile.files && inpFile.files[0]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
