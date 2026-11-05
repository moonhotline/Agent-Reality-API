for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const text = document.getElementById(button.dataset.copy)?.textContent;
    if (!text) return;
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      status.textContent = 'Request example copied. Set your base URL and API key before running it.';
      setTimeout(() => { button.textContent = 'Copy'; }, 1800);
    } catch { status.textContent = 'Copy is unavailable. Select the code example and copy it manually.'; }
  });
}
