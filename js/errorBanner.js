(function () {
  window.addEventListener('error', function (e) {
    var box = document.getElementById('errbox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'errbox';
      box.style.position = 'fixed';
      box.style.left = '0'; box.style.right = '0'; box.style.bottom = '0';
      box.style.background = 'rgba(200,0,0,0.9)'; box.style.color = '#fff';
      box.style.font = '12px/1.4 system-ui, sans-serif'; box.style.padding = '8px 12px';
      box.style.zIndex = '99999'; document.body.appendChild(box);
    }
    box.textContent = '[JS Error] ' + e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || '');
  });
})();
