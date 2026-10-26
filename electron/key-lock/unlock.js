// The unlock window's page: one field, two buttons, the answer said plainly.
const code = document.getElementById('code');
const error = document.getElementById('error');
const unlock = document.getElementById('unlock');

const tryUnlock = async () => {
  unlock.disabled = true;
  error.textContent = 'OPENING…';
  const result = await window.keyLock.unlock(code.value);
  if (!result.ok) {
    error.textContent = result.error;
    unlock.disabled = false;
  }
};

unlock.addEventListener('click', tryUnlock);
code.addEventListener('keydown', (event) => { if (event.key === 'Enter') tryUnlock(); });
document.getElementById('quit').addEventListener('click', () => window.keyLock.quit());
code.focus();
