const $ = (s) => document.getElementById(s);
const form = $('loginForm');
const err = $('err');
const go = $('go');

const mode = () => document.querySelector('input[name=authMode]:checked').value;

function applyMode() {
  const register = mode() === 'register';
  $('name').hidden = !register;
  $('invite').hidden = !register;
  $('password').autocomplete = register ? 'new-password' : 'current-password';
  $('password').placeholder = register ? 'Password (8+ അക്ഷരം)' : 'Password';
  go.textContent = register ? 'Create account' : 'Login';
  $('hint').hidden = !register;
  err.textContent = '';
}

document.querySelectorAll('input[name=authMode]').forEach((r) => r.addEventListener('change', applyMode));

// First visit ever: nobody has an account yet, so start on "Create account".
fetch('/api/auth-info')
  .then((r) => r.json())
  .then((info) => {
    $('hint').textContent = info.firstUser
      ? 'ആദ്യത്തെ account ആണ് (owner). പഴയ app-ലെ channels-ഉം posts-ഉം ഇതിലേക്ക് മാറും. Invite code = പഴയ app password.'
      : 'Team-ലെ ആളുകൾക്ക് owner തരുന്ന invite code വേണം.';
    if (info.firstUser) {
      document.querySelector('input[name=authMode][value=register]').checked = true;
    }
    applyMode();
  })
  .catch(applyMode);

$('toggle').addEventListener('click', () => {
  $('password').type = $('password').type === 'password' ? 'text' : 'password';
  $('password').focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const register = mode() === 'register';
  const label = go.textContent;
  go.disabled = true;
  go.textContent = register ? 'Creating…' : 'Checking…';
  try {
    const body = { email: $('email').value.trim(), password: $('password').value };
    if (register) Object.assign(body, { name: $('name').value.trim(), invite: $('invite').value });
    const res = await fetch(register ? '/api/register' : '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Something went wrong');
    go.textContent = 'Welcome ✓';
    const next = new URLSearchParams(location.search).get('next');
    location.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : register ? '/#channels' : '/');
  } catch (ex) {
    err.textContent = ex.message;
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
    go.disabled = false;
    go.textContent = label;
  }
});
