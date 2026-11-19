// "Copy for Notion" on an entry page: puts the entry's exported Markdown on the clipboard.
// The button starts hidden, so without scripts or clipboard access only the download link shows.
const load = async address => {
  const response = await fetch(address);
  if (!response.ok) throw new Error(`Export request failed: ${response.status}`);
  return response.text();
};

// For browsers that refuse the clipboard API: copy from a temporary, off-screen text field.
const copyFromField = value => {
  const field = Object.assign(document.createElement('textarea'), { value, readOnly: true });
  field.style.cssText = 'position:fixed;top:0;left:-200vw;opacity:0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Copy was refused');
};

const copy = async text => {
  if (navigator.clipboard) {
    try {
      // Handing the clipboard a pending result keeps the click's permission while the file loads.
      if (window.ClipboardItem && navigator.clipboard.write) {
        return await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(value => new Blob([value], { type: 'text/plain' })) })]);
      }
      return await navigator.clipboard.writeText(await text);
    } catch { /* fall through to the text field */ }
  }
  copyFromField(await text);
};

for (const button of document.querySelectorAll('[data-copy-md]')) {
  const status = button.parentElement.querySelector('[data-copy-status]');
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await copy(load(button.dataset.copyMd));
      status.textContent = 'Copied.';
    } catch {
      status.textContent = 'Copy failed. Use Download Markdown instead.';
    }
  });
}
