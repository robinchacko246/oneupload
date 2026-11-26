const form = document.getElementById('loginForm');
const pw = document.getElementById('password');
const err = document.getElementById('err');
const go = document.getElementById('go');

document.getElementById('toggle').addEventListener('click', () => {
  pw.type = pw.type === 'password' ? 'text' : 'password';
  pw.focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  go.disabled = true;
  go.textContent = 'Checking…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Login failed');
    go.textContent = 'Welcome ✓';
    const next = new URLSearchParams(location.search).get('next');
    location.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
  } catch (ex) {
    err.textContent = ex.message === 'Wrong password' ? 'പാസ്‌വേഡ് തെറ്റാണ്, വീണ്ടും ശ്രമിക്കൂ' : ex.message;
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
    pw.select();
    go.disabled = false;
    go.textContent = 'Login';
  }
});
